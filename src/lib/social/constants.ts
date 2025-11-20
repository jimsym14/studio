export const FRIEND_REQUESTS_COLLECTION = 'friend_requests';
export const FRIENDSHIPS_COLLECTION = 'friendships';
export const CHATS_COLLECTION = 'chats';
export const CHAT_MESSAGES_SUBCOLLECTION = 'messages';
export const CHAT_MEMBERSHIPS_COLLECTION = 'chat_memberships';
export const NOTIFICATIONS_COLLECTION = 'notifications';

export const FRIEND_REQUEST_STATUSES = ['pending', 'accepted', 'declined', 'cancelled'] as const;
export type FriendRequestStatus = (typeof FRIEND_REQUEST_STATUSES)[number];

export const CHAT_TYPES = ['persistent', 'temporary'] as const;
export type ChatType = (typeof CHAT_TYPES)[number];

export const CHAT_SCOPES = ['friend', 'lobby', 'game'] as const;
export type ChatScope = (typeof CHAT_SCOPES)[number];

export const MAX_FRIEND_REQUEST_MESSAGE_LENGTH = 280;
export const MAX_CHAT_MESSAGE_LENGTH = 1000;

export const NOTIFICATION_TYPES = ['chat-entry', 'friend-request', 'friend-accept'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
