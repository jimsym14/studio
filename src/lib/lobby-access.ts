const STORAGE_PREFIX = 'wordmates:lobby-access:';

const isBrowser = typeof window !== 'undefined';

const getStorage = () => {
  if (!isBrowser) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const buildKey = (gameId: string) => `${STORAGE_PREFIX}${gameId}`;

export const rememberLobbyAccess = (gameId: string, hash: string) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(buildKey(gameId), hash);
  } catch (error) {
    console.warn('Failed to cache lobby access', error);
  }
};

export const readLobbyAccess = (gameId: string): string | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(buildKey(gameId));
  } catch {
    return null;
  }
};

export const clearLobbyAccess = (gameId: string) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(buildKey(gameId));
  } catch (error) {
    console.warn('Failed to clear lobby access cache', error);
  }
};
