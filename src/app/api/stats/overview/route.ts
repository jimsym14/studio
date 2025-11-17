import { NextResponse } from 'next/server';

import { adminDb } from '@/lib/firebase-admin';
import type { GameDocument } from '@/types/game';

export const dynamic = 'force-dynamic';

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const ACTIVE_QUERY_LIMIT = 400;
const COMPLETED_MONTH_LIMIT = 5000;

interface LobbyRecord extends GameDocument {
  id: string;
}

interface LeaderboardEntry {
  playerId: string | null;
  displayName: string;
  count: number;
}

const parseIsoToMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isLobbyFresh = (lobby: LobbyRecord, cutoffMs: number) => {
  const lastActivity = parseIsoToMs(lobby.lastActivityAt);
  return typeof lastActivity === 'number' && lastActivity >= cutoffMs;
};

const getActivePlayerIds = (lobby: LobbyRecord) => sanitizeIds(lobby.activePlayers);

const hasWaitingOccupants = (lobby: LobbyRecord) => getActivePlayerIds(lobby).length > 0;

const fallbackPlayerLabel = (playerId?: string | null) => {
  if (!playerId) return 'Unknown player';
  if (/^guest/i.test(playerId)) {
    return playerId.replace(/^guest[-_:]*/i, 'Guest ');
  }
  if (playerId.length > 12) {
    return `Player ${playerId.slice(0, 6)}`;
  }
  return playerId;
};

const sanitizeIds = (ids?: string[]) =>
  Array.from(new Set((ids ?? []).filter((value): value is string => typeof value === 'string' && value.length > 0)));

const deriveWinningPlayers = (game: LobbyRecord): string[] => {
  if (game.winnerId) {
    return sanitizeIds([game.winnerId]);
  }
  return [];
};

const pickTop = (counts: Record<string, number>) => {
  const entries = Object.entries(counts);
  if (!entries.length) {
    return null;
  }
  entries.sort((a, b) => b[1] - a[1]);
  const [playerId, count] = entries[0];
  return { playerId, count } as const;
};

const formatLeader = (
  entry: { playerId: string; count: number } | null,
  nameLookup: Record<string, string>
): LeaderboardEntry => {
  if (!entry || entry.count <= 1) {
    return { playerId: null, displayName: '-', count: entry?.count ?? 0 };
  }
  return {
    playerId: entry.playerId,
    displayName: nameLookup[entry.playerId] ?? '-',
    count: entry.count,
  };
};

export async function GET() {
  try {
    const now = Date.now();
    const activeCutoffIso = new Date(now - STALE_THRESHOLD_MS).toISOString();
    const nowDate = new Date();
    const monthStart = new Date(Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), 1, 0, 0, 0, 0));
    const monthStartIso = monthStart.toISOString();
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayStartIso = todayStart.toISOString();

    const [activeSnapshot, completedSnapshot] = await Promise.all([
      adminDb
        .collection('games')
        .where('lastActivityAt', '>=', activeCutoffIso)
        .orderBy('lastActivityAt', 'desc')
        .limit(ACTIVE_QUERY_LIMIT)
        .get(),
      adminDb
        .collection('games')
        .where('completedAt', '>=', monthStartIso)
        .orderBy('completedAt', 'desc')
        .limit(COMPLETED_MONTH_LIMIT)
        .get(),
    ]);

    const activeDocs: LobbyRecord[] = activeSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...(doc.data() as GameDocument),
    }));

    const activeLobbies = activeDocs.filter(
      (lobby) =>
        lobby.gameType === 'multiplayer' &&
        ['waiting', 'in_progress'].includes(lobby.status) &&
        isLobbyFresh(lobby, now - STALE_THRESHOLD_MS) &&
        hasWaitingOccupants(lobby)
    );
    const waitingLobbies = activeLobbies.filter((lobby) => lobby.status === 'waiting');
    const privateRooms = waitingLobbies.filter((lobby) => (lobby.visibility ?? 'public') === 'private');

    const playersOnline = new Set<string>();
    activeLobbies.forEach((lobby) => {
      getActivePlayerIds(lobby).forEach((playerId) => playersOnline.add(playerId));
    });

    const monthDocs: LobbyRecord[] = completedSnapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as GameDocument),
      }))
      .filter((game) => game.status === 'completed');

    let wordsSolvedToday = 0;
    const todayCounts: Record<string, number> = {};
    const monthCounts: Record<string, number> = {};

    monthDocs.forEach((game) => {
      const completedAt = game.completedAt;
      if (!completedAt) return;
      const creditedPlayers = deriveWinningPlayers(game);
      if (!creditedPlayers.length) {
        return;
      }
      const isToday = completedAt >= todayStartIso;
      if (isToday) {
        wordsSolvedToday += 1;
      }
      creditedPlayers.forEach((playerId: string) => {
        if (!playerId) return;
        monthCounts[playerId] = (monthCounts[playerId] ?? 0) + 1;
        if (isToday) {
          todayCounts[playerId] = (todayCounts[playerId] ?? 0) + 1;
        }
      });
    });

    const topToday = pickTop(todayCounts);
    const topMonth = pickTop(monthCounts);

    const leaderIds = Array.from(
      new Set(
        [topToday?.playerId, topMonth?.playerId].filter(
          (value): value is string => typeof value === 'string' && value.length > 0
        )
      )
    );

    const nameLookup: Record<string, string> = {};
    if (leaderIds.length) {
      await Promise.all(
        leaderIds.map(async (uid) => {
          try {
            const snapshot = await adminDb.collection('profiles').doc(uid).get();
            const data = snapshot.data() as { username?: string } | undefined;
            if (data?.username) {
              nameLookup[uid] = data.username;
            }
          } catch (error) {
            console.error('Failed to load profile for leaderboard user', uid, error);
          }
        })
      );
    }

    return NextResponse.json(
      {
        activeLobbies: activeLobbies.length,
        waitingRooms: waitingLobbies.length,
        privateRooms: privateRooms.length,
        playersOnline: playersOnline.size,
        wordsSolvedToday,
        mostWordsToday: formatLeader(topToday, nameLookup),
        monthlyLegend: formatLeader(topMonth, nameLookup),
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('Failed to load stats overview', error);
    return NextResponse.json({ error: 'Unable to load stats overview' }, { status: 500 });
  }
}
