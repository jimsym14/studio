'use client';

import { cn } from '@/lib/utils';
import Image from 'next/image';
import { useTheme } from 'next-themes';

export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();

  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Image
        src="/logo.png"
        alt="WordMates Logo"
        width={300}
        height={150}
        priority
        className={cn(resolvedTheme === 'dark' ? 'invert' : '')}
      />
    </div>
  );
}
