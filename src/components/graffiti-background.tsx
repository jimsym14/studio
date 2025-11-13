'use client';

import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

// A custom hook to check for screen size for conditional rendering
const useIsMobile = () => {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768); // Typical breakpoint for mobile
    };
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);
  return isMobile;
};

const fontFamilies = [
  'font-body',
  'font-headline',
  'font-code',
  'font-comic',
  'font-moms',
];

const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

interface Letter {
  char: string;
  x: number;
  y: number;
  rotation: number;
  opacity: number;
  fontSize: number;
  fontFamily: string;
  depth: number;
  animationDuration: number;
}

const generateLetters = (count: number): Letter[] => {
  const letters: Letter[] = [];
  for (let i = 0; i < count; i++) {
    letters.push({
      char: characters.charAt(Math.floor(Math.random() * characters.length)),
      x: Math.random() * 100,
      y: Math.random() * 100,
      rotation: Math.random() * 120 - 60,
      opacity: 0.05 + Math.random() * 0.2,
      fontSize: 2 + Math.random() * 6,
      fontFamily: fontFamilies[Math.floor(Math.random() * fontFamilies.length)],
      depth: 0.1 + Math.random() * 0.9,
      animationDuration: 10 + Math.random() * 15,
    });
  }
  return letters;
};

export function GraffitiBackground() {
  const [letters, setLetters] = useState<Letter[]>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const isMobile = useIsMobile();

  useEffect(() => {
    setLetters(generateLetters(80));

    if (!isMobile) {
      const handleMouseMove = (event: MouseEvent) => {
        setMousePos({ x: event.clientX, y: event.clientY });
      };
      window.addEventListener('mousemove', handleMouseMove);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
      };
    }
  }, [isMobile]);

  const moveX = !isMobile ? (mousePos.x - window.innerWidth / 2) / (window.innerWidth / 2) : 0;
  const moveY = !isMobile ? (mousePos.y - window.innerHeight / 2) / (window.innerHeight / 2) : 0;

  return (
    <div className="fixed inset-0 -z-10 pointer-events-none">
      {letters.map((letter, i) => {
        const parallaxX = -moveX * 30 * letter.depth;
        const parallaxY = -moveY * 30 * letter.depth;

        return (
          <span // This outer span handles the parallax translation
            key={i}
            className={cn('absolute transition-transform duration-300 ease-out')}
            style={{
              left: `${letter.x}%`,
              top: `${letter.y}%`,
              transform: `translateX(calc(-50% + ${parallaxX}px)) translateY(calc(-50% + ${parallaxY}px))`,
            }}
          >
            <span // This inner span handles the rotation and float animation
              className={cn(
                'text-primary dark:text-chart-1 select-none',
                letter.fontFamily,
                { 'animate-float': isMobile } // Apply float animation only on mobile
              )}
              style={{
                display: 'inline-block',
                transform: `rotate(${letter.rotation}deg)`,
                opacity: letter.opacity,
                fontSize: `${letter.fontSize}rem`,
                lineHeight: 1,
                animationDuration: `${letter.animationDuration}s`,
                animationDelay: `${-letter.animationDuration * Math.random()}s`,
              }}
            >
              {letter.char}
            </span>
          </span>
        );
      })}
    </div>
  );
}
