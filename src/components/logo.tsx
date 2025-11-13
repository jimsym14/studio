'use client';

import { cn } from '@/lib/utils';
import { GraffitiBackground } from './graffiti-background';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('relative flex items-center justify-center', className)}>
      <GraffitiBackground />
      {/* The image is now explicitly placed in a higher stacking context */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="WordMates Logo"
        width={400}
        height={200}
        
        className={cn('relative z-10', className)}
      />
    </div>
  );
}
