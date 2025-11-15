'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { cn } from '@/lib/utils';

interface MagicButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  'aria-label'?: string;
}

export function MagicButton({
  children,
  onClick,
  className,
  'aria-label': ariaLabel,
}: MagicButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const shineMouseX = useMotionValue(-1);
  const shineMouseY = useMotionValue(-1);

  const handleMouseMove = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return;
    const { left, top, width, height } = ref.current.getBoundingClientRect();
    mouseX.set(e.clientX - left - width / 2);
    mouseY.set(e.clientY - top - height / 2);
    shineMouseX.set(e.clientX - left);
    shineMouseY.set(e.clientY - top);
  };

  const handleMouseLeave = () => {
    mouseX.set(0);
    mouseY.set(0);
    shineMouseX.set(-1);
    shineMouseY.set(-1);
  };

  const smoothOptions = { damping: 20, stiffness: 300, mass: 0.5 };
  const rotateX = useSpring(
    useTransform(mouseY, [-40, 40], [30, -30]), // Further increased intensity
    smoothOptions
  );
  const rotateY = useSpring(
    useTransform(mouseX, [-100, 100], [-28, 28]), // Further increased intensity
    smoothOptions
  );

  return (
    <motion.button
      ref={ref}
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      whileTap={{ scale: 0.96 }}
      whileHover={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 300, damping: 15 }}
      aria-label={ariaLabel}
      style={{
        perspective: '1000px',
        transformStyle: 'preserve-3d',
        background: 'linear-gradient(140deg, hsl(var(--primary) / 0.95), hsl(var(--primary) / 0.75) 60%, hsl(var(--primary) / 0.6) 100%)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
      }}
      className={cn(
        'relative h-20 overflow-hidden rounded-[26px] border border-white/35 p-4 font-moms text-lg uppercase tracking-[0.25em] text-[hsl(var(--button-contrast-light))] shadow-[0_40px_70px_rgba(244,131,45,0.45)] transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background dark:border-primary/30 dark:text-[hsl(var(--button-contrast-dark))]',
        className
      )}
    >
      {/* Shine Effect */}
      <motion.div
        className="absolute inset-0 z-20 rounded-2xl opacity-90 mix-blend-screen"
        style={{
          background: useTransform(
            [shineMouseX, shineMouseY],
            ([x, y]) =>
              x !== -1
                ? `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.98) 0%, rgba(255,255,255,0.35) 30%, transparent 65%)`
                : 'transparent'
          ),
          opacity: useTransform(
            [shineMouseX, shineMouseY],
            ([x, y]) => (x !== -1 ? 1 : 0)
          ),
        }}
      />
      {/* Content with 3D transform */}
      <motion.div
        style={{
          rotateX,
          rotateY,
          transformStyle: 'preserve-3d',
        }}
        className="flex h-full w-full items-center justify-center gap-4"
      >
        <div className="relative z-10 flex items-center justify-center gap-4">
          {children}
        </div>
      </motion.div>
    </motion.button>
  );
}
