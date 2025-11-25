'use client';

import * as React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useFirebase } from '@/components/firebase-provider';
import { isGuestProfile, type UserThemePreference } from '@/types/user';
import { updateGuestSessionTheme } from '@/lib/guest-session';

type ThemeToggleProps = React.ComponentProps<typeof Button>;

export function ThemeToggle({ className, onClick, ...props }: ThemeToggleProps) {
  const { setTheme, resolvedTheme, theme } = useTheme();
  const { profile, savePreferences } = useFirebase();
  const isClient = typeof window !== 'undefined';
  const lastToggleTimeRef = React.useRef(0);

  React.useEffect(() => {
    const preference = profile?.preferences?.theme;
    if (!preference) return;

    // Skip sync if we just toggled manually (within 2 seconds)
    // This prevents the "flash" where the profile update triggers a re-set of the theme
    if (Date.now() - lastToggleTimeRef.current < 2000) return;

    // If the preference matches the current theme (or resolved theme), do nothing.
    // This prevents unnecessary calls to setTheme which might cause re-renders or flashes.
    if (preference === theme || preference === resolvedTheme) return;

    if (preference !== theme) {
      setTheme(preference);
    }
  }, [profile?.preferences?.theme, setTheme, theme, resolvedTheme]);

  const handleToggle = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    const nextTheme = (resolvedTheme ?? theme) === 'dark' ? 'light' : 'dark';
    lastToggleTimeRef.current = Date.now();
    setTheme(nextTheme);

    if (profile) {
      if (isGuestProfile(profile)) {
        updateGuestSessionTheme(nextTheme as UserThemePreference);
      } else {
        void savePreferences({ theme: nextTheme as UserThemePreference });
      }
    }
  };

  if (!isClient) {
    return (
      <Button variant="ghost" size="icon" disabled className={cn('h-11 w-12', className)} {...props}>
        <Sun className="h-[1.45rem] w-[1.45rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-[1.45rem] w-[1.45rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        <span className="sr-only">Toggle theme</span>
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={handleToggle}
      aria-label="Toggle theme"
      className={cn('relative inline-flex h-11 w-12 items-center justify-center rounded-full', className)}
      {...props}
    >
      <Sun className="h-[1.45rem] w-[1.45rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-[1.45rem] w-[1.45rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
