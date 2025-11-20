import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { SESSION_LOCK_COLLECTION } from '@/lib/session-lock-constants';
import { emitChatMessage, emitChatReadReceipt } from '@/lib/realtime/server';

import {
  CHATS_COLLECTION,
  CHAT_MEMBERSHIPS_COLLECTION,
  CHAT_MESSAGES_SUBCOLLECTION,
  MAX_CHAT_MESSAGE_LENGTH,
  type ChatScope,
  type ChatType,
} from './constants';
import { ApiError } from './errors';
import { enqueueNotification } from './notifications';
import type { ChatRecord } from './types';
import { uniqueIds } from './utils';
import type { ChatMessagePayload } from '@/types/chat';

const GAMES_COLLECTION = 'games';

const buildMembershipId = (chatId: string, userId: string) => `${chatId}_${userId}`;
const messagesCollection = (chatId: string) =>
  adminDb.collection(CHATS_COLLECTION).doc(chatId).collection(CHAT_MESSAGES_SUBCOLLECTION);

const loadChatRecord = async (chatId: string): Promise<ChatRecord | null> => {
  const snapshot = await adminDb.collection(CHATS_COLLECTION).doc(chatId).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() as ChatRecord;
  return { ...data, id: chatId };
};

export const verifyChatMembership = async (chatId: string, userId: string) => {
  const chat = await loadChatRecord(chatId);
  if (!chat) {
    return false;
  }
  return chat.memberIds.includes(userId);
};

const mapReplyPayload = (value: unknown) => {
  if (!value || typeof value !== 'object') return null;
  const record = value as { messageId?: string; senderId?: string; text?: string };
  if (!record.messageId) return null;
  return {
    id: record.messageId,
    senderId: record.senderId ?? '',
    text: (record.text ?? '').slice(0, 200),
  };
};

export const listChatMessages = async (
  chatId: string,
  requesterId: string,
  options?: { limit?: number }
) => {
  const chat = await loadChatRecord(chatId);
  if (!chat) {
    throw new ApiError(404, 'Chat not found', { code: 'chat_not_found' });
  }
  if (!chat.memberIds.includes(requesterId)) {
    throw new ApiError(403, 'You are not a member of this chat', { code: 'not_member' });
  }

  const limitValue = Math.min(Math.max(options?.limit ?? 60, 20), 200);
  const snapshot = await messagesCollection(chatId)
    .orderBy('sentAt', 'desc')
    .limit(limitValue)
    .get();
  const messages = snapshot.docs
    .map((docSnapshot) => {
      const data = docSnapshot.data() ?? {};
      const sentAt = data.sentAt instanceof Timestamp ? data.sentAt.toDate().toISOString() : null;
      return {
        id: docSnapshot.id,
        senderId: typeof data.senderId === 'string' ? data.senderId : '',
        text: typeof data.text === 'string' ? data.text : '',
        sentAt,
        isSystem: Boolean(data.system),
        replyTo: mapReplyPayload(data.replyTo ?? null),
      };
    })
    .reverse();

  const membershipSnapshot = await adminDb
    .collection(CHAT_MEMBERSHIPS_COLLECTION)
    .doc(buildMembershipId(chatId, requesterId))
    .get();
  const membership = membershipSnapshot.exists
    ? (membershipSnapshot.data() as { lastReadAt?: Timestamp | null })
    : null;

  const readReceipts: Record<string, string | null> = {};
  Object.entries(chat.readReceipts ?? {}).forEach(([memberId, value]) => {
    if (value instanceof Timestamp) {
      readReceipts[memberId] = value.toDate().toISOString();
    } else {
      readReceipts[memberId] = null;
    }
  });

  return {
    chatId,
    messages,
    lastMessageAt: chat.lastMessageAt ? chat.lastMessageAt.toDate().toISOString() : null,
    membership: membership
      ? {
          lastReadAt: membership.lastReadAt ? membership.lastReadAt.toDate().toISOString() : null,
        }
      : null,
    readReceipts,
  };
};

export const ensureChatMembership = async (chatId: string, userId: string, temporary: boolean) => {
  const membershipRef = adminDb.collection(CHAT_MEMBERSHIPS_COLLECTION).doc(buildMembershipId(chatId, userId));
  const snapshot = await membershipRef.get();
  const now = Timestamp.now();

  if (!snapshot.exists) {
    await membershipRef.set({
      chatId,
      userId,
      temporary,
      joinedAt: now,
      lastReadAt: null,
      muted: false,
      updatedAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  const data = snapshot.data() as { temporary?: boolean } | undefined;
  const wasTemporary = Boolean(data?.temporary);
  const shouldUpdate = wasTemporary && !temporary;
  if (shouldUpdate) {
    await membershipRef.update({
      temporary,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
};

const upsertChatDoc = async (
  chatId: string,
  payload: {
    type: ChatType;
    scope: ChatScope;
    memberIds: string[];
    guestAllowed: boolean;
    createdBy: string;
    lobbyId?: string | null;
    gameId?: string | null;
  }
) => {
  const chatRef = adminDb.collection(CHATS_COLLECTION).doc(chatId);
  const snapshot = await chatRef.get();
  const now = Timestamp.now();

  if (!snapshot.exists) {
    await chatRef.set({
      ...payload,
      createdAt: now,
      lastMessageAt: null,
    });
    return chatId;
  }

  const data = snapshot.data();
  const mergedMembers = Array.from(new Set([...(data?.memberIds ?? []), ...payload.memberIds]));
  const updates: Record<string, unknown> = { memberIds: mergedMembers };
  if (data?.type !== payload.type) {
    updates.type = payload.type;
  }
  if (data?.guestAllowed !== payload.guestAllowed) {
    updates.guestAllowed = payload.guestAllowed;
  }
  if (payload.lobbyId) {
    updates.lobbyId = payload.lobbyId;
  }
  if (payload.gameId) {
    updates.gameId = payload.gameId;
  }
  await chatRef.update(updates);
  return chatId;
};

export const ensureFriendChat = async (friendshipId: string, memberIds: [string, string], createdBy: string) => {
  const chatId = `friend_${friendshipId}`;
  await upsertChatDoc(chatId, {
    type: 'persistent',
    scope: 'friend',
    memberIds,
    guestAllowed: false,
    createdBy,
  });
  await Promise.all(memberIds.map((memberId) => ensureChatMembership(chatId, memberId, false)));
  return chatId;
};

const fetchGameSnapshot = async (gameId: string) => {
  const snapshot = await adminDb.collection(GAMES_COLLECTION).doc(gameId).get();
  if (!snapshot.exists) {
    throw new ApiError(404, 'Game not found', { code: 'game_not_found' });
  }
  return snapshot;
};

const deriveGameMembers = (data: Record<string, unknown>) => {
  const players = Array.isArray(data.players) ? (data.players as string[]) : [];
  const active = Array.isArray(data.activePlayers) ? (data.activePlayers as string[]) : [];
  return uniqueIds([...players, ...active]);
};

const ensureScopedGameChat = async (
  scope: Exclude<ChatScope, 'friend'>,
  targetId: string,
  requesterId: string
) => {
  const snapshot = await fetchGameSnapshot(targetId);
  const data = snapshot.data() ?? {};
  const status = typeof data.status === 'string' ? (data.status as string) : 'waiting';
  const memberIds = deriveGameMembers(data);
  if (!memberIds.includes(requesterId)) {
    throw new ApiError(403, 'You are not part of this room', { code: 'not_in_room' });
  }

  if (status === 'completed') {
    throw new ApiError(410, 'Chat closed after the match ended', { code: 'room_closed' });
  }

  if (memberIds.length < 2) {
    throw new ApiError(409, 'Chat unlocks once another player joins', { code: 'waiting_for_players' });
  }
  const chatType: ChatType = 'temporary';
  const chatId = `${scope}_${targetId}`;
  await upsertChatDoc(chatId, {
    type: chatType,
    scope,
    memberIds,
    guestAllowed: true,
    createdBy: requesterId,
    lobbyId: scope === 'lobby' ? targetId : null,
    gameId: scope === 'game' ? targetId : null,
  });
  await Promise.all(memberIds.map((memberId) => ensureChatMembership(chatId, memberId, true)));
  return { chatId, type: chatType, scope, guestAllowed: true };
};

export const openLobbyChat = (lobbyId: string, requesterId: string) => {
  return ensureScopedGameChat('lobby', lobbyId, requesterId);
};

export const openGameChat = (gameId: string, requesterId: string) => {
  return ensureScopedGameChat('game', gameId, requesterId);
};

export const openFriendChatRoom = async (
  friendshipId: string,
  memberIds: [string, string],
  requesterId: string
) => {
  if (!memberIds.includes(requesterId)) {
    throw new ApiError(403, 'You are not part of this friendship', { code: 'not_friend' });
  }
  const chatId = await ensureFriendChat(friendshipId, memberIds, requesterId);
  return { chatId, type: 'persistent' as ChatType, scope: 'friend' as ChatScope, guestAllowed: false };
};

export const sendChatMessage = async (
  chatId: string,
  senderId: string,
  text: string,
  options: { isGuest: boolean; replyToMessageId?: string; clientMessageId?: string | null }
) => {
  const chat = await loadChatRecord(chatId);
  if (!chat) {
    throw new ApiError(404, 'Chat not found', { code: 'chat_not_found' });
  }

  if (!chat.memberIds.includes(senderId)) {
    throw new ApiError(403, 'You are not a member of this chat', { code: 'not_member' });
  }

  if (options.isGuest && (!chat.guestAllowed || chat.type !== 'temporary')) {
    throw new ApiError(403, 'Guests may only chat in temporary rooms', { code: 'guest_not_allowed' });
  }

  const trimmed = text.trim();
  if (!trimmed) {
    throw new ApiError(400, 'Message required', { code: 'empty_message' });
  }
  if (trimmed.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new ApiError(400, 'Message too long', { code: 'message_too_long' });
  }

  const messagesRef = messagesCollection(chatId);
  let replyPayload: { messageId: string; senderId: string; text: string } | null = null;

  if (options.replyToMessageId) {
    const replySnapshot = await messagesRef.doc(options.replyToMessageId).get();
    if (!replySnapshot.exists) {
      throw new ApiError(404, 'Message to reply to not found', { code: 'reply_target_missing' });
    }
    const replyData = replySnapshot.data() ?? {};
    replyPayload = {
      messageId: replySnapshot.id,
      senderId: typeof replyData.senderId === 'string' ? (replyData.senderId as string) : '',
      text: typeof replyData.text === 'string' ? (replyData.text as string).slice(0, 200) : '',
    };
  }

  const now = Timestamp.now();
  const payload: Record<string, unknown> = {
    senderId,
    text: trimmed,
    sentAt: now,
    system: false,
  };
  if (replyPayload) {
    payload.replyTo = replyPayload;
  }

  const newMessageRef = await messagesRef.add(payload);
  await adminDb
    .collection(CHATS_COLLECTION)
    .doc(chatId)
    .update({ lastMessageAt: now, [`readReceipts.${senderId}`]: now });

  const messageRecord: ChatMessagePayload = {
    id: newMessageRef.id,
    senderId,
    text: trimmed,
    sentAt: now.toDate().toISOString(),
    isSystem: false,
    clientMessageId: options.clientMessageId ?? null,
    replyTo: replyPayload
      ? {
          id: replyPayload.messageId,
          senderId: replyPayload.senderId,
          text: replyPayload.text,
        }
      : undefined,
  };

  emitChatMessage(chatId, messageRecord);
  emitChatReadReceipt(chatId, senderId, messageRecord.sentAt ?? null);

  return { chatId, sentAt: messageRecord.sentAt };
};

export const recordChatEntry = async (
  chatId: string,
  userId: string,
  options: { action: 'enter' | 'leave'; isGuest: boolean }
) => {
  const chat = await loadChatRecord(chatId);
  if (!chat) {
    throw new ApiError(404, 'Chat not found', { code: 'chat_not_found' });
  }
  if (!chat.memberIds.includes(userId)) {
    throw new ApiError(403, 'You are not a member of this chat', { code: 'not_member' });
  }

  await ensureChatMembership(chatId, userId, chat.type === 'temporary');

  if (options.action === 'enter') {
    const now = Timestamp.now();
    const membershipRef = adminDb.collection(CHAT_MEMBERSHIPS_COLLECTION).doc(buildMembershipId(chatId, userId));
    await membershipRef.set({ lastReadAt: now, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    await adminDb.collection(CHATS_COLLECTION).doc(chatId).set({ [`readReceipts.${userId}`]: now }, { merge: true });
    emitChatReadReceipt(chatId, userId, now.toDate().toISOString());
  } else {
    emitChatReadReceipt(chatId, userId, null);
  }

  await adminDb
    .collection(SESSION_LOCK_COLLECTION)
    .doc(userId)
    .set({ activeChatId: options.action === 'enter' ? chatId : null, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

  if (options.action === 'enter' && !options.isGuest && chat.type === 'persistent') {
    await Promise.all(
      chat.memberIds
        .filter((memberId) => memberId !== userId)
        .map((memberId) =>
          enqueueNotification({
            userId: memberId,
            type: 'chat-entry',
            payload: { chatId, by: userId },
          })
        )
    );
  }

  return { chatId, action: options.action };
};

export const markChatMessagesRead = async (chatId: string, userId: string, lastSeenAt?: string | null) => {
  const chat = await loadChatRecord(chatId);
  if (!chat) {
    throw new ApiError(404, 'Chat not found', { code: 'chat_not_found' });
  }
  if (!chat.memberIds.includes(userId)) {
    throw new ApiError(403, 'You are not a member of this chat', { code: 'not_member' });
  }

  await ensureChatMembership(chatId, userId, chat.type === 'temporary');

  let timestamp = Timestamp.now();
  if (lastSeenAt) {
    const parsed = new Date(lastSeenAt);
    if (!Number.isNaN(parsed.getTime())) {
      timestamp = Timestamp.fromDate(parsed);
    }
  }

  const membershipRef = adminDb.collection(CHAT_MEMBERSHIPS_COLLECTION).doc(buildMembershipId(chatId, userId));
  await membershipRef.set({ lastReadAt: timestamp, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  await adminDb.collection(CHATS_COLLECTION).doc(chatId).set({ [`readReceipts.${userId}`]: timestamp }, { merge: true });

  emitChatReadReceipt(chatId, userId, timestamp.toDate().toISOString());
  return { chatId, lastReadAt: timestamp.toDate().toISOString() };
};
