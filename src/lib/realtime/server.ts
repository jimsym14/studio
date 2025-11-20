import type { Server as IOServer, Socket } from 'socket.io';

import type { ChatMessagePayload } from '@/types/chat';
import type { FriendRealtimeEvent, NotificationRealtimeEvent } from '@/types/realtime';
import type { NotificationItem } from '@/types/social';

let io: IOServer | null = null;

export const setRealtimeServer = (server: IOServer) => {
  io = server;
};

export const getRealtimeServer = () => io;

const emitToRoom = (room: string, event: string, payload: unknown) => {
  if (!io) return;
  io.to(room).emit(event, payload);
};

export const emitChatMessage = (chatId: string, message: ChatMessagePayload) => {
  emitToRoom(`chat:${chatId}`, 'chat:message', { chatId, message });
};

export const emitChatReadReceipt = (chatId: string, userId: string, lastReadAt: string | null) => {
  emitToRoom(`chat:${chatId}`, 'chat:read', { chatId, userId, lastReadAt });
};

export const emitFriendEvent = (userId: string, payload: FriendRealtimeEvent) => {
  emitToRoom(`user:${userId}`, 'friends:event', payload);
};

export const emitChatTyping = (chatId: string, userId: string, isTyping: boolean) => {
  emitToRoom(`chat:${chatId}`, 'chat:typing', { chatId, userId, isTyping });
};

export const emitNotificationEvent = (userId: string, notification: NotificationItem) => {
  const payload: NotificationRealtimeEvent = {
    kind: 'created',
    notification,
  };
  emitToRoom(`user:${userId}`, 'notifications:event', payload);
};
