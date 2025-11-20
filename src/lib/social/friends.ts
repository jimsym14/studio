import { Timestamp } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { emitFriendEvent } from '@/lib/realtime/server';

import {
  FRIEND_REQUESTS_COLLECTION,
  FRIENDSHIPS_COLLECTION,
  MAX_FRIEND_REQUEST_MESSAGE_LENGTH,
} from './constants';
import { ApiError } from './errors';
import { enqueueNotification } from './notifications';
import { ensureFriendChat } from './chats';
import type { FriendRequestRecord, FriendshipRecord } from './types';
import { sanitizeUsername, usernameToLower } from './username';
import { fetchProfileById } from './profiles';
import { buildFriendshipId, buildRequestId } from './utils';
import type { FriendRequestSummary, FriendSummary } from '@/types/social';

const PROFILES_COLLECTION = 'profiles';

export interface FriendRequestInput {
  fromUserId: string;
  toUserId?: string;
  toUsername?: string;
  message?: string;
}

export type FriendRequestAction = 'accept' | 'decline' | 'cancel';

const truncateMessage = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_FRIEND_REQUEST_MESSAGE_LENGTH);
};

const findUserIdByUsername = async (username: string): Promise<{ uid: string } | null> => {
  const normalized = usernameToLower(username);
  const snapshot = await adminDb
    .collection(PROFILES_COLLECTION)
    .where('usernameLower', '==', normalized)
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return { uid: snapshot.docs[0].id };
};

const assertTargetUser = async (input: FriendRequestInput) => {
  if (input.toUserId) {
    return input.toUserId;
  }
  if (input.toUsername) {
    const sanitized = sanitizeUsername(input.toUsername);
    const match = await findUserIdByUsername(sanitized);
    if (!match) {
      throw new ApiError(404, 'No player found with that username', { code: 'user_not_found' });
    }
    return match.uid;
  }
  throw new ApiError(400, 'Provide a username or userId', { code: 'invalid_request' });
};

export const getFriendshipRecord = async (userA: string, userB: string) => {
  const friendshipId = buildFriendshipId(userA, userB);
  const snapshot = await adminDb.collection(FRIENDSHIPS_COLLECTION).doc(friendshipId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as FriendshipRecord;
  return { ...data, id: friendshipId };
};

const friendshipExists = async (userA: string, userB: string) => {
  const record = await getFriendshipRecord(userA, userB);
  return Boolean(record);
};

const loadRequestRecord = async (requestId: string) => {
  const snapshot = await adminDb.collection(FRIEND_REQUESTS_COLLECTION).doc(requestId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as FriendRequestRecord;
  return { ...data, id: snapshot.id };
};

const isMissingIndexError = (error: unknown) => {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: string }).code;
  if (typeof code === 'string' && code.toLowerCase() === 'failed-precondition') {
    return true;
  }
  const message = (error as { message?: string }).message;
  if (typeof message === 'string' && message.toLowerCase().includes('index')) {
    return true;
  }
  return false;
};

export const listFriends = async (userId: string): Promise<FriendSummary[]> => {
  const snapshot = await adminDb
    .collection(FRIENDSHIPS_COLLECTION)
    .where('userIds', 'array-contains', userId)
    .get();

  if (snapshot.empty) return [];

  const records = snapshot.docs.map((doc) => {
    const data = doc.data() as FriendshipRecord;
    return { ...data, id: doc.id };
  });
  const summaries = await Promise.all(
    records.map(async (record) => {
      const otherUserId = record.userIds.find((uid) => uid !== userId) ?? userId;
      const profile = await fetchProfileById(otherUserId);
      return {
        friendshipId: record.id,
        userId: otherUserId,
        username: profile?.username ?? null,
        displayName: profile?.displayName ?? profile?.username ?? null,
        photoURL: profile?.photoURL ?? null,
        lastInteractionAt: record.lastInteractionAt ? record.lastInteractionAt.toDate().toISOString() : null,
        activity: null,
      } satisfies FriendSummary;
    })
  );

  return summaries;
};

export const listFriendRequests = async (
  userId: string,
  direction: 'incoming' | 'outgoing' = 'incoming'
): Promise<FriendRequestSummary[]> => {
  const field = direction === 'incoming' ? 'to' : 'from';
  const collectionRef = adminDb.collection(FRIEND_REQUESTS_COLLECTION);
  const baseQuery = collectionRef.where(field, '==', userId);

  const queryWithOrdering = baseQuery.orderBy('createdAt', 'desc').limit(50);
  let snapshot;
  try {
    snapshot = await queryWithOrdering.get();
  } catch (error) {
    if (isMissingIndexError(error)) {
      console.warn('Missing index for friend requests query, falling back to unsorted fetch', {
        userId,
        direction,
        field,
      });
      snapshot = await baseQuery.limit(50).get();
    } else {
      throw error;
    }
  }

  if (snapshot.empty) return [];

  const summaries = snapshot.docs.map((doc) => {
    const data = doc.data() as FriendRequestRecord;
    return {
      id: doc.id,
      from: data.from,
      to: data.to,
      status: data.status,
      message: data.message ?? null,
      createdAt: data.createdAt ? data.createdAt.toDate().toISOString() : null,
      updatedAt: data.updatedAt ? data.updatedAt.toDate().toISOString() : null,
    } satisfies FriendRequestSummary;
  });

  return summaries.sort((a, b) => {
    const aTime = a.updatedAt ?? a.createdAt ?? '';
    const bTime = b.updatedAt ?? b.createdAt ?? '';
    return bTime.localeCompare(aTime);
  });
};

export const sendFriendRequest = async (input: FriendRequestInput) => {
  const toUserId = await assertTargetUser(input);

  if (toUserId === input.fromUserId) {
    throw new ApiError(400, 'You cannot add yourself', { code: 'self_request' });
  }

  const alreadyFriends = await friendshipExists(input.fromUserId, toUserId);
  if (alreadyFriends) {
    throw new ApiError(409, 'You are already friends', { code: 'already_friends' });
  }

  const requestId = buildRequestId(input.fromUserId, toUserId);
  const reverseRequestId = buildRequestId(toUserId, input.fromUserId);
  const [existing, reverse] = await Promise.all([
    loadRequestRecord(requestId),
    loadRequestRecord(reverseRequestId),
  ]);

  if (existing && existing.status === 'pending') {
    throw new ApiError(409, 'Request already pending', { code: 'request_exists' });
  }

  if (reverse && reverse.status === 'pending') {
    throw new ApiError(409, 'You already have a pending invite from this player', {
      code: 'incoming_request_pending',
      details: { requestId: reverse.id },
    });
  }

  const now = Timestamp.now();
  const docRef = adminDb.collection(FRIEND_REQUESTS_COLLECTION).doc(requestId);
  await docRef.set({
    from: input.fromUserId,
    to: toUserId,
    status: 'pending',
    message: truncateMessage(input.message),
    createdAt: now,
    updatedAt: now,
  });

  await enqueueNotification({
    userId: toUserId,
    type: 'friend-request',
    payload: { from: input.fromUserId, requestId },
  });

  emitFriendEvent(toUserId, { kind: 'pending-requests' });

  return { id: requestId, from: input.fromUserId, to: toUserId, status: 'pending', createdAt: now.toDate().toISOString() };
};

const createFriendship = async (from: string, to: string) => {
  const friendshipId = buildFriendshipId(from, to);
  const now = Timestamp.now();
  await adminDb
    .collection(FRIENDSHIPS_COLLECTION)
    .doc(friendshipId)
    .set({
      userIds: [from, to].sort(),
      createdAt: now,
      lastInteractionAt: now,
    });
  return friendshipId;
};

export const respondToFriendRequest = async (
  requestId: string,
  action: FriendRequestAction,
  actorUserId: string
) => {
  const record = await loadRequestRecord(requestId);
  if (!record) {
    throw new ApiError(404, 'Request not found', { code: 'request_not_found' });
  }
  if (record.status !== 'pending') {
    throw new ApiError(409, 'Request already resolved', { code: 'request_closed' });
  }

  const isRequester = record.from === actorUserId;
  const isRecipient = record.to === actorUserId;

  if (action === 'accept' && !isRecipient) {
    throw new ApiError(403, 'Only the recipient can accept', { code: 'not_allowed' });
  }
  if (action === 'decline' && !isRecipient) {
    throw new ApiError(403, 'Only the recipient can decline', { code: 'not_allowed' });
  }
  if (action === 'cancel' && !isRequester) {
    throw new ApiError(403, 'Only the sender can cancel', { code: 'not_allowed' });
  }

  const docRef = adminDb.collection(FRIEND_REQUESTS_COLLECTION).doc(requestId);
  const now = Timestamp.now();

  if (action === 'accept') {
    const friendshipId = await createFriendship(record.from, record.to);
    await ensureFriendChat(friendshipId, [record.from, record.to], actorUserId);
    await Promise.all([
      enqueueNotification({
        userId: record.from,
        type: 'friend-accept',
        payload: { by: record.to, requestId },
      }),
      enqueueNotification({
        userId: record.to,
        type: 'friend-accept',
        payload: { by: record.to, requestId },
      }),
    ]);
  }

  await docRef.update({ status: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled', updatedAt: now });

  emitFriendEvent(record.from, { kind: 'pending-requests' });
  emitFriendEvent(record.to, { kind: 'pending-requests' });

  if (action === 'accept') {
    emitFriendEvent(record.from, { kind: 'friends-list' });
    emitFriendEvent(record.to, { kind: 'friends-list' });
  }

  return { id: requestId, status: action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled' };
};
