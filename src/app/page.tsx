'use client';

import { useState } from 'react';
import { User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsModal } from '@/components/settings-modal';
import GreetingChanger from '@/components/greeting-changer';
import { Separator } from '@/components/ui/separator';
import { MagicButton } from '@/components/magic-button'; // Import the new MagicButton

type GameType = 'solo' | 'multiplayer';

export default function Home() {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    gameType: GameType | null;
  }>({ isOpen: false, gameType: null });

  const handleOpenModal = (type: GameType) => {
    setModalState({ isOpen: true, gameType: type });
  };

  const iconStyle = 'w-8 h-8';

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

      <div className="relative z-10 mt-10 w-full max-w-xl rounded-[32px] border border-[hsl(var(--hero-border))] bg-card/80 p-8 shadow-[0_35px_120px_rgba(0,0,0,0.15)] backdrop-blur">
        <div className="pointer-events-none absolute inset-0 rounded-[32px] border border-white/5" />
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <GreetingChanger />
          <Separator className="mt-6 w-2/3 mx-auto border-border/70" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.01 }}
          className="mt-10 flex flex-col items-center justify-center gap-6 sm:gap-8"
        >
          <MagicButton
            onClick={() => handleOpenModal('solo')}
            aria-label="Start Singleplayer Game"
            className="w-full max-w-sm"
          >
            <User className={iconStyle} />
            <span className="text-2xl font-semibold tracking-[0.45em] uppercase">Solo</span>
          </MagicButton>
          <MagicButton
            onClick={() => handleOpenModal('multiplayer')}
            aria-label="Start Multiplayer Game"
            className="w-full max-w-sm"
          >
            <Users className={iconStyle} />
            <span className="text-2xl font-black uppercase tracking-[0.25em]">Multiplayer</span>
          </MagicButton>
        </motion.div>
      </div>

      <SettingsModal
        isOpen={modalState.isOpen}
        gameType={modalState.gameType}
        onClose={() => setModalState({ isOpen: false, gameType: null })}
      />
    </div>
  );
}
