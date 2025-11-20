import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { adminDb } from '@/lib/firebase-admin';
import { emitNotificationEvent } from '@/lib/realtime/server';

import { NOTIFICATIONS_COLLECTION, type NotificationType } from './constants';
import type { NotificationItem } from '@/types/social';

export interface NotificationPayload {
  userId: string;
  type: NotificationType;
  payload?: Record<string, unknown>;
}

export const enqueueNotification = async (input: NotificationPayload) => {
  const docRef = adminDb.collection(NOTIFICATIONS_COLLECTION).doc();
  const now = Timestamp.now();
  const record = {
    userId: input.userId,
    type: input.type,
    payload: input.payload ?? {},
    createdAt: now,
    read: false,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await docRef.set(record);

  const notification: NotificationItem = {
    id: docRef.id,
    type: input.type,
    payload: input.payload ?? {},
    createdAt: now.toDate().toISOString(),
    read: false,
  };
  emitNotificationEvent(input.userId, notification);

  return notification;
};

export const listNotifications = async (userId: string, options?: { unreadOnly?: boolean; limit?: number }) => {
  const unreadOnly = options?.unreadOnly ?? true;
  const limit = options?.limit ?? 50;

  let queryRef = adminDb.collection(NOTIFICATIONS_COLLECTION).where('userId', '==', userId);
  if (unreadOnly) {
    queryRef = queryRef.where('read', '==', false);
  }
  queryRef = queryRef.orderBy('createdAt', 'desc').limit(limit);

  const snapshot = await queryRef.get();
  return snapshot.docs.map((doc) => {
    const data = doc.data() as Record<string, unknown>;
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null;
    return {
      id: doc.id,
      type: data.type as NotificationType,
      payload: (data.payload as Record<string, unknown>) ?? null,
      createdAt,
      read: Boolean(data.read),
    } satisfies NotificationItem;
  });
};

export const markNotificationsRead = async (userId: string, ids: string[]) => {
  const uniqueIds = Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.length > 0)));
  const results = await Promise.all(
    uniqueIds.map(async (id) => {
      const ref = adminDb.collection(NOTIFICATIONS_COLLECTION).doc(id);
      const snapshot = await ref.get();
      if (!snapshot.exists) return 0;
      const data = snapshot.data() as { userId?: string };
      if (data.userId !== userId) return 0;
      await ref.set({ read: true, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return 1;
    })
  );

  return results.reduce<number>((sum, value) => sum + value, 0);
};
