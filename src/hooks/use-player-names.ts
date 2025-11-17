import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, type Firestore } from 'firebase/firestore';

import type { UserProfile } from '@/types/user';

interface UsePlayerNamesOptions {
  db: Firestore | null;
  playerIds: Array<string | null | undefined>;
}

const normalizeIds = (ids: Array<string | null | undefined>) =>
  Array.from(new Set(ids.filter((id): id is string => Boolean(id)))).sort();

export function usePlayerNames({ db, playerIds }: UsePlayerNamesOptions) {
  const [names, setNames] = useState<Record<string, string>>({});
  const normalizedIds = useMemo(() => normalizeIds(playerIds), [playerIds]);

  useEffect(() => {
    if (!db || !normalizedIds.length) return;
    const missing = normalizedIds.filter((id) => !names[id]);
    if (!missing.length) return;

    let cancelled = false;

    (async () => {
      const results = await Promise.all(
        missing.map(async (uid) => {
          try {
            const profileSnap = await getDoc(doc(db, 'profiles', uid));
            if (!profileSnap.exists()) {
              return { uid, username: '' };
            }
            const data = profileSnap.data() as UserProfile;
            return { uid, username: data.username ?? '' };
          } catch (error) {
            console.error('Failed to fetch profile for player', uid, error);
            return { uid, username: '' };
          }
        })
      );

      if (cancelled) return;

      setNames((prev) => {
        const next = { ...prev };
        for (const { uid, username } of results) {
          next[uid] = username;
        }
        return next;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [db, normalizedIds, names]);

  const getPlayerName = (uid?: string | null) => {
    if (!uid) return undefined;
    return names[uid] || undefined;
  };

  return { playerNames: names, getPlayerName };
}
