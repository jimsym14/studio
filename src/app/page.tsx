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

type GameType = 'solo' | 'multiplayer';

export default function Home() {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    gameType: GameType | null;
  }>({ isOpen: false, gameType: null });

  const [activeMode, setActiveMode] = useState<GameType>('solo');
  const [playersOnline, setPlayersOnline] = useState(() => 2200 + Math.floor(Math.random() * 400));

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
      title: 'Solo Sprint',
      subtitle: 'Daily calm grind',
      description:
        'Dial in your Wordle grind with selectable word sizes, personal speed runs, and leaderboard climbs every time you clutch a solve.',
      vibe: 'Zen focus + gentle pressure',
      gradient: 'linear-gradient(135deg, #E37924 0%, #FFB347 60%, #FFD9A0 100%)',
      icon: User,
      perks: ['Custom word sizes', 'Timed mode', 'Leaderboard ready'],
    },
    multiplayer: {
      title: 'Squad Clash',
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
    const interval = setInterval(() => {
      setPlayersOnline((prev) => {
        const delta = Math.floor(Math.random() * 60) - 30;
        const next = prev + delta;
        return Math.min(4200, Math.max(1500, next));
      });
    }, 4500);
    return () => clearInterval(interval);
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

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-start overflow-hidden px-4 pt-10 pb-12 sm:px-6">
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

      <div className="absolute top-4 right-4 z-20 flex items-center gap-3 rounded-full border border-border/60 bg-card/70 px-4 py-2 shadow-lg backdrop-blur">
        <LanguageToggle />
        <span className="h-4 w-px bg-border/70" />
        <ThemeToggle />
      </div>

      <div className="z-10 text-center">
        <Logo />
      </div>

      <motion.section
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 mt-10 w-full max-w-4xl overflow-hidden rounded-[36px] border border-[hsl(var(--hero-border))] bg-card/80 p-8 shadow-[0_40px_140px_rgba(0,0,0,0.25)] backdrop-blur-xl sm:p-10"
      >
        <div className="pointer-events-none absolute inset-0 rounded-[36px] border border-white/5" />
        <div className="pointer-events-none absolute -right-16 top-8 h-64 w-64 rounded-full blur-[140px] opacity-70" style={{ background: activeDetails.gradient }} />

        <div className="relative grid gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-8">
            <div className="text-left">
              <GreetingChanger />
              <p className="mt-4 text-base text-muted-foreground sm:text-lg">
                {activeDetails.description}
              </p>
            </div>
            <Separator className="border-border/70" />
            <div className="grid gap-4 rounded-3xl border border-border/60 bg-background/70 p-4 sm:grid-cols-2">
              {heroStats.map((stat) => (
                <div key={stat.label} className="rounded-2xl bg-card/70 p-4 shadow-inner">
                  <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{stat.label}</p>
                  <p className="mt-2 text-2xl font-black tracking-tight">{stat.value}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-4 rounded-3xl border border-border/60 bg-background/70 p-4 sm:grid-cols-2">
              {topFinders.map((finder) => (
                <div key={finder.label} className="rounded-2xl bg-card/80 p-4 shadow-inner">
                  <p className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">
                    <Crown className="h-4 w-4 text-amber-400" />
                    {finder.label}
                  </p>
                  <p className="mt-3 text-lg font-semibold">{finder.player}</p>
                  <p className="text-sm text-muted-foreground">{finder.count} words solved</p>
                </div>
              ))}
            </div>
            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-primary">{activeDetails.title}</p>
              <p className="mt-2 text-sm text-muted-foreground">{activeDetails.vibe}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {activeDetails.perks.map((perk) => (
                  <span key={perk} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em]">
                    {perk}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-5">
            <p className="text-center text-xs font-semibold uppercase tracking-[0.5em] text-muted-foreground">Modes</p>
            <div className="flex flex-col gap-5">
              {(Object.entries(modeConfig) as [GameType, (typeof modeConfig)['solo']][]).map(([type, config]) => {
                const Icon = config.icon;
                const isActive = activeMode === type;
                return (
                  <motion.button
                    key={type}
                    type="button"
                    onClick={() => handleOpenModal(type)}
                    onMouseEnter={() => setActiveMode(type)}
                    onFocus={() => setActiveMode(type)}
                    aria-pressed={isActive}
                    style={{ background: isActive ? config.gradient : undefined }}
                    className={`group relative w-full overflow-hidden rounded-[28px] border border-white/10 p-5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                      isActive ? 'text-white shadow-lg' : 'bg-card/70'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <span className="rounded-full bg-black/20 px-3 py-1 text-xs font-semibold uppercase tracking-[0.3em]">
                        {config.subtitle}
                      </span>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mt-4 text-2xl font-black uppercase tracking-[0.25em]">{config.title}</h3>
                    <p
                      className={`mt-2 text-sm leading-snug ${isActive ? 'text-white/80' : 'text-foreground/70'}`}
                    >
                      {config.description}
                    </p>
                    <div
                      className={`mt-4 flex items-center justify-between text-sm font-semibold uppercase tracking-[0.3em] ${
                        isActive ? 'text-white' : 'text-foreground/80'
                      }`}
                    >
                      <span>Play now</span>
                      <motion.span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-full ${
                          isActive ? 'bg-white/20 text-white' : 'bg-foreground/10 text-foreground'
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
