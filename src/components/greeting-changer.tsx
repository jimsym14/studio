'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const greetings = [
  'Here we go again!',
  'Ready to show off your brain?',
  'Let the word games begin!',
  'Time to guess some letters!',
  'Another day, another puzzle!',
  'Hope you brought your dictionary!',
  "Let's see what you've got!",
  'Get ready to feel smart!',
  'May your guesses be ever in your favor!',
  "It's word-guessing o'clock!",
  'Unlock your inner wordsmith!',
  'Your daily dose of wordy fun!',
  "Let's put your vocabulary to the test!",
  'A wild puzzle has appeared!',
  'Go on, solve it, I dare you!',
  'This one might be tricky!',
  'Prepare for a wordy showdown!',
  'The challenge awaits!',
  'Think you can crack this one?',
  'Time to flex those brain muscles!',
];

const sentenceVariants = {
  hidden: { opacity: 0 },
  visible: (i = 1) => ({
    opacity: 1,
    transition: { staggerChildren: 0.0005, delayChildren: 0.001 * i },
  }),
};

const letterVariants = {
  hidden: { opacity: 0, y: 50 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 12,
      stiffness: 200,
    },
  },
};

export default function GreetingChanger() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentGreeting, setCurrentGreeting] = useState(greetings[0]);

  useEffect(() => {
    const interval = setInterval(() => {
      changeGreeting();
    }, 7000); // Change greeting every 5 seconds

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
            className="font-comic text-xl md:text-2xl font-bold text-primary tracking-wider"
            variants={sentenceVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
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
