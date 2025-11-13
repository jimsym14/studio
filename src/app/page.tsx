'use client';

import { useState } from 'react';
import { User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { SettingsModal } from '@/components/settings-modal';
import { GreetingChanger } from '@/components/greeting-changer';

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
    'h-24 text-xl font-semibold';

  return (
    <div className="relative flex flex-col items-center justify-start min-h-screen p-4 pt-20 overflow-hidden">
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
        <GreetingChanger />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="mt-24 grid grid-cols-1 sm:grid-cols-2 gap-8 w-full max-w-lg"
      >
        <Button
          className={buttonStyle}
          onClick={() => handleOpenModal('solo')}
          aria-label="Start Singleplayer Game"
        >
          <User className="w-6 h-6 mr-3" />
          Solo
        </Button>
        <Button
          className={buttonStyle}
          onClick={() => handleOpenModal('multiplayer')}
          aria-label="Start Multiplayer Game"
        >
          <Users className="w-6 h-6 mr-3" />
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
