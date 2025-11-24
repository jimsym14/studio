'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { ArrowLeft, Trophy, Target, TrendingUp, Gamepad2, Crown, Swords, Handshake, Calendar } from 'lucide-react';
import { motion } from 'framer-motion';

import { useFirebase } from '@/components/firebase-provider';
import { useGameHistory, type GameHistoryEntry } from '@/hooks/use-game-history';
import { usePlayerNames } from '@/hooks/use-player-names';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
};

const getModeIcon = (game: GameHistoryEntry) => {
    if (game.gameType === 'solo') return Crown;
    if (game.multiplayerMode === 'co-op') return Handshake;
    return Swords;
};

const getModeLabel = (game: GameHistoryEntry) => {
    if (game.gameType === 'solo') return 'Solo';
    if (game.multiplayerMode === 'co-op') return 'Co-op';
    return 'PvP';
};

export default function StatisticsPage() {
    const router = useRouter();
    const { resolvedTheme } = useTheme();
    const { db, userId, profile } = useFirebase();
    const { games, loading } = useGameHistory(db, userId);

    const isLightMode = resolvedTheme === 'light';

    // Get all unique player IDs for name resolution
    const allPlayerIds = useMemo(() => {
        const ids = new Set<string>();
        games.forEach((game) => {
            game.players.forEach((playerId) => ids.add(playerId));
            if (game.winnerId) ids.add(game.winnerId);
        });
        return Array.from(ids);
    }, [games]);

    const { getPlayerName } = usePlayerNames({ db, playerIds: allPlayerIds });

    // Calculate statistics
    const stats = useMemo(() => {
        const totalGames = games.length;
        const wins = games.filter((g) => g.result === 'win').length;
        const losses = games.filter((g) => g.result === 'loss').length;
        const draws = games.filter((g) => g.result === 'draw').length;

        const soloGames = games.filter((g) => g.gameType === 'solo').length;
        const pvpGames = games.filter((g) => g.gameType === 'multiplayer' && g.multiplayerMode === 'pvp').length;
        const coopGames = games.filter((g) => g.gameType === 'multiplayer' && g.multiplayerMode === 'co-op').length;

        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

        // Calculate current streak
        let currentStreak = 0;
        for (const game of games) {
            if (game.result === 'win') {
                currentStreak++;
            } else {
                break;
            }
        }

        return {
            totalGames,
            wins,
            losses,
            draws,
            winRate,
            soloGames,
            pvpGames,
            coopGames,
            currentStreak,
        };
    }, [games]);

    const resolvePlayerName = (playerId: string) => {
        if (playerId === userId) return profile?.username ?? 'You';
        return getPlayerName(playerId) ?? 'Player';
    };

    return (
        <div
            className={cn(
                'relative min-h-screen overflow-x-hidden px-3 py-8 sm:px-8 sm:py-10',
                isLightMode
                    ? 'bg-gradient-to-br from-slate-50 via-emerald-50/30 to-blue-50'
                    : 'bg-[#04050a] text-white'
            )}
        >
            {/* Background blobs */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div
                    className={cn(
                        'absolute -left-20 top-20 h-96 w-96 rounded-full blur-3xl',
                        isLightMode ? 'bg-emerald-200/40' : 'bg-emerald-500/20'
                    )}
                />
                <div
                    className={cn(
                        'absolute -right-20 bottom-20 h-96 w-96 rounded-full blur-3xl',
                        isLightMode ? 'bg-blue-200/40' : 'bg-blue-500/20'
                    )}
                />
            </div>

            <div className="relative z-10 mx-auto max-w-7xl">
                {/* Header */}
                <div className="mb-8 flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => router.push('/')}
                        className={cn(
                            'h-12 w-12 rounded-2xl border backdrop-blur-xl transition-colors',
                            isLightMode
                                ? 'border-white/60 bg-white/60 hover:bg-white/80'
                                : 'border-white/15 bg-white/10 hover:bg-white/20'
                        )}
                    >
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1
                            className={cn(
                                'text-3xl font-black uppercase tracking-tight sm:text-4xl',
                                isLightMode ? 'text-slate-900' : 'text-white'
                            )}
                        >
                            Statistics
                        </h1>
                        <p className={cn('text-sm', isLightMode ? 'text-slate-600' : 'text-white/60')}>
                            Your game history and performance
                        </p>
                    </div>
                </div>

                {/* Stats Grid */}
                <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard
                        icon={Gamepad2}
                        label="Total Games"
                        value={stats.totalGames}
                        isLight={isLightMode}
                    />
                    <StatCard
                        icon={Trophy}
                        label="Win Rate"
                        value={`${stats.winRate}%`}
                        isLight={isLightMode}
                    />
                    <StatCard
                        icon={TrendingUp}
                        label="Current Streak"
                        value={stats.currentStreak}
                        isLight={isLightMode}
                    />
                    <StatCard
                        icon={Target}
                        label="Total Wins"
                        value={stats.wins}
                        isLight={isLightMode}
                    />
                </div>

                {/* Mode Breakdown */}
                <div className="mb-8 grid gap-4 sm:grid-cols-3">
                    <ModeCard
                        icon={Crown}
                        label="Solo Games"
                        value={stats.soloGames}
                        color="amber"
                        isLight={isLightMode}
                    />
                    <ModeCard
                        icon={Swords}
                        label="PvP Games"
                        value={stats.pvpGames}
                        color="red"
                        isLight={isLightMode}
                    />
                    <ModeCard
                        icon={Handshake}
                        label="Co-op Games"
                        value={stats.coopGames}
                        color="green"
                        isLight={isLightMode}
                    />
                </div>

                {/* Game History */}
                <div
                    className={cn(
                        'overflow-hidden rounded-3xl border backdrop-blur-2xl',
                        isLightMode
                            ? 'border-white/60 bg-white/60 shadow-xl'
                            : 'border-white/15 bg-white/10 shadow-[0_20px_70px_rgba(0,0,0,0.5)]'
                    )}
                >
                    <div className={cn('border-b px-6 py-4', isLightMode ? 'border-slate-200' : 'border-white/10')}>
                        <h2
                            className={cn(
                                'flex items-center gap-2 text-lg font-bold uppercase tracking-wide',
                                isLightMode ? 'text-slate-900' : 'text-white'
                            )}
                        >
                            <Calendar className="h-5 w-5" />
                            Game History
                        </h2>
                    </div>

                    <div className="max-h-[600px] overflow-y-auto custom-scrollbar">
                        {loading ? (
                            <div className="flex items-center justify-center py-20">
                                <div className="text-center">
                                    <div className="mb-4 inline-block h-8 w-8 animate-spin rounded-full border-4 border-current border-t-transparent opacity-50" />
                                    <p className={cn('text-sm', isLightMode ? 'text-slate-600' : 'text-white/60')}>
                                        Loading games...
                                    </p>
                                </div>
                            </div>
                        ) : games.length === 0 ? (
                            <div className="py-20 text-center">
                                <p className={cn('text-sm', isLightMode ? 'text-slate-600' : 'text-white/60')}>
                                    No games played yet
                                </p>
                            </div>
                        ) : (
                            <div className="divide-y divide-opacity-10" style={{ borderColor: isLightMode ? 'rgb(226, 232, 240)' : 'rgba(255, 255, 255, 0.1)' }}>
                                {games.map((game, index) => {
                                    const ModeIcon = getModeIcon(game);
                                    const opponent = game.players.find((p) => p !== userId);
                                    const opponentName = opponent ? resolvePlayerName(opponent) : null;

                                    return (
                                        <motion.div
                                            key={game.id}
                                            initial={{ opacity: 0, y: 20 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ delay: index * 0.02 }}
                                            className={cn(
                                                'grid grid-cols-[auto_1fr_auto] items-center gap-4 px-6 py-4 transition-colors sm:grid-cols-[auto_1fr_auto_auto_auto]',
                                                isLightMode ? 'hover:bg-slate-100/50' : 'hover:bg-white/5'
                                            )}
                                        >
                                            {/* Mode Icon */}
                                            <div
                                                className={cn(
                                                    'flex h-10 w-10 items-center justify-center rounded-xl',
                                                    isLightMode ? 'bg-slate-200/60' : 'bg-white/10'
                                                )}
                                            >
                                                <ModeIcon className="h-5 w-5" />
                                            </div>

                                            {/* Game Info */}
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn('font-semibold', isLightMode ? 'text-slate-900' : 'text-white')}>
                                                        {getModeLabel(game)}
                                                    </span>
                                                    {opponentName && (
                                                        <>
                                                            <span className={cn('text-xs', isLightMode ? 'text-slate-500' : 'text-white/40')}>
                                                                vs
                                                            </span>
                                                            <span className={cn('text-sm', isLightMode ? 'text-slate-700' : 'text-white/70')}>
                                                                {opponentName}
                                                            </span>
                                                        </>
                                                    )}
                                                </div>
                                                <p className={cn('text-xs', isLightMode ? 'text-slate-500' : 'text-white/50')}>
                                                    {formatDate(game.completedAt)}
                                                </p>
                                            </div>

                                            {/* Result Badge */}
                                            <div className="hidden sm:block">
                                                <span
                                                    className={cn(
                                                        'inline-block rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider',
                                                        game.result === 'win' &&
                                                        (isLightMode
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-emerald-500/20 text-emerald-300'),
                                                        game.result === 'loss' &&
                                                        (isLightMode ? 'bg-red-100 text-red-700' : 'bg-red-500/20 text-red-300'),
                                                        game.result === 'draw' &&
                                                        (isLightMode ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-white/70')
                                                    )}
                                                >
                                                    {game.result}
                                                </span>
                                            </div>

                                            {/* Guesses */}
                                            <div className="hidden sm:block text-right">
                                                <p className={cn('text-sm font-semibold', isLightMode ? 'text-slate-700' : 'text-white/80')}>
                                                    {Array.isArray(game.guesses) ? game.guesses.length : 0} guesses
                                                </p>
                                            </div>

                                            {/* Mobile Result */}
                                            <div className="block sm:hidden">
                                                <span
                                                    className={cn(
                                                        'inline-block rounded-full px-2.5 py-1 text-xs font-bold uppercase',
                                                        game.result === 'win' &&
                                                        (isLightMode
                                                            ? 'bg-emerald-100 text-emerald-700'
                                                            : 'bg-emerald-500/20 text-emerald-300'),
                                                        game.result === 'loss' &&
                                                        (isLightMode ? 'bg-red-100 text-red-700' : 'bg-red-500/20 text-red-300'),
                                                        game.result === 'draw' &&
                                                        (isLightMode ? 'bg-slate-100 text-slate-700' : 'bg-white/10 text-white/70')
                                                    )}
                                                >
                                                    {game.result}
                                                </span>
                                            </div>
                                        </motion.div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 8px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: ${isLightMode ? 'rgba(226, 232, 240, 0.3)' : 'rgba(255, 255, 255, 0.05)'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${isLightMode ? 'rgba(148, 163, 184, 0.5)' : 'rgba(255, 255, 255, 0.2)'};
          border-radius: 10px;
          transition: background 0.2s;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${isLightMode ? 'rgba(100, 116, 139, 0.7)' : 'rgba(255, 255, 255, 0.3)'};
        }
      `}</style>
        </div>
    );
}

type StatCardProps = {
    icon: React.ElementType;
    label: string;
    value: number | string;
    isLight: boolean;
};

function StatCard({ icon: Icon, label, value, isLight }: StatCardProps) {
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
                'overflow-hidden rounded-2xl border p-6 backdrop-blur-2xl transition-transform hover:scale-[1.02]',
                isLight
                    ? 'border-white/60 bg-white/60 shadow-lg'
                    : 'border-white/15 bg-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
            )}
        >
            <div className="mb-2 flex items-center justify-between">
                <Icon className={cn('h-6 w-6', isLight ? 'text-slate-700' : 'text-white/80')} />
            </div>
            <div className={cn('text-3xl font-black', isLight ? 'text-slate-900' : 'text-white')}>{value}</div>
            <div className={cn('mt-1 text-xs font-semibold uppercase tracking-wider', isLight ? 'text-slate-600' : 'text-white/60')}>
                {label}
            </div>
        </motion.div>
    );
}

type ModeCardProps = {
    icon: React.ElementType;
    label: string;
    value: number;
    color: 'amber' | 'red' | 'green';
    isLight: boolean;
};

function ModeCard({ icon: Icon, label, value, color, isLight }: ModeCardProps) {
    const colorClasses = {
        amber: isLight ? 'from-amber-400/20 to-orange-400/20' : 'from-amber-500/20 to-orange-500/20',
        red: isLight ? 'from-red-400/20 to-pink-400/20' : 'from-red-500/20 to-pink-500/20',
        green: isLight ? 'from-emerald-400/20 to-green-400/20' : 'from-emerald-500/20 to-green-500/20',
    };

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
                'overflow-hidden rounded-2xl border p-6 backdrop-blur-2xl',
                `bg-gradient-to-br ${colorClasses[color]}`,
                isLight ? 'border-white/60 shadow-lg' : 'border-white/15 shadow-[0_8px_32px_rgba(0,0,0,0.3)]'
            )}
        >
            <Icon className={cn('mb-3 h-8 w-8', isLight ? 'text-slate-700' : 'text-white/90')} />
            <div className={cn('text-3xl font-black', isLight ? 'text-slate-900' : 'text-white')}>{value}</div>
            <div className={cn('mt-1 text-xs font-semibold uppercase tracking-wider', isLight ? 'text-slate-600' : 'text-white/70')}>
                {label}
            </div>
        </motion.div>
    );
}
