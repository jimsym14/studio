'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const greetings = [
  'BAM!',
  'KAPOW!',
  'ZAP!',
  'BOOM!',
  'WHAM!',
  'POW!',
  'CRASH!',
  'SMASH!',
  'WOOSH!',
  'THWACK!',
  'CLANG!',
  'BOING!',
  'SPLAT!',
  'KERPLUNK!',
  'ZING!',
  'FIZZ!',
  'POP!',
  'BEEP!',
  'HONK!',
  'ZOINK!',
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
