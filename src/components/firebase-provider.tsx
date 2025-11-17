'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { FirebaseApp } from 'firebase/app';
import type { Auth, User } from 'firebase/auth';
import {
  browserLocalPersistence,
  onAuthStateChanged,
  setPersistence,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { doc, onSnapshot } from 'firebase/firestore';

import { initializeFirebase } from '@/lib/firebase';
import type { UserPreferences, UserProfile } from '@/types/user';
import { updatePreferences as updateProfilePrefs } from '@/lib/profiles';
import {
  clearGuestSession,
  GUEST_SESSION_EVENT,
  hydrateGuestProfileFromSession,
} from '@/lib/guest-session';

const firebaseSingleton = initializeFirebase();

interface FirebaseContextType {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  user: User | null;
  userId: string | null;
  profile: UserProfile | null;
  isAuthReady: boolean;
  isProfileLoading: boolean;
  signOut: () => Promise<void>;
  savePreferences: (prefs: Partial<UserPreferences>) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(undefined);

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  const { app, auth, db } = firebaseSingleton;

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

  const handleSignOut = useCallback(async () => {
    if (!auth) return;
    await firebaseSignOut(auth);
    clearGuestSession();
  }, [auth]);

  const handleSavePreferences = useCallback(
    async (prefs: Partial<UserPreferences>) => {
      if (!db || !user) return;
      try {
        await updateProfilePrefs(db, user.uid, prefs);
      } catch (error) {
        console.error('Failed to persist preferences', error);
      }
    }, [db, user]);

  const value = useMemo<FirebaseContextType>(
    () => ({
        app,
        auth,
        db,
      user,
      userId: user?.uid ?? null,
      profile,
      isAuthReady,
      isProfileLoading: Boolean(user && !profileReady),
      signOut: handleSignOut,
      savePreferences: handleSavePreferences,
    }),
    [app, auth, db, user, profile, profileReady, isAuthReady, handleSignOut, handleSavePreferences]
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
