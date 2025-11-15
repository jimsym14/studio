'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { doc, onSnapshot, updateDoc, arrayUnion, runTransaction } from 'firebase/firestore';
import { Copy, Check, Crown, Handshake, Swords } from 'lucide-react';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/skeleton';
import type { GameDocument } from '@/types/game';

const LOBBY_GRACE_MINUTES = 3;
const INACTIVITY_MINUTES = 30;

const addMinutesIso = (iso: string, minutes: number | null) => {
  if (!minutes) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
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

const ModeBadge = ({ game }: { game: GameDocument | null }) => {
  if (!game) return null;
  let label = 'Solo';
  let Icon = Crown;
  if (game.gameType === 'multiplayer' && game.multiplayerMode === 'co-op') {
    label = 'Co-op';
    Icon = Handshake;
  } else if (game.gameType === 'multiplayer' && game.multiplayerMode !== 'co-op') {
    label = 'PvP';
    Icon = Swords;
  }
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-4 py-1 text-xs font-semibold uppercase tracking-wide">
      <Icon className="h-4 w-4" />
      {label}
    </span>
  );
};

const TimerChip = ({ label, value }: { label: string; value: string | null }) => {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      <span>{label}</span>
      <span className="font-mono text-sm text-foreground">{value}</span>
    </span>
  );
};

const abbreviateId = (value: string) => {
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}...${value.slice(-3)}`;
};

export default function LobbyPage() {
  const params = useParams();
  const router = useRouter();
  const { db, userId } = useFirebase();
  const { toast } = useToast();

  const [game, setGame] = useState<GameDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCopied, setIsCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const lobbyCloseAlertedRef = useRef(false);
  const inactivityAlertedRef = useRef(false);

  const gameId = params.gameId as string;

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const isLobbyPlayer = Boolean(userId && game?.players?.includes(userId));

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
      if (docSnap.exists()) {
        const gameData = docSnap.data() as GameDocument;
        setGame(gameData);

        const players = gameData.players ?? [];
        const isPlayer = Boolean(players.find((playerId) => playerId === userId));

        if (!isPlayer && gameData.status === 'waiting' && players.length < 2) {
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
          players.length === 2 &&
          (gameData.activePlayers?.length ?? 0) === 2 &&
          gameData.status === 'waiting'
        ) {
          try {
            await updateDoc(gameRef, {
              status: 'in_progress',
            });
            toast({ title: 'Players ready', description: 'Starting match...' });
          } catch (error) {
            console.error('Failed to start match from lobby', error);
          }
        }

        if (gameData.status === 'in_progress') {
          router.push(`/game/${gameId}`);
        }
        setLoading(false);
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Game not found.',
        });
        router.push('/');
      }
    });

    return () => unsubscribe();
  }, [gameId, userId, router, toast, db]);

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
      toast({
        variant: 'destructive',
        title: 'Lobby closed',
        description: 'Nobody reconnected during the grace period.',
      });
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
        description: 'Closing after extended inactivity. Create a new lobby to play again.',
      });
      router.push('/');
    }
  }, [game?.inactivityClosesAt, now, router, toast]);

  const inviteLink = typeof window === 'undefined' ? '' : window.location.href;

  const copyToClipboard = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      toast({ variant: 'destructive', title: 'Clipboard unavailable', description: 'Your browser blocked clipboard access.' });
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteLink);
      setIsCopied(true);
      toast({ title: 'Copied to clipboard!' });
      window.setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy invite link', error);
      toast({ variant: 'destructive', title: 'Copy failed', description: 'Try copying the link manually.' });
    }
  };

  if (loading) {
    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
            <Card className="w-full max-w-md animate-pulse">
                <CardHeader className="text-center">
                    <Skeleton className="h-8 w-48 mx-auto" />
                    <Skeleton className="h-4 w-64 mx-auto mt-2" />
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="text-center space-y-2">
                        <Skeleton className="h-6 w-32 mx-auto" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                    <div className="text-center text-sm text-muted-foreground space-y-2">
                        <Skeleton className="h-4 w-16 mx-auto" />
                        <Skeleton className="h-8 w-24 mx-auto" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
  }

  const playersList = game?.players ?? [];
  const activePlayersList = game?.activePlayers ?? [];
  const totalPlayers = playersList.length;
  const activePlayersCount = activePlayersList.length;
  const waitingForPlayers = game?.status === 'waiting';
  const lobbyCountdown = formatDuration(game?.lobbyClosesAt ?? null, now);
  const inactivityCountdown = formatDuration(game?.inactivityClosesAt ?? null, now);
  const matchCountdown = formatDuration(game?.matchDeadline ?? null, now);
  const turnCountdown = formatDuration(game?.turnDeadline ?? null, now);
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
    if (game?.status === 'in_progress') {
      return 'Match starting...';
    }
    return 'Both players connected. Starting soon!';
  })();

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4">
      <div className="absolute top-8">
        <Logo />
      </div>
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="space-y-4">
          <CardTitle className="text-3xl">Lobby</CardTitle>
          <CardDescription>
            {waitingForPlayers
              ? 'Share the link below. The match will launch when both players are connected.'
              : 'Match is loading...'}
          </CardDescription>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <ModeBadge game={game} />
            <TimerChip label="Match" value={matchCountdown} />
            <TimerChip label="Turn" value={turnCountdown} />
            <TimerChip label="Idle close" value={inactivityCountdown} />
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs font-semibold uppercase text-muted-foreground">
            <span className="rounded-full border border-border/50 px-3 py-1">
              Players {totalPlayers}/2
            </span>
            <span className="rounded-full border border-border/50 px-3 py-1">
              Connected {activePlayersCount}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-6 text-left">
          {lobbyCountdown && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              Connection lost. Lobby closing in <span className="font-semibold">{lobbyCountdown}</span> unless someone reconnects.
            </div>
          )}
          <div>
            <p className="mb-2 text-sm font-medium text-muted-foreground">Share this link to invite others:</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:space-x-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="w-full rounded-md border bg-muted px-3 py-2 text-sm text-muted-foreground"
              />
              <Button className="shrink-0" onClick={copyToClipboard} variant={isCopied ? 'secondary' : 'default'}>
                {isCopied ? (
                  <span className="inline-flex items-center gap-2">
                    <Check className="h-4 w-4" /> Copied
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <Copy className="h-4 w-4" /> Copy link
                  </span>
                )}
              </Button>
            </div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/30 px-4 py-3">
            <p className="text-sm font-semibold text-muted-foreground">Lobby status</p>
            <p className="mt-1 text-sm text-foreground">{statusText}</p>
            {waitingForPlayers && (
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
                <div className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <span>Starts automatically when everyone is ready.</span>
              </div>
            )}
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-muted-foreground">Players in lobby</p>
            <div className="space-y-3">
              {playersList.length ? (
                playersList.map((playerId, index) => {
                  const isConnected = Boolean(activePlayersList.includes(playerId));
                  return (
                    <div key={playerId} className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2">
                      <div>
                        <p className="text-sm font-semibold">
                          Player {index + 1} {playerId === userId ? '(You)' : ''}
                        </p>
                        <p className="text-xs text-muted-foreground">{abbreviateId(playerId)}</p>
                      </div>
                      <span
                        className={
                          isConnected
                            ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300'
                            : 'rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-200'
                        }
                      >
                        {isConnected ? 'Connected' : 'Reconnecting'}
                      </span>
                    </div>
                  );
                })
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
                  Waiting for players to join...
                </p>
              )}
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Need a moment? You have {INACTIVITY_MINUTES} minutes of idle time before the lobby fully closes.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
