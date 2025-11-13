import { cn } from '@/lib/utils';
import { Asterisk } from 'lucide-react';

export function Logo({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      <Asterisk className="w-10 h-10 text-primary" />
      <h1
        className={cn(
          'font-headline text-5xl md:text-6xl font-semibold tracking-tight'
        )}
      >
        WordMates
      </h1>
    </div>
  );
}
