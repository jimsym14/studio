'use client';

import { cn } from '@/lib/utils';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export function Logo({ className }: { className?: string }) {
  const { resolvedTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);
  
  // Use a placeholder or default until the theme is resolved on the client
  if (!isMounted) {
    return (
       <div className={cn('flex items-center justify-center', className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.png"
          alt="WordMates Logo"
          width={400}
          height={200}
          className={cn(className, "opacity-0")}
        />
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center', className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="WordMates Logo"
        width={400}
        height={200}
        className={cn(className, resolvedTheme === 'dark' ? 'invert' : '')}
      />
    </div>
  );
}
