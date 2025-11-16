'use client';

import { LogIn, LogOut, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useFirebase } from '@/components/firebase-provider';
import { isGuestProfile } from '@/types/user';
import { cn } from '@/lib/utils';

const initials = (value?: string | null) => {
  if (!value) return 'WM';
  return value
    .split(/\s+/)
    .map((segment) => segment[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
};

type UserMenuProps = {
  className?: string;
  variant?: 'chip' | 'icon';
};

export function UserMenu({ className, variant = 'chip' }: UserMenuProps) {
  const router = useRouter();
  const { user, profile, signOut } = useFirebase();

  if (!user) {
    if (variant === 'icon') {
      return (
        <Button
          size="icon"
          variant="ghost"
          className={cn('h-12 w-12 rounded-full border border-border/50 text-white', className)}
          onClick={() => router.push('/login')}
          aria-label="Go to login"
        >
          <LogIn className="h-5 w-5" />
        </Button>
      );
    }
    return (
      <Button
        size="sm"
        variant="ghost"
        className={cn('rounded-full border border-border/70 font-semibold', className)}
        onClick={() => router.push('/login')}
      >
        <LogIn className="mr-2 h-4 w-4" />
        Login
      </Button>
    );
  }

  const guest = isGuestProfile(profile);
  const username = profile?.username ?? 'Player';
  const statusLabel = guest ? 'Guest' : 'Signed in';
  const triggerClasses =
    variant === 'icon'
      ? cn('relative flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-black/30 p-0 text-white', className)
      : cn(
          'group flex min-w-[210px] items-center gap-4 rounded-full border border-border/50 px-6 py-4 text-sm font-semibold shadow-sm transition hover:border-border',
          'w-full justify-between sm:w-auto sm:justify-start',
          className
        );
  const avatarClasses = variant === 'icon' ? 'h-10 w-10 border border-border/40 shadow-inner' : 'h-12 w-12 border border-border/40 shadow-inner';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className={triggerClasses}>
          <Avatar className={avatarClasses}>
            <AvatarImage src={profile?.photoURL ?? undefined} alt={username} />
            <AvatarFallback>{initials(username)}</AvatarFallback>
          </Avatar>
          {variant === 'chip' ? (
            <div className="flex flex-col text-left leading-tight">
              <p className="text-[0.65rem] uppercase tracking-[0.35em] text-muted-foreground">{statusLabel}</p>
              <p className="text-base font-semibold leading-[1.35]">{username}</p>
            </div>
          ) : (
            <span className="sr-only">{`${statusLabel} as ${username}`}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="px-3 py-2 text-sm">
          <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Current handle</p>
          <p className="text-lg font-semibold">{username}</p>
        </div>
        <DropdownMenuSeparator />
        {!guest && (
          <>
            <DropdownMenuItem className="cursor-pointer" onClick={() => router.push('/settings')}>
              <Settings className="mr-2 h-4 w-4" />
              Profile settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          className="cursor-pointer"
          onClick={() => {
            void signOut();
          }}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
