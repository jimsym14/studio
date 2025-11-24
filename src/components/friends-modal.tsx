'use client';

import { collection, query, where, onSnapshot, Timestamp } from 'firebase/firestore';
import { ref as dbRef, onValue } from 'firebase/database';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Check,
  DoorOpen,
  Eye,
  Gamepad2,
  Inbox,
  Loader2,
  MessageCircle,
  RefreshCw,
  Plus,
  UserMinus,
  UserPlus,
  Users,
  X,
  ArrowLeft,
  Reply,
  Copy,
  Smile,
  Heart,
  ThumbsUp,
  Frown,
  Angry,
  Laugh,
  Send,
  MoreVertical,
} from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import EmojiPicker, { Theme, EmojiClickData } from "emoji-picker-react";
import { useLongPress } from "use-long-press";

import { useFirebase } from '@/components/firebase-provider';
import { useRealtime } from '@/components/realtime-provider';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { useToast } from '@/hooks/use-toast';
import { socialGet, socialPost, SocialClientError } from '@/lib/social-client';
import { createGame } from '@/lib/actions/game';
import { rememberLobbyPasscode } from '@/lib/lobby-passcode';
import { cn } from '@/lib/utils';
import { isUsernameValid } from '@/lib/social/username';
import type { FriendRequestSummary, FriendSummary, FriendActivityMode } from '@/types/social';
import type { FriendRealtimeEvent } from '@/types/realtime';
import { isGuestProfile } from '@/types/user';
import { useChatRoom, type ChatMessage } from '@/hooks/use-chat-room';
import { format } from 'date-fns';
import { sendGameInviteAction } from '@/lib/actions/notifications';

// ========================================
// UTILITY FUNCTIONS
// ========================================

// Utility: Format relative time (e.g., "5m ago", "2h ago")
const formatRelativeTime = (value?: string | null) => {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return `${weeks}w ago`;
};

// Utility: Format player display label
const formatPlayerLabel = (value?: string) => {
  if (!value) return 'Unknown player';
  if (value.toLowerCase().startsWith('guest')) {
    return value.replace(/^guest[-_:]*/i, 'Guest ');
  }
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…`;
};

// ========================================
// CONFIGURATION
// ========================================

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const ACTIVITY_MODE_LABEL: Record<FriendActivityMode, string> = {
  solo: 'solo',
  pvp: 'PvP',
  coop: 'co-op',
};

const RECENT_ACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;

const STATUS_TONE_CLASS: Record<FriendStatusDescriptor['tone'], string> = {
  active: 'text-emerald-500',
  idle: 'text-amber-500',
  offline: 'text-muted-foreground',
};

type FriendActionDescriptor =
  | { kind: 'invite' }
  | { kind: 'join'; lobbyId?: string | null; mode?: FriendActivityMode; passcode?: string | null }
  | { kind: 'spectate'; gameId?: string | null; mode?: FriendActivityMode };

type FriendStatusDescriptor = {
  text: string;
  tone: 'active' | 'idle' | 'offline';
};

// ========================================
// STATUS & ACTION DERIVATION
// ========================================

// Derive friend online/offline status
const deriveFriendStatus = (friend: FriendSummary): FriendStatusDescriptor => {
  const activity = friend.activity;
  if (activity?.kind === 'waiting') {
    const prefix = activity.mode === 'solo' ? 'In' : `In ${ACTIVITY_MODE_LABEL[activity.mode] ?? activity.mode}`;
    return {
      text: `${prefix} lobby`,
      tone: 'active',
    };
  }
  if (activity?.kind === 'playing') {
    const gameType = activity.mode === 'solo' ? 'solo' : 'multiplayer';
    return {
      text: `In ${gameType} game`,
      tone: 'active',
    };
  }
  if (activity?.kind === 'online') {
    return { text: 'Active', tone: 'idle' };
  }
  if (activity?.kind === 'offline') {
    const last = activity.lastInteractionAt ?? friend.lastInteractionAt;
    return {
      text: last ? `Active ${formatRelativeTime(last)}` : 'Offline',
      tone: 'offline',
    };
  }

  const lastInteractionMs = friend.lastInteractionAt ? new Date(friend.lastInteractionAt).getTime() : null;
  if (lastInteractionMs && Date.now() - lastInteractionMs <= RECENT_ACTIVITY_THRESHOLD_MS) {
    return { text: 'Active', tone: 'idle' };
  }

  return {
    text: friend.lastInteractionAt ? `Active ${formatRelativeTime(friend.lastInteractionAt)}` : 'Offline',
    tone: 'offline',
  };
};

// Determine primary action for a friend (invite, join, or spectate)
const determineFriendAction = (friend: FriendSummary): FriendActionDescriptor => {
  const activity = friend.activity;
  if (activity?.kind === 'waiting') {
    return { kind: 'join', lobbyId: activity.lobbyId ?? null, mode: activity.mode, passcode: activity.passcode };
  }
  if (activity?.kind === 'playing') {
    return { kind: 'spectate', gameId: activity.gameId ?? null, mode: activity.mode };
  }
  return { kind: 'invite' };
};

// Generate random lobby passcode
const generateLobbyPasscode = (length = 6) => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < length; i += 1) {
    result += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return result;
};

type TabKey = 'friends' | 'requests';

type FriendsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenChat?: (friendshipId: string, userId: string) => void;
  onPendingCountChange?: (count: number) => void;
  refreshPendingRequests?: () => Promise<void>;
  unreadChatIds?: Set<string>;
  onOpenInviteSettings?: (friendId: string, username: string, passcode: string) => void;
};

type RequestsState = {
  incoming: FriendRequestSummary[];
  outgoing: FriendRequestSummary[];
  loading: boolean;
  error: string | null;
};

type FriendsState = {
  records: FriendSummary[];
  loading: boolean;
  error: string | null;
};

const initialRequestsState: RequestsState = {
  incoming: [],
  outgoing: [],
  loading: false,
  error: null,
};

const initialFriendsState: FriendsState = {
  records: [],
  loading: false,
  error: null,
};

// ========================================
// COMPONENT: EmptyState
// ========================================
// Displays an empty state with icon, title, and description
const EmptyState = ({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof Users;
  title: string;
  description: string;
  action?: React.ReactNode;
}) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
    <Icon className="h-10 w-10 text-muted-foreground/70" />
    <div>
      <p className="font-semibold text-foreground">{title}</p>
      <p>{description}</p>
    </div>
    {action}
  </div>
);

// ========================================
// COMPONENT: FriendsModal (Main Component)
// ========================================
// Main friends modal with tabs for friends list and friend requests
export function FriendsModal({
  open,
  onOpenChange,
  onOpenChat,
  onPendingCountChange,
  refreshPendingRequests,
  unreadChatIds,
  onOpenInviteSettings,
}: FriendsModalProps) {
  const { toast } = useToast();
  const { user, profile, db, rtdb } = useFirebase();
  const { socket } = useRealtime();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('friends');
  const [requestsSubTab, setRequestsSubTab] = useState<'incoming' | 'outgoing'>('incoming');
  const [friendsState, setFriendsState] = useState<FriendsState>(initialFriendsState);
  const [requestsState, setRequestsState] = useState<RequestsState>(initialRequestsState);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [friendActionState, setFriendActionState] = useState<string | null>(null);
  const [friendSearchTerm, setFriendSearchTerm] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [outgoingMessage, setOutgoingMessage] = useState('');
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [activeFriendChat, setActiveFriendChat] = useState<{ friendshipId: string; userId: string; displayName: string } | null>(null);

  const profileIsGuest = profile ? isGuestProfile(profile) : Boolean(user?.isAnonymous);
  const canUseFriends = Boolean(user) && !profileIsGuest;

  useEffect(() => {
    if (!inviteSheetOpen) {
      setInviteError(null);
      setInviteUsername('');
    }
  }, [inviteSheetOpen]);

  useEffect(() => {
    if (!open) {
      setActiveTab('friends');
      setActiveFriendChat(null);
    }
  }, [open]);

  const loadFriends = useCallback(async () => {
    if (!canUseFriends) return;
    setFriendsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await socialGet<{ friends: FriendSummary[] }>('/api/friends');
      setFriendsState({ records: response.friends ?? [], loading: false, error: null });
    } catch (error) {
      const message = error instanceof SocialClientError ? error.message : 'Unable to load friends';
      setFriendsState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [canUseFriends]);

  const loadRequests = useCallback(async () => {
    if (!canUseFriends) return;
    setRequestsState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [incoming, outgoing] = await Promise.all([
        socialGet<{ requests: FriendRequestSummary[] }>('/api/friends/requests?direction=incoming'),
        socialGet<{ requests: FriendRequestSummary[] }>('/api/friends/requests?direction=outgoing'),
      ]);
      const next = {
        incoming: incoming.requests ?? [],
        outgoing: outgoing.requests ?? [],
        loading: false,
        error: null,
      } satisfies RequestsState;
      setRequestsState(next);
      const pendingIncoming = next.incoming.filter((request) => request.status === 'pending').length;
      onPendingCountChange?.(pendingIncoming);
    } catch (error) {
      const message = error instanceof SocialClientError ? error.message : 'Unable to load requests';
      setRequestsState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [canUseFriends, onPendingCountChange]);

  useEffect(() => {
    if (!open || !canUseFriends) return;
    void loadFriends();
    void loadRequests();
  }, [open, canUseFriends, loadFriends, loadRequests]);

  useEffect(() => {
    if (!socket) return;
    const handleFriendEvent = (event: FriendRealtimeEvent) => {
      if (!canUseFriends) return;
      if (event.kind === 'friends-list') {
        void loadFriends();
      }
      if (event.kind === 'pending-requests') {
        void loadRequests();
      }
    };
    socket.on('friends:event', handleFriendEvent);
    return () => {
      socket.off('friends:event', handleFriendEvent);
    };
  }, [socket, canUseFriends, loadFriends, loadRequests]);

  // Real-time activity tracking for each friend
  useEffect(() => {
    if (!db || !canUseFriends || !friendsState.records.length) return;

    const unsubscribers: (() => void)[] = [];

    // Set up a snapshot listener for each friend's activity
    friendsState.records.forEach((friend) => {
      // Only show activity for games that have been active in the last 10 minutes
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

      const gamesQuery = query(
        collection(db, 'games'),
        where('activePlayers', 'array-contains', friend.userId),
        where('status', 'in', ['waiting', 'in_progress']),
        where('lastActivityAt', '>=', tenMinutesAgo)
      );

      const unsubscribe = onSnapshot(
        gamesQuery,
        (snapshot) => {
          let newActivity: FriendSummary['activity'] = null;

          if (!snapshot.empty) {
            const gameDoc = snapshot.docs[0];
            const game = gameDoc.data() as {
              status: string;
              gameType?: string | null;
              multiplayerMode?: string | null;
              activePlayers?: string[];
              passcode?: string | null;
            };

            const gameId = gameDoc.id;

            // Double-check user is actually in activePlayers (prevent stale data)
            if (!game.activePlayers?.includes(friend.userId)) {
              // User is not actually in this game, show as online
              newActivity = { kind: 'online' };
            } else if (game.status === 'waiting') {
              let mode: FriendActivityMode = 'solo';
              if (game.gameType === 'multiplayer') {
                if (game.multiplayerMode === 'co-op') {
                  mode = 'coop';
                } else if (game.multiplayerMode === 'pvp') {
                  mode = 'pvp';
                }
              }
              newActivity = { kind: 'waiting', mode, lobbyId: gameId, passcode: game.passcode };
            } else if (game.status === 'in_progress') {
              let mode: FriendActivityMode = 'solo';
              if (game.gameType === 'multiplayer') {
                if (game.multiplayerMode === 'co-op') {
                  mode = 'coop';
                } else if (game.multiplayerMode === 'pvp') {
                  mode = 'pvp';
                }
              }
              newActivity = { kind: 'playing', mode, gameId };
            }
          } else {
            // No active games - check if user is offline or just online without a game
            const lastInteractionMs = friend.lastInteractionAt
              ? new Date(friend.lastInteractionAt).getTime()
              : null;

            // Only mark as offline if they haven't been active in over an hour
            if (lastInteractionMs && Date.now() - lastInteractionMs > 60 * 60 * 1000) {
              newActivity = {
                kind: 'offline',
                lastInteractionAt: friend.lastInteractionAt,
              };
            } else {
              // Otherwise assume they're active (just not in a game)
              newActivity = { kind: 'online' };
            }
          }

          // Update the friend's activity in state
          setFriendsState((prev) => ({
            ...prev,
            records: prev.records.map((f) =>
              f.friendshipId === friend.friendshipId
                ? { ...f, activity: newActivity }
                : f
            ),
          }));
        },
        (error) => {
          console.error('Failed to track friend activity', error);
        }
      );

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
    // Only recreate listeners when friends list changes (by checking IDs), not when activity updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, canUseFriends, friendsState.records.map(f => f.friendshipId).join(',')]);

  // Real-time presence tracking for friends (online/offline status)
  useEffect(() => {
    if (!rtdb || !canUseFriends || !friendsState.records.length) return;

    const unsubscribers: (() => void)[] = [];

    // Set up presence listeners for each friend
    friendsState.records.forEach((friend) => {
      const presenceRef = dbRef(rtdb, `presence/${friend.userId}`);

      const unsubscribe = onValue(presenceRef, (snapshot) => {
        const data = snapshot.val() as { online?: boolean; lastSeen?: number } | null;

        // Update friend state based on presence
        setFriendsState((prev) => ({
          ...prev,
          records: prev.records.map((f) => {
            if (f.friendshipId !== friend.friendshipId) return f;

            // If friend has active game/lobby, presence doesn't override activity
            if (f.activity?.kind === 'waiting' || f.activity?.kind === 'playing') {
              return f;
            }

            // If friend is offline according to presence
            if (!data?.online) {
              return {
                ...f,
                activity: {
                  kind: 'offline',
                  lastInteractionAt: f.lastInteractionAt,
                },
              };
            }

            // Friend is online but not in a game
            return {
              ...f,
              activity: { kind: 'online' },
            };
          }),
        }));
      });

      unsubscribers.push(unsubscribe);
    });

    return () => {
      unsubscribers.forEach((unsub) => unsub());
    };
    // Only recreate listeners when friends list changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rtdb, canUseFriends, friendsState.records.map(f => f.friendshipId).join(',')]);

  // Listen for friend activity (presence)
  useEffect(() => {
    if (!user || !db) return;

    let unsubscribe: () => void;

    try {
      const q = query(
        collection(db, 'users'),
        where('lastSeen', '>', Timestamp.fromMillis(Date.now() - 5 * 60 * 1000))
      );

      unsubscribe = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'modified' || change.type === 'added') {
            // Handle presence updates
          }
        });
      }, (error) => {
        // Suppress permission-denied errors which are expected before rules are updated
        if (error.code !== 'permission-denied') {
          console.error('Presence listener error:', error);
        }
      });
    } catch (err) {
      console.warn('Failed to setup presence listener:', err);
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, db]);

  const friendsLookup = useMemo(() => {
    return friendsState.records.reduce<Record<string, string>>((acc, friend) => {
      const label = friend.displayName ?? friend.username ?? formatPlayerLabel(friend.userId);
      acc[friend.userId] = label;
      return acc;
    }, {});
  }, [friendsState.records]);

  const friendsSource: FriendSummary[] = friendsState.records;
  const filteredFriends = friendsSource.filter((friend) => {
    if (!friendSearchTerm.trim()) return true;
    const query = friendSearchTerm.trim().toLowerCase();
    const composite = `${friend.displayName ?? ''} ${friend.username ?? ''} ${friend.userId}`.toLowerCase();
    return composite.includes(query);
  });

  const pendingIncomingCount = useMemo(
    () => requestsState.incoming.filter((request) => request.status === 'pending').length,
    [requestsState.incoming]
  );

  useEffect(() => {
    onPendingCountChange?.(pendingIncomingCount);
  }, [pendingIncomingCount, onPendingCountChange]);

  const isRequestBusy = useCallback(
    (requestId: string, action: 'accept' | 'decline' | 'cancel' | 'send') => requestActionId === `${requestId}:${action}`,
    [requestActionId]
  );

  const isFriendActionBusy = useCallback(
    (friendshipId: string, action: FriendActionDescriptor['kind']) => friendActionState === `${friendshipId}:${action}`,
    [friendActionState]
  );

  const handleRequestAction = async (
    requestId: string,
    action: 'accept' | 'decline' | 'cancel'
  ) => {
    setRequestActionId(`${requestId}:${action}`);
    try {
      await socialPost('/api/friends/respond', { requestId, action });
      toast({
        title: 'Request updated',
        description:
          action === 'accept'
            ? 'Added to your friends list.'
            : action === 'decline'
              ? 'Invitation declined.'
              : 'Invite cancelled.',
      });
      await Promise.all([loadRequests(), loadFriends()]);
      await refreshPendingRequests?.();
    } catch (error) {
      const message = error instanceof SocialClientError ? error.message : 'Request failed';
      toast({ variant: 'destructive', title: 'Unable to update request', description: message });
    } finally {
      setRequestActionId(null);
    }
  };

  const handleSendRequestToUsername = async (username: string) => {
    const normalized = username.trim();
    if (!normalized) {
      setInviteError('Enter a username to send an invite.');
      return;
    }
    if (!isUsernameValid(normalized)) {
      setInviteError('Usernames can include letters, numbers, periods, underscores, and hyphens.');
      return;
    }
    if (!canUseFriends || !user) {
      const description = 'Sign in with a full account to send friend requests.';
      setInviteError(description);
      toast({ variant: 'destructive', title: 'Sign in required', description });
      return;
    }
    setInviteError(null);
    setRequestActionId(`${normalized}:send`);
    try {
      await socialPost('/api/friends/request', {
        username: normalized,
        message: outgoingMessage.trim() ? outgoingMessage.trim() : undefined,
      });
      toast({ title: 'Request sent', description: `Invite sent to @${normalized}.` });
      setOutgoingMessage('');
      setInviteUsername('');
      setInviteSheetOpen(false);
      await loadRequests();
      await refreshPendingRequests?.();
    } catch (error) {
      const message = error instanceof SocialClientError ? error.message : 'Unable to send request';
      setInviteError(message);
      toast({ variant: 'destructive', title: 'Request failed', description: message });
    } finally {
      setRequestActionId(null);
    }
  };

  const openFriendChatRoom = useCallback(async (friend: FriendSummary) => {
    const response = await socialPost<{ chat?: { chatId?: string } }>('/api/chats/open', {
      context: 'friend',
      userId: friend.userId,
    });
    const chatId = response.chat?.chatId;
    if (!chatId) {
      throw new Error('Unable to open friend chat');
    }
    return chatId;
  }, []);

  const sendInviteLinkToFriend = useCallback(
    async (friend: FriendSummary, lobbyUrl: string, passcode: string) => {
      const chatId = await openFriendChatRoom(friend);
      await socialPost('/api/chats/message', {
        chatId,
        text: `Join me: ${lobbyUrl} (code: ${passcode})`,
      });
    },
    [openFriendChatRoom]
  );

  const handleInviteFriend = async (friend: FriendSummary) => {
    if (!canUseFriends || !user || !user.uid) {
      toast({ variant: 'destructive', title: 'Sign in required', description: 'Only registered players can send private invites.' });
      return;
    }

    // If callback is provided, use it to open settings modal with pre-filled data
    if (onOpenInviteSettings) {
      const passcode = generateLobbyPasscode();
      onOpenInviteSettings(friend.userId, friend.username || 'friend', passcode);
      return;
    }

    // Otherwise fall back to old behavior (auto-create)
    setFriendActionState(`${friend.friendshipId}:invite`);
    try {
      const authToken = await user.getIdToken?.();
      if (!authToken) {
        throw new Error('Missing session token. Please refresh and try again.');
      }
      const passcode = generateLobbyPasscode();
      const gameSettings = {
        wordLength: 5,
        matchTime: 'unlimited',
        turnTime: 'unlimited',
        visibility: 'private',
        passcode,
        gameType: 'multiplayer' as const,
        multiplayerMode: 'pvp' as const,
        creatorId: user.uid,
        creatorDisplayName: profile?.username ?? user.displayName ?? 'Player',
      };
      const gameId = await createGame(gameSettings, firebaseConfig, authToken);
      if (!gameId) {
        throw new Error('Failed to create a private lobby.');
      }
      rememberLobbyPasscode(gameId, passcode);
      const lobbyUrl = typeof window === 'undefined' ? `/lobby/${gameId}` : `${window.location.origin}/lobby/${gameId}`;
      const lobbyUrlWithPasscode = `${lobbyUrl}?passcode=${passcode}`;

      let shareSucceeded = true;
      try {
        await sendInviteLinkToFriend(friend, lobbyUrlWithPasscode, passcode);
        await sendGameInviteAction(friend.userId, gameId, passcode, authToken);
      } catch (shareError) {
        shareSucceeded = false;
        console.warn('Failed to send invite via chat/notification', shareError);
      }

      if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
        navigator.clipboard
          .writeText(`${lobbyUrlWithPasscode} (code: ${passcode})`)
          .catch(() => undefined);
      }

      toast({
        variant: shareSucceeded ? undefined : 'destructive',
        title: shareSucceeded ? 'Private lobby ready' : 'Lobby ready (manual share needed)',
        description: shareSucceeded
          ? `Shared link with ${friend.username ? `@${friend.username}` : 'your friend'}.`
          : 'We copied the lobby invite to your clipboard—send it manually in chat.',
      });
      router.push(`/lobby/${gameId}`);
    } catch (error) {
      const message = error instanceof SocialClientError || error instanceof Error ? error.message : 'Unable to invite friend';
      toast({ variant: 'destructive', title: 'Invite failed', description: message });
    } finally {
      setFriendActionState(null);
    }
  };

  const handleJoinFriendLobby = useCallback(
    async (friend: FriendSummary, lobbyId: string | null, passcode?: string | null) => {
      if (!lobbyId) {
        toast({ variant: 'destructive', title: 'Unable to join', description: 'The lobby is no longer available.' });
        return;
      }
      setFriendActionState(`${friend.friendshipId}:join`);
      try {
        const url = passcode ? `/lobby/${lobbyId}?passcode=${passcode}` : `/lobby/${lobbyId}`;
        router.push(url);
        // Close modal after navigation
        if (onOpenChange) {
          onOpenChange(false);
        }
      } finally {
        setFriendActionState(null);
      }
    },
    [router, toast, onOpenChange]
  );

  const handleSpectateFriendGame = async (friend: FriendSummary, gameId?: string | null) => {
    if (!gameId) {
      toast({ variant: 'destructive', title: 'Spectate unavailable', description: 'Unable to locate an active game for this friend.' });
      return;
    }
    setFriendActionState(`${friend.friendshipId}:spectate`);
    try {
      router.push(`/game/${gameId}?spectate=1`);
    } finally {
      setFriendActionState(null);
    }
  };

  const handleSendInvite = async () => {
    if (!inviteUsername.trim()) return;

    try {
      await handleSendRequestToUsername(inviteUsername);
      setInviteSheetOpen(false);
      setInviteUsername('');
      setOutgoingMessage('');
    } catch (error) {
      // Error is handled in handleSendRequestToUsername
    }
  };

  useEffect(() => {
    if (!inviteSheetOpen) {
      setInviteError(null);
    }
  }, [inviteSheetOpen]);

  // ========================================
  // Render Function: Friend Row
  // ========================================
  // Renders individual friend row with avatar, status, and action buttons
  const renderFriendRow = (friend: FriendSummary) => {
    const usernameLabel = friend.username ? `@${friend.username}` : formatPlayerLabel(friend.userId);
    const displayLabel = friend.displayName ?? usernameLabel;
    const initials = displayLabel
      .split(/\s+/)
      .map((segment) => segment[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
    const status = deriveFriendStatus(friend);
    const action = determineFriendAction(friend);
    const chatDisabled = !onOpenChat;
    const actionDisabled =
      (action.kind === 'join' && !action.lobbyId) ||
      (action.kind === 'spectate' && !action.gameId) ||
      (!canUseFriends && action.kind === 'invite');

    const actionLabel =
      action.kind === 'invite'
        ? 'Invite'
        : action.kind === 'join'
          ? 'Join'
          : 'Spectate';

    const actionIcon =
      action.kind === 'invite' ? (
        <Gamepad2 className="mr-1 h-4 w-4" />
      ) : action.kind === 'join' ? (
        <DoorOpen className="mr-1 h-4 w-4" />
      ) : (
        <Eye className="mr-1 h-4 w-4" />
      );

    const handlePrimaryAction = () => {
      if (action.kind === 'invite') {
        void handleInviteFriend(friend);
        return;
      }
      if (action.kind === 'join') {
        void handleJoinFriendLobby(friend, action.lobbyId ?? null, action.passcode);
        return;
      }
      void handleSpectateFriendGame(friend, action.gameId);
    };

    const isUnread = unreadChatIds?.has(`friend_${friend.friendshipId}`);

    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        key={friend.friendshipId}
        className="group relative flex items-center justify-between rounded-xl border border-white/5 bg-white/5 p-2 md:p-3 transition-colors hover:bg-white/10"
      >
        <div className="flex items-center gap-2 md:gap-3">
          <div className="relative">
            <Avatar className="h-8 w-8 md:h-10 md:w-10 border border-white/10 shadow-inner">
              <AvatarImage src={friend.photoURL ?? undefined} />
              <AvatarFallback className="text-[10px] md:text-sm">{friend.displayName?.slice(0, 2).toUpperCase() ?? '??'}</AvatarFallback>
            </Avatar>
            {/* Status Indicator */}
            <span
              className={cn(
                'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 md:h-3 md:w-3 rounded-full border-2 border-background shadow-sm',
                status.tone === 'active' ? 'bg-emerald-500' : status.tone === 'idle' ? 'bg-amber-500' : 'bg-slate-500'
              )}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] md:text-xs font-comic tracking-wide leading-tight text-white drop-shadow-sm">{usernameLabel}</p>
            <p className={cn('text-[8px] md:text-[10px] font-bold font-moms tracking-wider uppercase', STATUS_TONE_CLASS[status.tone])}>{status.text}</p>
          </div>
        </div>

        {/* Right side: Buttons stacked horizontally */}
        <div className="flex flex-row gap-1 md:gap-1.5 flex-shrink-0">
          {/* Only show action button if friend is not offline */}
          {friend.activity?.kind !== 'offline' && (
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrimaryAction}
              disabled={actionDisabled || isFriendActionBusy(friend.friendshipId, action.kind)}
              className="h-6 md:h-7 px-1.5 md:px-2 text-[9px] md:text-[10px] font-bold font-moms bg-emerald-500/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-300"
            >  {isFriendActionBusy(friend.friendshipId, action.kind) ? (
              <Loader2 className="h-2.5 w-2.5 md:h-3 md:w-3 animate-spin" />
            ) : (
              <>
                {action.kind === 'invite' ? (
                  <Gamepad2 className="mr-1 h-2.5 w-2.5 md:h-3 md:w-3" />
                ) : action.kind === 'join' ? (
                  <DoorOpen className="mr-1 h-2.5 w-2.5 md:h-3 md:w-3" />
                ) : (
                  <Eye className="mr-1 h-2.5 w-2.5 md:h-3 md:w-3" />
                )}
                {actionLabel}
              </>
            )}
            </Button>
          )}
          <div className="relative">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setActiveFriendChat({ friendshipId: friend.friendshipId, userId: friend.userId, displayName: displayLabel })}
              aria-label="Open chat"
              className="h-6 md:h-7 px-1.5 md:px-2 text-[9px] md:text-[10px] font-bold font-moms bg-white/10 hover:bg-white/20 text-white border border-white/5"
            >
              <MessageCircle className="mr-1 h-2.5 w-2.5 md:h-3 md:w-3" />
              Chat
            </Button>
            {isUnread && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 md:h-4 md:w-4 items-center justify-center rounded-full bg-rose-500 text-[8px] md:text-[10px] font-bold text-white ring-2 ring-background">
                !
              </span>
            )}
          </div>
        </div>
      </motion.div>
    );
  };

  // ========================================
  // Render Function: Request List
  // ========================================
  // Renders list of friend requests (incoming or outgoing)
  const renderRequestList = (requests: FriendRequestSummary[], direction: 'incoming' | 'outgoing') => {
    if (!requests.length) {
      return (
        <EmptyState
          icon={Inbox}
          title={`No ${direction === 'incoming' ? 'incoming' : 'outgoing'} requests`}
          description={direction === 'incoming' ? 'You are all caught up.' : 'Use the + button to send an invite.'}
        />
      );
    }

    const containerVariants = {
      hidden: { opacity: 0 },
      show: {
        opacity: 1,
        transition: {
          staggerChildren: 0.05
        }
      }
    };

    const itemVariants = {
      hidden: { opacity: 0, y: 15, scale: 0.95 },
      show: { opacity: 1, y: 0, scale: 1 }
    };

    return (
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="show"
        className="flex flex-col gap-4"
      >
        {requests.map((request) => {
          const isPending = request.status === 'pending';
          const counterpartId = direction === 'incoming' ? request.from : request.to;
          const nameLookup = friendsLookup[counterpartId];
          const label = nameLookup ?? formatPlayerLabel(counterpartId);
          const badgeVariant = request.status === 'accepted' ? 'default' : request.status === 'pending' ? 'secondary' : 'outline';

          return (
            <motion.div
              variants={itemVariants}
              layout
              key={request.id}
              className="flex flex-col justify-between rounded-3xl border border-white/10 bg-black/20 p-3 md:p-5 shadow-lg backdrop-blur-md transition-all hover:border-amber-500/30 hover:bg-black/30 hover:shadow-xl"
            >
              <div>
                <div className="flex items-start justify-between gap-2 md:gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base md:text-lg font-comic tracking-wide text-white" title={label}>{label}</p>
                    <p className="truncate text-[10px] md:text-xs text-white/60 font-moms">
                      {direction === 'incoming' ? 'Sent by' : 'Sent to'} {request.otherUser?.username ?? formatPlayerLabel(counterpartId)}
                    </p>
                  </div>
                  <Badge variant={badgeVariant} className={cn("ml-1 md:ml-2 shrink-0 capitalize font-bold font-moms text-[9px] md:text-[10px]", request.status === 'accepted' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30')}>{request.status}</Badge>
                </div>
                {request.message && <p className="mt-2 md:mt-3 rounded-xl bg-white/5 p-2 md:p-3 text-xs md:text-sm italic text-white/70">“{request.message}”</p>}
              </div>

              <div className="mt-3 md:mt-4 flex items-center gap-2">
                {direction === 'incoming' && isPending && (
                  <>
                    <Button
                      size="sm"
                      className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold font-moms h-7 md:h-8 text-[10px] md:text-xs"
                      onClick={() => handleRequestAction(request.id, 'accept')}
                      disabled={isRequestBusy(request.id, 'accept')}
                    >
                      {isRequestBusy(request.id, 'accept') ? (
                        <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="mr-1 md:mr-1.5 h-3 w-3 md:h-4 md:w-4" /> Accept
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 font-bold font-moms h-7 md:h-8 text-[10px] md:text-xs"
                      onClick={() => handleRequestAction(request.id, 'decline')}
                      disabled={isRequestBusy(request.id, 'decline')}
                    >
                      {isRequestBusy(request.id, 'decline') ? (
                        <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                      ) : (
                        <>
                          <X className="mr-1 md:mr-1.5 h-3 w-3 md:h-4 md:w-4" /> Decline
                        </>
                      )}
                    </Button>
                  </>
                )}
                {direction === 'outgoing' && isPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full font-bold font-moms h-7 md:h-8 text-[10px] md:text-xs"
                    onClick={() => handleRequestAction(request.id, 'cancel')}
                    disabled={isRequestBusy(request.id, 'cancel')}
                  >
                    {isRequestBusy(request.id, 'cancel') ? (
                      <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                    ) : (
                      <>
                        <UserMinus className="mr-1 md:mr-1.5 h-3 w-3 md:h-4 md:w-4" /> Cancel Invite
                      </>
                    )}
                  </Button>
                )}
                {!isPending && (
                  <p className="w-full text-center text-[10px] md:text-xs font-medium text-muted-foreground">
                    {request.status === 'accepted' ? 'Friend added' : 'Request resolved'} • {formatRelativeTime(request.updatedAt ?? request.createdAt)}
                  </p>
                )}
              </div>
            </motion.div>
          );
        })}
      </motion.div>
    );
  };

  const gatingMessage = !user
    ? 'Sign in or create an account to add friends and unlock persistent chats.'
    : 'Guests can only use temporary lobby chats. Create an account to unlock friends.';

  // ========================================
  // Main Render: FriendsModal
  // ========================================
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(
        "transition-all duration-300",
        activeFriendChat
          ? "max-w-[440px] w-full border-none bg-transparent p-0 shadow-none [&>button]:hidden"
          : "w-[95vw] max-w-md max-h-[90vh] md:max-h-[95vh] overflow-hidden border border-white/20 dark:border-white/10 bg-white/30 dark:bg-black/30 backdrop-blur-2xl shadow-2xl rounded-3xl"
      )}>
        <DialogDescription className="sr-only">
          Friends list and requests management interface
        </DialogDescription>
        {/* ========================================
            CHAT VIEW (when friend chat is active)
            ======================================== */}
        {activeFriendChat ? (
          <div className="relative flex h-[600px] w-full flex-col overflow-hidden rounded-3xl border border-border/40 bg-gradient-to-br from-emerald-500/5 via-background to-amber-500/5 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:from-emerald-900/20 dark:via-black dark:to-amber-900/20">
            {/* Chat Header */}
            <div className="flex items-center justify-between border-b border-border/10 px-6 py-4 dark:border-white/10">
              <div className="flex items-center gap-3">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setActiveFriendChat(null)}
                  className="h-8 w-8 text-foreground hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                  aria-label="Back to friends"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div>
                  <p className="text-[0.65rem] uppercase tracking-[0.4em] text-muted-foreground">Your chat with</p>
                  <h3 className="text-xl font-comic leading-tight text-foreground dark:text-white">{activeFriendChat.displayName}</h3>
                </div>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                className="h-8 w-8 text-foreground hover:bg-black/5 dark:text-white dark:hover:bg-white/10"
                aria-label="Close modal"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Chat Content */}
            <FriendChatPanel
              friendUserId={activeFriendChat.userId}
              friendDisplayName={activeFriendChat.displayName}
            />
          </div>
        ) : (
          <>
            {/* ========================================
                MAIN FRIENDS VIEW (default view)
                ======================================== */}
            {/* Dialog Header */}
            <DialogHeader className="mb-2">
              <DialogTitle className="text-2xl font-comic tracking-wide text-white drop-shadow-md">Friends</DialogTitle>
            </DialogHeader>
            {!canUseFriends && (
              <div className="rounded-2xl border border-dashed border-blue-500/50 bg-blue-500/5 p-6 text-center">
                <p className="text-base font-semibold">Friends are for signed-in players</p>
                <p className="mt-2 text-sm text-muted-foreground">{gatingMessage}</p>
                <Button className="mt-4" asChild>
                  <Link href="/login">Go to login</Link>
                </Button>
              </div>
            )}
            {/* Main Tabs Container (Friends & Requests) */}
            {canUseFriends && (
              <div className="space-y-3">
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
                  {/* Tab Triggers */}
                  <TabsList className="flex w-full gap-1 rounded-full bg-white/30 dark:bg-black/30 backdrop-blur-sm p-1 border border-white/20 dark:border-white/10">
                    <TabsTrigger
                      value="friends"
                      className="flex-1 flex items-center justify-center gap-1 rounded-full border border-transparent px-2 py-1 text-[12px] md:text-[15px] font-bold font-moms uppercase tracking-wider transition-all data-[state=active]:bg-white/90 data-[state=active]:text-emerald-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/20 dark:data-[state=active]:text-emerald-400"
                    >
                      <Users className="h-3 w-3" />
                      <span>Friends</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="requests"
                      className="flex-1 flex items-center justify-center gap-1 rounded-full border border-transparent px-2 py-1 text-[12px] md:text-[15px] font-bold font-moms uppercase tracking-wider transition-all data-[state=active]:bg-white/90 data-[state=active]:text-amber-600 data-[state=active]:shadow-sm dark:data-[state=active]:bg-white/20 dark:data-[state=active]:text-amber-400"
                    >
                      <UserPlus className="h-3 w-3" />
                      <span>Requests</span>
                      {pendingIncomingCount > 0 && (
                        <Badge variant="destructive" className="ml-1 h-3.5 md:h-4 px-1 text-[8px]">
                          {pendingIncomingCount}
                        </Badge>
                      )}
                    </TabsTrigger>
                  </TabsList>
                  {/* ========================================
                      TAB CONTENT: Friends List
                      ======================================== */}
                  <AnimatePresence mode="wait">
                    {activeTab === 'friends' && (
                      <TabsContent value="friends" asChild>
                        <motion.div
                          key="friends-tab"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="rounded-3xl border border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 backdrop-blur-md p-3">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-base font-bold">Your roster</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Input
                                  value={friendSearchTerm}
                                  onChange={(event) => setFriendSearchTerm(event.target.value)}
                                  placeholder="Search friends"
                                  className="w-32 sm:w-48"
                                />
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => loadFriends()}
                                  disabled={friendsState.loading}
                                  aria-label="Refresh friends"
                                >
                                  {friendsState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                                </Button>
                              </div>
                            </div>
                            {friendsState.error && <p className="mb-3 text-sm text-destructive">{friendsState.error}</p>}
                            {friendsState.loading && !friendsState.records.length ? (
                              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading friends...
                              </div>
                            ) : filteredFriends.length ? (
                              <ScrollArea className="max-h-[240px] pr-4">
                                <div className="space-y-2">
                                  {filteredFriends.map((friend) => renderFriendRow(friend))}
                                </div>
                              </ScrollArea>
                            ) : (
                              <EmptyState
                                icon={Users}
                                title="No friends match that search"
                                description="Try another handle."
                              />
                            )}
                          </div>
                        </motion.div>
                      </TabsContent>
                    )}
                    {/* Listen for friend activity (presence) */}

                    {/* ========================================
                      TAB CONTENT: Friend Requests
                      ======================================== */}
                    {activeTab === 'requests' && (
                      <TabsContent value="requests" asChild>
                        <motion.div
                          key="requests-tab"
                          initial={{ opacity: 0, x: -20 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: 20 }}
                          transition={{ duration: 0.2 }}
                        >
                          <div className="space-y-4 rounded-3xl border border-white/20 dark:border-white/10 bg-white/20 dark:bg-black/20 backdrop-blur-md p-3">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-base font-bold">Requests overview</p>
                                <p className="text-sm text-muted-foreground">Handle invites you&apos;ve received or sent.</p>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => loadRequests()}
                                disabled={requestsState.loading}
                                aria-label="Refresh requests"
                              >
                                {requestsState.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </Button>
                            </div>
                            {requestsState.error && <p className="text-sm text-destructive">{requestsState.error}</p>}

                            <div className="flex flex-col gap-4">
                              {/* Sub-tabs for Incoming/Outgoing Requests */}
                              <div className="flex p-1 bg-black/20 rounded-xl border border-white/5 backdrop-blur-sm">
                                <button
                                  onClick={() => setRequestsSubTab('incoming')}
                                  className={cn(
                                    "flex-1 py-2 text-xs font-bold font-moms uppercase tracking-widest rounded-lg transition-all",
                                    requestsSubTab === 'incoming'
                                      ? "bg-white/10 text-white shadow-sm"
                                      : "text-white/40 hover:text-white/70 hover:bg-white/5"
                                  )}
                                >
                                  Incoming
                                </button>
                                <button
                                  onClick={() => setRequestsSubTab('outgoing')}
                                  className={cn(
                                    "flex-1 py-2 text-xs font-bold font-moms uppercase tracking-widest rounded-lg transition-all",
                                    requestsSubTab === 'outgoing'
                                      ? "bg-white/10 text-white shadow-sm"
                                      : "text-white/40 hover:text-white/70 hover:bg-white/5"
                                  )}
                                >
                                  Outgoing
                                </button>
                              </div>

                              <div className="space-y-4">
                                <div className="rounded-2xl bg-white/5 p-5 border border-white/5 backdrop-blur-sm">
                                  <div className="mb-4 flex items-center justify-between">
                                    <div>
                                      <h4 className="text-sm font-bold font-moms text-white/90">
                                        {requestsSubTab === 'incoming' ? 'Incoming requests' : 'Outgoing requests'}
                                      </h4>
                                      <p className="text-xs text-white/50 mt-1">
                                        {requestsSubTab === 'incoming'
                                          ? 'Approve or decline invites from other players.'
                                          : "See invites you've sent or add someone new."}
                                      </p>
                                    </div>
                                    {requestsSubTab === 'outgoing' && (
                                      <Button
                                        size="sm"
                                        onClick={() => setInviteSheetOpen(true)}
                                        className="h-8 bg-white/10 hover:bg-white/20 text-white font-bold font-moms border border-white/10"
                                      >
                                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                                        New Invite
                                      </Button>
                                    )}
                                  </div>

                                  {renderRequestList(
                                    requestsSubTab === 'incoming' ? requestsState.incoming : requestsState.outgoing,
                                    requestsSubTab
                                  )}
                                </div>
                              </div>

                              {/* ========================================
                            SHEET: Send Friend Request
                            ======================================== */}
                              <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
                                <SheetContent side="bottom" className="rounded-t-[2rem] sm:max-w-md border-white/10 bg-black/90 backdrop-blur-xl text-white">
                                  <SheetHeader className="mb-4 text-left">
                                    <SheetTitle className="text-white font-comic tracking-wide text-xl">Send Friend Request</SheetTitle>
                                    <SheetDescription className="text-white/60 font-moms">
                                      Enter a username to send an invite.
                                    </SheetDescription>
                                  </SheetHeader>
                                  <div className="space-y-4">
                                    <div className="space-y-2">
                                      <Label htmlFor="username" className="text-white font-bold font-moms">Username</Label>
                                      <div className="flex gap-2">
                                        <div className="relative flex-1">
                                          <span className="absolute left-3 top-2.5 text-white/40 font-moms">@</span>
                                          <Input
                                            id="username"
                                            placeholder="username"
                                            className="pl-7 bg-white/10 border-white/10 text-white placeholder:text-white/20 font-moms"
                                            value={inviteUsername}
                                            onChange={(e) => setInviteUsername(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === 'Enter' && !isFriendActionBusy('invite', 'invite')) {
                                                void handleSendInvite();
                                              }
                                            }}
                                          />
                                        </div>
                                      </div>
                                      {inviteError && <p className="text-sm text-red-400 font-moms">{inviteError}</p>}
                                    </div>
                                    <div className="space-y-2">
                                      <Label htmlFor="message" className="text-white font-bold font-moms">Message (optional)</Label>
                                      <Textarea
                                        id="message"
                                        placeholder="Say hello..."
                                        className="resize-none bg-white/10 border-white/10 text-white placeholder:text-white/20 font-moms"
                                        maxLength={100}
                                        value={outgoingMessage}
                                        onChange={(e) => setOutgoingMessage(e.target.value)}
                                      />
                                      <p className="text-xs text-white/40 text-right font-moms">
                                        {outgoingMessage.length}/100
                                      </p>
                                    </div>
                                    <Button
                                      className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-bold font-moms h-12 text-lg"
                                      onClick={handleSendInvite}
                                      disabled={!inviteUsername.trim() || isFriendActionBusy('invite', 'invite')}
                                    >
                                      {isFriendActionBusy('invite', 'invite') ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Send className="mr-2 h-4 w-4" />
                                      )}
                                      Send Invite
                                    </Button>
                                  </div>
                                </SheetContent>
                              </Sheet>
                            </div>
                          </div>
                        </motion.div>
                      </TabsContent>
                    )}
                  </AnimatePresence>
                </Tabs>
              </div>
            )}
          </>
        )
        }
      </DialogContent >

      {/* Friend Chat Modal - Rendered at Body Level */}
      {/* The previous chat modal overlay code has been removed and integrated into DialogContent */}
    </Dialog >
  );
}

// ========================================
// COMPONENT: FriendChatPanel
// ========================================
// Inline friend chat panel with messages, reactions, and typing indicators
function FriendChatPanel({ friendUserId, friendDisplayName }: { friendUserId: string; friendDisplayName: string }) {
  const { userId, user } = useFirebase();
  const { toast } = useToast();
  const [message, setMessage] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
    moveX: number;
    moveY: number;
  } | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  const {
    ready,
    messages,
    sendMessage,
    sending,
    typingUsers,
    sendReaction,
    sendTyping,
    markMessagesRead,
    membership,
    lastMessageAt,
    readReceipts,
  } = useChatRoom({
    context: {
      scope: 'friend',
      friendshipId: `friend_${friendUserId}`,
      friendUserId,
      friendDisplayName,
    },
    enabled: true,
  });

  // Mark messages as read when chat is ready and visible
  useEffect(() => {
    if (ready && messages.length > 0) {
      // Delay slightly to ensure socket is ready
      const timer = setTimeout(() => {
        console.log('Marking messages as read...'); // Debug log
        markMessagesRead();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [ready, markMessagesRead]);

  // ALSO mark as read when new messages arrive (for badge clearing)
  useEffect(() => {
    if (ready && messages.length > 0) {
      const timer = setTimeout(() => {
        console.log('New messages arrived, marking as read...'); // Debug log
        markMessagesRead();
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [messages.length, ready, markMessagesRead]);

  // Log when readReceipts change
  useEffect(() => {
    console.log('[FriendChatPanel] Read receipts changed:', JSON.stringify(readReceipts, null, 2));
    console.log('[FriendChatPanel] Friend user ID:', friendUserId);
  }, [readReceipts, friendUserId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, typingUsers]);

  // Force re-render trigger when readReceipts change
  const readReceiptsKey = useMemo(() => JSON.stringify(readReceipts), [readReceipts]);

  // Handle typing indicator
  useEffect(() => {
    if (message.length > 0) {
      void sendTyping(true);
      const timeout = setTimeout(() => void sendTyping(false), 3000);
      return () => clearTimeout(timeout);
    }
  }, [message, sendTyping]);

  const handleSend = useCallback(async () => {
    if (!message.trim() || !ready) return;
    try {
      await sendMessage(message.trim(), { replyTo: replyTarget });
      setMessage('');
      setReplyTarget(null);
      setShowEmojiPicker(false);
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Message not sent',
        description: error instanceof Error ? error.message : 'Unable to send message',
      });
    }
  }, [message, ready, sendMessage, toast, replyTarget]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  const bindLongPress = useLongPress((event, { context }) => {
    const msgId = context as string;
    const target = event.target as HTMLElement;
    const rect = target.getBoundingClientRect();
    // We can't calculate the full center logic here easily without the container ref
    // Ideally we trigger the same logic as handleContextMenu
    // For now, let's rely on the onContextMenu handler which useLongPress triggers
    // setContextMenu({ id: msgId, x: rect.left, y: rect.top, moveX: 0, moveY: 0 });
  }, {
    threshold: 500,
    captureEvent: true,
    cancelOnMovement: true,
    onFinish: (event, { context }) => {
      // Ensure context menu triggers on long press finish
      const msgId = context as string;
      // We need to find the element and trigger the handler manually or reuse logic
      // Since we can't easily pass the event target here in the same way, we rely on the bind
      // But wait, useLongPress 'bind' returns onContextMenu/onTouchStart etc.
      // We should just let the bind handle it, but we need to make sure our handler accepts the event type
      // Actually, let's just clear the context menu here if needed or ignore
    }
  });

  const handleContextMenu = (e: React.MouseEvent | React.PointerEvent | TouchEvent | MouseEvent, msgId: string, isSelf: boolean) => {
    e.preventDefault();
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const container = target.closest('.relative.flex.flex-col');
    const containerRect = container?.getBoundingClientRect() || { left: 0, top: 0, width: 0, height: 0, bottom: 0, right: 0, x: 0, y: 0, toJSON: () => { } };

    // Calculate center of container
    const containerCenterX = containerRect.width / 2;
    const containerCenterY = containerRect.height / 2;

    // Calculate center of message relative to container
    const messageCenterX = (rect.left - containerRect.left) + rect.width / 2;
    const messageCenterY = (rect.top - containerRect.top) + rect.height / 2;

    // Calculate delta to move message to center
    // Center exactly (no offset)
    const moveX = (containerCenterX - messageCenterX);
    const moveY = containerCenterY - messageCenterY;

    // Menu position calculation
    // The message will be centered at containerCenterX
    const finalMessageLeft = containerCenterX - (rect.width / 2);
    const finalMessageRight = containerCenterX + (rect.width / 2);

    let menuX;
    if (isSelf) {
      // Align Menu Right with Message Right
      menuX = finalMessageRight - 180; // 180 is menu width
    } else {
      // Align Menu Left with Message Left
      menuX = finalMessageLeft;
    }

    // Clamp to container bounds with padding
    menuX = Math.max(10, Math.min(menuX, containerRect.width - 190));

    const menuY = containerCenterY + (rect.height / 2) + 10; // 10px gap below centered message

    setContextMenu({ id: msgId, x: menuX, y: menuY, moveX, moveY });
  };

  const handleReaction = (emoji: string, messageId?: string) => {
    const targetId = messageId ?? contextMenu?.id;
    if (targetId) {
      void sendReaction(targetId, emoji);
      setContextMenu(null);
    }
  };

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  // ========================================
  // Main Render: FriendChatPanel
  // ========================================
  return (
    <div className="flex flex-1 flex-col overflow-hidden relative">
      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 scrollbar-thin scrollbar-thumb-black/20 scrollbar-track-transparent hover:scrollbar-thumb-black/30 dark:scrollbar-thumb-white/10 dark:hover:scrollbar-thumb-white/20">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-white/60">
            No messages yet. Start the conversation!
          </div>
        ) : (
          <LayoutGroup key={readReceiptsKey}>
            <AnimatePresence initial={false} mode="popLayout">
              {messages.map((msg, index) => {
                const isSelf = msg.senderId === userId;
                const time = msg.sentAt ? format(new Date(msg.sentAt), 'h:mm a') : '';
                const prevMsg = index > 0 ? messages[index - 1] : null;
                const isGroupEnd = index === messages.length - 1 || messages[index + 1].senderId !== msg.senderId;
                const isActive = contextMenu?.id === msg.id;

                return (
                  <motion.div
                    layout
                    key={msg.clientMessageId || msg.id}
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{
                      opacity: contextMenu && !isActive ? 0.3 : 1,
                      x: isActive && contextMenu ? contextMenu.moveX : 0,
                      y: isActive && contextMenu ? contextMenu.moveY : 0,
                      scale: isActive ? 1.05 : 1,
                      zIndex: isActive ? 100 : (messages.length - index),
                      filter: isActive ? "brightness(1.1)" : (contextMenu && !isActive ? "blur(2px)" : "none")
                    }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className={cn(
                      'flex gap-2 relative group',
                      isSelf ? 'justify-end' : 'justify-start',
                      isGroupEnd ? 'mb-4' : 'mb-1'
                    )}
                    onContextMenu={(e) => handleContextMenu(e, msg.id, isSelf)}
                    {...bindLongPress(msg.id)}
                  >
                    {/* Avatar for friend */}
                    {!isSelf && isGroupEnd ? (
                      <Avatar className="h-8 w-8 border border-black/10 shadow-sm dark:border-white/10">
                        <AvatarFallback className="bg-muted text-xs text-muted-foreground dark:bg-white/10 dark:text-white">
                          {friendDisplayName[0]?.toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : !isSelf && <div className="w-8" />}

                    <div className={cn('flex max-w-[75%] flex-col min-w-0', isSelf ? 'items-end' : 'items-start')}>
                      <div
                        className={cn(
                          'relative px-4 py-2 text-sm shadow-sm transition-all',
                          isSelf
                            ? 'bg-[#22c55e] text-white dark:bg-[#22c55e] rounded-2xl rounded-tr-sm'
                            : 'bg-[#f68131] text-white rounded-2xl rounded-tl-sm',
                          msg.pending && 'opacity-70'
                        )}
                      >
                        {msg.replyTo && (
                          <div className="mb-2 rounded-md border-l-4 border-white/40 bg-black/5 px-3 py-2 text-xs dark:bg-black/20 max-w-[14rem] overflow-hidden">
                            <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wider opacity-70">
                              {msg.replyTo.senderId === userId ? 'You' : friendDisplayName}
                            </p>
                            <p className="line-clamp-2 opacity-90 break-words text-ellipsis overflow-hidden max-w-full">{msg.replyTo.text}</p>
                          </div>
                        )}
                        <p className="whitespace-pre-wrap break-all leading-relaxed max-w-full overflow-hidden">
                          {(() => {
                            const urlRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)/g;
                            const parts = msg.text.split(urlRegex);
                            return parts.map((part, i) => {
                              if (!part) return null;
                              if (part.match(urlRegex)) {
                                const href = part.startsWith('www.') ? `https://${part}` : part;
                                return (
                                  <a
                                    key={i}
                                    href={href}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline hover:opacity-80"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {part}
                                  </a>
                                );
                              }
                              return <span key={i}>{part}</span>;
                            });
                          })()}
                        </p>

                        {/* Reactions */}
                        {msg.reactions && Object.keys(msg.reactions).length > 0 && (
                          <div className={cn(
                            "absolute -bottom-3 -right-2 flex gap-0.5 z-50",
                          )}>
                            {Object.entries(msg.reactions).map(([uid, emoji]) => (
                              <div
                                key={uid}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (uid === userId) handleReaction(emoji, msg.id);
                                }}
                                className={cn(
                                  "flex h-7 w-7 items-center justify-center rounded-full bg-white text-sm shadow-sm ring-1 ring-black/5 dark:bg-[#1a1d26] dark:ring-white/10",
                                  uid === userId && "cursor-pointer hover:scale-110 transition-transform"
                                )}
                              >
                                {emoji}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      {isGroupEnd && (
                        <div className="mt-1 px-2 flex items-center gap-2">
                          <p className="text-[10px] text-white/40">{time}</p>
                          {/* Read receipts - show for last message */}
                          {index === messages.length - 1 && (() => {
                            const recipientReadAtStr = isSelf ? readReceipts[friendUserId] : readReceipts[userId || ''];
                            const recipientReadAt = recipientReadAtStr ? new Date(recipientReadAtStr).getTime() : 0;
                            const messageSentAt = new Date(msg.sentAt || 0).getTime();
                            const hasBeenRead = recipientReadAt >= messageSentAt;

                            console.log('[ReadReceipt]', {
                              isSelf,
                              friendUserId,
                              userId,
                              recipientReadAtStr,
                              recipientReadAt,
                              messageSentAt,
                              hasBeenRead,
                              diff: recipientReadAt - messageSentAt
                            });

                            return (
                              <p className="text-[9px] text-white/30 font-medium">
                                {hasBeenRead ? '✓✓ Seen' : '✓ Delivered'}
                              </p>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </LayoutGroup>
        )}

        {/* Typing Indicator */}
        {typingUsers.length > 0 && (
          <div className="flex gap-2 mt-2 ml-10">
            <div className="rounded-2xl rounded-tl-sm bg-white/10 px-4 py-2">
              <div className="flex gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: '0ms' }}></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: '150ms' }}></span>
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: '300ms' }}></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ========================================
          Context Menu Overlay (Message Actions)
          ======================================== */}
      <AnimatePresence>
        {contextMenu && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-40 bg-white/10 backdrop-blur-[2px] dark:bg-black/60 dark:backdrop-blur-[1px]"
              onClick={() => setContextMenu(null)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.15 }}
              className="absolute z-50 flex w-[180px] flex-col gap-1 rounded-2xl border border-white/20 bg-white/80 p-2 shadow-xl backdrop-blur-xl dark:border-white/10 dark:bg-[#1a1d26]/90"
              style={{
                top: contextMenu.y,
                left: contextMenu.x
              }}
            >
              {(() => {
                const msg = messages.find(m => m.id === contextMenu.id);
                const isSelf = msg?.senderId === userId;

                if (isSelf) {
                  return (
                    <>
                      <button
                        onClick={() => {
                          if (msg) setReplyTarget(msg);
                          setContextMenu(null);
                        }}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors dark:text-white dark:hover:bg-white/10 w-full text-left"
                      >
                        <Reply className="h-4 w-4" /> Reply
                      </button>
                      <div className="h-px bg-black/5 dark:bg-white/10 my-1" />
                      <button
                        onClick={() => {
                          if (msg) navigator.clipboard.writeText(msg.text);
                          setContextMenu(null);
                          toast({ title: "Copied to clipboard" });
                        }}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors dark:text-white dark:hover:bg-white/10 w-full text-left"
                      >
                        <Copy className="h-4 w-4" /> Copy Text
                      </button>
                    </>
                  );
                }

                return (
                  <>
                    <div className="flex justify-between px-1 py-1">
                      {['❤️', '👍', '😂', '😮'].map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleReaction(emoji)}
                          className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-black/5 transition-colors text-lg dark:hover:bg-white/10"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                    <div className="h-px bg-black/5 dark:bg-white/10" />
                    <button
                      onClick={() => {
                        if (msg) setReplyTarget(msg);
                        setContextMenu(null);
                      }}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors dark:text-white dark:hover:bg-white/10 w-full text-left"
                    >
                      <Reply className="h-4 w-4" /> Reply
                    </button>
                    <button
                      onClick={() => {
                        if (msg) navigator.clipboard.writeText(msg.text);
                        setContextMenu(null);
                        toast({ title: "Copied to clipboard" });
                      }}
                      className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-black/5 transition-colors dark:text-white dark:hover:bg-white/10 w-full text-left"
                    >
                      <Copy className="h-4 w-4" /> Copy Text
                    </button>
                  </>
                );
              })()}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ========================================
          Input Area (Message Composer)
          ======================================== */}
      <div className="border-t border-border/10 bg-white/50 backdrop-blur-md dark:border-white/10 dark:bg-[#0a0c14]/50">
        {replyTarget && (
          <div className="flex items-center justify-between border-b border-border/10 bg-black/5 px-4 py-2 dark:border-white/10 dark:bg-white/5">
            <div className="flex items-center gap-2 overflow-hidden">
              <Reply className="h-3 w-3 text-blue-500 dark:text-blue-400" />
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-xs font-medium text-blue-500 dark:text-blue-400">
                  Replying to {replyTarget.senderId === userId ? 'yourself' : friendDisplayName}
                </span>
                <span className="truncate text-xs text-muted-foreground dark:text-white/60 block">{replyTarget.text}</span>
              </div>
            </div>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setReplyTarget(null)}>
              <X className="h-3 w-3" />
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2 p-3">
          <Button
            size="icon"
            variant="ghost"
            className="h-10 w-10 shrink-0 text-muted-foreground hover:bg-black/5 hover:text-foreground rounded-full dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
          >
            <Smile className="h-5 w-5" />
          </Button>

          <div className="relative flex-1">
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              className="min-h-[44px] max-h-[120px] w-full resize-none rounded-[22px] border-transparent bg-black/5 px-4 py-3 text-base md:text-sm text-foreground placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-blue-500 scrollbar-hide dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/40"
              disabled={!ready || sending}
              rows={1}
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={!ready || !message.trim() || sending}
            size="icon"
            className={cn(
              "h-10 w-10 shrink-0 rounded-full transition-all duration-200",
              message.trim() ? "bg-[#22c55e] hover:bg-[#22c55e]/90 text-white dark:bg-[#22c55e] dark:hover:bg-[#22c55e]/90" : "bg-black/5 text-muted-foreground dark:bg-white/10 dark:text-white/40"
            )}
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5 ml-0.5" />}
          </Button>
        </div>

        {/* ========================================
            Emoji Picker
            ======================================== */}
        <AnimatePresence>
          {showEmojiPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 300, opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border/10 dark:border-white/10"
            >
              <EmojiPicker
                theme={Theme.AUTO}
                width="100%"
                height={300}
                lazyLoadEmojis={true}
                onEmojiClick={(data) => setMessage(prev => prev + data.emoji)}
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
