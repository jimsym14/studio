'use client';

import { motion } from 'framer-motion';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useFirebase } from '@/components/firebase-provider';
import { Button } from '@/components/ui/button';

const SYNC_TIMEOUT_SECONDS = 30;

function Spinner({ countdownSeconds }: { countdownSeconds?: number }) {
  const remaining = countdownSeconds != null ? Math.max(0, SYNC_TIMEOUT_SECONDS - countdownSeconds) : null;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      {remaining != null && (
        <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-white/15 bg-gradient-to-r from-white/5 via-[#ffe1c4]/20 to-[#ff8733]/15 px-5 py-2 text-xs uppercase tracking-[0.4em] text-white/70 shadow-[0_10px_35px_rgba(0,0,0,0.25)]">
          <span className="text-[0.55rem] tracking-[0.55em]">Sync timer</span>
          <span className="text-2xl font-digital tracking-[0.35em] text-white drop-shadow-[0_0_14px_rgba(255,176,118,0.6)]">
            {remaining.toString().padStart(2, '0')} s
          </span>
        </div>
      )}
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
  const { user, profile, isAuthReady, isProfileLoading, sessionStatus, retrySessionClaim } = useFirebase();
  const pathname = usePathname();
  const router = useRouter();
  const onLoginRoute = pathname?.startsWith('/login');
  const sessionBlocked = sessionStatus === 'blocked';

  const shouldRedirectToLogin = Boolean(isAuthReady && !user && !onLoginRoute);
  const profileMissing = Boolean(user && !profile && !onLoginRoute);
  const waitingForProfile = Boolean(user && !onLoginRoute && (isProfileLoading || profileMissing));
  const [syncSeconds, setSyncSeconds] = useState(0);
  const syncIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const syncResetFrameRef = useRef<number | null>(null);

  const scheduleSyncReset = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (syncResetFrameRef.current) {
      cancelAnimationFrame(syncResetFrameRef.current);
    }
    syncResetFrameRef.current = window.requestAnimationFrame(() => {
      setSyncSeconds(0);
      syncResetFrameRef.current = null;
    });
  }, []);

  useEffect(() => {
    if (!waitingForProfile || sessionBlocked) {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
      scheduleSyncReset();
      return;
    }

    scheduleSyncReset();
    const startedAt = Date.now();
    syncIntervalRef.current = setInterval(() => {
      setSyncSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 500);

    return () => {
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
        syncIntervalRef.current = null;
      }
    };
  }, [scheduleSyncReset, sessionBlocked, waitingForProfile]);

  useEffect(() => {
    return () => {
      if (syncResetFrameRef.current) {
        cancelAnimationFrame(syncResetFrameRef.current);
        syncResetFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!waitingForProfile || onLoginRoute) return;
    if (syncSeconds >= SYNC_TIMEOUT_SECONDS) {
      router.replace('/login?syncTimeout=1');
    }
  }, [onLoginRoute, router, syncSeconds, waitingForProfile]);

  useEffect(() => {
    if (shouldRedirectToLogin && !onLoginRoute) {
      router.replace('/login');
    }
  }, [onLoginRoute, router, shouldRedirectToLogin]);

  if (sessionBlocked && !onLoginRoute) {
    return <SessionConflictScreen onRetry={retrySessionClaim} />;
  }

  if (onLoginRoute) {
    if (!isAuthReady) {
      return <Spinner />;
    }
    return <>{children}</>;
  }

  if (!isAuthReady || shouldRedirectToLogin || waitingForProfile) {
    return <Spinner countdownSeconds={waitingForProfile ? syncSeconds : undefined} />;
  }

  return <>{children}</>;
}

function SessionConflictScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <motion.div
        className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-destructive/60 text-destructive"
        animate={{ scale: [1, 1.05, 1] }}
        transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
      >
        !
      </motion.div>
      <h2 className="mt-6 text-base font-semibold uppercase tracking-[0.35em] text-foreground">
        Signed in elsewhere
      </h2>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Your account is open in another tab or device. Close WordMates there or wait a few seconds for it to
        disconnect automatically, then try again.
      </p>
      <Button className="mt-6" variant="outline" onClick={onRetry}>
        Retry now
      </Button>
    </div>
  );
}
