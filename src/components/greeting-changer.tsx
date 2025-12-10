'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';

const greetings = [
  'Here we go again!',
  'Show off your brain!',
  'Let the games begin!',
  'Guess some letters!',
  'Another day, another puzzle!',
  'Brought your dictionary?',
  "Let's see what you've got!",
  'Get ready to feel smart!',
  'May your guesses be wise!',
  "It's word-guessing o'clock!",
  'Unlock your inner wordsmith!',
  'Your daily dose of wordy fun!',
  'Test your vocabulary!',
  'A wild puzzle has appeared!',
  'Go on, solve it, I dare you!',
  'This one might be tricky!',
  'Prepare for a wordy showdown!',
  'The challenge awaits!',
  'Think you can crack this one?',
  'Flex those brain muscles!',
];

const sentenceVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.02, delayChildren: 0.1 },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: 0.2,
    },
  },
};

const letterVariants = {
  hidden: { opacity: 0, y: 50 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 8,
      stiffness: 100,
    },
  },
};

export default function GreetingChanger() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentGreeting, setCurrentGreeting] = useState(greetings[0]);
  const { resolvedTheme } = useTheme();

  const changeGreeting = useCallback(() => {
    setCurrentIndex((prevIndex) => {
      const newIndex = (prevIndex + 1) % greetings.length;
      setCurrentGreeting(greetings[newIndex]);
      return newIndex;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      changeGreeting();
    }, 10000);

    return () => clearInterval(interval);
  }, [changeGreeting]);

  return (
    <div className="mt-4">
      <AnimatePresence mode="wait">
        <motion.h2
          key={currentIndex}
          className="font-comic text-xl md:text-2xl font-semibold tracking-wider whitespace-nowrap text-[#F7931E]"
          variants={sentenceVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {currentGreeting.split('').map((char, index) => (
            <motion.span
              key={`${char}-${index}`}
              variants={letterVariants}
              className="inline-block"
              style={{
                animation: `glow-${index} 0.8s cubic-bezier(0.4, 0, 0.2, 1) ${index * 0.02 + 0.1}s forwards`,
              }}
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.h2>
      </AnimatePresence>
      <style jsx>{`
        ${currentGreeting
          .split('')
          .map(
            (_, index) => `
          @keyframes glow-${index} {
            0% {
              text-shadow: 0 0 0px rgba(255, 122, 24, 0);
            }
            100% {
              text-shadow: 0 0 12px rgba(255, 122, 24, 0.6), 0 0 24px rgba(255, 122, 24, 0.4), 0 0 36px rgba(255, 122, 24, 0.2);
            }
          }
        `
          )
          .join('\n')}
      `}</style>
    </div>
  );
}
