'use client';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import { onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import { initializeFirebase } from '@/lib/firebase';

interface FirebaseContextType {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  userId: string | null;
}

const FirebaseContext = createContext<FirebaseContextType | undefined>(
  undefined
);

const USER_ID_KEY = 'wordmates-userId';

export function FirebaseProvider({ children }: { children: ReactNode }) {
  const [firebase, setFirebase] = useState<FirebaseContextType>({
    app: null,
    auth: null,
    db: null,
    userId: null,
  });

  useEffect(() => {
    const { app, auth, db } = initializeFirebase();
    setFirebase({ app, auth, db, userId: auth.currentUser?.uid ?? null });
  }, []);

  useEffect(() => {
    const auth = firebase.auth;
    if (!auth) return;

    const ensureAnonymousSession = () =>
      signInAnonymously(auth).catch((error) => {
        console.error('Failed to sign in anonymously', error);
      });

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (!user) {
        ensureAnonymousSession();
        setFirebase((prev) => ({ ...prev, userId: null }));
        return;
      }
      try {
        window.localStorage?.setItem(USER_ID_KEY, user.uid);
      } catch {
        // ignore storage issues
      }
      setFirebase((prev) => ({ ...prev, userId: user.uid }));
    });

    if (!auth.currentUser) {
      ensureAnonymousSession();
    } else {
      setFirebase((prev) => ({ ...prev, userId: auth.currentUser?.uid ?? null }));
    }

    return () => unsubscribe();
  }, [firebase.auth]);

  return (
    <FirebaseContext.Provider value={firebase}>
      {children}
    </FirebaseContext.Provider>
  );
}

export const useFirebase = () => {
  const context = useContext(FirebaseContext);
  if (context === undefined) {
    throw new Error('useFirebase must be used within a FirebaseProvider');
  }
  return context;
};
