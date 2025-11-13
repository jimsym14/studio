'use client';

import { cn } from '@/lib/utils';
import Image from 'next/image';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center', className)}>
      <Image
        src="/logo.png"
        alt="WordMates Logo"
        width={300}
        height={150}
        priority
      />
    </div>
  );
}
