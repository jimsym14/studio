import type { Timestamp } from 'firebase-admin/firestore';

import type { ChatScope, ChatType, FriendRequestStatus, NotificationType } from './constants';

export interface FriendRequestRecord {
  id: string;
  from: string;
  to: string;
  status: FriendRequestStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  message?: string | null;
}

export interface FriendshipRecord {
  id: string;
  userIds: [string, string];
  createdAt: Timestamp;
  lastInteractionAt?: Timestamp;
  blockedBy?: string | null;
}

export interface ChatRecord {
  id: string;
  type: ChatType;
  scope: ChatScope;
  memberIds: string[];
  lobbyId?: string | null;
  gameId?: string | null;
  guestAllowed: boolean;
  createdBy: string;
  createdAt: Timestamp;
  lastMessageAt?: Timestamp;
  readReceipts?: Record<string, Timestamp | null>;
}

export interface ChatMembershipRecord {
  id: string;
  chatId: string;
  userId: string;
  temporary: boolean;
  joinedAt: Timestamp;
  lastReadAt?: Timestamp;
  muted?: boolean;
}

export interface NotificationRecord {
  id: string;
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
  createdAt: Timestamp;
  read: boolean;
}

export interface RequestUser {
  uid: string;
  username?: string | null;
  displayName?: string | null;
  isGuest: boolean;
}
