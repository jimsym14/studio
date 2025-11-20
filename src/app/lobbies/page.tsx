'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { Filter, Link2, Lock, Search, ShieldCheck } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useFirebase } from '@/components/firebase-provider';
import { cn } from '@/lib/utils';
import { usePlayerNames } from '@/hooks/use-player-names';
import type { GameDocument } from '@/types/game';
import { hashToHex } from '@/lib/hash-client';
import { readLobbyAccess, rememberLobbyAccess } from '@/lib/lobby-access';

type VisibilityFilter = 'all' | 'public' | 'private';
type ModeFilter = 'multiplayer' | 'pvp' | 'co-op' | 'all';

type LobbyMode = 'pvp' | 'co-op';

interface LobbyWithId extends GameDocument {
  id: string;
}

const STALE_THRESHOLD_MS = 10 * 60 * 1000;
const ACTIVE_QUERY_WINDOW_MS = STALE_THRESHOLD_MS * 6; // ~1 hour of history

const parseIsoToMs = (value?: string | null) => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const isLobbyFresh = (lobby: LobbyWithId, cutoffMs: number) => {
  const lastActivity = parseIsoToMs(lobby.lastActivityAt);
  return typeof lastActivity === 'number' && lastActivity >= cutoffMs;
};

const countIds = (ids?: string[] | null) =>
  Array.isArray(ids) ? ids.filter((id): id is string => Boolean(id)).length : 0;

const hasWaitingOccupants = (lobby: LobbyWithId) => {
  const activeCount = countIds(lobby.activePlayers);
  const rosterCount = countIds(lobby.players);
  return activeCount > 0 || rosterCount > 0;
};

const fallbackHostLabel = (creatorId?: string | null) => {
  if (!creatorId) return 'Unknown player';
  if (/^guest/i.test(creatorId)) {
    return creatorId.replace(/^guest[-_:]*/i, 'Guest ');
  }
  if (creatorId.length > 12) {
    return `Player ${creatorId.slice(0, 6)}`;
  }
  return creatorId;
};

const deriveLobbyMode = (lobby: GameDocument): LobbyMode => (lobby.multiplayerMode === 'co-op' ? 'co-op' : 'pvp');

const modePillStyles: Record<LobbyMode, string> = {
  'pvp': 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-200',
  'co-op': 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200',
};

export default function LobbyBrowserPage() {
  const router = useRouter();
  const { db } = useFirebase();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [lobbies, setLobbies] = useState<LobbyWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>('all');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('multiplayer');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedPrivateId, setExpandedPrivateId] = useState<string | null>(null);
  const [passcodeDrafts, setPasscodeDrafts] = useState<Record<string, string>>({});
  const [passcodeErrors, setPasscodeErrors] = useState<Record<string, string | null>>({});
  const [unlockingLobbyId, setUnlockingLobbyId] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!db) return;
    const recentCutoffIso = new Date(Date.now() - ACTIVE_QUERY_WINDOW_MS).toISOString();
    const lobbyQuery = query(
      collection(db, 'games'),
      where('lastActivityAt', '>=', recentCutoffIso),
      orderBy('lastActivityAt', 'desc'),
      limit(200)
    );
    const unsubscribe = onSnapshot(lobbyQuery, (snapshot) => {
      const nextLobbies = snapshot.docs
        .map((doc) => ({ id: doc.id, ...(doc.data() as GameDocument) }))
        .filter((game) => typeof game.lastActivityAt === 'string' && game.lastActivityAt.length > 0);
      setLobbies(nextLobbies);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [db]);

  const activityCutoff = nowMs - STALE_THRESHOLD_MS;

  const waitingLobbies = useMemo(
    () => lobbies.filter((lobby) => lobby.status === 'waiting'),
    [lobbies]
  );

  const visibleWaitingLobbies = useMemo(
    () => waitingLobbies.filter(hasWaitingOccupants),
    [waitingLobbies]
  );

  const staleLobbyIds = useMemo(() => {
    return new Set(
      visibleWaitingLobbies.filter((lobby) => !isLobbyFresh(lobby, activityCutoff)).map((lobby) => lobby.id)
    );
  }, [visibleWaitingLobbies, activityCutoff]);

  const creatorIds = useMemo(() => visibleWaitingLobbies.map((lobby) => lobby.creatorId), [visibleWaitingLobbies]);
  const { playerNames, getPlayerName } = usePlayerNames({ db, playerIds: creatorIds });

  const normalizedSearch = searchTerm.trim().toLowerCase();

  const prioritizedLobbies = useMemo(() => {
    return [...visibleWaitingLobbies].sort((a, b) => {
      const aMs = parseIsoToMs(a.lastActivityAt) ?? 0;
      const bMs = parseIsoToMs(b.lastActivityAt) ?? 0;
      return bMs - aMs;
    });
  }, [visibleWaitingLobbies]);

  const resolveHostSearchName = useCallback(
    (lobby: LobbyWithId) => {
      const candidates = [
        lobby.creatorDisplayName,
        lobby.playerAliases?.[lobby.creatorId],
        playerNames[lobby.creatorId],
        lobby.creatorId,
      ];
      for (const value of candidates) {
        if (typeof value === 'string' && value.trim().length) {
          return value.toLowerCase();
        }
      }
      return '';
    },
    [playerNames]
  );

  const filteredLobbies = useMemo(() => {
    return prioritizedLobbies.filter((lobby) => {
      const visibility = lobby.visibility ?? 'public';
      if (visibilityFilter !== 'all' && visibility !== visibilityFilter) {
        return false;
      }
      const lobbyMode = deriveLobbyMode(lobby);
      if (modeFilter === 'multiplayer' && lobby.gameType !== 'multiplayer') {
        return false;
      }
      if (modeFilter !== 'all' && modeFilter !== 'multiplayer' && lobbyMode !== modeFilter) {
        return false;
      }
      if (normalizedSearch) {
        const hostName = resolveHostSearchName(lobby);
        if (!hostName.includes(normalizedSearch)) {
          return false;
        }
      }
      return true;
    });
  }, [prioritizedLobbies, visibilityFilter, modeFilter, normalizedSearch, resolveHostSearchName]);

  const hasCachedAccess = (lobby: LobbyWithId) => {
    if (!lobby.passcodeHash) return false;
    const cachedHash = readLobbyAccess(lobby.id);
    return Boolean(cachedHash && cachedHash === lobby.passcodeHash);
  };

  const handleLobbyClick = (lobby: LobbyWithId) => {
    const visibility = lobby.visibility ?? 'public';
    if (visibility === 'private') {
      if (hasCachedAccess(lobby)) {
        router.push(`/lobby/${lobby.id}`);
        return;
      }
      setExpandedPrivateId((current) => (current === lobby.id ? null : lobby.id));
      setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: null }));
      return;
    }
    router.push(`/lobby/${lobby.id}`);
  };

  const handlePasscodeChange = (lobbyId: string, value: string) => {
    setPasscodeDrafts((prev) => ({ ...prev, [lobbyId]: value }));
    setPasscodeErrors((prev) => ({ ...prev, [lobbyId]: null }));
  };

  const submitPrivatePasscode = async (lobby: LobbyWithId) => {
    const rawPasscode = passcodeDrafts[lobby.id]?.trim() ?? '';
    if (!rawPasscode) {
      setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: 'Enter the passcode.' }));
      return;
    }
    if (!lobby.passcodeHash) {
      setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: 'This lobby no longer accepts a passcode.' }));
      return;
    }

    setUnlockingLobbyId(lobby.id);
    try {
      const hashed = await hashToHex(rawPasscode);
      if (hashed !== lobby.passcodeHash) {
        setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: 'Incorrect passcode.' }));
        return;
      }
      rememberLobbyAccess(lobby.id, hashed);
      setPasscodeDrafts((prev) => ({ ...prev, [lobby.id]: '' }));
      setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: null }));
      setExpandedPrivateId(null);
      router.push(`/lobby/${lobby.id}`);
    } catch (error) {
      console.error('Failed to unlock lobby', error);
      setPasscodeErrors((prev) => ({ ...prev, [lobby.id]: 'Something went wrong. Please try again.' }));
    } finally {
      setUnlockingLobbyId(null);
    }
  };

  const totalActive = lobbies.filter((lobby) => isLobbyFresh(lobby, activityCutoff)).length;
  const totalWaiting = visibleWaitingLobbies.length;
  const totalPrivate = visibleWaitingLobbies.filter((lobby) => (lobby.visibility ?? 'public') === 'private').length;
  const showLoadingState = loading && !lobbies.length;

  const overviewMetrics = [
    {
      label: 'Active lobbies',
      value: totalActive.toString().padStart(2, '0'),
      note: 'Live right now',
    },
    {
      label: 'Waiting rooms',
      value: totalWaiting.toString().padStart(2, '0'),
      note: 'Ready for players',
    },
    {
      label: 'Private rooms',
      value: totalPrivate.toString().padStart(2, '0'),
      note: 'Locked squads',
    },
  ];

  const renderFilterButton = <ValueType extends string>(
    label: string,
    value: ValueType,
    activeValue: ValueType,
    onSelect: (next: ValueType) => void,
  ) => (
    <Button
      type="button"
      variant={value === activeValue ? 'default' : 'outline'}
      onClick={() => onSelect(value)}
      className={cn(
        'rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] transition',
        value === activeValue
          ? 'bg-gradient-to-r from-[#ff7a18] to-[#ffb347] text-slate-900'
          : 'border-slate-300 bg-transparent text-muted-foreground dark:border-white/20 dark:text-white/70'
      )}
    >
      {label}
    </Button>
  );

  return (
    <div
      className={cn(
        'min-h-screen w-full bg-gradient-to-b from-[#04050a] via-[#0a0f1f] to-[#04050a] px-4 py-10 text-white sm:px-8',
        !isDark && 'from-[#f8fbff] via-[#f1f4ff] to-white text-slate-900'
      )}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <header
          className={cn(
            'space-y-6 rounded-[32px] border p-6 shadow-[0_30px_80px_rgba(0,0,0,0.2)] backdrop-blur-2xl',
            isDark
              ? 'border-white/10 bg-white/10 text-white'
              : 'border-slate-200 bg-white/85 text-slate-900 shadow-[0_30px_80px_rgba(15,23,42,0.1)]'
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black uppercase tracking-[0.25em] sm:text-4xl">Lobby browser</h1>
            </div>
            <div className="flex gap-3">
              <Button
                variant="secondary"
                className={cn(
                  'rounded-full border px-6 py-3 text-xs font-semibold uppercase tracking-[0.4em]',
                  isDark ? 'border-white/30 text-white hover:bg-white/10' : 'border-slate-300 text-slate-700 hover:bg-slate-50'
                )}
                onClick={() => router.push('/')}
              >
                Home
              </Button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {overviewMetrics.map((metric) => (
              <div
                key={metric.label}
                className={cn(
                  'rounded-2xl border p-4 text-sm',
                  isDark ? 'border-white/15 bg-white/10' : 'border-slate-200 bg-white'
                )}
              >
                <p
                  className={cn(
                    'text-[0.55rem] uppercase tracking-[0.5em]',
                    isDark ? 'text-white/60' : 'text-slate-500'
                  )}
                >
                  {metric.label}
                </p>
                <p className="mt-2 text-3xl font-black">{metric.value}</p>
                <p className={cn('text-xs', isDark ? 'text-white/70' : 'text-slate-500')}>{metric.note}</p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_1fr]">
          <section
            className={cn(
              'relative space-y-6 rounded-[28px] border p-6 pb-12 shadow-[0_30px_60px_rgba(0,0,0,0.2)] backdrop-blur-md lg:self-start',
              'overflow-hidden',
              isDark ? 'border-white/10 bg-white/10 text-white' : 'border-slate-200 bg-white text-slate-900'
            )}
          >
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.5em]">
                  <Filter className={cn('h-4 w-4', isDark ? 'text-white/60' : 'text-slate-500')} />
                  <span className={cn(isDark ? 'text-white/70' : 'text-slate-500')}>Visibility</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {renderFilterButton('All', 'all', visibilityFilter, setVisibilityFilter)}
                  {renderFilterButton('Public', 'public', visibilityFilter, setVisibilityFilter)}
                  {renderFilterButton('Private', 'private', visibilityFilter, setVisibilityFilter)}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.5em]">
                  <ShieldCheck className={cn('h-4 w-4', isDark ? 'text-white/60' : 'text-slate-500')} />
                  <span className={cn(isDark ? 'text-white/70' : 'text-slate-500')}>Mode</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {renderFilterButton('Multiplayer', 'multiplayer', modeFilter, setModeFilter)}
                  {renderFilterButton('PvP', 'pvp', modeFilter, setModeFilter)}
                  {renderFilterButton('Co-op', 'co-op', modeFilter, setModeFilter)}
                  {renderFilterButton('All', 'all', modeFilter, setModeFilter)}
                </div>
              </div>
            </div>
            <div
              className={cn(
                'pointer-events-none absolute inset-x-0 bottom-0 hidden h-16 bg-gradient-to-b lg:block',
                isDark ? 'from-transparent to-white/10' : 'from-transparent to-slate-100'
              )}
            />
          </section>

          <section
            className={cn(
              'space-y-5 rounded-[28px] border p-6 shadow-[0_30px_60px_rgba(0,0,0,0.2)] backdrop-blur-md',
              isDark ? 'border-white/10 bg-white/10 text-white' : 'border-slate-200 bg-white text-slate-900'
            )}
          >
            <div className="flex flex-wrap items-center gap-4">
              <div className="relative min-w-[220px] flex-1">
                <Search
                  className={cn(
                    'pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2',
                    isDark ? 'text-white/50' : 'text-slate-500'
                  )}
                />
                <Input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search host usernames"
                  className={cn(
                    'w-full rounded-2xl border pl-10 text-base',
                    isDark
                      ? 'border-white/20 bg-white/5 text-white placeholder:text-white/40'
                      : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
                  )}
                />
              </div>
              <p className={cn('text-xs uppercase tracking-[0.4em]', isDark ? 'text-white/60' : 'text-slate-500')}>
                {filteredLobbies.length} lobbies match
              </p>
            </div>

            <div className="space-y-3">
              {showLoadingState ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className={cn(
                        'h-16 animate-pulse rounded-2xl',
                        isDark ? 'bg-white/5' : 'bg-slate-100'
                      )}
                    />
                  ))}
                </div>
              ) : filteredLobbies.length === 0 ? (
                <div
                  className={cn(
                    'rounded-2xl border p-6 text-center',
                    isDark ? 'border-white/15 bg-white/5 text-white/80' : 'border-slate-200 bg-slate-50 text-slate-600'
                  )}
                >
                  <p className="text-sm">No lobbies match. Try switching filters or hosting one.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {filteredLobbies.map((lobby) => {
                    const visibility = lobby.visibility ?? 'public';
                    const isPrivateLobby = visibility === 'private';
                    const lobbyMode = deriveLobbyMode(lobby);
                    const hostName =
                      lobby.creatorDisplayName?.trim() ||
                      lobby.playerAliases?.[lobby.creatorId]?.trim() ||
                      getPlayerName(lobby.creatorId) ||
                      fallbackHostLabel(lobby.creatorId);
                    const playersCount = lobby.players?.length ?? 0;
                    const activeCount = lobby.activePlayers?.length ?? 0;
                    const isExpanded = expandedPrivateId === lobby.id;
                    const isStale = staleLobbyIds.has(lobby.id);

                    const containerClasses = cn(
                      'rounded-2xl border px-4 py-3 shadow-[0_12px_25px_rgba(0,0,0,0.15)] focus-within:ring-2 focus-within:ring-offset-2 transition',
                      isPrivateLobby
                        ? 'border-violet-400/40 bg-gradient-to-r from-[#12051b] to-[#241233] text-white focus-within:ring-violet-300 focus-within:ring-offset-transparent'
                        : 'border-slate-200 bg-white text-slate-900 hover:border-emerald-300 focus-within:ring-emerald-400 focus-within:ring-offset-white dark:border-white/10 dark:bg-white/5 dark:text-white'
                    );

                    return (
                      <li key={lobby.id}>
                        <motion.div layout className={containerClasses}>
                          <div
                            role="button"
                            tabIndex={0}
                            className="flex flex-wrap items-center justify-between gap-4 outline-none"
                            onClick={() => handleLobbyClick(lobby)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                handleLobbyClick(lobby);
                              }
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-base font-semibold">{hostName}</p>
                              <div className="mt-1 flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.3em]">
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold',
                                    isPrivateLobby
                                      ? 'bg-white/20 text-white'
                                      : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-100'
                                  )}
                                >
                                  {isPrivateLobby ? 'Private' : 'Public'}
                                </span>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold',
                                    modePillStyles[lobbyMode]
                                  )}
                                >
                                  {lobbyMode === 'co-op' ? 'Co-op' : 'PvP'}
                                </span>
                                {isStale && (
                                  <span
                                    className={cn(
                                      'rounded-full px-2 py-0.5 text-[0.65rem] font-semibold',
                                      isPrivateLobby
                                        ? 'bg-white/15 text-white/80'
                                        : 'bg-amber-100 text-amber-700 dark:bg-amber-400/20 dark:text-amber-100'
                                    )}
                                  >
                                    Idle 10m+
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="text-right text-xs">
                              <p className="text-sm font-bold">
                                {playersCount}{' '}
                                <span className={cn(isDark ? 'text-white/60' : 'text-slate-500')}>players</span>
                              </p>
                              <p className={cn('text-[0.65rem] uppercase tracking-[0.3em]', isDark ? 'text-white/60' : 'text-slate-500')}>
                                {activeCount} active
                              </p>
                              <div className="mt-1 flex items-center justify-end gap-1 text-[0.65rem] uppercase tracking-[0.3em]">
                                {isPrivateLobby ? (
                                  <>
                                    <Lock className="h-3 w-3" />
                                    Hidden
                                  </>
                                ) : (
                                  <>
                                    <Link2 className="h-3 w-3" />
                                    {lobby.id.toUpperCase()}
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <AnimatePresence initial={false}>
                            {isPrivateLobby && isExpanded && (
                              <motion.div
                                key="passcode"
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="mt-3 space-y-2"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Input
                                    autoFocus
                                    value={passcodeDrafts[lobby.id] ?? ''}
                                    onChange={(event) => handlePasscodeChange(lobby.id, event.target.value)}
                                    placeholder="Enter passcode"
                                    disabled={unlockingLobbyId === lobby.id}
                                    className={cn(
                                      'flex-1 border px-3 py-2 text-sm',
                                      isDark
                                        ? 'border-white/20 bg-white/10 text-white placeholder:text-white/40'
                                        : 'border-slate-200 bg-white text-slate-900 placeholder:text-slate-400'
                                    )}
                                  />
                                  <Button
                                    type="button"
                                    onClick={() => submitPrivatePasscode(lobby)}
                                    disabled={unlockingLobbyId === lobby.id}
                                    className="whitespace-nowrap rounded-xl px-5 text-xs font-semibold uppercase tracking-[0.3em]"
                                  >
                                    {unlockingLobbyId === lobby.id ? 'Checking…' : 'Unlock lobby'}
                                  </Button>
                                </div>
                                {passcodeErrors[lobby.id] && (
                                  <p className="text-xs text-rose-400">{passcodeErrors[lobby.id]}</p>
                                )}
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>
        </div>
      </div>

    </div>
  );
}
