'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';

import { useFirebase } from '@/components/firebase-provider';

export type RealtimeContextValue = {
  socket: Socket | null;
  connected: boolean;
};

const RealtimeContext = createContext<RealtimeContextValue>({ socket: null, connected: false });

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useFirebase();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const refreshTimerRef = useRef<NodeJS.Timeout | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const cleanup = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      setConnected(false);
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
    };

    let cancelled = false;

    const scheduleRefresh = () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
      refreshTimerRef.current = setTimeout(() => {
        if (!user) return;
        user
          .getIdToken(true)
          .then((token) => {
            const instance = socketRef.current;
            if (!instance) return;
            instance.auth = { ...(instance.auth ?? {}), token };
            instance.connect();
          })
          .catch((error) => {
            console.warn('Failed to refresh realtime token', error);
          });
      }, 45 * 60 * 1000);
    };

    const refreshAuthToken = async (force = false) => {
      if (!user) return null;
      try {
        const token = await user.getIdToken(force);
        const instance = socketRef.current;
        if (instance) {
          instance.auth = { ...(instance.auth ?? {}), token };
        }
        return token;
      } catch (error) {
        console.warn('Failed to refresh realtime token', error);
        return null;
      }
    };

    const handleExpiredToken = async () => {
      const token = await refreshAuthToken(true);
      if (!token) return;
      const instance = socketRef.current;
      if (!instance) return;
      if (instance.connected) {
        instance.disconnect();
      }
      instance.connect();
    };

    const connect = async () => {
      if (!user) {
        cleanup();
        return;
      }
      try {
        const token = await refreshAuthToken(false);
        if (cancelled) return;
        const instance = io({
          path: '/api/realtime',
          transports: ['polling', 'websocket'],
          auth: { token },
          reconnectionAttempts: Infinity,
          reconnectionDelayMax: 10_000,
          timeout: 15_000,
        });
        instance.on('connect', () => {
          setConnected(true);
          scheduleRefresh();
        });
        instance.on('disconnect', () => {
          setConnected(false);
        });
        instance.on('connect_error', (error) => {
          console.warn('Realtime connection error', error.message);
          const message = error?.message ?? '';
          if (message.includes('auth/id-token-expired') || message.includes('ID token has expired')) {
            void handleExpiredToken();
          }
        });
        socketRef.current?.disconnect();
        socketRef.current = instance;
        setSocket(instance);
      } catch (error) {
        console.error('Failed to open realtime connection', error);
        cleanup();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [user, user?.uid]);

  const value = useMemo<RealtimeContextValue>(() => ({ socket, connected }), [socket, connected]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export const useRealtime = () => useContext(RealtimeContext);
