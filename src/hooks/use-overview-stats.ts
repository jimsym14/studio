"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import { useEffect, useMemo, useState } from 'react';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';

import { useFirebase } from '@/components/firebase-provider';
import { usePlayerNames } from '@/hooks/use-player-names';
import type { GameDocument } from '@/types/game';

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const ACTIVE_QUERY_LIMIT = 200;
const ACTIVE_QUERY_WINDOW_MS = STALE_THRESHOLD_MS * 6; // ~1 hour of history
const COMPLETED_MONTH_LIMIT = 5000;

const sanitizeIds = (ids?: string[]) =>
  Array.from(new Set((ids ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)));

const parseIsoToMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const deriveWinningPlayers = (game: GameDocument) => {
  if (game.winnerId) {
    return sanitizeIds([game.winnerId]);
  }
  return [];
};

const countIds = (ids?: string[] | null) =>
  Array.isArray(ids) ? ids.filter((id): id is string => Boolean(id)).length : 0;

const hasWaitingOccupants = (lobby: GameDocument) => countIds(lobby.activePlayers) > 0 || countIds(lobby.players) > 0;

export type LeaderboardStat = {
  playerId: string | null;
  displayName: string;
  count: number;
};

export type OverviewStatsPayload = {
  activeLobbies: number;
  waitingRooms: number;
  privateRooms: number;
  playersOnline: number;
  wordsSolvedToday: number;
  userWordsSolvedToday: number | null;
  mostWordsToday: LeaderboardStat;
  monthlyLegend: LeaderboardStat;
};

const emptyLeaderboard: LeaderboardStat = { playerId: null, displayName: '-', count: 0 };

export const useOverviewStats = (playerId: string | null) => {
  const { db } = useFirebase();
  const [activeDocs, setActiveDocs] = useState<GameDocument[]>([]);
  const [completedDocs, setCompletedDocs] = useState<GameDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    if (!db) return;
    setLoading(true);
    setError(null);
    const recentCutoffIso = new Date(Date.now() - ACTIVE_QUERY_WINDOW_MS).toISOString();
    const activeQuery = query(
      collection(db, 'games'),
      where('lastActivityAt', '>=', recentCutoffIso),
      orderBy('lastActivityAt', 'desc'),
      limit(ACTIVE_QUERY_LIMIT)
    );
    const unsubscribe = onSnapshot(
      activeQuery,
      (snapshot) => {
        const records = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as GameDocument) }))
          .filter((game) => typeof game.lastActivityAt === 'string' && game.lastActivityAt.length > 0);
        setActiveDocs(records);
        setLoading(false);
      },
      (snapshotError) => {
        console.error('Active lobbies listener failed', snapshotError);
        setError('Unable to load live lobby stats');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    if (!db) return;
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthStartIso = monthStart.toISOString();
    const completedQuery = query(
      collection(db, 'games'),
      where('completedAt', '>=', monthStartIso),
      orderBy('completedAt', 'desc'),
      limit(COMPLETED_MONTH_LIMIT)
    );
    const unsubscribe = onSnapshot(
      completedQuery,
      (snapshot) => {
        const records = snapshot.docs
          .map((doc) => ({ id: doc.id, ...(doc.data() as GameDocument) }))
          .filter(
            (game) =>
              game.status === 'completed' && typeof game.completedAt === 'string' && game.completedAt.length > 0
          );
        setCompletedDocs(records);
      },
      (snapshotError) => {
        console.error('Completed games listener failed', snapshotError);
        setError('Unable to load leaderboard stats');
      }
    );
    return () => unsubscribe();
  }, [db]);

  useEffect(() => {
    setNowTick(Date.now());
  }, [activeDocs]);

  const activityCutoff = useMemo(() => nowTick - STALE_THRESHOLD_MS, [nowTick]);

  const liveActiveLobbies = useMemo(() => {
    return activeDocs.filter((lobby) => {
      const lastActivity = parseIsoToMs(lobby.lastActivityAt);
      return (
        lobby.gameType === 'multiplayer' &&
        ['waiting', 'in_progress'].includes(lobby.status ?? 'waiting') &&
        hasWaitingOccupants(lobby) &&
        typeof lastActivity === 'number' &&
        lastActivity >= activityCutoff
      );
    });
  }, [activeDocs, activityCutoff]);

  const waitingLobbies = useMemo(
    () => liveActiveLobbies.filter((lobby) => lobby.status === 'waiting'),
    [liveActiveLobbies]
  );

  const privateRooms = useMemo(
    () => waitingLobbies.filter((lobby) => (lobby.visibility ?? 'public') === 'private'),
    [waitingLobbies]
  );

  const playersOnline = useMemo(() => {
    const ids = new Set<string>();
    liveActiveLobbies.forEach((lobby) => {
      sanitizeIds(lobby.activePlayers).forEach((id) => ids.add(id));
    });
    return ids.size;
  }, [liveActiveLobbies]);

  const leaderboardCounts = useMemo(() => {
    const todayCounts: Record<string, number> = {};
    const monthCounts: Record<string, number> = {};
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    completedDocs.forEach((game) => {
      if (game.status !== 'completed' || !game.completedAt) return;
      const credited = deriveWinningPlayers(game);
      if (!credited.length) return;
      const isToday = game.completedAt >= todayStartIso;
      credited.forEach((player) => {
        monthCounts[player] = (monthCounts[player] ?? 0) + 1;
        if (isToday) {
          todayCounts[player] = (todayCounts[player] ?? 0) + 1;
        }
      });
    });

    const pickTop = (counts: Record<string, number>) => {
      const entries = Object.entries(counts);
      if (!entries.length) return null;
      entries.sort((a, b) => b[1] - a[1]);
      return { playerId: entries[0][0], count: entries[0][1] } as const;
    };

    return {
      topToday: pickTop(todayCounts),
      topMonth: pickTop(monthCounts),
      todayCounts,
      monthCounts,
    };
  }, [completedDocs]);

  const leaderIds = useMemo(() => {
    const ids = [] as string[];
    if (leaderboardCounts.topToday?.playerId) {
      ids.push(leaderboardCounts.topToday.playerId);
    }
    if (leaderboardCounts.topMonth?.playerId) {
      ids.push(leaderboardCounts.topMonth.playerId);
    }
    return Array.from(new Set(ids));
  }, [leaderboardCounts]);

  const { playerNames } = usePlayerNames({ db, playerIds: leaderIds });

  const stats = useMemo<OverviewStatsPayload>(() => {
    const formatLeader = (entry: { playerId: string; count: number } | null): LeaderboardStat => {
      if (!entry) return emptyLeaderboard;
      const displayName = playerNames[entry.playerId] ?? entry.playerId;
      return { playerId: entry.playerId, displayName, count: entry.count };
    };

    const todayCount = playerId ? leaderboardCounts.todayCounts[playerId] ?? 0 : null;

    return {
  activeLobbies: liveActiveLobbies.length,
      waitingRooms: waitingLobbies.length,
      privateRooms: privateRooms.length,
      playersOnline,
      wordsSolvedToday: Object.values(leaderboardCounts.todayCounts).reduce((sum, value) => sum + value, 0),
      userWordsSolvedToday: todayCount,
      mostWordsToday: formatLeader(leaderboardCounts.topToday ?? null),
      monthlyLegend: formatLeader(leaderboardCounts.topMonth ?? null),
    };
  }, [
  liveActiveLobbies,
    leaderboardCounts,
    playerNames,
    playerId,
    playersOnline,
    privateRooms.length,
    waitingLobbies.length,
  ]);

  return { stats, loading, error } as const;
};
