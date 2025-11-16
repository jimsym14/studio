'use client';

import { useEffect, useMemo, useState } from 'react';
import { Crown, User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsModal } from '@/components/settings-modal';
import GreetingChanger from '@/components/greeting-changer';
import { Separator } from '@/components/ui/separator';
import { useIsMobile } from '@/hooks/use-mobile';
import { UserMenu } from '@/components/user-menu';
import { useFirebase } from '@/components/firebase-provider';
import { isGuestProfile } from '@/types/user';

type GameType = 'solo' | 'multiplayer';

export default function Home() {
  const { profile, user } = useFirebase();
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    gameType: GameType | null;
  }>({ isOpen: false, gameType: null });

  const [activeMode, setActiveMode] = useState<GameType>('solo');
  const [playersOnline, setPlayersOnline] = useState(2600);
  const isMobile = useIsMobile();
  const guest = profile ? isGuestProfile(profile) : false;
  const signedIn = Boolean(user);
  const statusLabel = signedIn ? (guest ? 'Guest mode' : 'Signed in') : 'Not signed in';
  const displayName = profile?.username ?? user?.displayName ?? (signedIn ? 'Player' : 'WordMates');

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
      subtitle: 'Party-ready chaos',
      description:
        'Jump into co-op boards or PvP bouts with customizable turn timers, match clocks, and word sizes that keep every round wild.',
      vibe: 'Arcade energy + team hype',
      gradient: 'linear-gradient(140deg, #658F41 0%, #76B66B 55%, #55A05E 100%)',
      icon: Users,
      perks: ['Co-op & PvP', 'Custom timers', 'Word size control'],
    },
  };

  useEffect(() => {
    const clamp = (value: number) => Math.min(4200, Math.max(1500, value));

    const seedTimeout = window.setTimeout(() => {
      setPlayersOnline(clamp(2200 + Math.floor(Math.random() * 400)));
    }, 0);

    const interval = window.setInterval(() => {
      setPlayersOnline((prev) => {
        const delta = Math.floor(Math.random() * 60) - 30;
        return clamp(prev + delta);
      });
    }, 4500);

    return () => {
      window.clearTimeout(seedTimeout);
      window.clearInterval(interval);
    };
  }, []);

  const heroStats = useMemo(
    () => ([
      { label: 'Players online', value: playersOnline.toLocaleString('en-US') },
      { label: 'Streaks saved today', value: '486' },
    ]),
    [playersOnline]
  );

  const topFinders = useMemo(
    () => ([
      { label: 'Most words today', player: 'LexiNova', count: 43 },
      { label: 'Monthly legend', player: 'GridOracle', count: 612 },
    ]),
    []
  );

  const handleOpenModal = (type: GameType) => {
    setModalState({ isOpen: true, gameType: type });
    setActiveMode(type);
  };

  const activeDetails = modeConfig[activeMode];

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
            className={`mode-card group relative w-full overflow-hidden rounded-[28px] border p-5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
              isVisuallyActive
                ? 'border-white/70 text-white shadow-[0_30px_90px_rgba(0,0,0,0.25)]'
                : 'neu-card text-foreground dark:bg-card/70 dark:text-foreground/90'
            }`}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em] text-foreground/80 dark:bg-black/20 dark:text-white/80">
                {config.subtitle}
              </span>
            </div>
            <h3 className="mt-4 flex items-center gap-3 text-2xl font-black uppercase tracking-[0.25em]">
              <Icon className="h-6 w-6" />
              {config.title}
            </h3>
            <div
              className={`play-pill mt-4 flex items-center justify-between rounded-full border px-4 py-2 text-sm font-semibold uppercase tracking-[0.3em] ${
                isVisuallyActive
                  ? 'border-white/70 bg-white/10 text-white'
                  : 'border-foreground/15 bg-white/70 text-foreground/80 dark:border-foreground/30 dark:bg-foreground/10'
              }`}
            >
              <span className="relative z-10">Play now</span>
              <motion.span
                className={`relative z-10 inline-flex h-8 w-8 items-center justify-center rounded-full ${
                  isActive ? 'bg-white/20 text-white' : 'bg-foreground/5 text-foreground'
                }`}
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
          style={{
            background:
              'radial-gradient(circle, hsl(var(--primary) / 0.55) 0%, hsl(var(--hero-glow-soft) / 0.9) 45%, hsl(var(--hero-glow-strong) / 0.08) 75%)',
          }}
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
        className="neu-shell relative z-10 mt-8 w-full max-w-4xl overflow-hidden rounded-[32px] p-5 backdrop-blur-xl sm:mt-10 sm:rounded-[36px] sm:p-10"
      >
        <div className="pointer-events-none absolute inset-0 rounded-[36px] border border-white/5" />
        <div className="pointer-events-none absolute -right-16 top-8 h-64 w-64 rounded-full blur-[140px] opacity-70" style={{ background: activeDetails.gradient }} />

        <div className="relative z-10 mb-6 w-full lg:hidden">
          <GreetingChanger />
        </div>

        <div className="relative z-10 mb-1 w-full sm:mb-1">
          <div className="flex w-full items-center gap-3 rounded-[28px] border border-white/15 bg-black/25 px-4 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] backdrop-blur-xl sm:gap-5">
            <div className="flex flex-1 items-center gap-3">
              <UserMenu variant="icon" className="h-11 w-11 shrink-0" />
              <div className="min-w-0">
                <p className="text-[0.55rem] uppercase tracking-[0.4em] text-white/60">{statusLabel}</p>
                <p className="truncate text-base font-semibold text-white sm:text-lg" title={displayName}>
                  {displayName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3">
              <LanguageToggle variant="icon" className="h-10 w-10 border-white/25 bg-transparent text-white" />
              <ThemeToggle className="h-10 w-10 rounded-full border border-white/25 bg-transparent text-white" />
            </div>
          </div>
        </div>

        <div className="relative grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:gap-10">
          <div className="space-y-8">
            <div className="hidden text-left lg:block">
              <GreetingChanger />
            </div>
            <div className="lg:hidden rounded-[32px] neu-card p-4">
              <p className="text-center text-xs font-semibold uppercase tracking-[0.5em] text-muted-foreground">Modes</p>
              <div className="mt-4">{modesList}</div>
            </div>
            <Separator className="border-border/70" />
            <div className="grid gap-4 rounded-3xl neu-card p-4 sm:grid-cols-2">
              {heroStats.map((stat) => (
                <div key={stat.label} className="rounded-2xl neu-card sunset-card p-4">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black tracking-tight">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 rounded-3xl neu-card p-4 sm:grid-cols-2">
              {topFinders.map((finder) => (
                <div key={finder.label} className="rounded-2xl neu-card sunset-card p-4">
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
            <p className="text-center text-xs font-semibold uppercase tracking-[0.5em] text-muted-foreground">Modes</p>
            {modesList}
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
