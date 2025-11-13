'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const greetings = [
  'Here we go again!',
  'Ready to show off your brain?',
  'Let the word games begin!',
  'Time to guess some letters!',
  'Another day, another puzzle!',
  'Hope you brought your dictionary!',
  'Let\'s see what you\'ve got!',
  'Get ready to feel smart!',
  'May your guesses be ever in your favor!',
  'It\'s word-guessing o\'clock!',
  'Unlock your inner wordsmith!',
  'Your daily dose of wordy fun!',
  'Let\'s put your vocabulary to the test!',
  'A wild puzzle has appeared!',
  'Go on, solve it, I dare you!',
  'This one might be tricky!',
  'Prepare for a wordy showdown!',
  'The challenge awaits!',
  'Think you can crack this one?',
  'Time to flex those brain muscles!',
];

export function GreetingChanger() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    // Set initial random greeting on client mount
    setCurrentIndex(Math.floor(Math.random() * greetings.length));
  }, []);

  const changeGreeting = () => {
    let nextIndex;
    do {
      nextIndex = Math.floor(Math.random() * greetings.length);
    } while (nextIndex === currentIndex);
    setCurrentIndex(nextIndex);
  };

  return (
    <div className="mt-4 cursor-pointer" onClick={changeGreeting}>
      <motion.p
        key={currentIndex}
        initial={{ opacity: 0, y: -20, rotate: -10 }}
        animate={{ opacity: 1, y: 0, rotate: 0 }}
        exit={{ opacity: 0, y: 20, rotate: 10 }}
        transition={{ duration: 0.3 }}
        className="font-comic text-4xl md:text-5xl font-bold text-primary tracking-wider"
      >
        {greetings[currentIndex]}
      </motion.p>
    </div>
  );
}
