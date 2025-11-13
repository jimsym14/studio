import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    <h1
      className={cn(
        'font-headline text-6xl md:text-7xl font-extrabold tracking-tighter',
        'bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent',
        className
      )}
    >
      WordMates
    </h1>
  );
}
