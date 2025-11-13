'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const greetings = [
  'Here we go again!',
  'Show off your brain!', // Shortened
  'Let the games begin!', // Shortened
  'Guess some letters!', // Shortened
  'Another day, another puzzle!',
  'Brought your dictionary?', // Shortened
  "Let's see what you've got!",
  'Get ready to feel smart!',
  'May your guesses be wise!', // Shortened
  "It's word-guessing o'clock!",
  'Unlock your inner wordsmith!',
  'Your daily dose of wordy fun!',
  'Test your vocabulary!', // Shortened
  'A wild puzzle has appeared!',
  'Go on, solve it, I dare you!',
  'This one might be tricky!',
  'Prepare for a wordy showdown!',
  'The challenge awaits!',
  'Think you can crack this one?',
  'Flex those brain muscles!', // Shortened
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

  useEffect(() => {
    const interval = setInterval(() => {
      changeGreeting();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  const changeGreeting = () => {
    setCurrentIndex((prevIndex) => {
      const newIndex = (prevIndex + 1) % greetings.length;
      setCurrentGreeting(greetings[newIndex]);
      return newIndex;
    });
  };

  return (
    <div className="mt-4">
      <AnimatePresence mode="wait">
        <motion.h2
          key={currentIndex}
          className="font-comic text-xl md:text-2xl font-semibold text-primary tracking-wider whitespace-nowrap"
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
            >
              {char === ' ' ? '\u00A0' : char}
            </motion.span>
          ))}
        </motion.h2>
      </AnimatePresence>
    </div>
  );
}
