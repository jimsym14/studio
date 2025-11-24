'use client';

import { useEffect, useMemo, useState } from 'react';
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
  '"Soopafresh", cursive',
  '"Moms", cursive',
  '"Space Grotesk", "Inter", sans-serif',
  '"Poppins", "Nunito", sans-serif',
  '"Comic Sans MS", "Comic Neue", cursive',
  '"Playfair Display", "Times New Roman", serif',
  '"Bebas Neue", "Oswald", sans-serif',
  '"Archivo Black", "Montserrat", sans-serif',
  '"JetBrains Mono", "Fira Code", monospace',
  '"VT323", monospace',
  '"Raleway", "Segoe UI", sans-serif',
  '"Courier New", monospace',
  '"Barlow Condensed", "Helvetica", sans-serif',
  '"Didot", "Georgia", serif',
  '"Avenir Next", "Futura", sans-serif',
] as const;

const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

const format = (value: number, digits = 4) => value.toFixed(digits);
const formatPercent = (value: number) => `${format(value)}%`;
const formatPx = (value: number) => `${format(value)}px`;
const formatRem = (value: number) => `${format(value)}rem`;
const formatSeconds = (value: number) => `${format(value)}s`;

const createSeededRandom = (seed: number) => {
  let current = seed;
  return () => {
    const x = Math.sin(current) * 10000;
    current += 1;
    return x - Math.floor(x);
  };
};

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
  animationPhase: number;
}

const generateLetters = (count: number): Letter[] => {
  const random = createSeededRandom(42);
  const letters: Letter[] = [];
  for (let i = 0; i < count; i++) {
    letters.push({
      char: characters.charAt(Math.floor(random() * characters.length)),
      x: random() * 100,
      y: random() * 100,
      rotation: random() * 120 - 60,
      opacity: 0.08 + random() * 0.18,
      fontSize: 2 + random() * 6,
      fontFamily: fontFamilies[Math.floor(random() * fontFamilies.length)],
      depth: 0.1 + random() * 0.9,
      animationDuration: 10 + random() * 15,
      animationPhase: random(),
    });
  }
  return letters;
};

interface GraffitiBackgroundProps {
  position?: 'fixed' | 'absolute';
  zIndex?: number;
  className?: string;
}

export function GraffitiBackground({ position = 'fixed', zIndex = -10, className }: GraffitiBackgroundProps = {}) {
  const isMobile = useIsMobile();
  const letters = useMemo(() => generateLetters(isMobile ? 12 : 40), [isMobile]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [windowSize, setWindowSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      setWindowSize({ width: window.innerWidth, height: window.innerHeight });
    };

    const handleMouseMove = (event: MouseEvent) => {
      setMousePos({ x: event.clientX, y: event.clientY });
    };

    handleResize(); // Set initial size on client mount
    window.addEventListener('resize', handleResize);

    if (!isMobile) {
      window.addEventListener('mousemove', handleMouseMove);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (!isMobile) {
        window.removeEventListener('mousemove', handleMouseMove);
      }
    };
  }, [isMobile]);

  const moveX = !isMobile && windowSize.width > 0 ? (mousePos.x - windowSize.width / 2) / (windowSize.width / 2) : 0;
  const moveY = !isMobile && windowSize.height > 0 ? (mousePos.y - windowSize.height / 2) / (windowSize.height / 2) : 0;

  return (
    <div
      className={cn(
        'graffiti-layer pointer-events-none inset-0',
        position === 'fixed' ? 'fixed' : 'absolute',
        className
      )}
      style={{ zIndex }}
    >
      {letters.map((letter, i) => {
        const distanceFromCenter = Math.min(
          1,
          Math.hypot(letter.x - 50, letter.y - 50) / 60
        );
        const opacity = letter.opacity * (0.45 + distanceFromCenter * 0.55);
        const parallaxX = -moveX * 30 * letter.depth;
        const parallaxY = -moveY * 30 * letter.depth;

        return (
          <span // This outer span handles the parallax translation
            key={i}
            className={cn('absolute transition-transform duration-300 ease-out')}
            style={{
              left: formatPercent(letter.x),
              top: formatPercent(letter.y),
              transform: `translateX(calc(-50% + ${formatPx(parallaxX)})) translateY(calc(-50% + ${formatPx(parallaxY)}))`,
            }}
          >
            <span // This inner span handles the rotation and float animation
              className={cn('select-none', {
                'animate-float': isMobile,
              })}
              style={{
                display: 'inline-block',
                transform: `rotate(${format(letter.rotation)}deg)`,
                opacity: Number(format(opacity)),
                fontSize: formatRem(letter.fontSize),
                lineHeight: 1,
                animationDuration: formatSeconds(letter.animationDuration),
                animationDelay: `-${format(letter.animationDuration * letter.animationPhase)}s`,
                color: 'hsl(var(--floating-letter) / 0.92)',
                fontFamily: letter.fontFamily,
                textShadow: '0 18px 45px hsla(var(--hero-glow-ambient) / 0.45)',
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
