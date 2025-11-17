'use client';

import {
  arrayUnion,
  deleteDoc,
  doc,
  onSnapshot,
  runTransaction,
  updateDoc,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore';
import {
  Clock3,
  Copy,
  CornerDownLeft,
  Crown,
  Delete,
  Flame,
  Handshake,
  Home,
  RefreshCcw,
  RotateCcw,
  Swords,
  Timer,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useFirebase } from '@/components/firebase-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { GraffitiBackground } from '@/components/graffiti-background';
import { usePlayerNames } from '@/hooks/use-player-names';
import { useToast } from '@/hooks/use-toast';
import { createGame } from '@/lib/actions/game';
import type { GameDocument } from '@/types/game';
import type { GuessResult, GuessScore } from '@/lib/wordle';
import { getKeyboardHints, scoreGuess } from '@/lib/wordle';
import { cn } from '@/lib/utils';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const keyboardRows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
const LOBBY_GRACE_MINUTES = 3;
const INACTIVITY_MINUTES = 30;
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
  if (value.length <= 8) return value.toUpperCase();
  return `${value.slice(0, 4)}…${value.slice(-3)}`.toUpperCase();
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

const tileTone: Record<GuessScore, string> = {
  correct: 'border-transparent bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))] shadow-[0_18px_45px_rgba(0,0,0,0.25)]',
  present: 'border-transparent bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_18px_45px_rgba(0,0,0,0.22)]',
  absent: 'bg-muted text-muted-foreground',
};

const keyboardTone: Record<GuessScore, string> = {
  correct: 'bg-[hsla(var(--accent)/0.95)] text-[hsl(var(--accent-foreground))] border-[hsla(var(--accent)/0.45)] shadow-[0_10px_26px_rgba(0,0,0,0.15)]',
  present: 'bg-[hsla(var(--primary)/0.9)] text-[hsl(var(--primary-foreground))] border-[hsla(var(--primary)/0.5)] shadow-[0_10px_26px_rgba(0,0,0,0.15)]',
  absent: 'bg-muted text-muted-foreground border-transparent',
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
  const params = useParams();
  const router = useRouter();
  const { db, userId, user } = useFirebase();
  const { toast } = useToast();

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
  const [revealedTiles, setRevealedTiles] = useState<Record<string, boolean>>({});
  const autoLossTriggeredRef = useRef(false);
  const previousGuessCountRef = useRef(0);
  const initialLoadRef = useRef(true);

  const gameId = params.gameId as string;
  const isPlayer = Boolean(userId && game?.players?.includes(userId));
  const isSpectator = Boolean(userId && game && !isPlayer);
  const lobbyLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lobby/${gameId}`;
  }, [gameId]);
  const displayedGameId = useMemo(() => abbreviateId(gameId ?? ''), [gameId]);
  const compactGameId = useMemo(() => {
    if (!gameId) return '';
    if (gameId.length <= 4) return gameId.toUpperCase();
    return `${gameId.slice(0, 4).toUpperCase()}…`;
  }, [gameId]);
  const turnOrder = game?.turnOrder?.length ? game.turnOrder : game?.players ?? [];
  const isMultiplayerGame = game?.gameType === 'multiplayer' && turnOrder.length > 0;
  const activeTurnPlayerId = isMultiplayerGame ? game?.currentTurnPlayerId ?? null : null;
  const hasLockedTurn = Boolean(isMultiplayerGame && activeTurnPlayerId);
  const isMyTurn = !isMultiplayerGame || !hasLockedTurn || activeTurnPlayerId === userId;
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
    if (game.currentTurnPlayerId) ids.add(game.currentTurnPlayerId);
    if (game.winnerId) ids.add(game.winnerId);
    if (game.endedBy) ids.add(game.endedBy);
    return Array.from(ids);
  }, [game, spectatorIds]);
  const { getPlayerName } = usePlayerNames({ db, playerIds: trackedPlayerIds });
  const formatPlayerLabel = (playerId?: string | null, fallbackPrefix = 'Player') => {
    if (!playerId) return '—';
    if (playerId === userId) return 'You';
    const resolved = getPlayerName(playerId);
    if (resolved) return resolved;
    return `${fallbackPrefix} ${playerId.slice(-4).toUpperCase()}`;
  };
  const turnStatusCopy = (() => {
    if (!isMultiplayerGame) return null;
    if (!hasLockedTurn) return 'Περιμένουμε να ξεκινήσει ο γύρος.';
    return activeTurnPlayerId === userId
      ? 'Η σειρά σου!'
      : `Σειρά: ${formatPlayerLabel(activeTurnPlayerId)}`;
  })();

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

        const lobbyDeadline = data.lobbyClosesAt ? new Date(data.lobbyClosesAt).getTime() : null;
        if (lobbyDeadline && Date.now() > lobbyDeadline) {
          deleteDoc(gameRef).catch((error) => console.error('Failed to remove expired lobby', error));
          toast({
            variant: 'destructive',
            title: 'Session closed',
            description: 'Lobby expired while everyone was away.',
          });
          router.push('/');
        }
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

  useEffect(() => {
    if (!db || !userId || !gameId || !isPlayer) return;
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
          transaction.update(gameRef, {
            activePlayers: Array.from(activePlayers),
            lobbyClosesAt: null,
            lastActivityAt: nowIso,
            inactivityClosesAt: addMinutesIso(nowIso, INACTIVITY_MINUTES),
          });
        });
      } catch (error) {
        console.error('Failed to register game presence', error);
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
        console.error('Failed to unregister game presence', error);
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
  }, [db, gameId, userId, isPlayer]);

  useEffect(() => {
    if (!db || !game || game.status !== 'in_progress') return;
    const votesNeeded = Math.max(game.players.length, 1);
    if ((game.endVotes ?? []).length < votesNeeded) return;

    const finalize = async () => {
      try {
        const gameRef = doc(db, 'games', gameId);
        await updateDoc(gameRef, {
          status: 'completed',
          completionMessage: 'Match ended by player vote.',
          completedAt: new Date().toISOString(),
          endedBy: null,
        });
      } catch (error) {
        console.error('Failed to close game after votes', error);
      }
    };

    void finalize();
  }, [db, game, gameId]);

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

  const addLetter = useCallback(
    (letter: string) => {
      if (!game || !isPlayer || !isMyTurn || game.status !== 'in_progress') return;
      if (currentGuess.length >= game.wordLength) return;
      const normalized = letter.toLowerCase();
      const nextGuess = (currentGuess + normalized).slice(0, game.wordLength);
      const pulseId = Date.now();
      setKeyPulse({ letter: normalized, id: pulseId });
      setTilePulse({ index: currentGuess.length, id: pulseId });
      setCurrentGuess(nextGuess);
    },
    [currentGuess, game, isMyTurn, isPlayer]
  );

  const removeLetter = useCallback(() => {
    if (!canInteract) return;
    setCurrentGuess((prev) => prev.slice(0, -1));
  }, [canInteract]);

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

  useEffect(() => {
    if (!db || !game || game.status !== 'in_progress' || autoLossTriggeredRef.current) return;

    const matchDeadlineMs = game.matchDeadline ? new Date(game.matchDeadline).getTime() : null;
    const turnDeadlineMs = game.turnDeadline ? new Date(game.turnDeadline).getTime() : null;
    const matchExpired = typeof matchDeadlineMs === 'number' && now >= matchDeadlineMs;
    const turnExpired = typeof turnDeadlineMs === 'number' && now >= turnDeadlineMs;

    if (!matchExpired && !turnExpired) return;

    autoLossTriggeredRef.current = true;
    const reason = matchExpired ? 'Match timer expired.' : 'Turn timer expired.';
    const completionMessage = buildLossMessage(reason);

    const finalize = async () => {
      try {
        const gameRef = doc(db, 'games', gameId);
        await updateDoc(gameRef, {
          status: 'completed',
          completedAt: new Date().toISOString(),
          winnerId: null,
          completionMessage,
          endedBy: null,
          matchDeadline: null,
          turnDeadline: null,
        });
      } catch (error) {
        console.error('Failed to auto-complete game on timer expiry', error);
        autoLossTriggeredRef.current = false;
      }
    };

    void finalize();
  }, [buildLossMessage, db, game, gameId, now]);

  const handleSubmit = useCallback(async () => {
    if (!db || !game || !gameId || !userId || !isPlayer || isSubmitting) return;
    if (!isMyTurn && game.gameType === 'multiplayer') {
      toast({ variant: 'destructive', title: 'Βάλε παύση', description: 'Περίμενε τη σειρά σου για να παίξεις.' });
      return;
    }
    const guess = currentGuess.trim().toLowerCase();
    if (guess.length !== game.wordLength) {
      toast({ variant: 'destructive', title: 'Too short', description: 'Need more letters.' });
      return;
    }

    setIsSubmitting(true);
    const previousGuess = currentGuess;
    try {
      const isRealWord = await validateWord(guess);
      if (!isRealWord) {
        toast({ variant: 'destructive', title: 'Invalid word', description: 'Try a real word.' });
        return;
      }

      const nextGuessCount = (game.guesses?.length ?? 0) + 1;
      setPendingGuess(previousGuess);
      setPendingGuessTargetCount(nextGuessCount);

      const evaluations = scoreGuess(guess, game.solution);
      const guessEntry: GuessResult = {
        word: guess,
        evaluations,
        playerId: userId,
        submittedAt: new Date().toISOString(),
      };

      const isWin = evaluations.every((value) => value === 'correct');
      const attemptsUsed = (game.guesses?.length ?? 0) + 1;
      const outOfAttempts = attemptsUsed >= game.maxAttempts;
      const matchMinutes = matchMinutesFromSetting(game.matchTime);
      const turnSeconds = turnSecondsFromSetting(game.turnTime);
      const order = game.turnOrder?.length ? game.turnOrder : game.players;
      const shouldRotateTurns = game.gameType === 'multiplayer' && order.length > 1;
      const nextTurnPlayerId = shouldRotateTurns
        ? getNextTurnPlayerId(order, game.currentTurnPlayerId ?? userId)
        : game.currentTurnPlayerId ?? null;

      const updatePayload: Record<string, unknown> = {
        guesses: arrayUnion(guessEntry),
        lastActivityAt: guessEntry.submittedAt,
        inactivityClosesAt: addMinutesIso(guessEntry.submittedAt, INACTIVITY_MINUTES),
        lobbyClosesAt: null,
        endVotes: [],
      };

      if (matchMinutes) {
        updatePayload.matchDeadline = addMinutesIso(guessEntry.submittedAt, matchMinutes);
      }
      if (turnSeconds) {
        updatePayload.turnDeadline = addSecondsIso(guessEntry.submittedAt, turnSeconds);
      } else {
        updatePayload.turnDeadline = null;
      }

      if (isWin || outOfAttempts) {
        updatePayload.status = 'completed';
        updatePayload.completedAt = guessEntry.submittedAt;
        updatePayload.winnerId = isWin ? userId : null;
        updatePayload.completionMessage = isWin
          ? game.gameType === 'multiplayer'
            ? game.multiplayerMode === 'co-op'
              ? 'Ομάδα, μπράβο! Βρήκατε τη λέξη.'
              : 'Νίκη! Έπιασες πρώτος τη λέξη.'
            : 'Word cracked! Celebrate the streak.'
          : buildLossMessage('No more guesses left.');
        updatePayload.turnDeadline = null;
        updatePayload.matchDeadline = null;
        updatePayload.currentTurnPlayerId = null;
      } else if (game.gameType === 'multiplayer') {
        if (shouldRotateTurns && nextTurnPlayerId) {
          updatePayload.currentTurnPlayerId = nextTurnPlayerId;
        } else if (!game.currentTurnPlayerId && order.length) {
          updatePayload.currentTurnPlayerId = order[0];
        }
        if (!game.turnOrder?.length) {
          updatePayload.turnOrder = order;
        }
      }

      const gameRef = doc(db, 'games', gameId);
      await updateDoc(gameRef, updatePayload);
      if (isWin) {
        toast({
          title: isCoopMode ? 'Team victory!' : 'Victory!',
          description: isCoopMode ? 'Η ομάδα σας βρήκε τη λέξη.' : 'You guessed the word.',
        });
      } else if (outOfAttempts) {
        toast({ title: 'Out of tries', description: `Answer: ${game.solution.toUpperCase()}` });
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
    currentGuess,
    db,
    game,
    gameId,
    isCoopMode,
    isMyTurn,
    isPlayer,
    isSubmitting,
    toast,
    userId,
    validateWord,
  ]);

  useEffect(() => {
    if (!game || game.status !== 'in_progress' || !isPlayer || !isMyTurn) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
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
  }, [addLetter, game, handleSubmit, isMyTurn, isPlayer, removeLetter]);

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

  const handleSoloEnd = useCallback(async () => {
    if (!db || !gameId) return;
    try {
      const gameRef = doc(db, 'games', gameId);
      await updateDoc(gameRef, {
        status: 'completed',
        completionMessage: 'You ended the solo session.',
        completedAt: new Date().toISOString(),
        endedBy: userId ?? null,
      });
    } catch (error) {
      console.error('Failed to end solo game', error);
      toast({ variant: 'destructive', title: 'Could not end game' });
    }
  }, [db, gameId, toast, userId]);

  const handleVoteToEnd = useCallback(async () => {
    if (!db || !gameId || !userId || hasVotedToEnd) return;
    try {
      const gameRef = doc(db, 'games', gameId);
      await updateDoc(gameRef, {
        endVotes: arrayUnion(userId),
      });
      setHasVotedToEnd(true);
      toast({ title: 'Vote registered', description: 'Waiting for all players.' });
    } catch (error) {
      console.error('Failed to vote to end game', error);
      toast({ variant: 'destructive', title: 'Vote failed', description: 'Try again later.' });
    }
  }, [db, gameId, hasVotedToEnd, toast, userId]);

  const handleRematch = useCallback(async () => {
    if (!firebaseConfig || !userId || !game) return;
    try {
      const authToken = await user?.getIdToken?.();
      if (!authToken) {
        throw new Error('Missing auth token');
      }
      const newGameId = await createGame(
        {
          creatorId: userId,
          gameType: game.gameType,
          multiplayerMode: game.multiplayerMode,
          wordLength: game.wordLength,
          matchTime: game.matchTime,
          turnTime: game.turnTime ?? 'unlimited',
        },
        firebaseConfig,
        authToken
      );
      if (!newGameId) throw new Error('Failed to create rematch');
      router.push(game.gameType === 'multiplayer' ? `/lobby/${newGameId}` : `/game/${newGameId}`);
    } catch (error) {
      console.error('Failed to start rematch', error);
      toast({ variant: 'destructive', title: 'Rematch failed', description: 'Please try again.' });
    }
  }, [game, router, toast, user, userId]);

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
    if (isCoopMode && game.winnerId) {
      return game.winnerId === userId ? 'You cracked it!' : 'Team victory!';
    }
    if (game.gameType === 'solo' && isPlayer && game.winnerId !== userId) {
      return 'You lost';
    }
    if (game.winnerId) {
      return game.winnerId === userId ? 'You cracked it!' : 'Rival guessed the word';
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
  const confettiPieces = useMemo<ConfettiPiece[]>(() => {
    if (!didWin) return [];
    const seededRandom = (index: number, offset: number) => {
      const value = Math.sin(index * 991 + confettiSeed * 137 + offset * 29.7) * 10000;
      return value - Math.floor(value);
    };
    return Array.from({ length: 22 }, (_, index) => ({
      color: confettiPalette[index % confettiPalette.length],
      left: seededRandom(index, 1) * 100,
      delay: seededRandom(index, 2) * 0.8,
      duration: 2.4 + seededRandom(index, 3) * 1.2,
      rotation: seededRandom(index, 4) * 360,
    }));
  }, [confettiSeed, didWin]);
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
    ?? (game?.completionMessage ?? (didWin ? 'Word cracked! Celebrate the streak.' : 'Thanks for playing.'));
  const debugButtons: Array<{ label: string; variant: Exclude<DebugResultVariant, null> }> = [
    { label: 'Preview Win', variant: 'playerWin' },
    { label: 'Preview Loss', variant: 'playerLoss' },
    { label: 'Preview Rival Win', variant: 'rivalWin' },
    { label: 'Preview No Winner', variant: 'noWinner' },
  ];

  const [isLocalhost, setIsLocalhost] = useState(false);

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
  }, [didLose, didWin, showResultPopup]);

  useEffect(() => {
    if (pendingGuessTargetCount === null) return;
    if (submittedGuessCount >= pendingGuessTargetCount) {
      setPendingGuess(null);
      setPendingGuessTargetCount(null);
      setCurrentGuess('');
    }
  }, [pendingGuessTargetCount, submittedGuessCount]);

  const sharedEndButtonClasses = cn(
    'inline-flex h-11 items-center justify-center gap-2 rounded-full border border-transparent px-5 text-sm font-semibold uppercase tracking-[0.2em] transition disabled:opacity-60',
    'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-[0_25px_55px_rgba(255,140,0,0.35)] hover:shadow-[0_30px_65px_rgba(255,140,0,0.45)]',
    'dark:bg-[hsl(var(--primary))]'
  );

  const endButton = game?.gameType === 'solo'
    ? (
        <Button
          className={sharedEndButtonClasses}
          onClick={handleSoloEnd}
          disabled={!isPlayer || game?.status !== 'in_progress'}
        >
          <Flame className="h-4 w-4" />
          End game
        </Button>
      )
    : (
        <Button
          className={sharedEndButtonClasses}
          onClick={handleVoteToEnd}
          disabled={!isPlayer || hasVotedToEnd || game?.status !== 'in_progress'}
        >
          <Flame className="h-4 w-4" />
          {hasVotedToEnd ? 'Vote sent' : 'Vote to end'}
        </Button>
      );

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
  const timerPills = [
    matchCountdown ? { label: 'Match', value: matchCountdown } : null,
    turnCountdown ? { label: 'Turn', value: turnCountdown } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const timerIconLookup: Record<'Match' | 'Turn', LucideIcon> = {
    Match: Timer,
    Turn: Clock3,
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[hsl(var(--panel-neutral))] text-foreground dark:bg-background">
      <GraffitiBackground zIndex={0} />
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
          <div className="relative mx-auto max-w-lg rounded-[34px] border border-white/40 bg-white/25 px-4 py-6 shadow-[0_35px_90px_rgba(0,0,0,0.25)] backdrop-blur-2xl sm:px-6 dark:border-white/10 dark:bg-white/5">
            <div className="pointer-events-none absolute inset-0 rounded-[34px] bg-gradient-to-br from-white/35 via-transparent to-white/10 opacity-70 dark:from-white/10 dark:via-transparent dark:to-white/5" />
            <div className="relative space-y-0">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 ">
                {modeMeta && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-transparent bg-[hsl(var(--primary))] px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em] text-[hsl(var(--primary-foreground))] shadow-[0_15px_35px_rgba(255,140,0,0.3)] dark:border-[hsla(var(--primary)/0.45)] dark:bg-gradient-to-r dark:from-[#13141c] dark:via-[#0c0d14] dark:to-[#090a12] dark:text-muted-foreground dark:shadow-none">
                    <modeMeta.icon className="h-4 w-4" />
                    <span>{modeMeta.label}</span>
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
            <div className="grid gap-2 ">
              {boardRows.map((row, rowIndex) => {
                const isActiveRow = row.state === 'active';
                return (
                  <div
                    key={rowIndex}
                    className="mx-auto grid w-full max-w-[min(92vw,420px)] gap-2 sm:gap-3"
                    style={{ gridTemplateColumns: `repeat(${game.wordLength}, minmax(0, 1fr))` }}
                  >
                    {row.letters.map((letter, letterIndex) => {
                      const evaluation = row.evaluations[letterIndex] as GuessScore | null;
                      const shouldReveal = Boolean(
                        recentRevealMeta && row.state === 'submitted' && rowIndex === recentRevealMeta.rowIndex
                      );
                      const tileDelayMs = letterIndex * 140;
                      const tileStyle: CSSProperties | undefined = shouldReveal
                        ? {
                            ['--tile-delay' as string]: `${tileDelayMs}ms`,
                            ['--tile-feedback-delay' as string]: `${tileDelayMs + 360}ms`,
                          }
                        : undefined;
                      const tilePulseActive = Boolean(
                        isActiveRow && tilePulse && tilePulse.index === letterIndex
                      );
                      const tileKey = `${rowIndex}-${letterIndex}`;
                      const evaluationReady = Boolean(
                        evaluation && (!shouldReveal || revealedTiles[tileKey])
                      );
                      const displayEvaluation = evaluationReady ? evaluation : null;
                      return (
                        <div
                          key={`${rowIndex}-${letterIndex}`}
                          style={tileStyle}
                          className={cn(
                            'relative flex aspect-square items-center justify-center rounded-3xl border text-2xl font-semibold uppercase tracking-wider transition-all duration-200',
                            !displayEvaluation &&
                              (isActiveRow
                                ? 'border-[hsla(var(--primary)/0.35)] bg-white/40 text-[#262624] shadow-[inset_4px_4px_15px_rgba(255,255,255,0.5),inset_-4px_-4px_12px_rgba(0,0,0,0.08)] dark:border-[hsla(var(--primary)/0.4)] dark:bg-white/5 dark:text-[#ffe8d0]'
                                : 'border-[hsla(var(--primary)/0.25)] bg-white/30 text-[#401503] dark:border-white/8 dark:bg-[#10111a]/70 dark:text-[#cbc7c1]'),
                            displayEvaluation && displayEvaluation !== 'absent' && 'border-transparent',
                            displayEvaluation === 'absent' && 'border-[hsl(var(--panel-border))] dark:border-white/15',
                            displayEvaluation && tileTone[displayEvaluation],
                            isActiveRow && !displayEvaluation && 'shadow-[inset_4px_4px_10px_rgba(0,0,0,0.22),inset_-4px_-4px_12px_rgba(255,255,255,0.2)]',
                            shouldReveal && 'tile-animate-reveal',
                            shouldReveal && evaluation === 'correct' && 'tile-animate-bounce',
                            shouldReveal && evaluation === 'present' && 'tile-animate-shake',
                            tilePulseActive && 'animate-tile-pop'
                          )}
                        >
                          {letter.trim()}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            </div>
          </div>

          <div className="relative mx-auto max-w-xl rounded-[32px] border border-white/40 bg-white/20 p-5 shadow-[0_30px_80px_rgba(0,0,0,0.25)] backdrop-blur-2xl sm:p-6 dark:border-white/10 dark:bg-white/5">
            <div className="pointer-events-none absolute inset-0 rounded-[32px] bg-gradient-to-t from-white/30 via-transparent to-white/5 opacity-80 dark:from-white/5 dark:via-transparent dark:to-white/0" />
            <div className="relative space-y-2.5">
            {isPlayer && game.status === 'in_progress' && canInteract && (
              <div>
                <div className="flex flex-wrap justify-center gap-2">
                  {currentGuessPreview.split('').map((letter: string, index: number) => (
                    <div
                      key={`preview-${index}`}
                      className="h-11 w-11 rounded-2xl border border-white/50 bg-white/40 text-center text-lg font-semibold uppercase leading-[2.75rem] text-[#2a1409] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] backdrop-blur dark:border-white/15 dark:bg-white/10 dark:text-white"
                    >
                      {letter.trim()}
                    </div>
                  ))}
                </div>
                <div className="mt-4 h-px w-full bg-white/50 dark:bg-white/10" />
              </div>
            )}
            {turnStatusCopy && (
              <p className="text-center text-xs font-semibold uppercase tracking-[0.35em] text-white/80 dark:text-white/60">
                {turnStatusCopy}
              </p>
            )}
            <div className="space-y-2.5">
              {keyboardRows.map((row) => (
                <div key={row} className="mx-auto flex w-full max-w-[320px] items-center justify-center gap-1 sm:max-w-[380px] sm:gap-1.5">
                  {row.split('').map((letter) => {
                    const hint = keyboardHints[letter];
                    const pulseActive = Boolean(keyPulse && keyPulse.letter === letter);
                    const feedbackEntry = keyboardFeedback?.entries.find((entry) => entry.letter === letter);
                    const keyStyle: CSSProperties | undefined = feedbackEntry
                      ? { ['--key-feedback-delay' as string]: `${feedbackEntry.delay}ms` }
                      : undefined;
                    return (
                      <button
                        key={letter}
                        type="button"
                        style={keyStyle}
                        className={cn(
                          'group relative isolate flex h-10 w-8 flex-none items-center justify-center rounded-[18px] border text-sm font-semibold uppercase tracking-wide text-[#2b140c] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)] transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-[0_14px_32px_rgba(0,0,0,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsla(var(--primary)/0.5)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent sm:h-12 sm:w-10 sm:text-sm',
                          hint
                            ? 'border-transparent text-white dark:text-white'
                            : 'border-white/50 bg-white/35 text-[#2b140c] backdrop-blur dark:border-white/10 dark:bg-white/10 dark:text-white/80',
                          hint && keyboardTone[hint],
                          pulseActive && 'animate-key-pop',
                          feedbackEntry && 'keyboard-feedback',
                          feedbackEntry && `keyboard-feedback-${feedbackEntry.evaluation}`,
                          (!canInteract) && 'opacity-60'
                        )}
                        onClick={() => addLetter(letter)}
                        disabled={!canInteract}
                        aria-label={`Use letter ${letter}`}
                      >
                        <span className="relative z-[1]">{letter}</span>
                        <span className="pointer-events-none absolute inset-0 -z-[1] rounded-[18px] opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ background: 'radial-gradient(circle at 50% 0%, rgba(255,255,255,0.8), transparent 58%)' }} />
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-center gap-2 sm:flex-nowrap">
                <Button
                  variant="ghost"
                  className="shrink-0 gap-2 rounded-2xl border border-[hsla(var(--accent)/0.5)] bg-[hsla(var(--accent)/0.15)] px-6 py-2 text-[hsl(var(--accent))] shadow-[0_12px_28px_rgba(0,128,96,0.2)] dark:border-[hsla(var(--accent)/0.4)] dark:bg-white/5 dark:text-[hsl(var(--accent-foreground))]"
                  onClick={() => setCurrentGuess('')}
                  disabled={!canInteract}
                >
                  <RotateCcw className="h-4 w-4" /> Reset row
                </Button>
                <button
                  type="button"
                  className="flex h-10 w-20 items-center justify-center rounded-2xl border border-transparent bg-[hsl(var(--primary))] text-sm font-semibold uppercase text-[hsl(var(--primary-foreground))] shadow-[0_15px_35px_rgba(255,140,0,0.35)] transition-all hover:-translate-y-0.5 sm:h-12 sm:w-24 dark:bg-[hsl(var(--primary))] dark:text-[hsl(var(--primary-foreground))]"
                  onClick={() => void handleSubmit()}
                  disabled={!canInteract || isSubmitting}
                  aria-label="Submit guess"
                >
                  <CornerDownLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="flex h-10 w-16 items-center justify-center rounded-2xl border border-transparent bg-[hsl(var(--destructive))] text-sm font-semibold uppercase text-[hsl(var(--destructive-foreground))] shadow-[0_12px_30px_rgba(255,0,72,0.3)] transition-all hover:-translate-y-0.5 sm:h-12 sm:w-18 sm:text-sm dark:bg-[hsl(var(--destructive))] dark:text-[hsl(var(--destructive-foreground))]"
                  onClick={removeLetter}
                  disabled={!canInteract || isSubmitting}
                  aria-label="Delete letter"
                >
                  <Delete className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            </div>
          </div>
          
          <div className="mx-auto max-w-md rounded-[26px] border border-[hsl(var(--panel-border))] bg-[hsl(var(--panel-neutral))] p-6 shadow-xl dark:border-border dark:bg-[hsl(var(--card))]">
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
                        {isCurrentTurnPlayer ? 'Παίζει τώρα' : active ? 'Online' : 'Away'}
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
        </div>
      </div>

      {showResultPopup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 px-3 py-6 backdrop-blur-lg sm:px-4 sm:py-10">
          <div
            className={cn(
              'relative w-full max-w-xl overflow-hidden rounded-[36px] border px-5 py-8 text-center shadow-[0_35px_110px_rgba(0,0,0,0.45)] sm:px-8 sm:py-10',
              didWin
                ? 'border-[hsla(var(--accent)/0.35)] bg-gradient-to-b from-white via-[hsl(var(--panel-neutral))] to-[hsl(var(--panel-warm))] text-foreground dark:bg-gradient-to-b dark:from-[#2a2c36] dark:via-[#181924] dark:to-[#0d0f17] dark:text-white'
                : 'border-[hsla(var(--destructive)/0.45)] bg-gradient-to-b from-[#fff0f0] via-[#ff9fb0] to-[#ff3f5e] text-white dark:bg-gradient-to-b dark:from-[#3a0505] dark:via-[#230202] dark:to-[#090000] dark:text-[hsl(var(--destructive-foreground))]'
            )}
          >
            {didWin && confettiPieces.length > 0 && (
              <div key={`confetti-${confettiSeed}`} className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
                {confettiPieces.map((piece, index) => (
                  <span
                    key={`confetti-piece-${confettiSeed}-${index}`}
                    className="absolute block h-3 w-1 rounded-full opacity-90"
                    style={{
                      left: `${piece.left}%`,
                      animation: `confetti-fall ${piece.duration}s linear infinite`,
                      animationDelay: `${piece.delay}s`,
                      backgroundColor: piece.color,
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
            <div className="relative z-[1] flex flex-col items-center text-center">
              <h3
                className={cn(
                  'mt-2 text-4xl font-black leading-tight tracking-tight sm:text-5xl',
                  didWin ? 'text-[hsl(var(--accent))] dark:text-[hsl(var(--accent))]' : 'text-[hsl(var(--destructive))] dark:text-white'
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

              <div className="mt-9 grid w-full grid-cols-2 gap-3 sm:gap-4">
                <Button variant="ghost" size="lg" onClick={handleReplayClick} className={cn('w-full', replayButtonClasses)}>
                  <RefreshCcw className="h-4 w-4" /> REPLAY
                </Button>
                <Button variant="ghost" size="lg" onClick={handleHomeNavigation} className={cn('w-full', homeButtonClasses)}>
                  <Home className="h-4 w-4" /> BACK TO HOME
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isLocalhost && process.env.NODE_ENV !== 'production' && (
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
      )}
    </div>
  );
}
