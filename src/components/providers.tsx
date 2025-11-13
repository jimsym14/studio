'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { FirebaseProvider } from '@/components/firebase-provider';
import { AuthProvider } from '@/components/auth-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <FirebaseProvider>
        <AuthProvider>{children}</AuthProvider>
      </FirebaseProvider>
    </ThemeProvider>
  );
}
