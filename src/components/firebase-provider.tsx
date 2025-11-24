'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { FirebaseApp } from 'firebase/app';
import { FirebaseError } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, onSnapshot } from 'firebase/firestore';
import type { Database } from 'firebase/database';
import { ref, onValue, set, onDisconnect, serverTimestamp } from 'firebase/database';

import { initializeFirebase } from '@/lib/firebase';
import type { UserPreferences, UserProfile } from '@/types/user';
import { updatePreferences as updateProfilePrefs } from '@/lib/profiles';
import {
  clearGuestSession,
  GUEST_SESSION_EVENT,
  hydrateGuestProfileFromSession,
} from '@/lib/guest-session';
import {
  claimSessionLock,
  heartbeatSessionLock,
  releaseSessionLock,
  type SessionLockDoc,
} from '@/lib/session-lock';
import { SESSION_HEARTBEAT_MS } from '@/lib/session-lock-constants';
import { toast } from '@/hooks/use-toast';
import { setSocialAuthTokenProvider } from '@/lib/social-client';

const firebaseSingleton = initializeFirebase();
const SESSION_LOCKS_STORAGE_KEY = 'wordmates.sessionLocksSilencedAt';
const SESSION_LOCKS_TOAST_SILENCE_MS = 12 * 60 * 60 * 1000;

const generateSessionId = () => {
  const uuidFn = typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function'
    ? globalThis.crypto.randomUUID.bind(globalThis.crypto)
    : null;
  if (uuidFn) {
    try {
      return uuidFn();
    } catch {
      // Fall through to math-based fallback below.
    }
  }
  // Simple RFC4122-ish fallback; good enough for client-side uniqueness.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = Math.random() * 16 | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
};

type SessionStatus = 'idle' | 'pending' | 'active' | 'blocked';

interface FirebaseContextType {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  rtdb: Database | null;
  user: User | null;
  userId: string | null;
  profile: UserProfile | null;
  isAuthReady: boolean;
  isProfileLoading: boolean;
  signOut: () => Promise<void>;
  savePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
  sessionStatus: SessionStatus;
  sessionConflict: SessionLockDoc | null;
  retrySessionClaim: () => void;
  sessionLocksEnabled: boolean;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [sessionConflict, setSessionConflict] = useState<SessionLockDoc | null>(null);
  const [sessionLocksDisabled, setSessionLocksDisabled] = useState(false);
  const [sessionLocksPrefReady, setSessionLocksPrefReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeUidRef = useRef<string | null>(null);
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const sessionDisableToastShownRef = useRef(false);

  const { app, auth, db, rtdb } = firebaseSingleton;

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const releaseSessionLockIfNeeded = useCallback(async () => {
    const uid = activeUidRef.current;
    const sessionId = sessionIdRef.current;
    stopHeartbeat();
    if (!db || !uid || !sessionId) {
      sessionIdRef.current = null;
      activeUidRef.current = null;
      return;
    }

    try {
      await releaseSessionLock(db, uid, sessionId);
    } catch (error) {
      console.error('Failed to release session lock', error);
    } finally {
      sessionIdRef.current = null;
      activeUidRef.current = null;
    }
  }, [db, stopHeartbeat]);

  const retrySessionClaim = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_LOCKS_STORAGE_KEY);
    }
    sessionDisableToastShownRef.current = false;
    setSessionLocksDisabled(false);
    setSessionAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setSessionLocksPrefReady(true);
      return;
    }
    const stored = window.localStorage.getItem(SESSION_LOCKS_STORAGE_KEY);
    if (stored) {
      const silencedAt = Number(stored);
      const isSilenced = Number.isFinite(silencedAt) && Date.now() - silencedAt < SESSION_LOCKS_TOAST_SILENCE_MS;
      if (isSilenced) {
        setSessionLocksDisabled(true);
        sessionDisableToastShownRef.current = true;
      } else {
        window.localStorage.removeItem(SESSION_LOCKS_STORAGE_KEY);
      }
    }
    setSessionLocksPrefReady(true);
  }, []);

  useEffect(() => {
    if (!auth) return;
    setPersistence(auth, browserLocalPersistence).catch((error) => {
      console.error('Failed to configure auth persistence', error);
    });
  }, [auth]);

  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        clearGuestSession();
        setProfile(null);
        setProfileReady(false);
      } else {
        setProfileReady(false);
      }
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, [auth]);

  useEffect(() => {
    if (!user) {
      setSocialAuthTokenProvider(null);
      return;
    }

    setSocialAuthTokenProvider(() => user.getIdToken());
    return () => {
      setSocialAuthTokenProvider(null);
    };
  }, [user]);

  useEffect(() => {
    if (!sessionLocksPrefReady) return;
    if (!user || user.isAnonymous || !db || sessionLocksDisabled) {
      releaseSessionLockIfNeeded();
      setSessionStatus('active');
      setSessionConflict(null);
      return;
    }

    let cancelled = false;
    const sessionId = generateSessionId();
    sessionIdRef.current = sessionId;
    activeUidRef.current = user.uid;
    setSessionStatus('pending');
    setSessionConflict(null);

    const metadata = typeof window === 'undefined'
      ? { deviceLabel: 'unknown', origin: undefined }
      : { deviceLabel: navigator.userAgent.slice(0, 180), origin: window.location.origin };

    claimSessionLock(db, user.uid, sessionId, metadata)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'granted') {
          setSessionStatus('active');
          if (typeof window !== 'undefined') {
            heartbeatRef.current = setInterval(() => {
              heartbeatSessionLock(db, user.uid, sessionId).catch((error) => {
                console.error('Session heartbeat failed', error);
                stopHeartbeat();
                setSessionStatus('blocked');
                setSessionConflict(null);
                setProfile(null);
                setProfileReady(false);
                toast({
                  variant: 'destructive',
                  title: 'Session lost',
                  description: 'WordMates is open somewhere else. Close that tab or wait a moment, then try again.',
                });
              });
            }, SESSION_HEARTBEAT_MS);
          }
        } else {
          setSessionStatus('blocked');
          setSessionConflict(result.lock);
          setProfile(null);
          setProfileReady(false);
          toast({
            variant: 'destructive',
            title: 'Account open elsewhere',
            description: 'Close WordMates on the other device or wait for it to sign out before continuing here.',
          });
        }
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('Failed to claim session lock', error);
        if (error instanceof FirebaseError && error.code === 'permission-denied') {
          setSessionLocksDisabled(true);
          sessionIdRef.current = null;
          activeUidRef.current = null;
          setSessionStatus('active');
          setSessionConflict(null);
          if (!sessionDisableToastShownRef.current) {
            toast({
              title: 'Continuing without live lock',
              description: "We couldn't check other devices, so we're continuing without restrictions.",
            });
            sessionDisableToastShownRef.current = true;
            if (typeof window !== 'undefined') {
              window.localStorage.setItem(SESSION_LOCKS_STORAGE_KEY, String(Date.now()));
            }
          }
          return;
        }
        setSessionStatus('blocked');
        setSessionConflict(null);
        setProfile(null);
        setProfileReady(false);
        toast({
          variant: 'destructive',
          title: 'Unable to connect',
          description: "We couldn't sync your profile. Please try again shortly.",
        });
      });

    return () => {
      cancelled = true;
      releaseSessionLockIfNeeded();
    };
  }, [auth, db, releaseSessionLockIfNeeded, sessionAttempt, sessionLocksDisabled, sessionLocksPrefReady, stopHeartbeat, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePageHide = () => {
      releaseSessionLockIfNeeded();
    };

    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
    };
  }, [releaseSessionLockIfNeeded]);

  useEffect(() => {
    if (typeof document === 'undefined' || !db) return;

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const uid = activeUidRef.current;
      const sessionId = sessionIdRef.current;
      if (!uid || !sessionId) return;
      heartbeatSessionLock(db, uid, sessionId).catch(() => undefined);
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [db]);

  useEffect(() => {
    if (!user) return;

    if (user.isAnonymous) {
      const applyGuestProfile = () => {
        setProfile(hydrateGuestProfileFromSession(user.uid));
        setProfileReady(true);
      };

      applyGuestProfile();

      window.addEventListener(GUEST_SESSION_EVENT, applyGuestProfile);
      return () => {
        window.removeEventListener(GUEST_SESSION_EVENT, applyGuestProfile);
        setProfile(null);
        setProfileReady(false);
      };
    }

    if (!db) return;

    const profileRef = doc(db, 'profiles', user.uid);
    const unsubscribe = onSnapshot(
      profileRef,
      (snapshot) => {
        setProfile(snapshot.exists() ? (snapshot.data() as UserProfile) : null);
        setProfileReady(true);
      },
      (error) => {
        console.error('Failed to watch profile', error);
        setProfile(null);
        setProfileReady(true);
      }
    );

    return () => {
      unsubscribe();
      setProfile(null);
      setProfileReady(false);
    };
  }, [db, user]);

  // Presence tracking with Firebase Realtime Database
  useEffect(() => {
    if (!rtdb || !user || user.isAnonymous) return;

    const connectedRef = ref(rtdb, '.info/connected');
    const presenceRef = ref(rtdb, `presence/${user.uid}`);

    const unsubscribe = onValue(connectedRef, (snapshot) => {
      if (snapshot.val() === true) {
        // Set user as online
        set(presenceRef, {
          online: true,
          lastSeen: serverTimestamp(),
        }).catch((error) => {
          console.error('Failed to set presence', error);
        });

        // Set user as offline when disconnected
        onDisconnect(presenceRef)
          .set({
            online: false,
            lastSeen: serverTimestamp(),
          })
          .catch((error) => {
            console.error('Failed to set disconnect handler', error);
          });
      }
    });

    return () => unsubscribe();
  }, [rtdb, user]);

  const handleSignOut = useCallback(async () => {
    await releaseSessionLockIfNeeded();
    if (!auth) return;
    await firebaseSignOut(auth);
    clearGuestSession();
  }, [auth, releaseSessionLockIfNeeded]);

  const handleSavePreferences = useCallback(
    async (prefs: Partial<UserPreferences>) => {
      if (!db || !user) return;
      try {
        await updateProfilePrefs(db, user.uid, prefs);
      } catch (error) {
        console.error('Failed to persist preferences', error);
      }
    },
    [db, user]
  );

  const value = useMemo<FirebaseContextType>(
    () => ({
      app,
      auth,
      db,
      rtdb,
      user,
      userId: user?.uid ?? null,
      profile,
      isAuthReady,
      isProfileLoading: Boolean(user && !profileReady && sessionStatus !== 'blocked'),
      signOut: handleSignOut,
      savePreferences: handleSavePreferences,
      sessionStatus,
      sessionConflict,
      retrySessionClaim,
      sessionLocksEnabled: !sessionLocksDisabled,
    }),
    [
      app,
      auth,
      db,
      rtdb,
      user,
      profile,
      profileReady,
      isAuthReady,
      sessionStatus,
      sessionConflict,
      handleSignOut,
      handleSavePreferences,
      retrySessionClaim,
      sessionLocksDisabled,
    ]
  );

  return <FirebaseContext.Provider value={value}>{children}</FirebaseContext.Provider>;
}

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
