import {
  deleteDoc,
  doc,
  runTransaction,
  serverTimestamp,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore';

import {
  SESSION_ACTIVE_GRACE_MS,
  SESSION_HEARTBEAT_MS,
  SESSION_LOCK_COLLECTION,
  SESSION_STALE_MS,
} from '@/lib/session-lock-constants';

export type SessionLockDoc = {
  sessionId: string;
  lastSeenAt: Timestamp | null;
  lastSeenAtMillis: number;
  createdAt: Timestamp | null;
  deviceLabel?: string;
  origin?: string;
  expiresAt: number;
};

export type SessionClaimResult =
  | { status: 'granted'; lock: SessionLockDoc }
  | { status: 'blocked'; lock: SessionLockDoc };

const now = () => Date.now();

const lockExpiresAt = () => now() + SESSION_STALE_MS;

const timestampToMillis = (value?: Timestamp | null) => (value ? value.toMillis() : 0);

const lockLastSeenMillis = (lock: SessionLockDoc) => {
  const fallback = timestampToMillis(lock.lastSeenAt || lock.createdAt);
  return lock.lastSeenAtMillis || fallback;
};

export const isSessionLockStale = (lock: SessionLockDoc, graceMs = SESSION_STALE_MS) => {
  return now() - lockLastSeenMillis(lock) > graceMs;
};

export const isSessionLockActive = (lock: SessionLockDoc, activeMs = SESSION_ACTIVE_GRACE_MS) => {
  return now() - lockLastSeenMillis(lock) <= activeMs;
};

const lockRef = (db: Firestore, uid: string) => doc(db, SESSION_LOCK_COLLECTION, uid);

export async function claimSessionLock(
  db: Firestore,
  uid: string,
  sessionId: string,
  metadata: Pick<SessionLockDoc, 'deviceLabel' | 'origin'>
): Promise<SessionClaimResult> {
  const current = now();

  return runTransaction(db, async (transaction) => {
    const ref = lockRef(db, uid);
    const snapshot = await transaction.get(ref);

    if (!snapshot.exists()) {
      const payload = {
        sessionId,
        lastSeenAt: serverTimestamp(),
        lastSeenAtMillis: current,
        createdAt: serverTimestamp(),
        expiresAt: lockExpiresAt(),
        ...metadata,
      };
      transaction.set(ref, payload);
      const lock: SessionLockDoc = {
        sessionId,
        lastSeenAt: null,
        lastSeenAtMillis: current,
        createdAt: null,
        expiresAt: payload.expiresAt,
        ...metadata,
      };
      return { status: 'granted', lock };
    }

    const existing = snapshot.data() as SessionLockDoc;
    const stale = isSessionLockStale(existing);
    const active = isSessionLockActive(existing);

    if (existing.sessionId === sessionId || stale || !active) {
      const payload = {
        sessionId,
        lastSeenAt: serverTimestamp(),
        lastSeenAtMillis: current,
        expiresAt: lockExpiresAt(),
        deviceLabel: metadata.deviceLabel ?? existing.deviceLabel,
        origin: metadata.origin ?? existing.origin,
      };
      transaction.set(ref, payload, { merge: true });
      const lock: SessionLockDoc = {
        ...existing,
        ...('deviceLabel' in payload ? { deviceLabel: payload.deviceLabel } : {}),
        ...('origin' in payload ? { origin: payload.origin } : {}),
        sessionId,
        lastSeenAt: existing.lastSeenAt,
        lastSeenAtMillis: current,
        expiresAt: payload.expiresAt,
      };
      return { status: 'granted', lock };
    }

    return { status: 'blocked', lock: existing };
  });
}

export async function heartbeatSessionLock(db: Firestore, uid: string, sessionId: string) {
  const current = now();
  return runTransaction(db, async (transaction) => {
    const ref = lockRef(db, uid);
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) {
      throw new Error('Session lock missing');
    }
    const existing = snapshot.data() as SessionLockDoc;
    if (existing.sessionId !== sessionId) {
      throw new Error('Session lock lost');
    }
    transaction.update(ref, {
      lastSeenAt: serverTimestamp(),
      lastSeenAtMillis: current,
      expiresAt: lockExpiresAt(),
    });
  });
}

export async function releaseSessionLock(db: Firestore, uid: string, sessionId: string) {
  const ref = lockRef(db, uid);
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists()) return;
    const existing = snapshot.data() as SessionLockDoc;
    if (existing.sessionId !== sessionId) return;
    transaction.delete(ref);
  });
}

export async function forceReleaseSession(db: Firestore, uid: string) {
  await deleteDoc(lockRef(db, uid));
}
