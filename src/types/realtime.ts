import type { ChatMessagePayload } from './chat';
import type { NotificationItem } from './social';

export type ChatMessageEvent = {
  chatId: string;
  message: ChatMessagePayload;
};

export type ChatReadReceiptEvent = {
  chatId: string;
  userId: string;
  lastReadAt: string | null;
};

export type FriendRealtimeEvent =
  | { kind: 'pending-requests' }
  | { kind: 'friends-list' };

export type NotificationRealtimeEvent = {
  kind: 'created';
  notification: NotificationItem;
};

export type RealtimeServerEventMap = {
  'chat:message': ChatMessageEvent;
  'chat:read': ChatReadReceiptEvent;
  'friends:event': FriendRealtimeEvent;
  'notifications:event': NotificationRealtimeEvent;
};
