export type FriendActivityMode = 'solo' | 'pvp' | 'coop';

export type FriendActivityState =
  | {
      kind: 'waiting';
      mode: FriendActivityMode;
      lobbyId?: string | null;
      passcodeRequired?: boolean;
    }
  | {
      kind: 'playing';
      mode: FriendActivityMode;
      gameId?: string | null;
    }
  | {
    kind: 'online';
    lastInteractionAt?: string | null;
  }
  | {
    kind: 'offline';
    lastInteractionAt?: string | null;
  };

export type FriendSummary = {
  friendshipId: string;
  userId: string;
  username?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  lastInteractionAt?: string | null;
  activity?: FriendActivityState | null;
};

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';

export type FriendRequestSummary = {
  id: string;
  from: string;
  to: string;
  status: FriendRequestStatus;
  message?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type NotificationType = 'chat-entry' | 'friend-request' | 'friend-accept';

export type NotificationItem = {
  id: string;
  type: NotificationType;
  payload?: Record<string, unknown> | null;
  createdAt?: string | null;
  read?: boolean;
};

export type ChatScope = 'lobby' | 'game' | 'friend';

export type LobbyChatContext = {
  scope: 'lobby';
  lobbyId: string;
  lobbyName?: string | null;
};

export type GameChatContext = {
  scope: 'game';
  gameId: string;
  gameName?: string | null;
};

export type FriendChatContext = {
  scope: 'friend';
  friendshipId: string;
  friendUserId: string;
  friendDisplayName?: string | null;
};

export type ChatContextDescriptor = LobbyChatContext | GameChatContext | FriendChatContext;

export type ChatAvailability = 'guest-blocked' | 'temporary' | 'persistent';

export type ChatPreviewSnapshot = {
  context: ChatContextDescriptor;
  availability: ChatAvailability;
  unreadCount?: number;
  lastMessageSnippet?: string | null;
  lastActivityAt?: string | null;
};
