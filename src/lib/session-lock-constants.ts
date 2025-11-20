export const SESSION_LOCK_COLLECTION = 'sessionLocks';
export const SESSION_HEARTBEAT_MS = 10_000;
export const SESSION_STALE_MS = 30_000;
export const SESSION_ACTIVE_GRACE_MS = 7_000;
export const SESSION_LIVE_TOLERANCE_MS = Math.round(SESSION_STALE_MS * 1.1);
