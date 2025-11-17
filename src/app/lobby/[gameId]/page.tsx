'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  AlertTriangle,
  Check,
  Clock3,
  Copy,
  Crown,
  Handshake,
  Hourglass,
  KeyRound,
  Link2,
  Lock,
  Swords,
  Timer,
  Unlock,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { arrayUnion, doc, onSnapshot, runTransaction, updateDoc } from 'firebase/firestore';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/utils';
import { usePlayerNames } from '@/hooks/use-player-names';
import type { GameDocument } from '@/types/game';
import { hashToHex } from '@/lib/hash-client';
import { readLobbyAccess, rememberLobbyAccess } from '@/lib/lobby-access';
import { readLobbyPasscode, rememberLobbyPasscode } from '@/lib/lobby-passcode';

const LOBBY_GRACE_MINUTES = 3;
const INACTIVITY_MINUTES = 30;

const addMinutesIso = (iso: string, minutes: number | null) => {
  if (!minutes) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
};

const parseMinutesSetting = (value?: string | null) => {
  if (!value || value === 'unlimited') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSecondsSetting = (value?: string | null) => {
  if (!value || value === 'unlimited') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatDuration = (deadline: string | null, now: number) => {
  if (!deadline) return null;
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return null;
  const diff = Math.max(0, target - now);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const formatMatchSettingLabel = (value?: string | null) => {
  const parsed = parseMinutesSetting(value);
  if (parsed === null) return '∞';
  return `${parsed} min`;
};

const formatTurnSettingLabel = (value?: string | null) => {
  const parsed = parseSecondsSetting(value);
  if (parsed === null) return '∞';
  if (parsed >= 60) {
    const minutes = Math.floor(parsed / 60);
    const seconds = parsed % 60;
    if (!seconds) return `${minutes} min`;
    return `${minutes}m ${seconds}s`;
  }
  return `${parsed}s`;
};

const abbreviateId = (value: string) => {
  if (value.length <= 8) return value.toUpperCase();
  return `${value.slice(0, 4)}…${value.slice(-3)}`.toUpperCase();
};

const ModeBadge = ({ game, isDark }: { game: GameDocument | null; isDark: boolean }) => {
  if (!game) return null;
  let label = 'Solo';
  let Icon = Crown;
  if (game.gameType === 'multiplayer' && game.multiplayerMode === 'co-op') {
    label = 'Co-op';
    Icon = Handshake;
  } else if (game.gameType === 'multiplayer') {
    label = 'PvP';
    Icon = Swords;
  }
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-full border px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] sm:tracking-[0.4em]',
        isDark
          ? 'border-white/15 bg-white/[0.04] text-white'
          : 'border-slate-200/80 bg-white text-slate-600'
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
};

const timerAccentClass: Record<'light' | 'dark', Record<'primary' | 'emerald' | 'amber' | 'muted', string>> = {
  light: {
    primary: 'bg-gradient-to-r from-[#ffb27a] to-[#ffdda7] text-[#5f2b00]',
    emerald: 'bg-gradient-to-r from-[#c9f7de] to-[#9ce8bf] text-[#0f5132]',
    amber: 'bg-gradient-to-r from-[#ffe8b5] to-[#ffd48a] text-[#7a4b00]',
    muted: 'bg-slate-100 text-slate-700',
  },
  dark: {
    primary: 'bg-gradient-to-r from-[#f97316] to-[#fabb5a] text-white',
    emerald: 'bg-gradient-to-r from-[#34d399] to-[#6ee7b7] text-white',
    amber: 'bg-gradient-to-r from-[#fcd34d] to-[#fb923c] text-slate-900',
    muted: 'bg-white/10 text-white/80',
  },
};

const TimerCard = ({
  label,
  value,
  icon: Icon,
  accent,
  isDark,
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  accent: 'primary' | 'emerald' | 'amber' | 'muted';
  isDark: boolean;
}) => (
  <div
    className={cn(
      'rounded-2xl p-3 transition-all',
      isDark
        ? 'border border-white/10 bg-white/5 shadow-[inset_6px_6px_18px_rgba(0,0,0,0.55),inset_-4px_-4px_12px_rgba(255,255,255,0.05)]'
        : 'glass-panel-soft text-slate-900'
    )}
  >
    <div
      className={cn(
        'flex items-center justify-between text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.35em]',
        isDark ? 'text-white/70' : 'text-slate-500'
      )}
    >
      <span>{label}</span>
      <Icon className="h-4 w-4" />
    </div>
    <div
      className={cn(
        'mt-2 rounded-xl px-3 py-2 text-lg font-black tracking-tight shadow-inner',
        timerAccentClass[isDark ? 'dark' : 'light'][accent]
      )}
    >
      {value}
    </div>
  </div>
);

const LoadingState = () => (
  <div className="flex min-h-screen flex-col items-center justify-center gap-6">
    <Logo />
    <div className="w-full max-w-2xl space-y-4 rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Skeleton className="h-24 w-full rounded-2xl" />
        <Skeleton className="h-24 w-full rounded-2xl" />
      </div>
      <Skeleton className="h-40 w-full rounded-3xl" />
    </div>
  </div>
);

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const { db, userId, profile } = useFirebase();
  const { resolvedTheme } = useTheme();
  const { toast } = useToast();

  const [game, setGame] = useState<GameDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [isPasscodeCopied, setIsPasscodeCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeError, setPasscodeError] = useState<string | null>(null);
  const [isVerifyingPasscode, setIsVerifyingPasscode] = useState(false);
  const [cachedAccessHash, setCachedAccessHash] = useState<string | null>(null);
  const [rememberedPasscode, setRememberedPasscode] = useState<string | null>(null);
  const lobbyCloseAlertedRef = useRef(false);
  const inactivityAlertedRef = useRef(false);

  const gameId = params.gameId as string;
  const isDarkTheme = resolvedTheme === 'dark';

  const inviteLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lobby/${gameId}`;
  }, [gameId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setCachedAccessHash(readLobbyAccess(gameId));
    setRememberedPasscode(readLobbyPasscode(gameId));
  }, [gameId]);

  const isLobbyPlayer = Boolean(userId && game?.players?.includes(userId));

  useEffect(() => {
    if (!game || !game.passcodeHash) return;
    const isPrivateLobby = (game.visibility ?? 'public') === 'private';
    if (!isPrivateLobby || !(game.hasPasscode ?? false)) return;
    if (!isLobbyPlayer) return;
    if (cachedAccessHash === game.passcodeHash) return;
    rememberLobbyAccess(gameId, game.passcodeHash);
    setCachedAccessHash(game.passcodeHash);
  }, [cachedAccessHash, game, gameId, isLobbyPlayer]);

  useEffect(() => {
    if (!db || !userId || !gameId || !isLobbyPlayer) return;
    const gameRef = doc(db, 'games', gameId);

    const registerPresence = async () => {
      try {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(gameRef);
          if (!snapshot.exists()) return;
          const data = snapshot.data() as GameDocument;
          const activePlayers = new Set(data.activePlayers ?? []);
          activePlayers.add(userId);
          const nowIso = new Date().toISOString();
          const updatePayload: Partial<GameDocument> & Record<string, unknown> = {
            activePlayers: Array.from(activePlayers),
            lastActivityAt: nowIso,
            lobbyClosesAt: null,
            inactivityClosesAt: addMinutesIso(nowIso, INACTIVITY_MINUTES),
          };
          transaction.update(gameRef, updatePayload);
        });
      } catch (error) {
        console.error('Failed to register lobby presence', error);
      }
    };

    const unregisterPresence = async () => {
      try {
        await runTransaction(db, async (transaction) => {
          const snapshot = await transaction.get(gameRef);
          if (!snapshot.exists()) return;
          const data = snapshot.data() as GameDocument;
          const filtered = (data.activePlayers ?? []).filter((id) => id !== userId);
          const updatePayload: Partial<GameDocument> & Record<string, unknown> = {
            activePlayers: filtered,
          };
          if (!filtered.length) {
            const nowIso = new Date().toISOString();
            updatePayload.lobbyClosesAt = addMinutesIso(nowIso, LOBBY_GRACE_MINUTES);
          }
          transaction.update(gameRef, updatePayload);
        });
      } catch (error) {
        console.error('Failed to unregister lobby presence', error);
      }
    };

    void registerPresence();

    const handleBeforeUnload = () => {
      void unregisterPresence();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void unregisterPresence();
    };
  }, [db, gameId, userId, isLobbyPlayer]);

  useEffect(() => {
    if (!gameId || !userId || !db) return;
    const gameRef = doc(db, 'games', gameId);

    const unsubscribe = onSnapshot(gameRef, async (docSnap) => {
      if (!docSnap.exists()) {
        toast({ variant: 'destructive', title: 'Game not found', description: 'The lobby may have expired.' });
        router.push('/');
        return;
      }

      const gameData = docSnap.data() as GameDocument;
      const rawPlayers = Array.isArray(gameData.players) ? gameData.players : [];
      const normalizedPlayers = Array.from(
        new Set(rawPlayers.filter((id): id is string => typeof id === 'string' && id.length > 0))
      );
      const nextGameData =
        normalizedPlayers.length === rawPlayers.length ? gameData : { ...gameData, players: normalizedPlayers };

      if (normalizedPlayers.length !== rawPlayers.length) {
        try {
          await updateDoc(gameRef, { players: normalizedPlayers });
        } catch (error) {
          console.error('Failed to normalize lobby roster', error);
        }
      }

      const passProtected = (nextGameData.hasPasscode ?? false) && Boolean(nextGameData.passcodeHash);
      const cachedMatch = Boolean(
        passProtected && nextGameData.passcodeHash && cachedAccessHash && cachedAccessHash === nextGameData.passcodeHash
      );
      setGame(nextGameData);

      const players = nextGameData.players ?? [];
      const isPlayer = players.includes(userId);

      if (passProtected && !isPlayer && !cachedMatch) {
        setLoading(false);
        return;
      }

      if (!isPlayer && nextGameData.status === 'waiting' && players.length < 2) {
        try {
          const nowIso = new Date().toISOString();
          await updateDoc(gameRef, {
            players: arrayUnion(userId),
            activePlayers: arrayUnion(userId),
            lastActivityAt: nowIso,
            lobbyClosesAt: null,
            inactivityClosesAt: addMinutesIso(nowIso, INACTIVITY_MINUTES),
          });
        } catch (error) {
          console.error('Failed to auto-join lobby', error);
        }
      }

      if (
        nextGameData.status === 'waiting' &&
        players.length >= 2 &&
        (nextGameData.activePlayers?.length ?? 0) >= 2
      ) {
        try {
          await updateDoc(gameRef, { status: 'in_progress' });
          toast({ title: 'Players ready', description: 'Launching the board…' });
        } catch (error) {
          console.error('Failed to start match from lobby', error);
        }
      }

      if (nextGameData.status === 'in_progress') {
        router.push(`/game/${gameId}`);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [cachedAccessHash, db, gameId, router, toast, userId]);

  useEffect(() => {
    if (!game?.lobbyClosesAt) {
      lobbyCloseAlertedRef.current = false;
      return;
    }
    if (lobbyCloseAlertedRef.current) return;
    const deadline = new Date(game.lobbyClosesAt).getTime();
    if (Number.isNaN(deadline)) return;
    if (deadline <= now) {
      lobbyCloseAlertedRef.current = true;
      toast({ variant: 'destructive', title: 'Lobby closed', description: 'Nobody reconnected during the grace period.' });
      router.push('/');
    }
  }, [game?.lobbyClosesAt, now, router, toast]);

  useEffect(() => {
    if (!game?.inactivityClosesAt) {
      inactivityAlertedRef.current = false;
      return;
    }
    if (inactivityAlertedRef.current) return;
    const deadline = new Date(game.inactivityClosesAt).getTime();
    if (Number.isNaN(deadline)) return;
    if (deadline <= now) {
      inactivityAlertedRef.current = true;
      toast({
        variant: 'destructive',
        title: 'Lobby expired',
        description: 'Create a new lobby when you are ready to play again.',
      });
      router.push('/');
    }
  }, [game?.inactivityClosesAt, now, router, toast]);

  const copyToClipboard = useCallback(async () => {
    if (!inviteLink) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast({ variant: 'destructive', title: 'Clipboard unavailable', description: 'Copy the link manually instead.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setIsCopied(true);
      toast({ title: 'Link copied', description: 'Share it with a friend.' });
      window.setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy invite link', error);
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Try copying manually.' });
    }
  }, [inviteLink, toast]);

  const handleReturnHome = useCallback(() => {
    router.push('/');
  }, [router]);

  const handleVerifyPasscode = useCallback(async () => {
    if (!game?.passcodeHash) {
      setPasscodeError('This lobby no longer accepts new players.');
      return;
    }
    if (!passcodeInput.trim()) {
      setPasscodeError('Enter the passcode first.');
      return;
    }
    setIsVerifyingPasscode(true);
    setPasscodeError(null);
    try {
      const trimmedPasscode = passcodeInput.trim();
      const hashed = await hashToHex(trimmedPasscode);
      if (hashed !== game.passcodeHash) {
        setPasscodeError('That passcode does not match.');
        return;
      }
      rememberLobbyAccess(gameId, hashed);
      setCachedAccessHash(hashed);
      rememberLobbyPasscode(gameId, trimmedPasscode);
      setRememberedPasscode(trimmedPasscode);
      setPasscodeInput('');
    } catch (error) {
      console.error('Failed to verify lobby passcode', error);
      setPasscodeError('Unable to verify passcode. Try again.');
    } finally {
      setIsVerifyingPasscode(false);
    }
  }, [game?.passcodeHash, gameId, passcodeInput]);

  const trackedPlayerIds = game?.players ?? [];
  const { getPlayerName } = usePlayerNames({ db, playerIds: trackedPlayerIds });

  const isPrivateLobby = (game?.visibility ?? 'public') === 'private';
  const passcodeDisplayValue = isPrivateLobby ? rememberedPasscode : null;
  const hasPassRequirement = isPrivateLobby && (game?.hasPasscode ?? false) && Boolean(game?.passcodeHash);
  const cachedPasscodeMatch = Boolean(hasPassRequirement && game?.passcodeHash && cachedAccessHash === game?.passcodeHash);
  const showPasscodeGate = Boolean(hasPassRequirement && !isLobbyPlayer && !cachedPasscodeMatch);

  const handleCopyPasscode = useCallback(async () => {
    if (!passcodeDisplayValue) return;
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast({ variant: 'destructive', title: 'Clipboard unavailable', description: 'Enter it manually instead.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(passcodeDisplayValue);
      setIsPasscodeCopied(true);
      toast({ title: 'Passcode copied', description: 'Share it securely.' });
      window.setTimeout(() => setIsPasscodeCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy passcode', error);
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Enter it manually instead.' });
    }
  }, [passcodeDisplayValue, toast]);

  if (loading || !game) {
    return <LoadingState />;
  }

  const playersList = trackedPlayerIds;
  const activePlayersList = game.activePlayers ?? [];
  const totalPlayers = playersList.length;
  const activePlayersCount = activePlayersList.length;
  const waitingForPlayers = game.status === 'waiting';
  const lobbyCountdown = formatDuration(game.lobbyClosesAt ?? null, now);
  const inactivityCountdown = formatDuration(game.inactivityClosesAt ?? null, now);
  const matchCountdown = formatDuration(game.matchDeadline ?? null, now);
  const turnCountdown = formatDuration(game.turnDeadline ?? null, now);
  const noActivePlayers = waitingForPlayers && totalPlayers > 0 && activePlayersCount === 0;

  const statusText = (() => {
    if (noActivePlayers && lobbyCountdown) {
      return `All players disconnected. Closing in ${lobbyCountdown}.`;
    }
    if (totalPlayers < 2) {
      return 'Waiting for another player to join.';
    }
    if (activePlayersCount < totalPlayers) {
      return 'Waiting for everyone to reconnect.';
    }
    if (game.status === 'in_progress') {
      return 'Match starting…';
    }
    return 'Both players connected. Starting soon!';
  })();

  const resolvePlayerName = (playerId?: string | null) => {
    if (!playerId) return null;
    if (playerId === userId) {
      return profile?.username ?? getPlayerName(playerId) ?? 'You';
    }
    return getPlayerName(playerId) ?? `Player ${playerId.slice(-4).toUpperCase()}`;
  };

  const currentUserDisplayName = resolvePlayerName(userId) ?? profile?.username ?? 'You';
  const matchDisplayValue = matchCountdown ?? formatMatchSettingLabel(game.matchTime);
  const turnDisplayValue = turnCountdown ?? formatTurnSettingLabel(game.turnTime);

  const timerCards = [
    { label: 'Match limit', value: matchDisplayValue, icon: Timer, accent: 'muted' as const },
    { label: 'Turn limit', value: turnDisplayValue, icon: Clock3, accent: 'muted' as const },
    { label: 'Idle close', value: inactivityCountdown ?? '—', icon: Hourglass, accent: 'muted' as const },
    { label: 'Lobby grace', value: lobbyCountdown ?? '∞', icon: AlertTriangle, accent: 'muted' as const },
  ];

  return (
    <div
      className={cn(
        'relative min-h-screen overflow-x-hidden px-3 py-8 text-slate-900 transition-colors sm:px-8 sm:py-10',
        isDarkTheme ? 'bg-[#04050a] text-white' : 'bg-gradient-to-b from-[#fdfbff] via-[#eef3ff] to-[#dce8ff] text-slate-900'
      )}
    >
      {showPasscodeGate && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <motion.form
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="w-full max-w-md space-y-4 rounded-3xl border border-white/10 bg-white/10 p-6 text-white backdrop-blur-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void handleVerifyPasscode();
            }}
          >
            <p className="text-xs uppercase tracking-[0.25em] text-white/60 sm:tracking-[0.4em]">Private lobby</p>
            <h2 className="text-2xl font-black">Enter the passcode to join</h2>
            <p className="text-sm text-white/70">
              The host locked this room. Share the passcode privately and enter it below to continue.
            </p>
            <Input
              value={passcodeInput}
              onChange={(event) => setPasscodeInput(event.target.value)}
              placeholder="Passcode"
              disabled={isVerifyingPasscode}
              className="border-white/30 bg-white/10 text-base text-white placeholder:text-white/40"
            />
            {passcodeError && <p className="text-sm text-rose-300">{passcodeError}</p>}
            <div className="flex flex-wrap gap-3">
              <Button type="submit" disabled={isVerifyingPasscode} className="flex-1 rounded-2xl bg-white text-slate-900">
                {isVerifyingPasscode ? 'Checking…' : 'Unlock lobby'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleReturnHome}
                className="flex-1 rounded-2xl border border-white/20 bg-transparent text-white hover:bg-white/10"
              >
                Back home
              </Button>
            </div>
          </motion.form>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 opacity-75">
        <div
          className={cn(
            'absolute -left-10 top-0 h-72 w-72 rounded-full blur-[140px]',
            isDarkTheme ? 'bg-primary/30' : 'bg-primary/20'
          )}
        />
        <div
          className={cn(
            'absolute bottom-10 right-0 h-96 w-96 rounded-full blur-[160px]',
            isDarkTheme ? 'bg-emerald-500/20' : 'bg-emerald-300/40'
          )}
        />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-1 sm:px-4 lg:px-0">
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className={cn(
            'mx-auto w-full max-w-[520px] space-y-5 overflow-hidden rounded-[28px] border p-4 shadow-[0_35px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:max-w-3xl sm:space-y-8 sm:p-8 lg:max-w-none lg:rounded-[32px] lg:p-10',
            isDarkTheme
              ? 'border-white/15 bg-black/60 text-white/90 shadow-[0_40px_120px_rgba(0,0,0,0.65)]'
              : 'pale-orange-shell text-slate-900'
          )}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] lg:gap-8">
            <div className="min-w-0 space-y-5 sm:space-y-6">
              <div
                className={cn(
                  'rounded-[24px] px-4 py-3 text-sm sm:px-5 sm:py-4',
                  isDarkTheme
                    ? 'border border-white/15 bg-black/20 text-white shadow-[inset_6px_6px_20px_rgba(0,0,0,0.6),inset_-4px_-4px_12px_rgba(255,255,255,0.08)]'
                    : 'glass-panel-strong text-slate-800'
                )}
              >
                <div className="flex flex-wrap items-center gap-4">
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'text-[0.55rem] uppercase tracking-[0.3em] sm:tracking-[0.5em]',
                        isDarkTheme ? 'text-white/60' : 'text-slate-500'
                      )}
                    >
                      Lobby ID
                    </p>
                    <p className={cn('font-mono text-base', isDarkTheme ? 'text-white' : 'text-slate-900')}>
                      {abbreviateId(gameId)}
                    </p>
                  </div>
                  <div
                    className={cn('hidden h-10 w-px sm:block', isDarkTheme ? 'bg-white/10' : 'bg-slate-200')}
                  />
                  <div className="min-w-0">
                    <p
                      className={cn(
                        'text-[0.55rem] uppercase tracking-[0.3em] sm:tracking-[0.5em]',
                        isDarkTheme ? 'text-white/60' : 'text-slate-500'
                      )}
                    >
                      Signed in
                    </p>
                    <p
                      className={cn('truncate font-semibold', isDarkTheme ? 'text-white' : 'text-slate-900')}
                      title={currentUserDisplayName}
                    >
                      {currentUserDisplayName}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
                <ModeBadge game={game} isDark={isDarkTheme} />
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.35em]',
                    isDarkTheme ? 'border-white/10 text-white/80' : 'border-white/70 bg-white/70 text-slate-700'
                  )}
                >
                  <Users className="h-4 w-4" />
                  {activePlayersCount}/{Math.max(2, totalPlayers)} Ready
                </span>
                <span
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.35em]',
                    isDarkTheme ? 'border-white/15 bg-white/5 text-white/80' : 'border-slate-200 bg-white text-slate-700'
                  )}
                >
                  {isPrivateLobby ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  {isPrivateLobby ? 'Private' : 'Public'}
                </span>
                {isPrivateLobby && (
                  <button
                    type="button"
                    onClick={() => {
                      void handleCopyPasscode();
                    }}
                    disabled={!passcodeDisplayValue}
                    className={cn(
                      'inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] transition-colors sm:tracking-[0.35em]',
                      isDarkTheme
                        ? 'border-white/15 bg-white/5 text-white/80'
                        : 'border-slate-200 bg-white text-slate-700',
                      !passcodeDisplayValue && 'opacity-60'
                    )}
                    title={passcodeDisplayValue ? 'Copy passcode' : 'Passcode appears after you enter it on this device.'}
                  >
                    <KeyRound className="h-4 w-4" />
                    <span className="font-mono text-xs tracking-normal sm:text-sm">
                      {passcodeDisplayValue ?? '—'}
                    </span>
                    {isPasscodeCopied && <Check className="h-4 w-4" />}
                  </button>
                )}
              </div>

              <p className={cn('break-words text-base leading-relaxed', isDarkTheme ? 'text-white/80' : 'text-slate-600')}>
                {statusText}
              </p>


              {lobbyCountdown && noActivePlayers && (
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm',
                    isDarkTheme ? 'border-amber-500/30 bg-amber-500/10 text-amber-100' : 'border-amber-200 bg-amber-50 text-amber-700'
                  )}
                >
                  <WifiOff className="h-4 w-4" />
                  <span>Connection lost. Lobby closes in {lobbyCountdown} unless someone returns.</span>
                </div>
              )}

              <div className="grid w-full gap-2.5 sm:grid-cols-2 sm:gap-4">
                {timerCards.map((card) => (
                  <TimerCard key={card.label} {...card} isDark={isDarkTheme} />
                ))}
              </div>

              <Button
                type="button"
                onClick={handleReturnHome}
                className={cn(
                  'w-full rounded-2xl border px-5 py-3 text-xs font-semibold uppercase tracking-[0.18em] transition-colors sm:tracking-[0.35em]',
                  isDarkTheme
                    ? 'border-white/20 bg-white/5 text-white hover:bg-white/10'
                    : 'border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50'
                )}
              >
                Return to homepage
              </Button>

              <div
                className={cn(
                  'rounded-3xl px-4 py-4 sm:px-5',
                  isDarkTheme
                    ? 'border border-white/10 bg-white/[0.02] shadow-[inset_6px_6px_18px_rgba(0,0,0,0.55),inset_-4px_-4px_12px_rgba(255,255,255,0.05)]'
                    : 'glass-panel-soft text-slate-900'
                )}
              >
                <p
                  className={cn(
                    'text-xs font-semibold uppercase tracking-[0.25em] sm:tracking-[0.4em]',
                    isDarkTheme ? 'text-white/60' : 'text-slate-500'
                  )}
                >
                  Invite link
                </p>
                <div className="mt-3 flex w-full flex-col gap-3 sm:flex-row">
                  <div
                    className={cn(
                      'flex flex-1 items-center gap-2 rounded-2xl px-4 py-3 text-sm font-mono',
                      isDarkTheme
                        ? 'border border-white/10 bg-black/20 text-white/80'
                        : 'glass-panel-soft text-slate-800'
                    )}
                  >
                    <Link2 className="h-4 w-4 shrink-0" />
                    <span className="truncate">{inviteLink}</span>
                  </div>
                  <Button
                    type="button"
                    onClick={copyToClipboard}
                    className="w-full rounded-2xl bg-gradient-to-r from-[#ff7a18] to-[#ffb347] text-black shadow-[0_10px_30px_rgba(0,0,0,0.25)] sm:w-auto"
                  >
                    {isCopied ? (
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <Check className="h-4 w-4" /> Copied
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-2 text-sm font-semibold">
                        <Copy className="h-4 w-4" /> Copy link
                      </span>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div
              className={cn(
                'min-w-0 space-y-4 rounded-[24px] p-4 sm:space-y-5 sm:p-5',
                isDarkTheme
                  ? 'border border-white/10 bg-white/[0.02] shadow-[inset_6px_6px_18px_rgba(0,0,0,0.5),inset_-4px_-4px_12px_rgba(255,255,255,0.05)]'
                  : 'glass-panel-soft text-slate-900'
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p
                  className={cn(
                    'text-xs uppercase tracking-[0.25em] sm:tracking-[0.35em]',
                    isDarkTheme ? 'text-white/60' : 'text-slate-500'
                  )}
                >
                  Players
                </p>
                <span
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] sm:tracking-[0.3em]',
                    isDarkTheme
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
                      : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  )}
                >
                  {activePlayersCount} online
                </span>
              </div>

              <div className="space-y-3">
                {playersList.length ? (
                  playersList.map((playerId) => {
                    const isConnected = activePlayersList.includes(playerId);
                    return (
                      <div
                        key={playerId}
                        className={cn(
                          'flex min-w-0 items-center justify-between gap-3 rounded-2xl px-4 py-3',
                          isDarkTheme
                            ? 'border border-white/10 bg-gradient-to-r from-white/[0.04] to-transparent'
                            : 'glass-panel-soft text-slate-900'
                        )}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{resolvePlayerName(playerId)}</p>
                          <p className="text-xs text-muted-foreground">{abbreviateId(playerId)}</p>
                        </div>
                        <span
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-semibold',
                            isConnected
                              ? isDarkTheme
                                ? 'bg-emerald-500/15 text-emerald-200'
                                : 'bg-emerald-100 text-emerald-700'
                              : isDarkTheme
                                ? 'bg-amber-500/15 text-amber-200'
                                : 'bg-amber-100 text-amber-700'
                          )}
                        >
                          {isConnected ? 'Connected' : 'Reconnecting'}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div
                    className={cn(
                      'rounded-2xl border border-dashed px-4 py-6 text-center text-sm',
                      isDarkTheme ? 'border-white/20 text-white/50' : 'border-slate-200 text-slate-500'
                    )}
                  >
                    Waiting for players to join…
                  </div>
                )}
              </div>

              <p className={cn('text-xs leading-relaxed', isDarkTheme ? 'text-white/60' : 'text-slate-500')}>
                Need a moment? Lobbies auto-close after {INACTIVITY_MINUTES} minutes of inactivity. We hold the room for
                {` ${LOBBY_GRACE_MINUTES} `}
                additional minutes if everyone disconnects.
              </p>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
