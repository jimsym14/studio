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
    transition: { staggerChildren: 0.02, delayChildren: 0.05 * i },
  }),
};

const letterVariants = {
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: 'spring',
      damping: 10,
      stiffness: 150,
      duration: 0.1
    },
  },
  hidden: {
    opacity: 0,
    y: 20,
    transition: {
      type: 'spring',
      damping: 10,
      stiffness: 150,
      duration: 0.1
    },
  },
};


export function GreetingChanger() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setCurrentIndex(Math.floor(Math.random() * greetings.length));
  }, []);

  const changeGreeting = () => {
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * greetings.length);
    } while (nextIndex === currentIndex);
    setCurrentIndex(nextIndex);
  };
  
  const currentGreeting = greetings[currentIndex];

  return (
    <div className="mt-4 cursor-pointer" onClick={changeGreeting}>
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
