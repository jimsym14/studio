'use client';

import { arrayRemove, arrayUnion, doc, onSnapshot, runTransaction, updateDoc, type DocumentData, type DocumentSnapshot } from 'firebase/firestore';
import {
  AlertTriangle,
  Clock3,
  Copy,
  CornerDownLeft,
  Crown,
  Delete,
  DoorOpen,
  Handshake,
  Home,
  Lock,
  RefreshCcw,
  RotateCcw,
  Swords,
  Timer,
  Users,
  Hourglass,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTheme } from 'next-themes';
import { useParams, useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { GameGrid } from '@/components/game/game-grid';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useFirebase } from '@/components/firebase-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { GraffitiBackground } from '@/components/graffiti-background';
import { usePlayerNames } from '@/hooks/use-player-names';
import { useToast } from '@/hooks/use-toast';
import { createGame, advanceGameRound, toggleEndVote, surrenderMatch } from '@/lib/actions/game';
import type { GameDocument } from '@/types/game';
import type { GuessResult, GuessScore } from '@/lib/wordle';
import { getKeyboardHints, scoreGuess } from '@/lib/wordle';
import { cn } from '@/lib/utils';
import { ChatDock } from '@/components/chat-dock';
import { isGuestProfile } from '@/types/user';
import type { ChatAvailability, ChatContextDescriptor } from '@/types/social';
import { runWithFirestoreRetry } from '@/lib/firestore-retry';
import { useGamePresence } from '@/hooks/use-game-presence';
import { useGameTyping } from '@/hooks/use-game-typing';
import { Keyboard } from '@/components/keyboard';
import { useIsMobile } from '@/hooks/use-mobile';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};


const MATCH_HARD_STOP_MINUTES = 30;
const REJOIN_MINUTES = 2;
const DISCONNECT_DRAW_MS = 60_000;
const confettiPalette = ['#FF7A18', '#FFB800', '#39D98A', '#23BDEE', '#9960FF'];
type ConfettiPiece = {
  color: string;
  left: number;
  delay: number;
  duration: number;
  rotation: number;
};
type DebugResultVariant = 'playerWin' | 'playerLoss' | 'rivalWin' | 'noWinner' | null;

const getNextTurnPlayerId = (order: string[], current: string | null): string | null => {
  if (!order.length) return null;
  const currentIndex = current ? order.indexOf(current) : -1;
  if (currentIndex === -1) {
    return order[0];
  }
  return order[(currentIndex + 1) % order.length];
};

const matchMinutesFromSetting = (value?: string) => {
  if (!value || value === 'unlimited') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const turnSecondsFromSetting = (value?: string) => {
  if (!value || value === 'unlimited') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const addMinutesIso = (iso: string, minutes: number | null) => {
  if (!minutes) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
};

const addSecondsIso = (iso: string, seconds: number | null) => {
  if (!seconds) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + seconds * 1000).toISOString();
};

const abbreviateId = (value: string) => {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-3)}`;
};

const formatCountdown = (deadline: string | null | undefined, now: number) => {
  if (!deadline) return null;
  const target = new Date(deadline).getTime();
  if (Number.isNaN(target)) return null;
  const diff = Math.max(0, target - now);
  const totalSeconds = Math.floor(diff / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const describeNameGroup = (names: string[], pluralLabel: string) => {
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.length} ${pluralLabel}`;
};

const getModeMeta = (game?: GameDocument | null) => {
  if (!game) return null;
  if (game.gameType === 'solo') {
    return { label: 'Solo', icon: Crown };
  }
  if (game.multiplayerMode === 'co-op') {
    return { label: 'Co-op', icon: Handshake };
  }
  return { label: 'PvP', icon: Swords };
};



const SOLO_LOSS_MESSAGES = [
  'The word slipped through your fingers this time.',
  'Mystery letters stayed hidden—shake it off and try again.',
  'Close call! Take a breath and give it another go.',
  'Even legends miss a word now and then.',
  'Consider this a warm-up round.',
  'Every loss sharpens your instincts for the next win.',
  'The board resets, but your streak can return stronger.',
  'You’ve got the grit—queue up another run.',
  'Tough break, but the next solve is yours.',
  'Even the best detectives hit a dead end occasionally.',
] as const;

const getRandomSoloLossMessage = () => {
  const index = Math.floor(Math.random() * SOLO_LOSS_MESSAGES.length);
  return SOLO_LOSS_MESSAGES[index];
};

export default function GamePage() {
  const params = useParams<{ gameId?: string }>();
  const router = useRouter();
  const { db, userId, user, profile } = useFirebase();
  const { toast } = useToast();
  const { theme, resolvedTheme } = useTheme();
  const isLightMode = resolvedTheme === 'light';
  const isMobile = useIsMobile();

  const [game, setGame] = useState<GameDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentGuess, setCurrentGuess] = useState('');
  const [pendingGuess, setPendingGuess] = useState<string | null>(null);
  const [pendingGuessTargetCount, setPendingGuessTargetCount] = useState<number | null>(null);
  const [keyboardHints, setKeyboardHints] = useState<Record<string, GuessScore>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResultPopup, setShowResultPopup] = useState(false);
  const [hasVotedToEnd, setHasVotedToEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confettiSeed, setConfettiSeed] = useState(0);
  const [shockwaveSeed, setShockwaveSeed] = useState(0);
  const [debugResultVariant, setDebugResultVariant] = useState<DebugResultVariant>(null);
  const [keyPulse, setKeyPulse] = useState<{ letter: string; id: number } | null>(null);
  const [tilePulse, setTilePulse] = useState<{ index: number; id: number } | null>(null);
  const [recentRevealMeta, setRecentRevealMeta] = useState<{
    rowIndex: number;
    timestamp: number;
    evaluations: GuessScore[];
  } | null>(null);
  const [keyboardFeedback, setKeyboardFeedback] = useState<{
    id: number;
    entries: Array<{ letter: string; evaluation: GuessScore; delay: number }>;
    duration: number;
  } | null>(null);
  const [chatComposerFocused, setChatComposerFocused] = useState(false);
  const [revealedTiles, setRevealedTiles] = useState<Record<string, boolean>>({});
  const [isLocalhost, setIsLocalhost] = useState(false);
  const [disconnectCountdown, setDisconnectCountdown] = useState<number | null>(null);
  const [missingPlayerNames, setMissingPlayerNames] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [lockedIndices, setLockedIndices] = useState<Set<number>>(new Set());
  const autoLossTriggeredRef = useRef(false);
  const previousGuessCountRef = useRef(0);
  const initialLoadRef = useRef(true);
  const rejoinHandleRef = useRef(false);
  const hardStopHandleRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);
  const disconnectDrawHandledRef = useRef(false);
  const disconnectDeadlineRef = useRef<number | null>(null);
  /* Optimization Refs */
  const currentGuessRef = useRef(currentGuess);
  const gameRef = useRef(game);
  const lockedIndicesRef = useRef(lockedIndices);
  const selectedIndexRef = useRef(selectedIndex);
  const isMyTurnRef = useRef(isMyTurn);
  const isPlayerRef = useRef(isPlayer);
  const isSubmittingRef = useRef(isSubmitting);
  const userIdRef = useRef(userId);
  const broadcastTypingRef = useRef(broadcastTyping);
  const lastAddRef = useRef(0);

  useEffect(() => { currentGuessRef.current = currentGuess; }, [currentGuess]);
  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { lockedIndicesRef.current = lockedIndices; }, [lockedIndices]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);
  useEffect(() => { isMyTurnRef.current = isMyTurn; }, [isMyTurn]);
  useEffect(() => { isPlayerRef.current = isPlayer; }, [isPlayer]);
  useEffect(() => { isSubmittingRef.current = isSubmitting; }, [isSubmitting]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { broadcastTypingRef.current = broadcastTyping; }, [broadcastTyping]);

  const disconnectCountdownIntervalRef = useRef<number | null>(null);

  const clearDisconnectCountdown = useCallback(() => {
    if (disconnectCountdownIntervalRef.current && typeof window !== 'undefined') {
      window.clearInterval(disconnectCountdownIntervalRef.current);
    }
    disconnectCountdownIntervalRef.current = null;
    disconnectDeadlineRef.current = null;
    setDisconnectCountdown(null);
  }, []);

  const updateDisconnectCountdown = useCallback(() => {
    const deadline = disconnectDeadlineRef.current;
    if (!deadline) {
      setDisconnectCountdown(null);
      return;
    }
    const diff = Math.max(0, deadline - Date.now());
    setDisconnectCountdown(Math.max(0, Math.ceil(diff / 1000)));
  }, []);

  const startDisconnectCountdown = useCallback(() => {
    disconnectDeadlineRef.current = Date.now() + DISCONNECT_DRAW_MS;
    updateDisconnectCountdown();
    if (typeof window !== 'undefined') {
      if (disconnectCountdownIntervalRef.current) {
        window.clearInterval(disconnectCountdownIntervalRef.current);
      }
      disconnectCountdownIntervalRef.current = window.setInterval(() => {
        updateDisconnectCountdown();
      }, 1000);
    }
  }, [updateDisconnectCountdown]);

  const clearDisconnectTimer = useCallback(() => {
    if (disconnectTimerRef.current && typeof window !== 'undefined') {
      window.clearTimeout(disconnectTimerRef.current);
    }
    disconnectTimerRef.current = null;
    clearDisconnectCountdown();
  }, [clearDisconnectCountdown]);

  const gameId = params?.gameId ? String(params.gameId) : '';
  const { activePlayers: realtimePlayers, loading: presenceLoading } = useGamePresence(gameId);
  const { broadcastTyping, clearTyping, peerTyping } = useGameTyping(gameId);
  const guest = profile ? isGuestProfile(profile) : false;
  const chatAvailability: ChatAvailability = user && !guest ? 'persistent' : 'guest-blocked';
  const isPlayer = Boolean(userId && game?.players?.includes(userId));
  const isSpectator = Boolean(userId && game && !isPlayer);
  const lobbyLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lobby/${gameId}`;
  }, [gameId]);
  const displayedGameId = useMemo(() => abbreviateId(gameId ?? ''), [gameId]);
  const compactGameId = useMemo(() => {
    if (!gameId) return '';
    if (gameId.length <= 4) return gameId;
    return `${gameId.slice(0, 4)}…`;
  }, [gameId]);
  const turnOrder = game?.turnOrder?.length ? game.turnOrder : game?.players ?? [];
  const isMultiplayerGame = game?.gameType === 'multiplayer' && turnOrder.length > 0;
  const activeTurnPlayerId = isMultiplayerGame ? game?.currentTurnPlayerId ?? null : null;
  const hasLockedTurn = Boolean(isMultiplayerGame && activeTurnPlayerId);
  const isMyTurn = !isMultiplayerGame || !hasLockedTurn || activeTurnPlayerId === userId;
  const isMultiRoundPvP = Boolean(isMultiplayerGame && game?.multiplayerMode === 'pvp' && (game?.matchState?.maxWins ?? 1) > 1);
  const canInteract = Boolean(isPlayer && game?.status === 'in_progress' && isMyTurn);
  const isCoopMode = game?.multiplayerMode === 'co-op';
  const spectatorIds = useMemo(() => {
    if (!game) return [];
    const active = Array.from(new Set(game.activePlayers ?? []));
    return active.filter((id) => !game.players.includes(id));
  }, [game]);
  const trackedPlayerIds = useMemo(() => {
    if (!game) return [];
    const ids = new Set<string>();
    (game.players ?? []).forEach((id) => id && ids.add(id));
    (game.activePlayers ?? []).forEach((id) => id && ids.add(id));
    (game.turnOrder ?? []).forEach((id) => id && ids.add(id));
    spectatorIds.forEach((id) => id && ids.add(id));
    Object.keys(game.playerAliases ?? {}).forEach((id) => id && ids.add(id));
    if (game.currentTurnPlayerId) ids.add(game.currentTurnPlayerId);
    if (game.winnerId) ids.add(game.winnerId);
    if (game.endedBy) ids.add(game.endedBy);
    return Array.from(ids);
  }, [game, spectatorIds]);
  const { getPlayerName } = usePlayerNames({ db, playerIds: trackedPlayerIds });
  const playerAliases = useMemo(() => game?.playerAliases, [JSON.stringify(game?.playerAliases)]);

  const resolvePlayerAlias = useCallback(
    (playerId?: string | null) => {
      if (!playerId) return undefined;
      const fromGame = playerAliases?.[playerId]?.trim();
      if (fromGame) return fromGame;
      const resolved = getPlayerName(playerId)?.trim();
      return resolved && resolved.length ? resolved : undefined;
    },
    [playerAliases, getPlayerName]
  );
  const formatPlayerLabel = useCallback(
    (playerId?: string | null, fallbackPrefix = 'Player') => {
      if (!playerId) return '—';
      if (playerId === userId) return profile?.username ?? 'You';
      const alias = resolvePlayerAlias(playerId);
      if (alias) return alias;
      return fallbackPrefix;
    },
    [profile?.username, resolvePlayerAlias, userId]
  );
  const otherPlayerIds = useMemo(
    () => (game?.players ?? []).filter((playerId): playerId is string => Boolean(playerId) && playerId !== userId),
    [game?.players, userId]
  );
  const otherPlayerNames = otherPlayerIds.map((playerId) => formatPlayerLabel(playerId, isCoopMode ? 'Teammate' : 'Opponent'));
  const rivalGroupLabel = !isCoopMode ? describeNameGroup(otherPlayerNames, 'rivals') : null;
  const teammateGroupLabel = isCoopMode ? describeNameGroup(otherPlayerNames, 'teammates') : null;
  const rivalWinnerLabel =
    !isCoopMode && game?.winnerId && game.winnerId !== userId ? formatPlayerLabel(game.winnerId, 'Opponent') : null;
  const teammateWinnerLabel =
    isCoopMode && game?.winnerId && game.winnerId !== userId ? formatPlayerLabel(game.winnerId, 'Teammate') : null;
  const turnStatusCopy = (() => {
    if (!isMultiplayerGame) return null;
    if (!hasLockedTurn) {
      const neededPlayers = (game?.players?.length ?? 0) < 2;
      return neededPlayers ? 'Waiting for another player…' : 'Choosing who starts…';
    }
    return activeTurnPlayerId === userId ? `It's your turn!` : `It's not your turn.`;
  })();
  const chatParticipantCount = (game?.players ?? []).filter(Boolean).length;
  const shouldShowChatDock = Boolean(game && chatParticipantCount >= 2);
  const chatDockContext = useMemo<ChatContextDescriptor>(() => ({
    scope: 'game',
    gameId,
    gameName: resolvePlayerAlias(game?.creatorId ?? undefined) ?? `Match ${displayedGameId}`,
  }), [gameId, game?.creatorId, displayedGameId, resolvePlayerAlias]);
  const chatParticipants = (game?.players ?? [])
    .filter((playerId): playerId is string => Boolean(playerId))
    .slice(0, 2)
    .map((playerId) => ({
      id: playerId,
      displayName: formatPlayerLabel(playerId),
      photoURL: playerId === userId ? profile?.photoURL ?? null : null,
      isSelf: playerId === userId,
    }));

  useEffect(() => {
    if (!keyPulse) return undefined;
    const timeout = window.setTimeout(() => setKeyPulse(null), 220);
    return () => window.clearTimeout(timeout);
  }, [keyPulse]);

  useEffect(() => {
    if (!tilePulse) return undefined;
    const timeout = window.setTimeout(() => setTilePulse(null), 220);
    return () => window.clearTimeout(timeout);
  }, [tilePulse]);

  useEffect(() => {
    if (!keyboardFeedback) return undefined;
    const timeout = window.setTimeout(() => setKeyboardFeedback(null), keyboardFeedback.duration);
    return () => window.clearTimeout(timeout);
  }, [keyboardFeedback]);

  useEffect(() => {
    if (!recentRevealMeta) return undefined;
    const timeout = window.setTimeout(() => setRecentRevealMeta(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [recentRevealMeta]);

  useEffect(() => {
    if (!recentRevealMeta) return undefined;
    const timeouts = recentRevealMeta.evaluations.map((_, index) => {
      const tileKey = `${recentRevealMeta.rowIndex}-${index}`;
      const delay = index * 140 + 520;
      return window.setTimeout(() => {
        setRevealedTiles((prev) => {
          if (prev[tileKey]) return prev;
          return { ...prev, [tileKey]: true };
        });
      }, delay);
    });
    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [recentRevealMeta]);

  useEffect(() => {
    setRevealedTiles({});
  }, [gameId]);

  useEffect(() => {
    if (!db || !gameId || !userId || !profile?.username) return;
    if (!game?.players?.includes(userId)) return;
    if (game.playerAliases?.[userId] === profile.username) return;
    const gameRef = doc(db, 'games', gameId);
    void updateDoc(gameRef, { [`playerAliases.${userId}`]: profile.username });
  }, [db, game?.playerAliases, game?.players, gameId, profile?.username, userId]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setShowResultPopup(game?.status === 'completed');
  }, [game?.status]);

  useEffect(() => {
    if (!game) return;
    setCurrentGuess((prev) => prev.slice(0, game.wordLength));
  }, [game]);

  useEffect(() => {
    if (!game?.matchState?.roundBonus || !userId) {
      setLockedIndices(new Set());
      return;
    }
    if (game.matchState.roundBonus.beneficiaryId === userId) {
      const { revealedLetterIndex, revealedLetter } = game.matchState.roundBonus;
      setLockedIndices(prev => {
        if (prev.has(revealedLetterIndex)) return prev;
        const next = new Set(prev);
        next.add(revealedLetterIndex);
        return next;
      });
      // Also ensure current guess has the letter
      setCurrentGuess(prev => {
        const chars = prev.split('');
        // Fill up to index if needed
        while (chars.length <= revealedLetterIndex) chars.push(' ');
        if (chars[revealedLetterIndex] !== revealedLetter) {
          chars[revealedLetterIndex] = revealedLetter;
          return chars.join('').slice(0, game.wordLength);
        }
        return prev;
      });
    }
  }, [game?.matchState?.roundBonus, userId, game?.wordLength]);

  useEffect(() => {
    if (!isPlayer) return;
    if (!isMyTurn) {
      setCurrentGuess('');
    }
  }, [isMyTurn, isPlayer]);

  useEffect(() => {
    if (!db || !gameId) return;

    const gameRef = doc(db, 'games', gameId);
    const unsubscribe = onSnapshot(
      gameRef,
      (snapshot: DocumentSnapshot<DocumentData>) => {
        if (!snapshot.exists()) {
          toast({
            variant: 'destructive',
            title: 'Session missing',
            description: 'This match no longer exists.',
          });
          router.push('/');
          return;
        }

        const data = snapshot.data() as GameDocument;
        setGame({ ...data, id: snapshot.id });
        setKeyboardHints(getKeyboardHints((data.guesses ?? []) as GuessResult[]));
        setHasVotedToEnd(Boolean(userId && data.endVotes?.includes(userId!)));
        setLoading(false);

        const guessCount = Array.isArray(data.guesses) ? data.guesses.length : 0;
        if (!initialLoadRef.current && guessCount > previousGuessCountRef.current) {
          const lastGuess = (data.guesses ?? [])[guessCount - 1] as GuessResult | undefined;
          if (lastGuess) {
            setRecentRevealMeta({
              rowIndex: guessCount - 1,
              timestamp: Date.now(),
              evaluations: lastGuess.evaluations as GuessScore[],
            });

            const scoreRank: Record<GuessScore, number> = { absent: 0, present: 1, correct: 2 };
            const entryMap = new Map<string, { letter: string; evaluation: GuessScore; delay: number }>();
            lastGuess.word.split('').forEach((char, index) => {
              const evaluation = lastGuess.evaluations[index] as GuessScore;
              if (evaluation === 'absent') return;
              const letter = char.toLowerCase();
              const existing = entryMap.get(letter);
              if (!existing || scoreRank[evaluation] > scoreRank[existing.evaluation]) {
                entryMap.set(letter, { letter, evaluation, delay: index * 140 });
              }
            });
            const entries = Array.from(entryMap.values());
            if (entries.length) {
              setKeyboardFeedback({
                id: Date.now(),
                entries,
                duration: entries.reduce((max, entry) => Math.max(max, entry.delay), 0) + 1200,
              });
            }
          }
        }
        previousGuessCountRef.current = guessCount;
        initialLoadRef.current = false;

      },
      (error: unknown) => {
        console.error('Error loading game', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Could not load the game.',
        });
        router.push('/');
      }
    );

    return () => unsubscribe();
  }, [db, gameId, router, toast, userId]);

  const registerGamePresence = useCallback(async () => {
    if (!db || !userId || !gameId || !isPlayer) return;
    const gameRef = doc(db, 'games', gameId);
    try {
      await runWithFirestoreRetry(() =>
        updateDoc(gameRef, {
          activePlayers: arrayUnion(userId),
          lobbyClosesAt: null,
          lastActivityAt: new Date().toISOString(),
        })
      );
    } catch (error) {
      console.error('Failed to register game presence', error);
    }
  }, [db, gameId, isPlayer, userId]);

  const unregisterGamePresence = useCallback(async () => {
    if (!db || !userId || !gameId || !isPlayer) return;
    const gameRef = doc(db, 'games', gameId);
    try {
      // We can't easily check if the list becomes empty atomically with arrayRemove without a transaction or cloud function.
      // However, for the "lobby closes" logic, we can just remove the player.
      // The "empty lobby" check is done in a separate useEffect anyway (checking activePlayers.length).
      // So we just remove the player here.

      // Wait, the original code set lobbyClosesAt if the list BECAME empty.
      // To do that atomically, we DO need a transaction or a precondition.
      // But maybe we can skip setting lobbyClosesAt here and let the periodic check handle it?
      // The periodic check `useEffect` handles "lobbyClosesAt" expiration, but doesn't SET it.

      // If we want to set lobbyClosesAt when the LAST player leaves, we need to know if we are the last player.
      // arrayRemove doesn't tell us that.

      // Let's stick to transaction for unregister ONLY if we need to set lobbyClosesAt.
      // But the contention usually happens on REGISTER (joining).
      // Unregister happens on leave.

      // Actually, the original code had a race condition anyway.
      // If we use arrayRemove, we avoid the "failed-precondition" on the array update.
      // We can do a two-step: remove, then check if empty? No, that's racy.

      // Let's just use arrayRemove for now to fix the errors. 
      // The "lobby closes" logic might need to be robust enough to handle this.
      // If we don't set lobbyClosesAt, the game won't auto-close when empty.
      // But maybe that's acceptable for now to fix the crash.

      // Alternatively, we can use a transaction but ONLY read activePlayers.
      // But the previous transaction failed because the doc changed.

      // Let's use arrayRemove. It's safer.
      // We can try to set lobbyClosesAt if we think we are the last one (optimistically), 
      // but activePlayers is the source of truth.

      // For now, let's just remove the player.

      await runWithFirestoreRetry(() =>
        updateDoc(gameRef, {
          activePlayers: arrayRemove(userId)
        })
      );

      // We could check activePlayers after removal?
      // But we've already returned.

    } catch (error) {
      console.error('Failed to unregister game presence', error);
    }
  }, [db, gameId, isPlayer, userId]);

  useEffect(() => {
    if (!db || !userId || !gameId || !isPlayer) return;

    void registerGamePresence();

    const handleBeforeUnload = () => {
      void unregisterGamePresence();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      void unregisterGamePresence();
    };
  }, [db, gameId, isPlayer, registerGamePresence, unregisterGamePresence, userId]);

  useEffect(() => {
    if (!isPlayer || !userId) return;
    const activeList = game?.activePlayers ?? [];
    if (!Array.isArray(activeList)) return;
    if (activeList.includes(userId)) return;
    void registerGamePresence();
  }, [game?.activePlayers, isPlayer, registerGamePresence, userId]);

  useEffect(() => {
    if (!db || !game || !gameId || game.status !== 'in_progress' || game.matchHardStopAt) return;
    const gameRef = doc(db, 'games', gameId);
    void runWithFirestoreRetry(() =>
      runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(gameRef);
        if (!snapshot.exists()) return;
        const data = snapshot.data() as GameDocument;
        if (data.matchHardStopAt) return;
        const nowIso = new Date().toISOString();
        transaction.update(gameRef, {
          matchHardStopAt: addMinutesIso(nowIso, MATCH_HARD_STOP_MINUTES),
        });
      })
    ).catch((error) => console.error('Failed to seed match hard stop', error));
  }, [db, game, gameId]);

  useEffect(() => {
    if (!db || !game?.matchHardStopAt || game.status !== 'in_progress') {
      hardStopHandleRef.current = false;
      return;
    }
    if (hardStopHandleRef.current) return;
    const deadline = new Date(game.matchHardStopAt).getTime();
    if (Number.isNaN(deadline)) return;
    if (deadline <= now) {
      hardStopHandleRef.current = true;
      const finalize = async () => {
        try {
          await updateDoc(doc(db, 'games', gameId), {
            status: 'completed',
            completedAt: new Date().toISOString(),
            completionMessage: 'Match ended after 30 minutes.',
            turnDeadline: null,
            matchDeadline: null,
          });
          toast({ variant: 'destructive', title: 'Match ended', description: 'Time limit reached.' });
        } catch (error) {
          console.error('Failed to enforce hard stop', error);
        } finally {
          router.push('/');
        }
      };
      void finalize();
    }
  }, [db, game?.matchHardStopAt, game?.status, gameId, now, router, toast]);

  useEffect(() => {
    if (!db || !game?.lobbyClosesAt || game.status !== 'in_progress') {
      rejoinHandleRef.current = false;
      return;
    }
    if (rejoinHandleRef.current) return;
    const deadline = new Date(game.lobbyClosesAt).getTime();
    if (Number.isNaN(deadline)) return;
    if (deadline <= now) {
      rejoinHandleRef.current = true;
      const handleTimeout = async () => {
        try {
          await updateDoc(doc(db, 'games', gameId), {
            status: 'completed',
            completedAt: new Date().toISOString(),
            completionMessage: 'Match closed after everyone left.',
            lobbyClosesAt: null,
          });
          toast({ variant: 'destructive', title: 'Match closed', description: 'Nobody rejoined within 2 minutes.' });
        } catch (error) {
          console.error('Failed to close empty match', error);
        } finally {
          router.push('/');
        }
      };
      void handleTimeout();
    }
  }, [db, game?.lobbyClosesAt, game?.status, gameId, now, router, toast]);

  useEffect(() => {
    if (!db || !game || !isMultiplayerGame || game.status !== 'in_progress' || presenceLoading) {
      clearDisconnectTimer();
      setMissingPlayerNames((prev) => (prev.length ? [] : prev));
      disconnectDrawHandledRef.current = false;
      return;
    }

    const allPlayers = (game.players ?? []).filter((id): id is string => Boolean(id));
    // Use RTDB presence for accurate disconnect detection
    const activeSet = new Set(realtimePlayers.filter(p => p.online).map(p => p.userId));
    const activeCount = activeSet.size;

    // Only consider it a disconnect if we have at least one player connected (us)
    // and fewer connected players than total players
    const hasMissingPlayer = allPlayers.length >= 2 && activeCount > 0 && activeCount < allPlayers.length;

    if (!hasMissingPlayer) {
      clearDisconnectTimer();
      setMissingPlayerNames((prev) => (prev.length ? [] : prev));
      disconnectDrawHandledRef.current = false;
      return;
    }

    const missingIds = allPlayers.filter((playerId) => !activeSet.has(playerId));
    const nextMissingNames = missingIds.map((playerId) => formatPlayerLabel(playerId, 'Player'));
    setMissingPlayerNames((prev) => {
      if (prev.length === nextMissingNames.length && prev.every((name, index) => name === nextMissingNames[index])) {
        return prev;
      }
      return nextMissingNames;
    });

    if (disconnectDrawHandledRef.current || disconnectTimerRef.current || typeof window === 'undefined') {
      return;
    }

    startDisconnectCountdown();
    disconnectTimerRef.current = window.setTimeout(() => {
      disconnectTimerRef.current = null;
      disconnectDrawHandledRef.current = true;
      clearDisconnectCountdown();
      const finalizeDisconnectDraw = async () => {
        try {
          await updateDoc(doc(db, 'games', gameId), {
            status: 'completed',
            completedAt: new Date().toISOString(),
            winnerId: null,
            completionMessage: 'Draw! Match ended after a player disconnected for too long.',
            turnDeadline: null,
            matchDeadline: null,
            lobbyClosesAt: null,
            inactivityClosesAt: null,
            matchHardStopAt: null,
            endedBy: 'system_disconnect',
          });
          toast({ title: 'Match ended in a draw', description: 'A player disconnected for over a minute.' });
        } catch (error) {
          console.error('Failed to finish disconnect draw', error);
          disconnectDrawHandledRef.current = false;
        } finally {
          router.push('/');
        }
      };
      void finalizeDisconnectDraw();
    }, DISCONNECT_DRAW_MS);

    return () => {
      clearDisconnectTimer();
    };
  }, [
    clearDisconnectCountdown,
    clearDisconnectTimer,
    db,
    formatPlayerLabel,
    game,
    gameId,
    isMultiplayerGame,
    router,
    startDisconnectCountdown,
    toast,
  ]);

  /* Word Logic & Submission */
  const validateWord = useCallback(
    async (word: string) => {
      try {
        const url = new URL('/api/words/validate', window.location.origin);
        url.searchParams.set('word', word);
        url.searchParams.set('length', String(game?.wordLength ?? 5));
        const response = await fetch(url.toString());
        if (!response.ok) return false;
        const data = await response.json();
        return Boolean(data.valid);
      } catch (error) {
        console.error('Word validation failed', error);
        return false;
      }
    },
    [game?.wordLength]
  );

  const buildLossMessage = useCallback(
    (reason: string) => {
      if (!game) return reason;
      if (game.gameType === 'solo') {
        return `${reason} ${getRandomSoloLossMessage()}`.trim();
      }
      return reason;
    },
    [game]
  );

  const handleSubmit = useCallback(async () => {
    // We use refs for internal logic but invalidation for `isSubmitting` is handled by `useCallback` dependency if we want?
    // Actually, `isSubmitting` changes rarely (start/end).
    // `currentGuess` logic MUST use ref.
    if (!db || !gameRef.current || !gameId || !userIdRef.current || !isPlayerRef.current || isSubmittingRef.current) return;
    if (!isMyTurnRef.current && gameRef.current.gameType === 'multiplayer') {
      toast({ variant: 'destructive', title: 'Not your turn', description: 'Wait for your turn before playing.' });
      return;
    }
    const guess = currentGuessRef.current.trim().toLowerCase();
    const gameVal = gameRef.current;

    if (guess.includes(' ')) {
      toast({ variant: 'destructive', title: 'Incomplete word', description: 'Please fill all empty boxes.' });
      return;
    }

    if (guess.length !== gameVal.wordLength) {
      toast({ variant: 'destructive', title: 'Too short', description: 'Need more letters.' });
      return;
    }

    setIsSubmitting(true);
    const previousGuess = currentGuessRef.current; // Snapshot
    try {
      const isRealWord = await validateWord(guess);
      if (!isRealWord) {
        toast({ variant: 'destructive', title: 'Invalid word', description: 'Try a real word.' });
        return;
      }

      const nextGuessCount = (gameVal.guesses?.length ?? 0) + 1;
      setPendingGuess(previousGuess);
      setPendingGuessTargetCount(nextGuessCount);

      const evaluations = scoreGuess(guess, gameVal.solution);
      const guessEntry: GuessResult = {
        word: guess,
        evaluations,
        playerId: userIdRef.current!,
        submittedAt: new Date().toISOString(),
      };

      const isWin = evaluations.every((value) => value === 'correct');
      const attemptsUsed = (gameVal.guesses?.length ?? 0) + 1;
      const outOfAttempts = attemptsUsed >= gameVal.maxAttempts;
      const matchMinutes = matchMinutesFromSetting(gameVal.matchTime);
      const turnSeconds = turnSecondsFromSetting(gameVal.turnTime);
      const order = gameVal.turnOrder?.length ? gameVal.turnOrder : gameVal.players;
      const shouldRotateTurns = gameVal.gameType === 'multiplayer' && order.length > 1;
      const nextTurnPlayerId = shouldRotateTurns
        ? getNextTurnPlayerId(order, gameVal.currentTurnPlayerId ?? userIdRef.current)
        : gameVal.currentTurnPlayerId ?? null;

      const updatePayload: Record<string, unknown> = {
        guesses: arrayUnion(guessEntry),
        lastActivityAt: guessEntry.submittedAt,
        lobbyClosesAt: null,
        endVotes: [],
      };

      if (matchMinutes && !gameVal.roundDeadline) {
        updatePayload.roundDeadline = addMinutesIso(guessEntry.submittedAt, matchMinutes);
      }

      if (!gameVal.turnStartedAt) {
        updatePayload.turnStartedAt = guessEntry.submittedAt;
      }

      if (turnSeconds) {
        updatePayload.turnDeadline = addSecondsIso(guessEntry.submittedAt, turnSeconds);
      } else {
        updatePayload.turnDeadline = null;
      }

      if (isWin || outOfAttempts) {
        updatePayload.status = 'completed';
        updatePayload.completedAt = guessEntry.submittedAt;
        updatePayload.winnerId = isWin ? userIdRef.current : null;
        updatePayload.completionMessage = isWin
          ? gameVal.gameType === 'multiplayer'
            ? gameVal.multiplayerMode === 'co-op'
              ? 'Team win! You all found the word.'
              : 'Victory! You grabbed the word first.'
            : 'Word cracked! Celebrate the streak.'
          : buildLossMessage('No more guesses left.');
        updatePayload.turnDeadline = null;
        updatePayload.matchDeadline = null;
        updatePayload.currentTurnPlayerId = null;
      } else if (gameVal.gameType === 'multiplayer') {
        if (shouldRotateTurns && nextTurnPlayerId) {
          updatePayload.currentTurnPlayerId = nextTurnPlayerId;
          updatePayload.turnStartedAt = new Date().toISOString();
        } else if (!gameVal.currentTurnPlayerId && order.length) {
          updatePayload.currentTurnPlayerId = order[0];
        }
        if (!gameVal.turnOrder?.length) {
          updatePayload.turnOrder = order;
        }
      }

      const gameDocRef = doc(db, 'games', gameId);
      await updateDoc(gameDocRef, updatePayload);
      setLockedIndices(new Set());
      setSelectedIndex(null);
      if (gameVal.multiplayerMode === 'co-op') {
        clearTyping();
      }
      if (isWin) {
        toast({
          title: gameVal.multiplayerMode === 'co-op' ? 'Team victory!' : 'Victory!',
          description: gameVal.multiplayerMode === 'co-op' ? 'Your team found the word.' : 'You guessed the word.',
        });
      } else if (outOfAttempts) {
        toast({ title: 'Out of tries', description: `Answer: ${gameVal.solution.toUpperCase()}` });
      }

      if (gameVal.gameType === 'multiplayer' && gameVal.multiplayerMode === 'pvp' && gameVal.matchState && (isWin || outOfAttempts)) {
        const currentRound = gameVal.matchState.currentRound;
        const roundsSetting = gameVal.roundsSetting ?? 1;
        const maxWins = gameVal.matchState.maxWins;

        const myCurrentWins = gameVal.matchState.scores[userIdRef.current!] || 0;
        const projectedWins = isWin ? myCurrentWins + 1 : myCurrentWins;

        const isScoreWin = projectedWins >= maxWins;
        const isLastRound = currentRound >= roundsSetting;

        if (isScoreWin || isLastRound) {
          // Wait for background action
          void advanceGameRound(gameId, isWin ? userIdRef.current! : null, currentRound).catch(err => console.error('Background advance failed', err));
        }
      }
    } catch (error) {
      console.error('Failed to submit guess', error);
      setPendingGuess(null);
      setPendingGuessTargetCount(null);
      setCurrentGuess(previousGuess);
      toast({ variant: 'destructive', title: 'Guess failed', description: 'Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    buildLossMessage,
    // currentGuess, // Removed as ref used
    db,
    // game, // Removed as ref used
    gameId,
    // isCoopMode, // Removed (access via gameRef)
    // isMyTurn, // Removed
    // isPlayer, // Removed
    // isSubmitting, // Removed (ref used, but effect syncs it)
    toast,
    // userId, // Removed
    validateWord,
    clearTyping,
  ]);

  const addLetter = useCallback(
    (letter: string) => {
      // Use refs to avoid re-creation on every keystroke
      if (!gameRef.current || !isPlayerRef.current || !isMyTurnRef.current || gameRef.current.status !== 'in_progress') return;

      // Thrive throttle to prevent double-tap issues on some mobile devices
      const now = Date.now();
      if (now - lastAddRef.current < 50) return;
      lastAddRef.current = now;

      const maxLength = gameRef.current.wordLength;
      const normalized = letter.toLowerCase();
      const isLocked = (idx: number) => lockedIndicesRef.current.has(idx);

      let nextGuess = currentGuessRef.current;
      let targetIndex = selectedIndexRef.current;

      // If no selection, find the first empty slot (space) from the left
      if (targetIndex === null) {
        const paddedToCheck = nextGuess.padEnd(maxLength, ' ');
        const firstSpace = paddedToCheck.indexOf(' ');
        if (firstSpace !== -1 && firstSpace < maxLength) {
          targetIndex = firstSpace;
        } else {
          if (nextGuess.length < maxLength) {
            targetIndex = nextGuess.length;
          } else {
            return; // Full
          }
        }
      }

      // If target is locked, skip right until unlocked
      while (targetIndex < maxLength && isLocked(targetIndex)) {
        targetIndex++;
      }

      if (targetIndex >= maxLength) return;

      if (nextGuess.length <= targetIndex) {
        nextGuess = nextGuess.padEnd(targetIndex + 1, ' ');
      }

      const chars = nextGuess.split('');
      chars[targetIndex] = normalized;

      const newGuess = chars.join('').slice(0, maxLength);

      const pulseId = Date.now();
      // We are inside a callback, so we can't use the hook directly if we want to change it?
      // Actually we can read useIsMobile() result if we passed it in OR we can just use a ref for it too?
      // Or just accept the prop dependency if it's stable. `isMobile` is from a hook.
      // Let's assume isMobile is stable enough or use a simple check.
      // Ideally we shouldn't trigger state updates for pulse on mobile to save performance as per original code.
      // Original: if (!isMobile) ...
      // We will access window width or just set it.
      // Let's just set it. The check will happen in render or we pass isMobile val.
      // We can use a ref for isMobile too if we really want to be pure.
      // For now, let's just dispatch.

      // NOTE: setting state inside this callback is fine.
      // We need to NOT depend on isMobile in dependency array if we want 100% stability,
      // but isMobile only changes on resize. It is stable.
      // But we need to ensure we don't close over stale isMobile?
      // Actually, standard window.matchMedia check is fine?

      // Let's just set the pulse. The component handles !isMobile for rendering the animation.
      setKeyPulse({ letter: normalized, id: pulseId });
      setTilePulse({ index: targetIndex, id: pulseId });

      setCurrentGuess(newGuess);

      if (gameRef.current.multiplayerMode === 'co-op') {
        const row = gameRef.current.guesses?.length ?? 0;
        broadcastTypingRef.current(newGuess, row);
      }

      // Auto-advance selection
      if (selectedIndexRef.current !== null) {
        let nextSem = targetIndex + 1;
        while (nextSem < maxLength && isLocked(nextSem)) {
          nextSem++;
        }
        if (nextSem < maxLength) {
          setSelectedIndex(nextSem);
        } else {
          setSelectedIndex(null);
        }
      }
    },
    []
  );

  const removeLetter = useCallback(() => {
    // Check local ref
    const canInteract = isPlayerRef.current && gameRef.current?.status === 'in_progress' && isMyTurnRef.current;
    if (!canInteract) return;

    const maxLength = gameRef.current?.wordLength ?? 5;
    const isLocked = (idx: number) => lockedIndicesRef.current.has(idx);
    let nextGuess = currentGuessRef.current;

    let targetIndex = selectedIndexRef.current;

    if (targetIndex !== null) {
      // Selection mode behavior
      const padded = nextGuess.padEnd(maxLength, ' ');
      const chars = padded.split('');
      chars[targetIndex] = ' ';
      const newVal = chars.join('').trimEnd();
      setCurrentGuess(newVal);

      if (gameRef.current?.multiplayerMode === 'co-op') {
        const row = gameRef.current.guesses?.length ?? 0;
        broadcastTypingRef.current(newVal, row);
      }

      // Move left
      let prev = targetIndex - 1;
      while (prev >= 0 && isLocked(prev)) {
        prev--;
      }

      if (prev >= 0) {
        setSelectedIndex(prev);
      }
    } else {
      // Normal mode behavior
      const padded = nextGuess.padEnd(maxLength, ' ');
      for (let i = maxLength - 1; i >= 0; i--) {
        if (padded[i] !== ' ' && !isLocked(i)) {
          const chars = padded.split('');
          chars[i] = ' ';
          const newVal = chars.join('').trimEnd();
          setCurrentGuess(newVal);

          if (gameRef.current?.multiplayerMode === 'co-op') {
            const row = gameRef.current.guesses?.length ?? 0;
            broadcastTypingRef.current(newVal, row);
          }
          break;
        }
      }
    }
  }, []);

  /* Hidden Input Logic (Dependent on above functions) */
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const focusHiddenInput = useCallback(() => {
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus({ preventScroll: true });
    }
  }, []);

  const handleHiddenInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (!val) return;
    const char = val.slice(-1);
    if (/^[a-zA-Z]$/.test(char)) {
      addLetter(char);
    }
    e.target.value = '';
  }, [addLetter]);

  const handleHiddenInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      removeLetter();
    } else if (e.key === 'Enter') {
      void handleSubmit();
    }
  }, [removeLetter, handleSubmit]);

  /* Interaction Handlers */
  useEffect(() => {
    if (!db || !gameId) return;
    const unsub = onSnapshot(doc(db, 'games', gameId), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as GameDocument;
        setGame({ ...data, id: docSnap.id });
        setLoading(false);
      } else {
        setLoading(false);
      }
    });
    return () => unsub();
  }, [db, gameId]);

  /* Selection Logic */
  const handleTileClick = useCallback((index: number, isActiveRow: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLongPressRef.current) return; // Should be caught by TouchEnd preventDefault but double check
    if (!game || game.status !== 'in_progress' || !isPlayer || !isMyTurn || !isActiveRow) return;

    setSelectedIndex(index);
    focusHiddenInput();
  }, [game, isMyTurn, isPlayer, focusHiddenInput]);

  useEffect(() => {
    if (!game || game.status !== 'in_progress' || !isPlayer || !isMyTurn) return;

    const isTypingTarget = (event: KeyboardEvent) => {
      if (chatComposerFocused) return true;
      const target = event.target as HTMLElement | null;
      if (!target) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event)) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        void handleSubmit();
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        removeLetter();
        return;
      }

      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        addLetter(event.key);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addLetter, chatComposerFocused, game, handleSubmit, isMyTurn, isPlayer, removeLetter]);

  /* Interaction Handlers - Touch / Click / Background */
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isLongPressRef = useRef(false);

  // Background click to deselect
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (e.defaultPrevented) return;
    setSelectedIndex(null);
  }, []);

  const handleTileTouchStart = useCallback((index: number, isActiveRow: boolean) => {
    if (!isMyTurn || !isPlayer || game?.status !== 'in_progress' || !isActiveRow) return;
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setLockedIndices(prev => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
      if (navigator.vibrate) navigator.vibrate(50);
    }, 500); // 500ms long press
  }, [game?.status, isMyTurn, isPlayer]);

  const handleTileTouchEnd = useCallback((index: number, e: React.MouseEvent | React.TouchEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isLongPressRef.current) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
  }, []);

  const handleTileMouseDown = useCallback((index: number, isActive: boolean, e: React.MouseEvent) => {
    if (!isMyTurn || !isPlayer || game?.status !== 'in_progress' || !isActive) return;
    isLongPressRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      isLongPressRef.current = true;
      setLockedIndices(prev => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    }, 500); // 500ms long press
  }, [game?.status, isMyTurn, isPlayer]);

  const handleTileMouseUp = useCallback((index: number, e: React.MouseEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (isLongPressRef.current) {
      setTimeout(() => { isLongPressRef.current = false; }, 100);
    }
  }, []);

  const handleTileMouseLeave = useCallback((index: number, e: React.MouseEvent) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleCopyLobbyLink = useCallback(async () => {
    try {
      if (!lobbyLink) throw new Error('Link unavailable');
      await navigator.clipboard.writeText(lobbyLink);
      toast({ title: 'Link copied', description: 'Lobby URL copied to clipboard.' });
    } catch (error) {
      console.error('Failed to copy lobby link', error);
      toast({
        variant: 'destructive',
        title: 'Copy failed',
        description: 'Unable to copy the lobby URL.',
      });
    }
  }, [lobbyLink, toast]);



  const handleRematch = useCallback(async () => {
    if (!firebaseConfig || !userId || !game || !db) return;
    // Voting Logic for Rematch
    try {
      const gameRef = doc(db, 'games', game.id!); // assume gameId is in scope or game.id
      const currentVotes = game.rematchVotes ?? [];
      const totalPlayers = game.players.length;

      // If already voted, do nothing (wait)
      if (currentVotes.includes(userId)) return;

      if (game.gameType === 'solo' || totalPlayers < 2) {
        // Direct Create
      } else {
        // Add Vote
        await updateDoc(gameRef, {
          rematchVotes: arrayUnion(userId)
        });
        // If not last vote, return and wait
        if (currentVotes.length + 1 < totalPlayers) {
          toast({ title: 'Vote registered', description: 'Waiting for opponent...' });
          return;
        }
      }

      // If we are here, we are the last voter (or solo), so WE facilitate the creation
      const authToken = await user?.getIdToken?.();
      if (!authToken) throw new Error('Missing auth token');

      const newGameId = await createGame(
        {
          creatorId: userId,
          gameType: game.gameType,
          multiplayerMode: game.multiplayerMode,
          wordLength: game.wordLength,
          matchTime: game.matchTime,
          turnTime: game.turnTime ?? 'unlimited',
          roundsSetting: game.roundsSetting,
        },
        firebaseConfig,
        authToken
      );

      if (!newGameId) throw new Error('Failed to create rematch');

      // Update current game to point to new game (for everyone to redirect)
      if (game.gameType !== 'solo') {
        await updateDoc(gameRef, {
          rematchGameId: newGameId
        });
      } else {
        router.push(`/game/${newGameId}`);
      }

    } catch (error) {
      console.error('Failed to start rematch', error);
      toast({ variant: 'destructive', title: 'Rematch failed', description: 'Please try again.' });
    }
  }, [game, firebaseConfig, userId, db, user, toast, router]);

  const clearDebugResult = useCallback(() => {
    setDebugResultVariant(null);
    setShowResultPopup(Boolean(game?.status === 'completed'));
  }, [game?.status]);

  const triggerDebugResult = useCallback((variant: Exclude<DebugResultVariant, null>) => {
    setDebugResultVariant(variant);
    setShowResultPopup(true);
  }, []);

  const handleReplayClick = useCallback(() => {
    if (debugResultVariant) {
      clearDebugResult();
      return;
    }
    void handleRematch();
  }, [clearDebugResult, debugResultVariant, handleRematch]);

  const handleHomeNavigation = useCallback(() => {
    if (debugResultVariant) {
      clearDebugResult();
      return;
    }
    router.push('/');
  }, [clearDebugResult, debugResultVariant, router]);

  const liveGuess = pendingGuess ?? currentGuess;

  const boardRows = useMemo(() => {
    if (!game) return [];
    const rows = [];
    const submittedGuesses = game.guesses ?? [];

    for (let i = 0; i < game.maxAttempts; i += 1) {
      const existing = submittedGuesses[i];
      if (existing) {
        rows.push({
          letters: existing.word.split(''),
          evaluations: existing.evaluations,
          state: 'submitted',
        });
        continue;
      }

      if (
        i === submittedGuesses.length &&
        isPlayer &&
        game.status === 'in_progress' &&
        isMyTurn
      ) {
        const padded = liveGuess.padEnd(game.wordLength, ' ');
        rows.push({
          letters: padded.split(''),
          evaluations: new Array(game.wordLength).fill(null),
          state: 'active',
        });
      } else {
        rows.push({
          letters: new Array(game.wordLength).fill(' '),
          evaluations: new Array(game.wordLength).fill(null),
          state: 'empty',
        });
      }
    }

    return rows;
  }, [isMyTurn, liveGuess, game, isPlayer]);



  const activePeerTyping = useMemo(() => {
    if (!isCoopMode || isMyTurn || !game) return null;
    const activeRow = game.guesses?.length ?? 0;
    // Find a peer who is typing on this row
    // If multiple, just pick one (first entry)
    const entry = Object.values(peerTyping).find(p => p.rowIndex === activeRow && p.guess);
    return entry ? entry.guess : null;
  }, [isCoopMode, isMyTurn, game, peerTyping]);

  // Merge peer typing into board rows for display if it's not my turn
  const displayRows = useMemo(() => {
    // Start with base rows
    let rows = boardRows;

    // 1. Inject Peer Typing (if applicable)
    if (activePeerTyping) {
      rows = rows.map(row => {
        const isCurrentRow = boardRows.indexOf(row) === (game?.guesses?.length ?? 0);
        if (isCurrentRow && (row.state === 'active' || row.state === 'empty')) { // catch empty too if !isMyTurn
          const padded = activePeerTyping.padEnd(game?.wordLength ?? 5, ' ');
          return {
            ...row,
            letters: padded.split(''),
            state: 'active' as const,
            isPeerInput: true,
          };
        }
        return row;
      });
    }

    // 2. Inject Match Bonus (Green Letter)
    if (game?.matchState?.roundBonus?.beneficiaryId === userId && game.matchState.roundBonus.revealedLetter) {
      const { revealedLetterIndex, revealedLetter } = game.matchState.roundBonus;
      rows = rows.map(row => {
        const isCurrentRow = boardRows.indexOf(row) === (game?.guesses?.length ?? 0);
        // Only inject into the ACTIVE/CURRENT row (where user is typing)
        if (isCurrentRow) {
          const letters = [...row.letters];
          letters[revealedLetterIndex] = revealedLetter.toUpperCase();

          const evaluations = [...row.evaluations];
          evaluations[revealedLetterIndex] = 'correct'; // Show as Green

          return {
            ...row,
            letters,
            evaluations,
            // Ensure state is active so it renders potentially
            state: row.state === 'empty' ? 'active' : row.state,
          };
        }
        return row;
      });
    }
    return rows;
  }, [boardRows, activePeerTyping, game, userId]);

  const matchCountdown = formatCountdown(game?.matchDeadline ?? null, now);
  const turnCountdown = formatCountdown(game?.turnDeadline ?? null, now);
  const submittedGuessCount = game?.guesses?.length ?? 0;
  const isGameComplete = game?.status === 'completed';
  const coopTeamWin = Boolean(isGameComplete && isCoopMode && game?.winnerId);
  const actualDidWin = Boolean(
    isGameComplete && (game?.winnerId === userId || (coopTeamWin && isPlayer))
  );
  const actualDidLose = Boolean(isGameComplete && !actualDidWin);
  const solutionWord = (game?.solution ?? 'DEBUG').toUpperCase();
  const baseResultHeading = (() => {
    if (!game) return 'Match complete';

    // PvP Best-of-3 Logic
    if (game.matchState && !isCoopMode && game.gameType !== 'solo') {
      const isMatchEnd = game.matchState.isMatchOver;
      const isMe = game.winnerId === userId;
      // Identify if this is potentially the final round
      // 1. Single round game
      const isSingleRound = (game.roundsSetting ?? 1) === 1;
      // 2. Max wins reached? (Handled by isMatchOver usually, but simplistic check:)
      const currentScore = (game.matchState.scores[game.winnerId ?? ''] ?? 0) + 1;
      const isScoreWin = typeof game.winnerId === 'string' && currentScore >= game.matchState.maxWins;
      // 3. Round limit reached?
      const roundsSetting = game.roundsSetting ?? 1;
      const isLastRound = game.matchState.currentRound >= roundsSetting;

      const isFinalRound = isSingleRound || isScoreWin || isLastRound;

      const winnerName = isMe ? 'You' : formatPlayerLabel(game.winnerId, 'Opponent');

      if (isMatchEnd || (isFinalRound && game.winnerId)) {
        // Recalculate isMe for the single-round case if needed (usually same as round winner)
        const effectiveWinnerId = game.matchState.matchWinnerId ?? game.winnerId;
        const effectiveIsMe = effectiveWinnerId === userId;

        if (isMatchEnd && !effectiveWinnerId) {
          return 'MATCH DRAW!';
        }

        return effectiveIsMe ? 'MATCH VICTORY!' : 'MATCH DEFEAT';
      } else {
        // Round Over
        if (game.winnerId) {
          return `Round ${game.matchState.currentRound} Winner: ${winnerName}`;
        }
        return 'Round Draw';
      }
    }


    if (isCoopMode && game.winnerId) {
      if (game.winnerId === userId) {
        return teammateGroupLabel ? `Victory with ${teammateGroupLabel}` : 'You cracked it!';
      }
      return `${teammateWinnerLabel ?? 'Your teammate'} cracked it!`;
    }
    if (game.gameType === 'solo' && isPlayer && game.winnerId !== userId) {
      return 'You lost';
    }
    if (game.winnerId) {
      return game.winnerId === userId
        ? rivalGroupLabel
          ? `You beat ${rivalGroupLabel}`
          : 'You cracked it!'
        : `${formatPlayerLabel(game.winnerId, 'Opponent')} guessed the word`;
    }
    return 'No winner this round';
  })();
  const debugOverrides = useMemo(() => {
    if (!debugResultVariant) return null;
    switch (debugResultVariant) {
      case 'playerWin':
        return {
          didWin: true,
          didLose: false,
          heading: 'You cracked it! (Debug)',
          message: 'Word cracked! Celebrate the streak.',
        } as const;
      case 'playerLoss':
        return {
          didWin: false,
          didLose: true,
          heading: 'You lost (Debug)',
          message: 'No more guesses left. Keep the momentum for next run.',
        } as const;
      case 'rivalWin':
        return {
          didWin: false,
          didLose: true,
          heading: 'Rival guessed the word (Debug)',
          message: 'Another player grabbed the solve while you watched.',
        } as const;
      case 'noWinner':
        return {
          didWin: false,
          didLose: false,
          heading: 'No winner this round (Debug)',
          message: 'Match timed out before anyone solved it.',
        } as const;
      default:
        return null;
    }
  }, [debugResultVariant]);
  const didWin = debugOverrides?.didWin ?? actualDidWin;
  const didLose = debugOverrides?.didLose ?? actualDidLose;
  const resultHeading = debugOverrides?.heading ?? baseResultHeading;
  const isMatchDraw = resultHeading === 'MATCH DRAW!';
  const [showBonusPopup, setShowBonusPopup] = useState(false);
  const [lastBonusRound, setLastBonusRound] = useState(-1);

  // Tiebreaker Announcement State
  const [showTiebreakerPopup, setShowTiebreakerPopup] = useState(false);
  const [tiebreakerShown, setTiebreakerShown] = useState(false);

  // Trigger Tiebreaker Popup
  useEffect(() => {
    if (!game || !game.matchState || !isMultiplayerGame || game.multiplayerMode !== 'pvp' || isSubmitting) return;

    const roundsSetting = game.roundsSetting ?? 1;
    // Condition: Final Round (e.g. Round 3 of 3, or Round 5 of 5)
    // Actually user said "start of 3rd round on 3 round games".
    // currentRound is 1-based. So if currentRound === roundsSetting.
    const isFinalRound = game.matchState.currentRound === roundsSetting;

    // We only show this for multi-round games (3 or 5 rounds)
    if (isFinalRound && roundsSetting > 1 && !tiebreakerShown && (game.guesses?.length ?? 0) === 0) {
      // Check for Tie
      const myId = userId ?? '';
      const otherId = game.players.find(p => p !== myId) ?? '';
      const myScore = game.matchState.scores[myId] || 0;
      const otherScore = game.matchState.scores[otherId] || 0;

      // User specific scores: 0-0, 1-1, 2-2
      if (myScore === otherScore) {
        setShowTiebreakerPopup(true);
        setTiebreakerShown(true);
      }
    }
  }, [game, isMultiplayerGame, userId, tiebreakerShown, isSubmitting]);

  // Close popup if game goes back to in_progress (e.g. new round started)
  // But keep it if we are just visualizing a "Finalizing..." state
  useEffect(() => {
    if (game?.status === 'in_progress' && showResultPopup) {
      setShowResultPopup(false);
    }
  }, [game?.status, showResultPopup]);

  useEffect(() => {
    // Check for round bonus at start of round
    const bonus = game?.matchState?.roundBonus;
    const currentRound = game?.matchState?.currentRound ?? 0;

    // Only show if we have a bonus, we haven't shown it for this round yet, and it's practically the start
    // (We use guesses length check or just ensure it triggers once per round via lastBonusRound)
    if (bonus && currentRound !== lastBonusRound && (game.guesses?.length ?? 0) === 0) {
      setShowBonusPopup(true);
      setLastBonusRound(currentRound);
    }
  }, [game?.matchState?.currentRound, game?.matchState?.roundBonus, game?.guesses?.length, lastBonusRound]);

  const defaultWinMessage = (() => {
    if (isCoopMode) {
      if (teammateGroupLabel) {
        return `You cracked it with ${teammateGroupLabel}.`;
      }
      return 'Word cracked! Celebrate the streak.';
    }
    if (game?.matchState && !game.matchState.isMatchOver) {
      return "Great job! Get ready for the next round.";
    }
    if (rivalGroupLabel) {
      return `You stayed ahead of ${rivalGroupLabel} and locked in the word.`;
    }
    return 'Word cracked! Celebrate the streak.';
  })();
  const defaultLossMessage = (() => {
    if (isCoopMode) {
      if (teammateWinnerLabel) {
        return `${teammateWinnerLabel} sealed the win for your team.`;
      }
      return 'Another squad solved it first.';
    }
    if (rivalWinnerLabel) {
      return `${rivalWinnerLabel} locked in the answer first.`;
    }
    return 'Another player solved it before you did.';
  })();
  const confettiPieces = useMemo<ConfettiPiece[]>(() => {
    if (!didWin && !isMatchDraw) return [];
    const seededRandom = (index: number, offset: number) => {
      const value = Math.sin(index * 991 + confettiSeed * 137 + offset * 29.7) * 10000;
      return value - Math.floor(value);
    };
    return Array.from({ length: 22 }, (_, index) => ({
      color: confettiPalette[index % confettiPalette.length],
      left: seededRandom(index, 1) * 100,
      delay: seededRandom(index, 2) * 0.8,
      duration: 2.2 + seededRandom(index, 3),
      rotation: seededRandom(index, 4) * 360,
    }));
  }, [didWin, isMatchDraw, confettiSeed]);

  const handleNextRound = useCallback(async () => {
    if (!gameId || isSubmitting || !db || !userId) return;
    setIsSubmitting(true);
    try {
      // Vote Logic
      const gameRef = doc(db, 'games', gameId);
      const currentVotes = game?.nextRoundVotes ?? [];
      const totalPlayers = game?.players?.length ?? 0;

      // If single player mode, just proceed
      if (game?.gameType === 'solo' || totalPlayers < 2) {
        const previousWinnerId = game?.winnerId || null;
        const currentRound = game?.matchState?.currentRound ?? 1;
        await advanceGameRound(gameId, previousWinnerId, currentRound);
        return;
      }

      // Check if I already voted
      if (!currentVotes.includes(userId)) {
        await updateDoc(gameRef, {
          nextRoundVotes: arrayUnion(userId)
        });

        // Optimistic check: if this vote completes the set?
        // Actually, let the realtime listener handle the "all voted" trigger?
        // Or trigger it here if (currentVotes.length + 1 >= totalPlayers)
        if (currentVotes.length + 1 >= totalPlayers) {
          const previousWinnerId = game?.winnerId || null;
          const currentRound = game?.matchState?.currentRound ?? 1;
          await advanceGameRound(gameId, previousWinnerId, currentRound);
        }
      }
    } catch (error) {
      console.error('Failed to vote next round:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to register vote.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [gameId, isSubmitting, db, userId, game?.nextRoundVotes, game?.players?.length, game?.gameType, game?.winnerId, toast]);

  // Auto-advance round when all players have voted
  useEffect(() => {
    if (!game || !gameId || !userId || game.status !== 'completed') return;

    // Only for multiplayer games
    if (game.gameType === 'solo') return;

    const totalPlayers = game.players.length;
    const votes = game.nextRoundVotes ?? [];

    // If everyone has voted
    if (votes.length >= totalPlayers && totalPlayers > 1) {
      // Deterministic trigger: The first player alphabetically (or by some stable sort) triggers the advance
      // This prevents race conditions where multiple clients try to call it simultaneously
      const sortedPlayers = [...game.players].sort();
      const responsiblePlayerId = sortedPlayers[0];

      if (userId === responsiblePlayerId) {
        // We are the responsible client
        const performAdvance = async () => {
          try {
            const previousWinnerId = game.winnerId || null;
            const currentRound = game.matchState?.currentRound ?? 1;
            await advanceGameRound(gameId, previousWinnerId, currentRound);
          } catch (err) {
            console.error("Failed to auto-advance round", err);
          }
        };
        void performAdvance();
      }
    }
  }, [game, gameId, userId]);

  // Auto-Redirect on Rematch
  useEffect(() => {
    if (game?.rematchGameId) {
      router.push(`/lobby/${game.rematchGameId}`);
    }
  }, [game?.rematchGameId, router]);

  // Auto-advance if it's the final round and we have a winner but match isn't over
  useEffect(() => {
    if (!game || !game.matchState || game.matchState.isMatchOver || isSubmitting) return;

    // Fix: Do not auto-advance if the game is still in progress and no one has won this round/game yet.
    if (game.status === 'in_progress' && !game.winnerId) return;

    if (!game.winnerId) {
      // If it's a draw, ensure we still check if it's the final round
    }

    const isSingleRound = (game.roundsSetting ?? 1) === 1;
    // Calculate projected score IF there is a winner
    const currentScore = game.winnerId
      ? (game.matchState.scores[game.winnerId] ?? 0) + 1
      : 0; // If draw, score doesn't increase

    const isScoreWin = game.winnerId && currentScore >= game.matchState.maxWins;
    const roundsSetting = game.roundsSetting ?? 1;
    const isLastRound = game.matchState.currentRound >= roundsSetting;

    if (isSingleRound || isScoreWin || isLastRound) {
      // It is the final round (or win), but isMatchOver is false.
      // Auto-trigger next round to finalize it.
      const timer = setTimeout(() => {
        void handleNextRound();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [game, handleNextRound, isSubmitting]);

  const headingFontFamily = didWin ? '"Soopafresh", "Moms", sans-serif' : '"Moms", "Soopafresh", sans-serif';
  const messageFontFamily = didWin ? '"Soopafresh", "Moms", sans-serif' : '"Moms", "Soopafresh", sans-serif';
  const replayButtonClasses = cn(
    'gap-3 rounded-2xl px-6 py-4 text-xs font-black tracking-[0.4em] uppercase transition-all duration-200 sm:text-sm',
    didWin
      ? '!bg-gradient-to-r !from-[hsl(var(--accent))] !to-[hsla(var(--accent)/0.85)] !text-[hsl(var(--accent-foreground))] shadow-[0_22px_55px_rgba(0,0,0,0.35)] hover:-translate-y-0.5'
      : '!bg-[hsla(var(--destructive)/0.95)] !text-[hsl(var(--destructive-foreground))] shadow-[0_22px_60px_rgba(0,0,0,0.6)] hover:-translate-y-0.5 dark:!text-white'
  );
  const homeButtonClasses = cn(
    'gap-3 rounded-2xl px-6 py-3 text-[0.55rem] font-semibold uppercase tracking-[0.45em] transition-all duration-200 sm:text-xs',
    didWin
      ? '!bg-[hsl(var(--primary))] !text-[hsl(var(--primary-foreground))] shadow-[0_16px_35px_rgba(0,0,0,0.25)] hover:-translate-y-0.5 dark:!bg-[#25262f] dark:!text-white'
      : '!border !border-white/40 !text-white hover:!bg-white/10 dark:!text-white'
  );
  const completionBodyText = debugOverrides?.message
    ?? (game?.completionMessage ?? (didWin ? defaultWinMessage : defaultLossMessage));
  const debugButtons: Array<{ label: string; variant: Exclude<DebugResultVariant, null> }> = [
    { label: 'Preview Win', variant: 'playerWin' },
    { label: 'Preview Loss', variant: 'playerLoss' },
    { label: 'Preview Rival Win', variant: 'rivalWin' },
    { label: 'Preview No Winner', variant: 'noWinner' },
  ];

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsLocalhost(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  }, []);

  useEffect(() => {
    if (!showResultPopup) return;
    if (didWin) {
      setConfettiSeed((seed) => seed + 1);
      return;
    }
    if (didLose) {
      setShockwaveSeed((seed) => seed + 1);
    }
    if (didLose) {
      setShockwaveSeed((seed) => seed + 1);
    }
  }, [didLose, didWin, showResultPopup]);

  // Auto-Open Bonus Popup (Round Completion)
  useEffect(() => {
    // If round bonus exists, it means a round just finished. Show popup.
    if (game?.matchState?.roundBonus) {
      setShowBonusPopup(true);
    }
  }, [game?.matchState?.roundBonus?.beneficiaryId]); // Trigger on ID change

  // Auto-Open Result Popup on Game Completion
  useEffect(() => {
    if (game?.status === 'completed' && !showResultPopup && !game.matchState?.isMatchOver) {
      // Wait, if it's just a round completion, do we show it?
      // Yes, "Round Winner" popup.
      // But if isMatchOver is false, it might just mean waiting for next round?
      // Current UI logic: 
      // If status=completed -> Game is effectively paused/over.
      // So yes, showing popup is correct.
      setShowResultPopup(true);
    } else if (game?.status === 'completed' && !showResultPopup) {
      setShowResultPopup(true);
    }
  }, [game?.status, showResultPopup, game?.matchState?.isMatchOver]);

  useEffect(() => {
    if (pendingGuessTargetCount === null) return;
    if (submittedGuessCount >= pendingGuessTargetCount) {
      setPendingGuess(null);
      setPendingGuessTargetCount(null);
      setCurrentGuess('');
    }
  }, [pendingGuessTargetCount, submittedGuessCount]);

  // End Match Logic State
  const [isEndMatchDialogOpen, setIsEndMatchDialogOpen] = useState(false);

  // Vote Cancel Notification State
  const [showVoteAnnouncementPopup, setShowVoteAnnouncementPopup] = useState(false);
  const previousVoteCountRef = useRef(0);

  useEffect(() => {
    if (!game?.endVotes) return;
    const currentVotes = game.endVotes;
    const count = currentVotes.length;
    const prevCount = previousVoteCountRef.current;

    if (count > prevCount && count > 0) {
      // Logic: A vote was added. Show popup if not already voting.
      if (!isEndMatchDialogOpen) {
        setShowVoteAnnouncementPopup(true);
      }
    }
    previousVoteCountRef.current = count;
  }, [game?.endVotes, isEndMatchDialogOpen]);

  // Handle "View Vote" action
  const handleOpenVoteDialogFromPopup = useCallback(() => {
    setShowVoteAnnouncementPopup(false);
    setIsEndMatchDialogOpen(true);
  }, []);

  // Auto-close dialogs if match ends
  useEffect(() => {
    if (game?.status === 'completed') {
      setIsEndMatchDialogOpen(false);
      setShowVoteAnnouncementPopup(false);
    }
  }, [game?.status]);

  const handleVoteCancel = useCallback(async () => {
    if (!gameId || !userId || !user) return;
    try {
      const authToken = await user.getIdToken();
      await toggleEndVote(gameId, authToken);
    } catch (error) {
      console.error("Failed to vote cancel:", error);
      toast({ variant: 'destructive', title: 'Action failed', description: 'Could not submit vote.' });
    }
  }, [gameId, userId, user, toast]);

  const handleSurrenderMatch = useCallback(async () => {
    if (!gameId || !userId || !user) return;
    try {
      const authToken = await user.getIdToken();
      await surrenderMatch(gameId, authToken);
      setIsEndMatchDialogOpen(false); // Close dialog
    } catch (error) {
      console.error("Failed to surrender:", error);
      toast({ variant: 'destructive', title: 'Action failed', description: 'Could not surrender.' });
    }
  }, [gameId, userId, user, toast]);

  // Solo End: Immediate Redirect
  // Solo End: Immediate Redirect (with Cleanup)
  const handleSoloEnd = useCallback(async () => {
    if (!gameId) {
      router.push('/');
      return;
    }

    // Attempt to close the game session in DB, but always redirect
    try {
      if (db && userId) {
        const gameRef = doc(db, 'games', gameId);
        await updateDoc(gameRef, {
          status: 'completed',
          completionMessage: getRandomSoloLossMessage(),
          completedAt: new Date().toISOString(),
          endedBy: userId,
          winnerId: null, // Ensure it registers as a loss
        });
      }
    } catch (error) {
      console.warn("Failed to update solo game status on exit", error);
    } finally {
      // router.push('/');
    }
  }, [router, db, gameId, userId]);

  const sharedEndButtonClasses = cn(
    'inline-flex h-11 items-center justify-center rounded-full border border-transparent text-sm font-semibold uppercase tracking-[0.2em] transition disabled:opacity-60',
    'w-12 gap-0 px-0 sm:w-auto sm:gap-2 sm:px-5',
    'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_25px_55px_rgba(255,140,0,0.35)] hover:shadow-[0_30px_65px_rgba(255,140,0,0.45)]',
    'dark:bg-[hsl(var(--primary))]'
  );

  const endButton = game?.gameType === 'solo'
    ? (
      <Button
        className={sharedEndButtonClasses}
        onClick={handleSoloEnd}
        disabled={!isPlayer || game?.status !== 'in_progress'}
        aria-label="End game"
      >
        <DoorOpen className="h-4 w-4" />
        <span className="hidden sm:inline">End game</span>
      </Button>
    )
    : (
      <>
        <Button
          className={sharedEndButtonClasses}
          onClick={() => setIsEndMatchDialogOpen(true)}
          disabled={!isPlayer || game?.status !== 'in_progress'}
          aria-label="End Match"
        >
          <DoorOpen className="h-4 w-4" />
          <span className="hidden sm:inline">End Match</span>
        </Button>

        <Dialog open={isEndMatchDialogOpen} onOpenChange={setIsEndMatchDialogOpen}>
          <DialogContent className="w-[90vw] max-w-sm rounded-[1.5rem] border border-white/10 bg-black/60 p-0 text-white shadow-2xl backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 sm:max-w-md">
            <div className="flex flex-col gap-6 p-6">
              <DialogHeader>
                <DialogTitle className="text-center font-black uppercase tracking-[0.2em] text-xl text-white/90 drop-shadow-md">
                  End Match
                </DialogTitle>
                <DialogDescription className="text-center text-xs font-medium uppercase tracking-widest text-white/50">
                  Select an option to conclude the game
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-3">
                {/* Surrender Option */}
                <div className="group relative overflow-hidden rounded-xl border border-white/5 bg-white/5 p-4 transition-all hover:border-[hsl(var(--destructive)/0.5)] hover:bg-[hsl(var(--destructive)/0.1)]">
                  <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--destructive)/0.1)] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="flex items-center gap-2 font-bold uppercase tracking-wider text-[hsl(var(--destructive))]">
                        <AlertTriangle className="h-4 w-4" />
                        Surrender
                      </h4>
                    </div>
                    <p className="mb-4 text-xs font-medium text-white/60">
                      Immediate forfeit. Opponent wins.
                    </p>
                    <Button
                      variant="destructive"
                      className="w-full rounded-lg font-bold uppercase tracking-widest shadow-lg transition-transform active:scale-95"
                      onClick={handleSurrenderMatch}
                    >
                      Surrender Match
                    </Button>
                  </div>
                </div>

                {/* Vote Cancel Option */}
                <div className="group relative overflow-hidden rounded-xl border border-white/5 bg-white/5 p-4 transition-all hover:border-[hsl(var(--primary)/0.5)] hover:bg-[hsl(var(--primary)/0.1)]">
                  <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--primary)/0.1)] to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="flex items-center gap-2 font-bold uppercase tracking-wider text-[hsl(var(--primary))]">
                        <Handshake className="h-4 w-4" />
                        Vote To Cancel
                      </h4>
                      <span className="flex items-center justify-center rounded-md border border-white/10 bg-black/40 px-2.5 py-1 text-[10px] font-bold text-white/80">
                        {game?.endVotes?.length ?? 0}/{game?.activePlayers?.length ?? 0}
                      </span>
                    </div>
                    <p className="mb-4 text-xs font-medium text-white/60">
                      Mutual agreement. Result is a Tie.
                    </p>
                    <Button
                      variant={hasVotedToEnd ? "secondary" : "default"}
                      className={cn(
                        "w-full rounded-lg font-bold uppercase tracking-widest shadow-lg transition-transform active:scale-95",
                        hasVotedToEnd ? "bg-white/10 text-white hover:bg-white/20" : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                      )}
                      onClick={handleVoteCancel}
                    >
                      {hasVotedToEnd ? "Retract Vote" : "Vote to Cancel"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );

  // --- HOSTED HOOKS (Moved before conditional returns) ---
  const handleSurrender = useCallback(async () => {
    if (!game || !userId) return;

    // In PvP, if I surrender, the other player wins immediately.
    // If >2 players, it's elimination? Assume 2-player PvP for now as per requirements.
    const opponentId = game.players.find(p => p !== userId);
    if (opponentId) {
      const currentRound = game.matchState?.currentRound ?? 1;
      await advanceGameRound(gameId, opponentId, currentRound);
    }
  }, [game, userId, gameId]);

  // 1. Round Timer
  const [roundTimeRemaining, setRoundTimeRemaining] = useState<string | null>(null);
  const roundTimerTriggeredRef = useRef(false);

  useEffect(() => {
    // Reset trigger if round changes
    if (game?.matchState?.currentRound) {
      // logic (empty ref reset if needed, but dependency array handles it mostly)
    }
  }, [game?.matchState?.currentRound]);

  useEffect(() => {
    // Paused State (Start of Round)
    if (!game?.roundDeadline && game?.status === 'in_progress') {
      const limit = game.roundTimeLimit || matchMinutesFromSetting(game.matchTime);
      if (limit) {
        setRoundTimeRemaining(`${limit}:00`);
      } else {
        setRoundTimeRemaining(null);
      }
      return;
    }

    if (!game?.roundDeadline || game.status !== 'in_progress') {
      setRoundTimeRemaining(null);
      roundTimerTriggeredRef.current = false;
      return;
    }
    const deadline = new Date(game.roundDeadline).getTime();

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = deadline - now;

      if (diff <= 1000 && !roundTimerTriggeredRef.current) {
        // Time is up (1s buffer)
        roundTimerTriggeredRef.current = true;
        setRoundTimeRemaining("00:00");
        clearInterval(interval);

        // Trigger Round Draw
        if (game.creatorId === userId) {
          const currentRound = game.matchState?.currentRound ?? 1;
          const prevWinnerId = game.matchState?.matchWinnerId ?? null;
          // Previous winner? No, surrender/timeout implies loss for current player? 
          // Just calling advanceGameRound without winner implies DRAW for this round?
          // User said "if somebody's turn time depletes... round completion popup".
          // If Round Timer depletes -> It's a DRAW or LOSS? Usually Draw if round time runs out.
          // But here we are in Round Timer logic.
          advanceGameRound(gameId, null, currentRound).catch(console.error);
        }
      } else if (diff > 0) {
        const m = Math.floor(diff / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setRoundTimeRemaining(`${m}:${s.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [game?.roundDeadline, game?.status, game?.creatorId, userId, gameId, game?.matchState?.currentRound, game?.roundTimeLimit, game?.matchTime]);

  // 2. Chess Timer
  const [chessTimers, setChessTimers] = useState<Record<string, string>>({});
  const chessTimerTriggeredRef = useRef(false);

  // Reset trigger on turn change
  useEffect(() => {
    chessTimerTriggeredRef.current = false;
  }, [game?.currentTurnPlayerId]);

  useEffect(() => {
    if (!game?.playerTimers || game.status !== 'in_progress') {
      setChessTimers({});
      return;
    }

    const interval = setInterval(() => {
      const nowMs = Date.now();
      const turnStartMs = game.turnStartedAt ? new Date(game.turnStartedAt).getTime() : nowMs;
      const elapsed = game.turnStartedAt ? (nowMs - turnStartMs) : 0; // ms since turn start

      const nextTimers: Record<string, string> = {};

      game.playerTimers && Object.keys(game.playerTimers).forEach(pid => {
        const bankSeconds = game.playerTimers![pid]; // Seconds
        if (typeof bankSeconds !== 'number') return;

        // If this is the active player, subtract elapsed
        let remainingSeconds = bankSeconds;
        if (game.currentTurnPlayerId === pid) {
          remainingSeconds -= (elapsed / 1000);
        }

        if (remainingSeconds <= 0) {
          nextTimers[pid] = "0:00";

          // Trigger Loss logic
          if (game.currentTurnPlayerId === pid && pid === userId && !chessTimerTriggeredRef.current) {
            chessTimerTriggeredRef.current = true;
            handleSurrender();
          }

        } else {
          const m = Math.floor(remainingSeconds / 60);
          const s = Math.floor(remainingSeconds % 60);
          nextTimers[pid] = `${m}:${s.toString().padStart(2, '0')}`;
        }
      });
      setChessTimers(nextTimers);

    }, 100); // 10hz updates for smoothness
    return () => clearInterval(interval);
  }, [game?.playerTimers, game?.turnStartedAt, game?.currentTurnPlayerId, game?.status, userId, handleSurrender]);

  const modeMeta = getModeMeta(game);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="h-16 w-16 animate-spin rounded-full border-4 border-border border-t-primary" />
          <p className="text-muted-foreground">Loading match…</p>
        </div>
      </div>
    );
  }

  if (!game) {
    return null;
  }

  const currentGuessPreview = liveGuess.padEnd(game.wordLength, ' ');


  // Update Pills Display
  // Color coding logic:
  // - Round Timer: Always visible.
  // - Turn Timer: 
  //   - If it's MY turn: Active/Bright.
  //   - If it's OPPONENT'S turn: Dimmed/Faint.

  // Actually the requirement is: "fainted when it counts for the other player and it is more visible... if it counts on the screen of the player it is targetted to"
  // Meaning: My Screen + My Turn = Bright. My Screen + Other Turn = Fainted.

  const timerPills: { label: string; value: string; icon?: any; dim?: boolean; intent?: 'neutral' | 'active' | 'danger' }[] = [];

  // Round Timer Pill
  if (roundTimeRemaining) {
    timerPills.push({ label: 'Round', value: roundTimeRemaining, icon: Hourglass, intent: 'neutral' });
  }

  // Turn Timer
  if (isMultiplayerGame && game?.currentTurnPlayerId) {
    const isMyTurnForTimer = game.currentTurnPlayerId === userId;
    const timerValue = chessTimers[game.currentTurnPlayerId] ?? '--:--';

    // Fallback if timer not ready yet (e.g. key missing) -> show initial limit?
    // But `chessTimers` updates fast.

    timerPills.push({
      label: 'Turn',
      value: timerValue,
      icon: Clock3,
      dim: !isMyTurnForTimer, // Dim if not my turn
      intent: isMyTurnForTimer ? 'active' : 'neutral'
    });
  }

  const timerIconLookup: Record<string, LucideIcon> = { Round: Hourglass, Turn: Clock3 };

  return (<>
    <div
      className="relative min-h-screen overflow-hidden bg-[hsl(var(--panel-neutral))] text-foreground dark:bg-background animate-theme"
      onClick={handleBackgroundClick}
    >
      <GraffitiBackground zIndex={0} />

      {/* Hidden input for mobile keyboard trigger */}
      {/* Fixed positioning keeps it in viewport to prevent scroll jumps */}
      <input
        ref={hiddenInputRef}
        type="text"
        className="fixed left-0 top-0 h-px w-px opacity-0 pointer-events-none"
        onChange={handleHiddenInputChange}
        onKeyDown={handleHiddenInputKeyDown}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck="false"
        aria-hidden="true"
        aria-label="Hidden keyboard input"
      />


      <div className="pointer-events-none absolute inset-0 z-[1]">
        <div
          className="absolute left-1/2 top-10 hidden h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-[150px] opacity-90 sm:block dark:opacity-100"
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.8) 0%, hsl(var(--hero-glow-soft) / 0.75) 40%, hsl(var(--hero-glow-strong) / 0.15) 78%)',
          }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-[hsl(var(--panel-neutral))] via-[hsl(var(--panel-neutral))/0.8] to-transparent opacity-70 dark:opacity-100 dark:from-background dark:via-background/70" />
      </div>
      <div className="relative z-10 mx-auto w-full max-w-5xl px-4 pt-12 pb-6 sm:pt-10">

        <div
          className="relative mx-auto w-full max-w-xl rounded-[32px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-neutral))] px-6 py-8 text-center shadow-[0_25px_65px_rgba(0,0,0,0.25)] backdrop-blur-xl dark:border-[hsla(var(--border)/0.7)] dark:bg-[hsl(var(--card))]"
        >
          <div className="absolute right-4 top-4">
            <ThemeToggle
              className="group h-14 w-14 rounded-full border border-[hsla(var(--panel-border)/0.8)] bg-white/70 p-1.5 text-[hsl(var(--primary))] shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur transition-all duration-300 hover:-translate-y-0.5 hover:border-[hsla(var(--primary)/0.65)] hover:bg-white/95 hover:shadow-[0_20px_55px_rgba(255,140,0,0.35)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--primary))]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--panel-neutral))] dark:border-white/10 dark:bg-white/5 dark:text-white dark:shadow-[0_8px_24px_rgba(0,0,0,0.45)] dark:hover:border-white/25 dark:hover:bg-white/10 dark:hover:shadow-[0_25px_55px_rgba(0,0,0,0.65)] dark:focus-visible:ring-white/50 before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:bg-[radial-gradient(circle_at_35%_35%,rgba(255,255,255,0.95),rgba(255,255,255,0))] before:opacity-0 before:blur-[18px] before:transition before:duration-300 before:content-[''] group-hover:before:scale-125 group-hover:before:opacity-95 dark:before:hidden after:pointer-events-none after:absolute after:inset-0 after:hidden after:rounded-full after:bg-[radial-gradient(circle_at_70%_70%,rgba(0,0,0,0.92),rgba(0,0,0,0))] after:opacity-0 after:blur-[22px] after:transition after:duration-300 after:content-[''] dark:after:block group-hover:after:scale-125 group-hover:after:opacity-100"
            />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="WordMates" className="mx-auto h-20 w-auto drop-shadow-xl" />
          <span
            className="pointer-events-none absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                'radial-gradient(circle at 15% 20%, rgba(255,255,255,0.18) 0%, transparent 35%), radial-gradient(circle at 65% 10%, rgba(0,0,0,0.18) 0%, transparent 40%), radial-gradient(circle at 10% 85%, rgba(0,0,0,0.12) 0%, transparent 32%)',
            }}
          />
          <div className="relative top-5 flex w-full min-w-0 flex-nowrap items-stretch gap-3 overflow-x-auto rounded-[40px] border border-[hsla(var(--panel-border)/0.7)] bg-gradient-to-r from-white via-[hsl(var(--panel-neutral))] to-[hsl(var(--panel-warm))] px-4 py-4 text-left shadow-[0_25px_65px_rgba(0,0,0,0.18)] [scrollbar-gutter:stable] sm:overflow-visible dark:border-white/10 dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12]">
            <div className="flex min-w-max flex-1 items-center gap-3 pr-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-[hsla(var(--primary)/0.45)] bg-white px-3 py-1.5 text-left text-foreground shadow-[0_18px_35px_rgba(255,140,0,0.15)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-[hsl(var(--card))] dark:text-[hsl(var(--primary-foreground))]">
                <span className="text-[0.6rem] font-semibold uppercase tracking-[0.3em] text-muted-foreground sm:text-[11px]">
                  Game ID
                </span>
                <span
                  className="inline-flex items-center rounded-full bg-[hsl(var(--primary))] px-2.5 py-1 font-mono text-[0.58rem] tracking-[0.25em] text-[hsl(var(--primary-foreground))] shadow-[0_10px_25px_rgba(255,140,0,0.35)] sm:px-3 sm:text-xs dark:bg-white/10 dark:text-[hsl(var(--primary))] dark:shadow-none"
                  title={displayedGameId}
                >
                  <span className="hidden truncate sm:inline">{displayedGameId}</span>
                  <span className="inline sm:hidden">{compactGameId}</span>
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopyLobbyLink}
                  className="h-8 w-8 rounded-full border border-[hsla(var(--primary)/0.4)] bg-[hsl(var(--panel-neutral))] text-[hsl(var(--primary))] hover:bg-[hsl(var(--panel-neutral)/0.9)] dark:border-[hsla(var(--primary)/0.35)] dark:bg-[hsl(var(--card))] dark:text-[hsl(var(--primary-foreground))]"
                  aria-label="Copy lobby link"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center justify-center whitespace-nowrap">
              {endButton}
            </div>
          </div>
          <div className="relative flex flex-wrap gap-2">

          </div>
        </div>

        <div className="mt-10 space-y-8">
          <div
            className={cn(
              'relative mx-auto max-w-lg rounded-[34px] border px-4 py-6 shadow-[0_35px_90px_rgba(0,0,0,0.25)] backdrop-blur-2xl sm:px-6',
              isLightMode
                ? 'pale-orange-shell text-[#2b1409]'
                : 'border-white/10 bg-gradient-to-br from-[#0f1119] via-[#0a0c14] to-[#05060a] text-white shadow-[0_35px_120px_rgba(0,0,0,0.65)]'
            )}
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-0 rounded-[34px]',
                isLightMode ? 'hidden' : 'bg-gradient-to-br from-white/35 via-transparent to-white/10 opacity-70 dark:from-white/10 dark:via-transparent dark:to-white/5'
              )}
            />
            <div className="relative space-y-0">
              <div className="mb-6">
                {isMultiRoundPvP ? (
                  // NEW LAYOUT
                  <div className="flex flex-col gap-4 w-full">
                    {/* Row 1: Turn Status (Centered) */}
                    {isMultiplayerGame && (
                      <div className="flex justify-center w-full">
                        <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--accent))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(var(--accent-foreground))] shadow-[0_12px_32px_rgba(16,185,129,0.32)] dark:border-[hsla(var(--accent)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                          <Clock3 className="h-4 w-4" />
                          <span>{turnStatusCopy ?? 'Waiting'}</span>
                        </span>
                      </div>
                    )}

                    {/* Row 2: Score + PvP Label (Centered) */}
                    <div className="flex justify-center w-full">
                      {modeMeta && (
                        <span className={cn(
                          "inline-flex items-center gap-2 rounded-full border border-transparent px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] shadow-[0_15px_35px_rgba(255,140,0,0.3)] dark:shadow-none transition-all",
                          "bg-white border-amber-500/50 text-amber-600 dark:bg-transparent dark:text-amber-400"
                        )}>
                          <modeMeta.icon className="h-4 w-4" />
                          <span>{modeMeta.label}</span>
                          <div className="mx-2 h-4 w-px bg-current opacity-20" />
                          <div className="flex items-center gap-2 font-black" style={{ fontFamily: headingFontFamily }}>
                            {(() => {
                              const myScore = userId ? (game.matchState!.scores[userId] || 0) : 0;
                              const otherId = Object.keys(game.matchState!.scores).find(id => id !== userId);
                              const otherScore = otherId ? (game.matchState!.scores[otherId] || 0) : 0;
                              return (
                                <>
                                  <span className={cn(myScore > otherScore ? 'text-green-500 dark:text-green-400' : '')}>
                                    {myScore}
                                  </span>
                                  <span className="opacity-50">-</span>
                                  <span className={cn(otherScore > myScore ? 'text-red-500 dark:text-red-400' : '')}>
                                    {otherScore}
                                  </span>
                                </>
                              );
                            })()}
                          </div>
                          <div className="mx-2 h-4 w-px bg-current opacity-20" />
                          <span>
                            ROUND {game.matchState!.currentRound}/{game.matchState!.maxWins * 2 - 1}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Row 3: Players | Timers */}
                    <div className="flex flex-wrap items-center justify-between w-full">
                      {/* Left: Players */}
                      <div className="flex justify-start">
                        <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--primary))] px-4 py-2 text-sm text-[hsl(var(--primary-foreground))] shadow-[0_12px_30px_rgba(255,140,0,0.28)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                          <Users className="h-4 w-4" />
                          <span className="font-mono text-base text-[hsl(var(--primary-foreground))] dark:text-foreground">{game.players.length}</span>
                        </span>
                      </div>

                      {/* Right: Timers */}
                      <div className="flex justify-end">
                        {timerPills.length > 0 && (
                          <div className="flex flex-wrap justify-end items-start gap-2">
                            {timerPills.map(({ label, value, intent, dim }) => (
                              <span
                                key={`board-timer-${label}`}
                                className={cn(
                                  "inline-flex items-center gap-2 rounded-full border border-transparent px-4 py-2 text-sm shadow-[0_12px_30px_rgba(255,140,0,0.28)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:shadow-none transition-all",
                                  intent === 'active'
                                    ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] dark:text-white dark:border-white/20"
                                    : "bg-white text-muted-foreground dark:text-muted-foreground",
                                  dim && "opacity-50 grayscale"
                                )}
                              >
                                {(() => {
                                  // Reuse Logic or simplified icon
                                  const TimerIcon = timerIconLookup[label as 'Round' | 'Turn'] ?? Clock3;
                                  return <TimerIcon className="h-4 w-4" />;
                                })()}
                                <span className={cn("font-mono text-base", intent === 'active' ? "text-[hsl(var(--primary-foreground))] dark:text-white" : "text-foreground dark:text-foreground")}>{value}</span>
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : isCoopMode ? (
                  // CO-OP LAYOUT (2-Row, Centered Top)
                  <div className="flex flex-col gap-4 w-full">
                    {/* Row 1: Turn Status (Centered) */}
                    <div className="flex justify-center w-full">
                      <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--accent))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(var(--accent-foreground))] shadow-[0_12px_32px_rgba(16,185,129,0.32)] dark:border-[hsla(var(--accent)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                        <Clock3 className="h-4 w-4" />
                        <span>{turnStatusCopy ?? 'Waiting'}</span>
                      </span>
                    </div>

                    {/* Row 2: GameMode | Players | Timer (Centered Row) */}
                    <div className="flex flex-wrap items-center justify-center gap-3 w-full">
                      {/* Game Mode Pill */}
                      {modeMeta && (
                        <span className={cn(
                          "inline-flex h-9 items-center gap-2 rounded-full border border-transparent px-4 text-xs font-semibold uppercase tracking-[0.25em] shadow-[0_15px_35px_rgba(255,140,0,0.3)] dark:shadow-none transition-all",
                          "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground"
                        )}>
                          <modeMeta.icon className="h-4 w-4" />
                          <span>{modeMeta.label}</span>
                        </span>
                      )}

                      {/* Player Count Pill */}
                      <span className="inline-flex h-9 items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--primary))] px-4 text-sm text-[hsl(var(--primary-foreground))] shadow-[0_12px_30px_rgba(255,140,0,0.28)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                        <Users className="h-4 w-4" />
                        <span className="font-mono text-base text-[hsl(var(--primary-foreground))] dark:text-foreground">{game.players.length}</span>
                      </span>

                      {/* Timer Pill (Only if value exists / not unlimited) */}
                      {timerPills.length > 0 && <div className="basis-full h-0 sm:hidden" />}
                      {timerPills.length > 0 && timerPills.map(({ label, value }) => (
                        // Co-op usually just has one shared timer (Round or Turn), or none if unlimited.
                        // Using generic map just to be safe if multiple timers exist.
                        <span
                          key={`coop-timer-${label}`}
                          className="inline-flex h-9 items-center gap-3 rounded-full border border-transparent bg-[hsl(var(--accent))] px-4 text-[hsl(var(--accent-foreground))] shadow-[0_12px_32px_rgba(16,185,129,0.32)] dark:border-[hsla(var(--accent)/0.5)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-foreground dark:shadow-none"
                        >
                          <Hourglass className="h-4 w-4" />
                          <span className="font-mono text-sm tracking-[0.2em] text-[hsl(var(--accent-foreground))] dark:text-foreground">{value}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  // EXISTING LAYOUT
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex flex-wrap items-center gap-2 ">
                      {modeMeta && (
                        <span className={cn(
                          "inline-flex items-center gap-2 rounded-full border border-transparent px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] shadow-[0_15px_35px_rgba(255,140,0,0.3)] dark:shadow-none transition-all",
                          isMultiplayerGame && game.multiplayerMode === 'pvp' && (game.matchState?.maxWins ?? 1) > 1
                            ? "bg-transparent border-amber-500/50 text-amber-500 dark:text-amber-400"
                            : "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground"
                        )}>
                          <modeMeta.icon className="h-4 w-4" />
                          <span>{modeMeta.label}</span>

                          {/* Merged Score & Round Info for PvP Multi-round */}
                          {isMultiplayerGame && game.multiplayerMode === 'pvp' && game.matchState && game.matchState.maxWins > 1 && (
                            <>
                              <div className="mx-2 h-4 w-px bg-current opacity-20" />
                              <div className="flex items-center gap-2 font-black" style={{ fontFamily: headingFontFamily }}>
                                {(() => {
                                  const myScore = userId ? (game.matchState!.scores[userId] || 0) : 0;
                                  const otherId = Object.keys(game.matchState!.scores).find(id => id !== userId);
                                  const otherScore = otherId ? (game.matchState!.scores[otherId] || 0) : 0;
                                  return (
                                    <>
                                      <span className={cn(myScore > otherScore ? 'text-green-500 dark:text-green-400' : '')}>
                                        {myScore}
                                      </span>
                                      <span className="opacity-50">-</span>
                                      <span className={cn(otherScore > myScore ? 'text-red-500 dark:text-red-400' : '')}>
                                        {otherScore}
                                      </span>
                                    </>
                                  );
                                })()}
                              </div>
                              <div className="mx-2 h-4 w-px bg-current opacity-20" />
                              <span>
                                ROUND {game.matchState.currentRound}/{game.matchState.maxWins * 2 - 1}
                              </span>
                            </>
                          )}
                        </span>
                      )}

                      <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--primary))] px-4 py-2 text-sm text-[hsl(var(--primary-foreground))] shadow-[0_12px_30px_rgba(255,140,0,0.28)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                        <Users className="h-4 w-4" />
                        <span className="font-mono text-base text-[hsl(var(--primary-foreground))] dark:text-foreground">{game.players.length}</span>
                      </span>
                      {isMultiplayerGame && (
                        <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--accent))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(var(--accent-foreground))] shadow-[0_12px_32px_rgba(16,185,129,0.32)] dark:border-[hsla(var(--accent)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                          <Clock3 className="h-4 w-4" />
                          <span>{turnStatusCopy ?? 'Waiting'}</span>
                        </span>
                      )}
                    </div>
                    {timerPills.length > 0 && (
                      <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                        {timerPills.map(({ label, value }) => (
                          <span
                            key={`board-timer-${label}`}
                            className="inline-flex items-center gap-3 rounded-full border border-transparent bg-[hsl(var(--accent))] px-4 py-2 text-[hsl(var(--accent-foreground))] shadow-[0_12px_32px_rgba(16,185,129,0.32)] dark:border-[hsla(var(--accent)/0.5)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-foreground dark:shadow-none"
                          >
                            {(() => {
                              const TimerIcon = timerIconLookup[label as 'Match' | 'Turn'] ?? Clock3;
                              return (
                                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white dark:bg-white/10 dark:text-[hsl(var(--accent))]">
                                  <TimerIcon className="h-4 w-4" />
                                  <span className="sr-only">{label}</span>
                                </span>
                              );
                            })()}
                            <span className="font-mono text-sm tracking-[0.2em] text-[hsl(var(--accent-foreground))] dark:text-foreground">{value}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>


              <div className="mx-auto w-full max-w-[min(92vw,420px)]">
                <GameGrid
                  wordLength={game.wordLength}
                  rows={displayRows as any}
                  isLightMode={isLightMode}
                  revealedTiles={revealedTiles}
                  selectedIndex={selectedIndex}
                  lockedIndices={lockedIndices}
                  tilePulse={tilePulse}
                  onTileClick={handleTileClick}
                  onTileTouchStart={handleTileTouchStart}
                  onTileTouchEnd={handleTileTouchEnd}
                  onTileMouseDown={handleTileMouseDown}
                  onTileMouseUp={handleTileMouseUp}
                  onTileMouseLeave={handleTileMouseLeave}
                />
              </div>
            </div >
          </div >

          <div
            className={cn(
              'relative mx-auto max-w-xl rounded-[32px] border p-5 shadow-[0_30px_80px_rgba(0,0,0,0.25)] backdrop-blur-2xl sm:p-6',
              isLightMode
                ? 'pale-orange-shell text-[#2b1409]'
                : 'border-white/10 bg-gradient-to-b from-[#10121b] via-[#090a12] to-[#05060b] text-white shadow-[0_40px_120px_rgba(0,0,0,0.65)]'
            )}
          >
            <div
              className={cn(
                'pointer-events-none absolute inset-0 rounded-[32px]',
                isLightMode ? 'hidden' : 'bg-gradient-to-t from-white/30 via-transparent to-white/5 opacity-80 dark:from-white/5 dark:via-transparent dark:to-white/0'
              )}
            />
            <div className="relative space-y-2.5">
              {isPlayer && game.status === 'in_progress' && canInteract && (
                <div className="relative">
                  <div className="flex flex-wrap justify-center gap-2">
                    {currentGuessPreview.split('').map((letter: string, index: number) => {
                      const isLocked = lockedIndices.has(index);
                      const isSelected = selectedIndex === index;
                      return (
                        <div
                          key={`preview-${index}`}
                          onClick={(e) => handleTileClick(index, true, e)}
                          onTouchStart={() => handleTileTouchStart(index, true)}
                          onTouchEnd={(e) => handleTileTouchEnd(index, e)}
                          onMouseDown={() => handleTileTouchStart(index, true)}
                          onMouseUp={(e) => handleTileTouchEnd(index, e)}
                          onMouseLeave={(e) => handleTileTouchEnd(index, e)}
                          className={cn(
                            'relative h-11 w-11 rounded-2xl border text-center text-lg font-semibold uppercase leading-[2.75rem] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur transition-all duration-200 cursor-pointer select-none',
                            'border-white/50 bg-white/40 text-[#2a1409] dark:border-white/15 dark:bg-white/10 dark:text-white',
                            isSelected && 'ring-2 ring-[hsl(var(--primary))] ring-offset-2 ring-offset-[hsl(var(--panel-neutral))] dark:ring-offset-background',
                            isLocked && 'opacity-70 bg-white/20'
                          )}
                        >
                          {letter.trim()}
                          {isLocked && (
                            <Lock className="absolute top-1 right-1 h-2.5 w-2.5 opacity-50" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-4 h-px w-full bg-white/50 dark:bg-white/10" />

                  {/* Ghost Preview (Last Word) - Compact & Below Divider */}
                  {(() => {
                    const lastGuess = game.guesses?.length ? game.guesses[game.guesses.length - 1] : null;
                    if (!lastGuess) return null;

                    const { word, evaluations } = lastGuess;

                    return (
                      <div className="mt-3 flex justify-center gap-1.5 opacity-60 select-none">
                        {word.split('').map((char, i) => {
                          const status = evaluations[i];
                          const colorClass =
                            status === 'correct'
                              ? 'border-green-500/50 bg-green-500/20 text-green-500 dark:text-green-400'
                              : status === 'present'
                                ? 'border-amber-500/50 bg-amber-500/20 text-amber-500 dark:text-amber-400'
                                : 'border-white/40 bg-white/5 text-white/90 dark:border-white/20'; // absent

                          return (
                            <div
                              key={`ghost-compact-${i}`}
                              className={cn(
                                "flex h-6 w-6 items-center justify-center rounded border text-[10px] font-bold uppercase shadow-sm",
                                colorClass
                              )}
                            >
                              {char}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              )}
              {turnStatusCopy && (
                <p className="text-center text-xs font-semibold uppercase tracking-[0.35em] text-gray-700 dark:text-white/60">
                  {turnStatusCopy}
                </p>
              )}
              {missingPlayerNames.length > 0 && (
                <div className="rounded-[26px] border border-amber-400/40 bg-amber-500/10 p-4 text-center text-amber-50 shadow-[0_20px_50px_rgba(0,0,0,0.35)] dark:border-amber-300/20 dark:bg-amber-500/5">
                  <p className="text-sm font-semibold text-amber-100">
                    Waiting for {missingPlayerNames.join(', ')} to reconnect
                  </p>
                  <p className="text-xs text-amber-100/80">
                    {disconnectCountdown && disconnectCountdown > 0
                      ? `Match ends in ${disconnectCountdown}s if they stay offline.`
                      : 'Match will end shortly if they do not return.'}
                  </p>
                </div>
              )}

              <Keyboard
                hints={keyboardHints}
                onAddLetter={addLetter}
                onDelete={removeLetter}
                onSubmit={() => void handleSubmit()}
                onReset={() => setCurrentGuess('')}
                isSubmitting={isSubmitting}
                canInteract={canInteract}
                isLightMode={isLightMode}
                keyPulse={keyPulse}
                keyboardFeedback={keyboardFeedback}
              />
            </div>
          </div>
        </div >
      </div >

      <div className="relative z-10 mx-auto max-w-md rounded-[26px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-neutral))] p-6 shadow-xl dark:border-border dark:bg-[hsl(var(--card))]">
        <div className="flex items-center justify-between">
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Players</p>
          <span className="text-xs text-muted-foreground">{game.players.length} total</span>
        </div>
        <ul className="mt-4 space-y-3">
          {game.players.map((playerId) => {
            const active = (game.activePlayers ?? []).includes(playerId);
            const isCurrentTurnPlayer = game.currentTurnPlayerId === playerId;
            return (
              <li
                key={playerId}
                className={cn(
                  'flex items-center justify-between rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-neutral))] px-4 py-3 dark:border-border dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12]',
                  isCurrentTurnPlayer && 'border-[hsl(var(--accent))] shadow-[0_10px_24px_rgba(0,0,0,0.35)]'
                )}
              >
                <div>
                  <p className="text-sm font-semibold">{formatPlayerLabel(playerId)}</p>
                  <p
                    className={cn(
                      'text-xs',
                      isCurrentTurnPlayer
                        ? 'font-semibold text-[hsl(var(--accent))]'
                        : 'text-muted-foreground'
                    )}
                  >
                    {isCurrentTurnPlayer ? 'Taking a turn' : active ? 'Online' : 'Away'}
                  </p>
                </div>
                <span
                  className={cn(
                    'h-2.5 w-2.5 rounded-full',
                    isCurrentTurnPlayer
                      ? 'bg-[hsl(var(--accent))]'
                      : active
                        ? 'bg-[hsl(var(--accent))]/60'
                        : 'bg-muted-foreground'
                  )}
                />
              </li>
            );
          })}
        </ul>

        {spectatorIds.length > 0 && (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Spectators</p>
            <ul className="mt-3 space-y-2">
              {spectatorIds.map((spectatorId) => (
                <li
                  key={spectatorId}
                  className="flex items-center justify-between rounded-2xl border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-sage))] px-4 py-2 text-sm dark:border-border dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12]"
                >
                  <span>{formatPlayerLabel(spectatorId, 'Viewer')}</span>
                  <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Watching</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {game.status === 'completed' && (
          <Button className="mt-6 w-full gap-2" onClick={handleRematch}>
            <RefreshCcw className="h-4 w-4" /> Replay
          </Button>
        )}
      </div>
    </div >


    {/* Tiebreaker Announcement Popup */}
    {
      showTiebreakerPopup && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 px-4 backdrop-blur-sm animate-in fade-in zoom-in duration-300">
          <div className="relative w-full max-w-lg overflow-hidden rounded-[36px] border-4 border-yellow-400 bg-gradient-to-b from-yellow-300 via-amber-200 to-yellow-400 p-8 text-center shadow-[0_0_100px_rgba(234,179,8,0.6)]">

            {/* Confetti Background for Popup */}
            <div className="absolute inset-0 z-0 overflow-hidden opacity-50">
              {Array.from({ length: 20 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute h-2 w-2 rounded-full bg-white"
                  style={{
                    left: `${Math.random() * 100}%`,
                    top: `${Math.random() * 100}%`,
                    animation: `pulse ${1 + Math.random()}s infinite`
                  }}
                />
              ))}
            </div>

            <div className="relative z-10 flex flex-col items-center gap-6">
              <div className="text-6xl animate-bounce">⚠️</div>
              <h2 className="font-black text-5xl tracking-tighter text-yellow-950 drop-shadow-md" style={{ fontFamily: '"Soopafresh", sans-serif' }}>
                TIE BREAKER!
              </h2>
              <p className="text-xl font-bold text-yellow-900/80 uppercase tracking-widest">
                Final Round • Winner Takes All
              </p>
              <div className="w-full h-1 bg-yellow-900/10 rounded-full" />

              <div className="flex gap-4">
                <div className="text-4xl">🔥</div>
                <div className="text-4xl">⚔️</div>
                <div className="text-4xl">🏆</div>
              </div>

              <Button
                onClick={() => setShowTiebreakerPopup(false)}
                className="w-full max-w-xs rounded-full bg-yellow-950 text-yellow-100 hover:bg-yellow-900 hover:scale-105 transition-all text-lg font-black tracking-widest py-6 shadow-xl"
              >
                LET'S GO!
              </Button>
            </div>
          </div>
        </div>
      )
    }

    {
      showResultPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-3 py-6 backdrop-blur-lg sm:px-4 sm:py-10">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
            className={cn(
              'relative w-full max-w-xl overflow-hidden rounded-[36px] border px-5 py-8 text-center shadow-[0_35px_110px_rgba(0,0,0,0.45)] sm:px-8 sm:py-10',
              isMatchDraw
                ? 'border-yellow-400/50 bg-gradient-to-b from-yellow-100 via-amber-50 to-orange-100 text-yellow-900 dark:bg-gradient-to-b dark:from-yellow-950/40 dark:via-yellow-900/20 dark:to-orange-950/30 dark:text-yellow-100'
                : didWin
                  ? 'border-[hsla(var(--accent)/0.35)] bg-gradient-to-b from-white via-[hsl(var(--panel-neutral))] to-[hsl(var(--panel-warm))] text-foreground dark:bg-gradient-to-b dark:from-[#2a2c36] dark:via-[#181924] dark:to-[#0d0f17] dark:text-white'
                  : 'border-[hsla(var(--destructive)/0.45)] bg-gradient-to-b from-[#fff0f0] via-[#ff9fb0] to-[#ff3f5e] text-white dark:bg-gradient-to-b dark:from-[#3a0505] dark:via-[#230202] dark:to-[#090000] dark:text-[hsl(var(--destructive-foreground))]'
            )}
          >
            {(didWin || isMatchDraw) && confettiPieces.length > 0 && (
              <div key={`confetti-${confettiSeed}`} className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                {confettiPieces.map((piece, index) => (
                  <span
                    key={`confetti-piece-${confettiSeed}-${index}`}
                    className="absolute block h-3 w-1 rounded-full opacity-90"
                    style={{
                      left: `${piece.left}%`,
                      animation: `confetti-fall ${piece.duration}s linear infinite`,
                      animationDelay: `${piece.delay}s`,
                      backgroundColor: isMatchDraw ? '#facc15' : piece.color, // Yellow confetti for draw
                    }}
                  />
                ))}
              </div>
            )}
            {didLose && (
              <div key={`shockwave-${shockwaveSeed}`} className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center">
                <div className="relative">
                  <span className="block h-56 w-56 rounded-full border border-[hsla(var(--destructive)/0.35)] opacity-70 [animation:loss-shock_2.8s_ease-out_infinite]" />
                  <span className="absolute inset-8 rounded-full bg-[hsla(var(--destructive)/0.2)] blur-2xl [animation:loss-shock_2.8s_ease-out_infinite]" />
                </div>
              </div>
            )}
            <div className="relative flex w-full flex-col items-center overflow-hidden animate-theme">
              <h3
                className={cn(
                  'mt-2 text-4xl font-black leading-tight tracking-tight sm:text-5xl',
                  isMatchDraw
                    ? 'text-yellow-500 dark:text-yellow-400 drop-shadow-sm'
                    : didWin ? 'text-[hsl(var(--accent))] dark:text-[hsl(var(--accent))]' : 'text-[hsl(var(--destructive))] dark:text-white'
                )}
                style={{ fontFamily: headingFontFamily }}
              >
                {resultHeading}
              </h3>
              <p
                className={cn(
                  'mt-4 max-w-md text-sm sm:text-base',
                  didWin
                    ? 'text-[hsl(var(--primary))] dark:text-[hsl(var(--accent-foreground))]'
                    : 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] dark:text-white/80'
                )}
                style={{ fontFamily: messageFontFamily }}
              >
                {completionBodyText}
              </p>

              <div className="mt-7 w-full max-w-md">
                <p
                  className={cn(
                    'text-[0.6rem] uppercase tracking-[0.45em]',
                    didWin
                      ? 'text-[hsl(var(--primary))] dark:text-white'
                      : 'text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.35)] dark:text-white/80'
                  )}
                >
                  The word was
                </p>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5 sm:gap-2">
                  {solutionWord
                    ? solutionWord.split('').map((letter, index) => (
                      <span
                        key={`${letter}-${index}`}
                        className={cn(
                          'flex h-10 w-10 items-center justify-center rounded-2xl font-black text-lg uppercase tracking-[0.15em] transition-transform duration-300 sm:h-12 sm:w-12 sm:text-xl',
                          didWin
                            ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-[0_18px_40px_rgba(0,0,0,0.25)] dark:bg-white/15 dark:text-white'
                            : 'bg-[hsla(var(--destructive)/0.35)] text-white shadow-[0_18px_45px_rgba(0,0,0,0.5)] dark:bg-white/15 dark:text-white'
                        )}
                        style={{ animation: `word-glow 3s ease-in-out ${index * 0.12}s infinite` }}
                      >
                        {letter}
                      </span>
                    ))
                    : (
                      <span className="rounded-full bg-muted px-4 py-2 text-xs uppercase tracking-[0.35em] text-muted-foreground">
                        Hidden for now
                      </span>
                    )}
                </div>
              </div>

              <div className="mt-9 flex w-full flex-col gap-3 sm:grid sm:grid-cols-2 sm:gap-4">
                {game?.matchState && !game.matchState.isMatchOver ? (
                  // Check if we are auto-advancing (Final Round)
                  (() => {
                    const isSingleRound = (game.roundsSetting ?? 1) === 1;
                    const currentScore = (game.matchState.scores[game.winnerId ?? ''] ?? 0) + 1;
                    const isScoreWin = typeof game.winnerId === 'string' && currentScore >= game.matchState.maxWins;
                    const roundsSetting = game.roundsSetting ?? 1;
                    const isLastRound = game.matchState.currentRound >= roundsSetting;
                    const isFinalRound = isSingleRound || isScoreWin || isLastRound;

                    if (isFinalRound) {
                      return (
                        <Button disabled variant="outline" size="lg" className="w-full col-span-2 opacity-80">
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          FINALIZING MATCH...
                        </Button>
                      );
                    }

                    return (
                      <div className="col-span-2 grid grid-cols-2 gap-3 sm:gap-4">
                        <Button
                          variant={game.nextRoundVotes?.includes(userId ?? '') ? "secondary" : "ghost"}
                          size="lg"
                          onClick={handleNextRound}
                          className={cn(
                            'col-span-2 sm:col-span-1 shadow-lg transition-all',
                            game.nextRoundVotes?.includes(userId ?? '')
                              ? 'bg-neutral-800 text-white opacity-90'
                              : 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent)/0.9)]'
                          )}
                        >
                          <Swords className="h-4 w-4 mr-2" />
                          {game.nextRoundVotes?.includes(userId ?? '')
                            ? `WAITING... (${game.nextRoundVotes.length}/${game.players.length})`
                            : 'NEXT ROUND'}
                        </Button>
                        <Button variant="ghost" size="lg" onClick={handleHomeNavigation} className="col-span-2 sm:col-span-1 border border-border/10 bg-black/20 text-white hover:bg-black/30 dark:bg-zinc-800 dark:hover:bg-zinc-700">
                          <DoorOpen className="h-4 w-4 mr-2" /> LEAVE
                        </Button>
                      </div>
                    );
                  })()
                ) : (
                  <>
                    <Button
                      variant={(game?.rematchVotes?.includes(userId ?? '')) ? "secondary" : "ghost"}
                      size="lg"
                      onClick={handleRematch}
                      className={cn(
                        'w-full',
                        replayButtonClasses,
                        (game?.rematchVotes?.includes(userId ?? '')) && 'bg-neutral-800 text-white opacity-90'
                      )}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {(game?.rematchVotes?.includes(userId ?? ''))
                        ? `WAITING... (${game.rematchVotes.length}/${game.players.length})`
                        : (game?.matchState?.isMatchOver ? 'NEW MATCH' : 'REPLAY')}
                    </Button>
                    <Button variant="ghost" size="lg" onClick={handleHomeNavigation} className={cn('w-full', homeButtonClasses)}>
                      <Home className="h-4 w-4" /> BACK TO HOME
                    </Button>
                  </>
                )}
              </div>

              {/* Disconnect Warning */}
              {game?.gameType !== 'solo' && isGameComplete && (
                (() => {
                  const activeCount = game?.activePlayers?.length ?? 0;
                  const totalCount = game?.players?.length ?? 0;
                  if (activeCount < totalCount && (game?.nextRoundVotes?.includes(userId ?? '') || game?.rematchVotes?.includes(userId ?? ''))) {
                    return (
                      <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-yellow-500/10 p-2 text-xs font-medium text-yellow-500">
                        <AlertTriangle className="h-3 w-3" />
                        <span>Opponent seems disconnected ({activeCount}/{totalCount} online)</span>
                      </div>
                    );
                  }
                  return null;
                })()
              )}
            </div>
          </motion.div>
        </div>
      )
    }

    {/* Bonus Popup (Winner's Perk) */}
    <AnimatePresence>
      {showBonusPopup && !!game?.matchState?.roundBonus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.9, opacity: 0, y: 10 }}
            transition={{ type: 'spring', duration: 0.5, bounce: 0.3 }}
            className="relative w-full max-w-sm overflow-hidden rounded-[32px] border border-[hsl(var(--accent)/0.3)] bg-gradient-to-br from-[#1b1c26] to-[#0d0e14] p-8 text-center shadow-2xl dark:from-[#1b1c26] dark:to-[#0d0e14]"
          >
            {/* Glow Effect */}
            <div className="absolute inset-0 z-0 bg-[radial-gradient(circle_at_50%_0%,hsla(var(--accent)/0.15),transparent_70%)]" />

            <div className="relative z-10 flex flex-col items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] shadow-[0_0_30px_hsl(var(--accent)/0.2)]">
                <Crown className="h-8 w-8" />
              </div>

              <div className="space-y-2">
                <h3 className="font-[family-name:var(--font-heading)] text-2xl text-white">
                  {game.matchState.roundBonus.beneficiaryId === userId ? "Winner's Perk!" : "Opponent's Perk"}
                </h3>
                <p className="text-sm font-medium leading-relaxed text-muted-foreground">
                  {game.matchState.roundBonus.beneficiaryId === userId
                    ? "You won the last round, so you start with a free hint!"
                    : "They won the last round, so they start with a free hint."}
                </p>
              </div>

              <Button
                size="lg"
                className="mt-2 w-full rounded-xl bg-[hsl(var(--accent))] font-bold text-[hsl(var(--accent-foreground))] hover:bg-[hsl(var(--accent)/0.9)]"
                onClick={() => setShowBonusPopup(false)}
              >
                READY
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Vote Announcement Popup */}
    {
      showVoteAnnouncementPopup && !isEndMatchDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="relative w-full max-w-sm overflow-hidden rounded-[2rem] border border-[hsl(var(--primary)/0.3)] bg-gradient-to-b from-[hsl(var(--primary)/0.15)] to-black shadow-2xl p-6 text-center animate-in fade-in zoom-in-95 duration-200">
            <div className="flex flex-col items-center gap-4">
              <div className="rounded-full bg-[hsl(var(--primary)/0.2)] p-4 text-[hsl(var(--primary))] shadow-[0_0_25px_hsl(var(--primary)/0.3)]">
                <Handshake className="w-8 h-8" />
              </div>

              <div>
                <h3 className="text-xl font-black uppercase tracking-widest text-[hsl(var(--primary))]">
                  Vote to Cancel
                </h3>
                <p className="mt-2 text-sm text-white/80 font-medium">
                  A player wants to cancel the match.
                  <br />
                  <span className="text-xs opacity-70">
                    ({game?.endVotes?.length ?? 0}/{game?.activePlayers?.length ?? 0} Votes)
                  </span>
                </p>
              </div>

              <div className="flex w-full gap-3 mt-2">
                <Button
                  variant="ghost"
                  className="flex-1 rounded-xl text-white/60 hover:text-white hover:bg-white/10"
                  onClick={() => setShowVoteAnnouncementPopup(false)}
                >
                  Ignore
                </Button>
                <Button
                  className="flex-1 rounded-xl bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] font-bold shadow-lg shadow-[hsl(var(--primary)/0.2)]"
                  onClick={handleOpenVoteDialogFromPopup}
                >
                  View Vote
                </Button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    {
      shouldShowChatDock && (
        <ChatDock
          context={chatDockContext}
          availability={chatAvailability}
          participantCount={chatParticipantCount}
          participants={chatParticipants}
          unreadCount={0}
          onComposerFocusChange={(focused) => setChatComposerFocused(focused)}
        />
      )
    }

    {
      isLocalhost && process.env.NODE_ENV !== 'production' && (
        <div className="fixed bottom-4 left-4 z-[60] flex flex-wrap gap-2 rounded-2xl border border-dashed border-[hsla(var(--border)/0.6)] bg-background/95 p-3 text-[10px] uppercase tracking-[0.2em] shadow-2xl dark:bg-[#090b10]/90">
          {debugButtons.map(({ label, variant }) => (
            <button
              key={variant}
              type="button"
              className={cn(
                'rounded-xl px-3 py-1 text-[0.55rem] font-semibold transition',
                debugResultVariant === variant
                  ? 'bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]'
                  : 'bg-muted text-foreground hover:bg-muted/80'
              )}
              onClick={() => triggerDebugResult(variant)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="rounded-xl bg-[hsl(var(--destructive))] px-3 py-1 text-[0.55rem] font-semibold text-[hsl(var(--destructive-foreground))] transition hover:opacity-90"
            onClick={clearDebugResult}
          >
            Live data
          </button>
        </div>
      )
    }
  </>);
}
