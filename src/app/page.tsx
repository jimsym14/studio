'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { Compass, Crown, User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsModal } from '@/components/settings-modal';
import GreetingChanger from '@/components/greeting-changer';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { UserMenu } from '@/components/user-menu';
import { useFirebase } from '@/components/firebase-provider';
import { isGuestProfile } from '@/types/user';
import { cn } from '@/lib/utils';

type GameType = 'solo' | 'multiplayer';

type LeaderboardStat = {
  playerId: string | null;
  displayName: string;
  count: number;
};

type OverviewStatsPayload = {
  activeLobbies: number;
  waitingRooms: number;
  privateRooms: number;
  playersOnline: number;
  wordsSolvedToday: number;
  mostWordsToday: LeaderboardStat;
  monthlyLegend: LeaderboardStat;
};

export default function Home() {
  const router = useRouter();
  const { profile, user } = useFirebase();
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    gameType: GameType | null;
  }>({ isOpen: false, gameType: null });

  const [activeMode, setActiveMode] = useState<GameType>('solo');
  const [overviewStats, setOverviewStats] = useState<OverviewStatsPayload | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  const guest = profile ? isGuestProfile(profile) : false;
  const signedIn = Boolean(user);
  const statusLabel = signedIn ? (guest ? 'Guest mode' : 'Signed in') : 'Not signed in';
  const displayName = profile?.username ?? user?.displayName ?? (signedIn ? 'Player' : 'WordMates');
  const { resolvedTheme } = useTheme();
  const isLightMode = resolvedTheme === 'light';
  const heroGlowDark = 'radial-gradient(circle, hsl(var(--primary) / 0.55) 0%, hsl(var(--hero-glow-soft) / 0.9) 45%, hsl(var(--hero-glow-strong) / 0.08) 75%)';
  const heroGlowLight = 'radial-gradient(circle, rgba(255, 143, 53, 0.8) 0%, rgba(255, 193, 134, 0.78) 40%, rgba(255, 175, 110, 0.35) 65%, rgba(255, 160, 96, 0.12) 80%)';
  const heroGlowBackground = isLightMode ? heroGlowLight : heroGlowDark;

  const modeConfig: Record<
    GameType,
    {
      title: string;
      subtitle: string;
      description: string;
      vibe: string;
      gradient: string;
      icon: typeof User;
      perks: string[];
    }
  > = {
    solo: {
      title: 'Solo',
      subtitle: 'Daily calm grind',
      description:
        'Dial in your Wordle grind with selectable word sizes, personal speed runs, and leaderboard climbs every time you clutch a solve.',
      vibe: 'Zen focus + gentle pressure',
      gradient: 'linear-gradient(135deg, #E37924 0%, #FFB347 60%, #FFD9A0 100%)',
      icon: User,
      perks: ['Custom word sizes', 'Timed mode', 'Leaderboard ready'],
    },
    multiplayer: {
      title: 'Multiplayer',
      subtitle: 'PvP & Co-op',
      description:
        'Jump into co-op boards or PvP bouts with customizable turn timers, match clocks, and word sizes that keep every round wild.',
      vibe: 'Arcade energy + team hype',
      gradient: 'linear-gradient(140deg, #658F41 0%, #76B66B 55%, #55A05E 100%)',
      icon: Users,
      perks: ['Co-op & PvP', 'Custom timers', 'Word size control'],
    },
  };

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats/overview', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Stats request failed with ${response.status}`);
        }
        const payload = (await response.json()) as OverviewStatsPayload;
        if (!cancelled) {
          setOverviewStats(payload);
          setStatsError(null);
        }
      } catch (error) {
        console.error('Failed to fetch overview stats', error);
        if (!cancelled) {
          setStatsError('Δεν μπορέσαμε να συγχρονίσουμε τα live stats.');
        }
      }
    };

    fetchStats();
    const interval = window.setInterval(fetchStats, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const heroStats = useMemo(
    () => ([
      {
        label: 'Players online',
        value:
          overviewStats?.playersOnline != null
            ? overviewStats.playersOnline.toLocaleString('en-US')
            : '—',
      },
      {
        label: 'Words solved today',
        value:
          overviewStats?.wordsSolvedToday != null
            ? overviewStats.wordsSolvedToday.toLocaleString('en-US')
            : '—',
      },
    ]),
    [overviewStats]
  );

  const topFinders = useMemo(
    () => ([
      {
        label: 'Most words today',
        player: overviewStats?.mostWordsToday?.displayName ?? 'No data yet',
        count: overviewStats?.mostWordsToday?.count ?? 0,
      },
      {
        label: 'Monthly legend',
        player: overviewStats?.monthlyLegend?.displayName ?? 'No data yet',
        count: overviewStats?.monthlyLegend?.count ?? 0,
      },
    ]),
    [overviewStats]
  );

  const handleOpenModal = (type: GameType) => {
    setModalState({ isOpen: true, gameType: type });
    setActiveMode(type);
  };

  const handleBrowseLobbies = () => {
    router.push('/lobbies');
  };

  const activeDetails = modeConfig[activeMode];

  const browseLobbiesButton = (
    <Button
      type="button"
      onClick={handleBrowseLobbies}
      className={cn(
        'group flex w-full items-center justify-center gap-3 rounded-[26px] border px-5 py-3 text-[0.7rem] font-semibold uppercase tracking-[0.2em] shadow-[0_18px_45px_rgba(0,0,0,0.18)] sm:px-6 sm:py-4 sm:text-xs sm:tracking-[0.4em]',
        isLightMode
          ? 'border-slate-200 bg-gradient-to-r from-[#ff8f3f] to-[#ffb347] text-slate-900'
          : 'border-white/20 bg-white/10 text-white'
      )}
    >
      <Compass className="h-4 w-4" /> Browse lobbies
    </Button>
  );

  const modesList = (
    <div className="flex flex-col gap-4 sm:gap-5">
      {(Object.entries(modeConfig) as [GameType, (typeof modeConfig)['solo']][]).map(([type, config]) => {
        const Icon = config.icon;
        const isActive = activeMode === type;
        const isVisuallyActive = isMobile || isActive;
        return (
          <motion.button
            key={type}
            type="button"
            onClick={() => handleOpenModal(type)}
            onMouseEnter={() => setActiveMode(type)}
            onFocus={() => setActiveMode(type)}
            aria-pressed={isActive}
            style={{ background: isVisuallyActive ? config.gradient : undefined }}
            className={cn(
              'mode-card group relative w-full overflow-hidden rounded-[28px] border p-5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isVisuallyActive
                ? 'border-white/70 text-white shadow-[0_30px_90px_rgba(0,0,0,0.25)]'
                : 'neu-card text-foreground dark:bg-card/70 dark:text-foreground/90'
            )}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-foreground/80 dark:bg-black/20 dark:text-white/80 sm:tracking-[0.3em]">
                {config.subtitle}
              </span>
            </div>
            <h3 className="mt-4 flex items-center gap-3 text-2xl font-black uppercase tracking-[0.15em] sm:tracking-[0.25em]">
              <Icon className="h-6 w-6" />
              {config.title}
            </h3>
            <div
              className={cn(
                'play-pill mt-4 flex items-center justify-between rounded-full border px-4 py-2 text-[0.65rem] font-semibold uppercase tracking-[0.2em] shadow-sm transition-colors sm:text-sm sm:tracking-[0.3em]',
                isVisuallyActive
                  ? 'border-white/70 bg-white/10 text-white'
                  : isLightMode
                    ? 'border-white/70 bg-gradient-to-r from-white/95 via-white/80 to-white/65 text-slate-900/80 shadow-[0_18px_45px_rgba(15,23,42,0.12)]'
                    : 'border-foreground/30 bg-foreground/10 text-foreground/80'
              )}
            >
              <span className="relative z-10">Play now</span>
              <motion.span
                className={cn(
                  'relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent transition-colors',
                  isActive
                    ? 'bg-white/20 text-white'
                    : isLightMode
                      ? 'border-white/80 bg-white text-slate-900 shadow-[0_8px_20px_rgba(15,23,42,0.18)]'
                      : 'bg-foreground/5 text-foreground'
                )}
                animate={{ x: isActive ? 6 : 0 }}
              >
                →
              </motion.span>
            </div>
          </motion.button>
        );
      })}
    </div>
  );

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-start overflow-hidden px-4 pt-10 pb-12 sm:px-6 sm:pt-12">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div
          className="absolute left-1/2 top-24 h-[520px] w-[520px] -translate-x-1/2 rounded-full blur-[140px]"
          style={{ background: heroGlowBackground }}
        />
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-background via-background/70 to-transparent" />
      </div>

      <div className="z-10 text-center">
        <Logo />
      </div>

      <motion.section
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className={cn(
          'neu-shell relative z-10 mt-8 w-full max-w-4xl overflow-hidden rounded-[32px] p-5 backdrop-blur-xl sm:mt-10 sm:rounded-[36px] sm:p-10',
          isLightMode ? ' text-slate-900 transition-[background] duration-700 ease-out' : 'text-white'
        )}
      >
        <div className="pointer-events-none absolute inset-0 rounded-[36px] border border-white/5" />
        <div className="pointer-events-none absolute -right-16 top-8 h-64 w-64 rounded-full blur-[140px] opacity-70" style={{ background: activeDetails.gradient }} />

        <div className="relative z-10 mb-6 w-full lg:hidden">
          <GreetingChanger />
        </div>

        <div className="relative z-10 mb-1 w-full sm:mb-1">
          <div
            className={cn(
              'flex w-full items-center gap-3 rounded-[28px] px-4 py-3 text-sm transition-colors duration-300 sm:gap-5 backdrop-blur-xl',
              isLightMode
                ? 'glass-panel-strong text-slate-900'
                : 'border border-white/15 bg-black/25 text-white shadow-[inset_6px_6px_18px_rgba(0,0,0,0.5),inset_-4px_-4px_12px_rgba(255,255,255,0.05)]'
            )}
          >
            <div className="flex flex-1 items-center gap-3">
              <UserMenu variant="icon" className="h-11 w-11 shrink-0" />
              <div className="min-w-0">
                <p
                  className={cn(
                    'text-[0.55rem] uppercase tracking-[0.4em]',
                    isLightMode ? 'text-slate-600' : 'text-white/60'
                  )}
                >
                  {statusLabel}
                </p>
                <p
                  className={cn(
                    'truncate text-base font-semibold sm:text-lg',
                    isLightMode ? 'text-slate-900' : 'text-white'
                  )}
                  title={displayName}
                >
                  {displayName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <LanguageToggle
                variant="icon"
                className={cn(
                  'h-10 w-10 border bg-transparent',
                  isLightMode ? 'border-slate/60 bg-white/60 text-slate-900' : 'border-white/25 text-white'
                )}
              />
              <ThemeToggle
                className={cn(
                  'h-10 w-10 rounded-full border',
                  isLightMode ? 'border-slate/60 bg-white/60 text-slate-900' : 'border-white/25 text-white'
                )}
              />
            </div>
          </div>
        </div>

        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
          <div className="space-y-8">
            <div className="hidden text-left lg:block">
              <GreetingChanger />
            </div>
            <div
              className={cn(
                'lg:hidden rounded-[32px] p-4',
                isLightMode ? 'glass-panel-soft text-slate-900' : 'neu-card'
              )}
            >
              <p className="text-center text-xs font-semibold uppercase tracking-[0.5em] text-muted-foreground">Modes</p>
              <div className="mt-4 space-y-4">
                {modesList}
                {browseLobbiesButton}
              </div>
            </div>
            <Separator className="border-border/70" />
            <div
              className={cn(
                'grid gap-4 rounded-3xl p-4 sm:grid-cols-2',
                isLightMode ? 'glass-panel-soft' : 'neu-card'
              )}
            >
              {heroStats.map((stat) => (
                <div
                  key={stat.label}
                  className={cn(
                    'rounded-2xl p-4',
                    isLightMode ? 'glass-panel-soft text-slate-900' : 'neu-card sunset-card'
                  )}
                >
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black tracking-tight">{stat.value}</p>
                </div>
              ))}
            </div>
            {statsError && (
              <p className="text-center text-xs text-rose-400">{statsError}</p>
            )}
            <div
              className={cn(
                'grid gap-4 rounded-3xl p-4 sm:grid-cols-2',
                isLightMode ? 'glass-panel-soft' : 'neu-card'
              )}
            >
              {topFinders.map((finder) => (
                <div
                  key={finder.label}
                  className={cn(
                    'rounded-2xl p-4',
                    isLightMode ? 'glass-panel-soft text-slate-900' : 'neu-card sunset-card'
                  )}
                >
                  <p className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    <Crown className="h-4 w-4 text-amber-400" />
                    {finder.label}
                  </p>
                  <p className="mt-3 text-lg font-semibold">{finder.player}</p>
                  <p className="text-sm text-muted-foreground">{finder.count} words solved</p>
                </div>
              ))}
            </div>
          </div>

          <div className="hidden space-y-5 lg:block">
            <p
              className={cn(
                'text-center text-xs font-semibold uppercase tracking-[0.5em] text-muted-foreground',
                isMobile ? '' : 'mt-8'
              )}
            >
              Modes
            </p>
            {modesList}
            <div className="pt-2">{browseLobbiesButton}</div>
          </div>
        </div>
      </motion.section>

      <SettingsModal
        isOpen={modalState.isOpen}
        gameType={modalState.gameType}
        onClose={() => setModalState({ isOpen: false, gameType: null })}
      />
    </div>
  );
}
