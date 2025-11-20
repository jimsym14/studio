'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@/components/theme-provider';
import { FirebaseProvider } from '@/components/firebase-provider';
import { FriendsModalProvider } from '@/components/friends-modal-provider';
import { RealtimeProvider } from '@/components/realtime-provider';
import { NotificationsProvider } from '@/components/notifications-provider';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <FirebaseProvider>
        <RealtimeProvider>
          <NotificationsProvider>
            <FriendsModalProvider>{children}</FriendsModalProvider>
          </NotificationsProvider>
        </RealtimeProvider>
      </FirebaseProvider>
    </ThemeProvider>
  );
}
