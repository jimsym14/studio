'use client';

import { useState } from 'react';
import { User, Users } from 'lucide-react';
import { motion } from 'framer-motion';

import { Button } from '@/components/ui/button';
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

  const handleOpenModal = (type: GameType) => {
    setModalState({ isOpen: true, gameType: type });
  };

  const buttonStyle =
    'h-16 w-15% text-lg font-moms rounded-none uppercase flex items-center justify-center gap-4 transition-colors duration-300 ease-in-out hover:bg-primary';

  const iconStyle = 'w-8 h-8';

  return (
    <div className="relative flex flex-col items-center justify-start min-h-screen p-4 pt-8 overflow-hidden">
      <div className="absolute top-4 right-4 flex items-center gap-4 z-20">
        <LanguageToggle />
        <ThemeToggle />
      </div>

      <div className="text-center z-10">
        <Logo />
      </div>

      <div className="relative w-full max-w-lg mt-8 p-6 border rounded-lg dark:border-slate-700 border-orange-300 bg-background/70 dark:bg-slate-800/50 backdrop-blur-sm z-10">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center"
        >
          <GreetingChanger />
          <Separator className="mt-6 w-2/3 mx-auto" />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="mt-12 flex flex-col justify-center gap-8 w-full"
        >
          <Button
            className={buttonStyle}
            onClick={() => handleOpenModal('solo')}
            aria-label="Start Singleplayer Game"
          >
            <User className={iconStyle} />
            Solo
          </Button>
          <Button
            className={buttonStyle}
            onClick={() => handleOpenModal('multiplayer')}
            aria-label="Start Multiplayer Game"
          >
            <Users className={iconStyle} />
            Multiplayer
          </Button>
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
