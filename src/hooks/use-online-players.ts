import { useEffect, useState } from 'react';
import { FirebaseError } from 'firebase/app';
import { collection, onSnapshot } from 'firebase/firestore';

import { useFirebase } from '@/components/firebase-provider';
import { SESSION_LOCK_COLLECTION, SESSION_STALE_MS } from '@/lib/session-lock-constants';

type OnlinePlayersState = {
  count: number | null;
  live: boolean;
};

const initialState: OnlinePlayersState = { count: null, live: false };

export function useOnlinePlayers() {
  const { db, sessionLocksEnabled } = useFirebase();
  const [state, setState] = useState<OnlinePlayersState>(initialState);

  useEffect(() => {
    if (!db || !sessionLocksEnabled) {
      Promise.resolve().then(() => setState({ count: null, live: false }));
      return undefined;
    }

    const locksRef = collection(db, SESSION_LOCK_COLLECTION);

    const unsubscribe = onSnapshot(
      locksRef,
      (snapshot) => {
        const now = Date.now();
        let active = 0;
        snapshot.forEach((doc) => {
          const data = doc.data();
          const expiresAt = typeof data.expiresAt === 'number' ? data.expiresAt : 0;
          const lastSeen = typeof data.lastSeenAtMillis === 'number' ? data.lastSeenAtMillis : 0;
          if (expiresAt > now && now - lastSeen <= SESSION_STALE_MS * 1.1) {
            active += 1;
          }
        });
        setState({ count: active, live: true });
      },
      (error) => {
        if (error instanceof FirebaseError && error.code === 'permission-denied') {
          console.warn('Skipping players online live view due to Firestore permissions');
          setState({ count: null, live: false });
        } else {
          console.error('Players online listener failed', error);
        }
      }
    );

    return unsubscribe;
  }, [db, sessionLocksEnabled]);

  return state;
}
