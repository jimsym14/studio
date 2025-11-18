'use client';

import { motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';

import { useFirebase } from '@/components/firebase-provider';

function Spinner() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background">
      <motion.div
        className="h-14 w-14 rounded-full border-4 border-muted border-t-primary"
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 1.1, ease: 'linear' }}
      />
      <p className="mt-6 text-sm uppercase tracking-[0.35em] text-muted-foreground">Syncing profile…</p>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const { user, profile, isAuthReady, isProfileLoading } = useFirebase();
  const pathname = usePathname();
  const router = useRouter();
  const onLoginRoute = pathname?.startsWith('/login');

  const shouldRedirectToLogin = Boolean(isAuthReady && !user && !onLoginRoute);
  const profileMissing = Boolean(user && !profile && !onLoginRoute);
  const waitingForProfile = Boolean(user && !onLoginRoute && (isProfileLoading || profileMissing));

  useEffect(() => {
    if (shouldRedirectToLogin && !onLoginRoute) {
      router.replace('/login');
    }
  }, [onLoginRoute, router, shouldRedirectToLogin]);

  if (onLoginRoute) {
    if (!isAuthReady) {
      return <Spinner />;
    }
    return <>{children}</>;
  }

  if (!isAuthReady || shouldRedirectToLogin || waitingForProfile) {
    return <Spinner />;
  }

  return <>{children}</>;
}
