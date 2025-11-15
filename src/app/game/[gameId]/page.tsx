'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  Copy,
  Crown,
  Handshake,
  Home,
  RefreshCcw,
  RotateCcw,
  Swords,
  Users,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useFirebase } from '@/components/firebase-provider';
import { ThemeToggle } from '@/components/theme-toggle';
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
  correct: 'bg-emerald-500 text-white shadow-[0_10px_30px_rgba(16,185,129,0.45)]',
  present: 'bg-amber-400 text-white shadow-[0_10px_30px_rgba(251,191,36,0.45)]',
  absent: 'bg-muted text-muted-foreground',
};

const keyboardTone: Record<GuessScore, string> = {
  correct: 'bg-emerald-500 text-white',
  present: 'bg-amber-400 text-white',
  absent: 'bg-muted text-muted-foreground',
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
  const { db, userId } = useFirebase();
  const { toast } = useToast();

  const [game, setGame] = useState<GameDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentGuess, setCurrentGuess] = useState('');
  const [keyboardHints, setKeyboardHints] = useState<Record<string, GuessScore>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResultPopup, setShowResultPopup] = useState(false);
  const [hasVotedToEnd, setHasVotedToEnd] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const autoLossTriggeredRef = useRef(false);

  const gameId = params.gameId as string;
  const isPlayer = Boolean(userId && game?.players?.includes(userId));
  const isSpectator = Boolean(userId && game && !isPlayer);
  const lobbyLink = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return `${window.location.origin}/lobby/${gameId}`;
  }, [gameId]);
  const displayedGameId = useMemo(() => abbreviateId(gameId ?? ''), [gameId]);

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
      setCurrentGuess((prev) => {
        if (!game || !isPlayer) return prev;
        if (prev.length >= game.wordLength) return prev;
        return (prev + letter).slice(0, game.wordLength).toLowerCase();
      });
    },
    [game, isPlayer]
  );

  const removeLetter = useCallback(() => {
    setCurrentGuess((prev) => prev.slice(0, -1));
  }, []);

  const buildLossMessage = useCallback(
    (reason: string) => {
      if (!game) return reason;
      const reveal = `The word was ${game.solution.toUpperCase()}.`;
      if (game.gameType === 'solo') {
        return `${reason} ${getRandomSoloLossMessage()} ${reveal}`.trim();
      }
      return `${reason} ${reveal}`.trim();
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
          ? 'Word cracked! Celebrate the streak.'
          : buildLossMessage('No more guesses left.');
        updatePayload.turnDeadline = null;
        updatePayload.matchDeadline = null;
      }

      const gameRef = doc(db, 'games', gameId);
      await updateDoc(gameRef, updatePayload);
      setCurrentGuess('');
      if (isWin) {
        toast({ title: 'Victory!', description: 'You guessed the word.' });
      } else if (outOfAttempts) {
        toast({ title: 'Out of tries', description: `Answer: ${game.solution.toUpperCase()}` });
      }
    } catch (error) {
      console.error('Failed to submit guess', error);
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
    isPlayer,
    isSubmitting,
    toast,
    userId,
    validateWord,
  ]);

  useEffect(() => {
    if (!game || game.status !== 'in_progress') return;

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
  }, [game, handleSubmit, removeLetter, addLetter]);

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
      const newGameId = await createGame(
        {
          creatorId: userId,
          gameType: game.gameType,
          multiplayerMode: game.multiplayerMode,
          wordLength: game.wordLength,
          matchTime: game.matchTime,
          turnTime: game.turnTime ?? 'unlimited',
        },
        firebaseConfig
      );
      if (!newGameId) throw new Error('Failed to create rematch');
      router.push(game.gameType === 'multiplayer' ? `/lobby/${newGameId}` : `/game/${newGameId}`);
    } catch (error) {
      console.error('Failed to start rematch', error);
      toast({ variant: 'destructive', title: 'Rematch failed', description: 'Please try again.' });
    }
  }, [game, router, toast, userId]);

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
        game.status === 'in_progress'
      ) {
        const padded = currentGuess.padEnd(game.wordLength, ' ');
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
  }, [currentGuess, game, isPlayer]);

  const matchCountdown = formatCountdown(game?.matchDeadline ?? null, now);
  const turnCountdown = formatCountdown(game?.turnDeadline ?? null, now);
  const spectatorIds = useMemo(() => {
    if (!game) return [];
    const active = Array.from(new Set(game.activePlayers ?? []));
    return active.filter((id) => !game.players.includes(id));
  }, [game]);

  const endButton = game?.gameType === 'solo'
    ? (
        <Button
          className="h-10 rounded-full border border-red-400/40 bg-gradient-to-br from-red-500 to-red-600 text-sm font-semibold text-white shadow-[inset_3px_3px_6px_rgba(255,255,255,0.25),inset_-4px_-4px_10px_rgba(0,0,0,0.35)] transition hover:brightness-110 disabled:opacity-60"
          onClick={handleSoloEnd}
          disabled={!isPlayer || game?.status !== 'in_progress'}
        >
          End game
        </Button>
      )
    : (
        <Button
          className="h-10 rounded-full border border-amber-400/40 bg-gradient-to-br from-amber-400 to-amber-500 text-sm font-semibold text-white shadow-[inset_3px_3px_6px_rgba(255,255,255,0.2),inset_-4px_-4px_10px_rgba(0,0,0,0.3)] transition hover:brightness-110 disabled:opacity-60"
          onClick={handleVoteToEnd}
          disabled={!isPlayer || hasVotedToEnd || game?.status !== 'in_progress'}
        >
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

  const currentGuessPreview = currentGuess.padEnd(game.wordLength, ' ');
  const timerPills = [
    matchCountdown ? { label: 'Match', value: matchCountdown } : null,
    turnCountdown ? { label: 'Turn', value: turnCountdown } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const resultHeading =
    game.gameType === 'solo' && isPlayer && game.winnerId !== userId
      ? 'You lost'
      : game.winnerId
        ? game.winnerId === userId
          ? 'You cracked it!'
          : 'Rival guessed the word'
        : 'No winner this round';

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative mx-auto w-full max-w-5xl px-4 pt-12 pb-6 sm:pt-10">

        <div
          className="relative mx-auto w-full max-w-xl rounded-[32px] bg-card/30 px-6 py-8 text-center shadow-[0_25px_65px_rgba(0,0,0,0.45)] backdrop-blur-xl"
        >
          <div className="absolute right-4 top-4 hidden lg:block">
            <ThemeToggle />
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="WordMates" className="mx-auto h-20 w-auto drop-shadow-xl" />
          <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/60 bg-background/40 px-4 py-5 text-left shadow-inner">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex flex-wrap items-center gap-3 rounded-full border border-border/50 bg-card/60 px-4 py-2 text-left">
                <span className="text-[11px] uppercase tracking-[0.35em] text-muted-foreground">Game ID</span>
                <span className="font-mono text-sm tracking-[0.3em] text-foreground whitespace-nowrap">{displayedGameId}</span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={handleCopyLobbyLink}
                  className="h-8 w-8 shrink-0 rounded-full border border-border/60 bg-background/70"
                  aria-label="Copy lobby link"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
              <div className="w-full sm:w-auto sm:ml-auto">{endButton}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              
            </div>
          </div>
        </div>

        <div className="mt-10 space-y-8">
          <div className=" max-w-lg mx-auto rounded-[30px] border border-border/50 bg-card/50 px-4 py-6 shadow-xl sm:px-6">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex flex-wrap items-center gap-2 ">
                {modeMeta && (
                  <span className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/60 px-4 py-2 text-xs font-semibold uppercase tracking-[0.25em]">
                    <modeMeta.icon className="h-4 w-4" />
                    {modeMeta.label}
                  </span>
                )}
                <span className="inline-flex items-center gap-2 rounded-full border border-border/50 bg-card/60 px-4 py-2 text-sm text-muted-foreground">
                <Users className="h-4 w-4" />
                <span className="font-mono text-base text-foreground">{game.players.length}</span>
              </span>
              </div>
              {timerPills.length > 0 && (
                <div className="flex flex-wrap items-start gap-2 sm:justify-end">
                  {timerPills.map(({ label, value }) => (
                    <span
                      key={`board-timer-${label}`}
                      className="inline-flex items-center gap-3 rounded-full border border-border/50 bg-card/60 px-4 py-2"
                    >
                      <span className="text-xs uppercase tracking-[0.25em] text-muted-foreground">{label}</span>
                      <span className="font-mono text-sm tracking-[0.2em] text-foreground">{value}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-2 ">
              {boardRows.map((row, rowIndex) => (
                <div
                  key={rowIndex}
                  className="mx-auto grid w-full max-w-[min(92vw,420px)] gap-2 sm:gap-3"
                  style={{ gridTemplateColumns: `repeat(${game.wordLength}, minmax(0, 1fr))` }}
                >
                  {row.letters.map((letter, letterIndex) => {
                    const evaluation = row.evaluations[letterIndex] as GuessScore | null;
                    return (
                      <div
                        key={`${rowIndex}-${letterIndex}`}
                        className={cn(
                          'relative flex aspect-square items-center justify-center rounded-3xl border border-border/40 bg-background/80 text-2xl font-semibold uppercase tracking-wider transition-all duration-200',
                          evaluation && tileTone[evaluation],
                          row.state === 'active' && !evaluation && 'shadow-[inset_4px_4px_10px_rgba(0,0,0,0.35),inset_-4px_-4px_10px_rgba(255,255,255,0.08)]'
                        )}
                      >
                        {letter.trim()}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            {isPlayer && game.status === 'in_progress' && (
              <div className="mt-6 flex flex-wrap justify-center gap-2 ">
                {currentGuessPreview.split('').map((letter: string, index: number) => (
                  <div
                    key={`preview-${index}`}
                    className="h-12 w-12 rounded-2xl bg-background/40 text-center text-xl font-semibold uppercase leading-[3rem] text-foreground outline outline-1 outline-border/70"
                  >
                    {letter.trim()}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mx-auto max-w-xl rounded-[28px] border border-border/50 bg-card/60 p-5 shadow-xl sm:p-6">
            <div className="space-y-3">
              {keyboardRows.map((row) => (
                <div key={row} className="mx-auto flex w-full max-w-[340px] items-center justify-center gap-1.5 sm:max-w-[420px] sm:gap-2">
                  {row.split('').map((letter) => {
                    const hint = keyboardHints[letter];
                    return (
                      <button
                        key={letter}
                        type="button"
                        className={cn(
                          'h-11 w-9 flex-none rounded-2xl border border-border/40 bg-background/60 text-sm font-semibold uppercase shadow-sm transition-all hover:translate-y-[1px] sm:h-14 sm:w-12 sm:text-base',
                          hint ? keyboardTone[hint] : 'text-foreground'
                        )}
                        onClick={() => addLetter(letter)}
                        disabled={!isPlayer || game.status !== 'in_progress'}
                      >
                        {letter}
                      </button>
                    );
                  })}
                  {row === 'zxcvbnm' && (
                    <>
                      <button
                        type="button"
                        className="h-11 w-20 flex-none rounded-2xl border border-primary/40 bg-primary/80 text-sm font-semibold uppercase text-primary-foreground shadow-lg sm:h-14 sm:w-24"
                        onClick={() => void handleSubmit()}
                        disabled={!isPlayer || isSubmitting || game.status !== 'in_progress'}
                      >
                        Enter
                      </button>
                      <button
                        type="button"
                        className="h-11 w-14 flex-none rounded-2xl border border-border/50 bg-background/80 text-sm font-semibold uppercase sm:h-14 sm:w-16 sm:text-base"
                        onClick={removeLetter}
                        disabled={!isPlayer || game.status !== 'in_progress'}
                      >
                        Del
                      </button>
                    </>
                  )}
                </div>
              ))}
              <div className="flex justify-center">
                <Button
                  variant="ghost"
                  className="gap-2 rounded-2xl border border-border/40 bg-background/60 px-6 py-2"
                  onClick={() => setCurrentGuess('')}
                >
                  <RotateCcw className="h-4 w-4" /> Reset row
                </Button>
              </div>
            </div>
          </div>

          <div className="max-w-md mx-auto rounded-[26px] border border-border/50 bg-card/60 p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Players</p>
              <span className="text-xs text-muted-foreground">{game.players.length} total</span>
            </div>
            <ul className="mt-4 space-y-3">
              {game.players.map((playerId) => {
                const active = (game.activePlayers ?? []).includes(playerId);
                return (
                  <li
                    key={playerId}
                    className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/60 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-semibold">{playerId === userId ? 'You' : `Player ${playerId.slice(-4)}`}</p>
                      {!active && <p className="text-xs text-muted-foreground">Away</p>}
                    </div>
                    <span
                      className={cn(
                        'h-2.5 w-2.5 rounded-full',
                        active ? 'bg-emerald-500' : 'bg-muted-foreground'
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
                      className="flex items-center justify-between rounded-2xl border border-border/40 bg-background/50 px-4 py-2 text-sm"
                    >
                      <span>{spectatorId === userId ? 'You' : `Viewer ${spectatorId.slice(-4)}`}</span>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 px-4">
          <div className="w-full max-w-md rounded-[32px] border border-border/40 bg-card/90 p-8 text-center shadow-2xl">
            <p className="text-xs uppercase tracking-[0.4em] text-muted-foreground">Match complete</p>
            <h3 className="mt-2 text-3xl font-semibold">{resultHeading}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{game.completionMessage ?? 'Thanks for playing.'}</p>
            <div className="mt-6 flex flex-col gap-3">
              <Button size="lg" onClick={handleRematch} className="gap-2">
                <RefreshCcw className="h-4 w-4" /> Replay
              </Button>
              <Button variant="outline" size="lg" onClick={() => router.push('/')} className="gap-2">
                <Home className="h-4 w-4" /> Back to home
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
