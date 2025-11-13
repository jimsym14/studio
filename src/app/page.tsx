'use client';

import { useState } from 'react';
import { User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsModal } from '@/components/settings-modal';

type GameType = 'solo' | 'multiplayer';

export default function Home() {
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    gameType: GameType | null;
  }>({ isOpen: false, gameType: null });

  const handleOpenModal = (type: GameType) => {
    setModalState({ isOpen: true, gameType: type });
  };

  const buttonStyle =
    'h-24 text-2xl font-bold border-4 border-foreground/50 shadow-[8px_8px_0px_hsl(var(--primary))] hover:shadow-[10px_10px_0px_hsl(var(--primary))] active:shadow-[4px_4px_0px_hsl(var(--primary))] transition-all duration-200 ease-in-out transform active:translate-x-1 active:translate-y-1';

  return (
    <div className="relative flex flex-col items-center justify-center min-h-screen p-4 overflow-hidden">
      <div className="absolute top-4 right-4 flex items-center gap-4">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center"
      >
        <Logo />
        <p className="mt-2 text-lg text-muted-foreground max-w-md mx-auto">
          A real-time, social multiplayer word-guessing game.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-16 grid grid-cols-1 sm:grid-cols-2 gap-8 w-full max-w-lg"
      >
        <Button
          className={buttonStyle}
          onClick={() => handleOpenModal('solo')}
          aria-label="Start Singleplayer Game"
        >
          <User className="w-8 h-8 mr-4" />
          Solo
        </Button>
        <Button
          className={buttonStyle}
          onClick={() => handleOpenModal('multiplayer')}
          aria-label="Start Multiplayer Game"
        >
          <Users className="w-8 h-8 mr-4" />
          Multiplayer
        </Button>
      </motion.div>

      <SettingsModal
        isOpen={modalState.isOpen}
        gameType={modalState.gameType}
        onClose={() => setModalState({ isOpen: false, gameType: null })}
      />
    </div>
  );
}
