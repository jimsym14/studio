'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
} from 'lucide-react';

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

const formatPlayerLabel = (value?: string) => {
  if (!value) return 'Unknown player';
  if (value.toLowerCase().startsWith('guest')) {
    return value.replace(/^guest[-_:]*/i, 'Guest ');
  }
  if (value.length <= 16) return value;
  return `${value.slice(0, 10)}…`;
};

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
  | { kind: 'join'; lobbyId?: string | null; mode?: FriendActivityMode }
  | { kind: 'spectate'; gameId?: string | null; mode?: FriendActivityMode };

type FriendStatusDescriptor = {
  text: string;
  tone: 'active' | 'idle' | 'offline';
};

const deriveFriendStatus = (friend: FriendSummary): FriendStatusDescriptor => {
  const activity = friend.activity;
  if (activity?.kind === 'waiting') {
    return {
      text: `Waiting in ${ACTIVITY_MODE_LABEL[activity.mode] ?? activity.mode} lobby`,
      tone: 'active',
    };
  }
  if (activity?.kind === 'playing') {
    return {
      text: `Playing ${ACTIVITY_MODE_LABEL[activity.mode] ?? activity.mode} game`,
      tone: 'active',
    };
  }
  if (activity?.kind === 'online') {
    return { text: 'Online', tone: 'idle' };
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
    return { text: 'Online', tone: 'idle' };
  }

  return {
    text: friend.lastInteractionAt ? `Active ${formatRelativeTime(friend.lastInteractionAt)}` : 'Offline',
    tone: 'offline',
  };
};

const determineFriendAction = (friend: FriendSummary): FriendActionDescriptor => {
  const activity = friend.activity;
  if (activity?.kind === 'waiting') {
    return { kind: 'join', lobbyId: activity.lobbyId ?? null, mode: activity.mode };
  }
  if (activity?.kind === 'playing') {
    return { kind: 'spectate', gameId: activity.gameId ?? null, mode: activity.mode };
  }
  return { kind: 'invite' };
};

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

export function FriendsModal({
  open,
  onOpenChange,
  onOpenChat,
  onPendingCountChange,
  refreshPendingRequests,
}: FriendsModalProps) {
  const { toast } = useToast();
  const { user, profile } = useFirebase();
  const { socket } = useRealtime();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabKey>('friends');
  const [friendsState, setFriendsState] = useState<FriendsState>(initialFriendsState);
  const [requestsState, setRequestsState] = useState<RequestsState>(initialRequestsState);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [friendActionState, setFriendActionState] = useState<string | null>(null);
  const [friendSearchTerm, setFriendSearchTerm] = useState('');
  const [inviteUsername, setInviteUsername] = useState('');
  const [outgoingMessage, setOutgoingMessage] = useState('');
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

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
      let shareSucceeded = true;
      try {
        await sendInviteLinkToFriend(friend, lobbyUrl, passcode);
      } catch (shareError) {
        shareSucceeded = false;
        console.warn('Failed to send invite via chat', shareError);
      }
      if (typeof window !== 'undefined' && navigator?.clipboard?.writeText) {
        navigator.clipboard
          .writeText(`${lobbyUrl} (code: ${passcode})`)
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

  const handleJoinFriendLobby = async (friend: FriendSummary, lobbyId?: string | null) => {
    if (!lobbyId) {
      toast({ variant: 'destructive', title: 'Lobby unavailable', description: 'This lobby no longer accepts direct joins.' });
      return;
    }
    setFriendActionState(`${friend.friendshipId}:join`);
    try {
      router.push(`/lobby/${lobbyId}`);
    } finally {
      setFriendActionState(null);
    }
  };

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

  useEffect(() => {
    if (!inviteSheetOpen) {
      setInviteError(null);
    }
  }, [inviteSheetOpen]);

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
        ? 'Invite to play'
        : action.kind === 'join'
          ? 'Join lobby'
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
        void handleJoinFriendLobby(friend, action.lobbyId);
        return;
      }
      void handleSpectateFriendGame(friend, action.gameId);
    };

    return (
      <div key={friend.friendshipId} className="flex flex-col gap-3 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 items-center gap-3">
          <Avatar className="h-12 w-12 border border-border/40">
            <AvatarImage src={friend.photoURL ?? undefined} alt={displayLabel} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{usernameLabel}</p>
            <p className={cn('text-xs font-medium', STATUS_TONE_CLASS[status.tone])}>{status.text}</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => onOpenChat?.(friend.friendshipId, friend.userId)}
            disabled={chatDisabled}
            aria-label="Open chat"
          >
            <MessageCircle className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrimaryAction}
            disabled={actionDisabled || isFriendActionBusy(friend.friendshipId, action.kind)}
          >
            {isFriendActionBusy(friend.friendshipId, action.kind) ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {actionIcon}
                {actionLabel}
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };

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

    return (
      <div className="space-y-3">
        {requests.map((request) => {
          const isPending = request.status === 'pending';
          const counterpartId = direction === 'incoming' ? request.from : request.to;
          const nameLookup = friendsLookup[counterpartId];
          const label = nameLookup ?? formatPlayerLabel(counterpartId);
          const badgeVariant = request.status === 'accepted' ? 'default' : request.status === 'pending' ? 'secondary' : 'outline';

          return (
            <div key={request.id} className="rounded-2xl border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {direction === 'incoming' ? 'Sent by' : 'Sent to'} {formatPlayerLabel(counterpartId)}
                  </p>
                </div>
                <Badge variant={badgeVariant}>{request.status}</Badge>
              </div>
              {request.message && <p className="mt-2 rounded-xl bg-muted/40 p-3 text-sm">“{request.message}”</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {direction === 'incoming' && isPending && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => handleRequestAction(request.id, 'accept')}
                      disabled={isRequestBusy(request.id, 'accept')}
                    >
                      {isRequestBusy(request.id, 'accept') ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Check className="mr-1 h-4 w-4" /> Accept
                        </>
                      )}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRequestAction(request.id, 'decline')}
                      disabled={isRequestBusy(request.id, 'decline')}
                    >
                      {isRequestBusy(request.id, 'decline') ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <X className="mr-1 h-4 w-4" /> Decline
                        </>
                      )}
                    </Button>
                  </>
                )}
                {direction === 'outgoing' && isPending && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleRequestAction(request.id, 'cancel')}
                    disabled={isRequestBusy(request.id, 'cancel')}
                  >
                    {isRequestBusy(request.id, 'cancel') ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <UserMinus className="mr-1 h-4 w-4" /> Cancel
                      </>
                    )}
                  </Button>
                )}
                {!isPending && (
                  <p className="text-xs text-muted-foreground">
                    Resolved {formatRelativeTime(request.updatedAt ?? request.createdAt)}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const gatingMessage = !user
    ? 'Sign in or create an account to add friends and unlock persistent chats.'
    : 'Guests can only use temporary lobby chats. Create an account to unlock friends.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>Friends & Chats</DialogTitle>
          <DialogDescription>Manage your roster, invites, and future chat launches.</DialogDescription>
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
        {canUseFriends && (
          <div className="space-y-4">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabKey)}>
              <TabsList className="grid w-full grid-cols-2 gap-2 rounded-2xl bg-muted/40 p-2">
                <TabsTrigger
                  value="friends"
                  className="flex h-auto flex-col gap-1 rounded-xl border border-transparent px-3 py-2 text-xs font-semibold uppercase tracking-[0.35em] data-[state=active]:border-primary/40 data-[state=active]:bg-background"
                >
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <Users className="h-4 w-4" />
                    <span>Friends</span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="requests"
                  className="flex h-auto flex-col gap-1 rounded-xl border border-transparent px-3 py-2 text-xs font-semibold uppercase tracking-[0.35em] data-[state=active]:border-primary/40 data-[state=active]:bg-background"
                >
                  <div className="flex items-center justify-center gap-2 text-sm">
                    <UserPlus className="h-4 w-4" />
                    <span>Requests</span>
                    {pendingIncomingCount > 0 && (
                      <Badge variant="destructive" className="ml-1">
                        {pendingIncomingCount}
                      </Badge>
                    )}
                  </div>
                </TabsTrigger>
              </TabsList>
              <TabsContent value="friends">
                <div className="rounded-3xl border border-border/60 p-4">
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Your roster</p>
                      <p className="text-xs text-muted-foreground">
                        Search handles and open persistent chats once you both accept.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        value={friendSearchTerm}
                        onChange={(event) => setFriendSearchTerm(event.target.value)}
                        placeholder="Search friends"
                        className="w-48"
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
                    <ScrollArea className="max-h-[360px] pr-4">
                      <div className="space-y-3">
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
              </TabsContent>
              <TabsContent value="requests">
                <div className="space-y-6 rounded-3xl border border-border/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Requests overview</p>
                      <p className="text-xs text-muted-foreground">Handle invites you&apos;ve received or sent.</p>
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
                  <div className="grid gap-4 lg:grid-cols-2">
                    <section className="space-y-3 rounded-2xl border p-4">
                      <div>
                        <p className="text-sm font-semibold">Incoming requests</p>
                        <p className="text-xs text-muted-foreground">Approve or decline invites from other players.</p>
                      </div>
                      {renderRequestList(requestsState.incoming, 'incoming')}
                    </section>
                    <Sheet open={inviteSheetOpen} onOpenChange={setInviteSheetOpen}>
                      <section className="space-y-3 rounded-2xl border p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Outgoing requests</p>
                            <p className="text-xs text-muted-foreground">See invites you&apos;ve sent or add someone new.</p>
                          </div>
                          <div className="flex items-center gap-2">
                            <SheetTrigger asChild>
                              <Button size="icon" variant="outline" aria-label="Send a request">
                                <Plus className="h-4 w-4" />
                              </Button>
                            </SheetTrigger>
                          </div>
                        </div>
                        {renderRequestList(requestsState.outgoing, 'outgoing')}
                      </section>
                      <SheetContent side="right" className="sm:max-w-md">
                        <SheetHeader>
                          <SheetTitle>Send a friend request</SheetTitle>
                          <SheetDescription>Enter the exact username of the player you want to add.</SheetDescription>
                        </SheetHeader>
                        <form
                          className="mt-6 space-y-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void handleSendRequestToUsername(inviteUsername);
                          }}
                        >
                          <div className="space-y-2">
                            <Label htmlFor="invite-username">Username</Label>
                            <Input
                              id="invite-username"
                              value={inviteUsername}
                              onChange={(event) => setInviteUsername(event.target.value)}
                              autoComplete="off"
                              placeholder="wordmate"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="invite-message">Optional message</Label>
                            <Textarea
                              id="invite-message"
                              value={outgoingMessage}
                              onChange={(event) => setOutgoingMessage(event.target.value)}
                              placeholder="Let them know why you&apos;re reaching out"
                              className="min-h-[80px]"
                            />
                          </div>
                          {inviteError && <p className="text-sm text-destructive">{inviteError}</p>}
                          <div className="flex items-center gap-2">
                            <Button
                              type="submit"
                              className="flex-1"
                              disabled={!inviteUsername.trim() || isRequestBusy(inviteUsername.trim(), 'send')}
                            >
                              {isRequestBusy(inviteUsername.trim(), 'send') ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <UserPlus className="mr-1 h-4 w-4" /> Send invite
                                </>
                              )}
                            </Button>
                            <Button type="button" variant="outline" onClick={() => setInviteSheetOpen(false)}>
                              Close
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            We only send requests to real usernames. If a name doesn&apos;t exist, you&apos;ll see the exact server error here.
                          </p>
                        </form>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
