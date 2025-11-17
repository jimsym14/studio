const PASSCODE_STORAGE_PREFIX = 'wordmates:lobby-passcode:';

const isBrowser = typeof window !== 'undefined';

const getStorage = () => {
  if (!isBrowser) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

const buildKey = (gameId: string) => `${PASSCODE_STORAGE_PREFIX}${gameId}`;

export const rememberLobbyPasscode = (gameId: string, passcode: string) => {
  if (!passcode) return;
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(buildKey(gameId), passcode);
  } catch (error) {
    console.warn('Failed to cache lobby passcode', error);
  }
};

export const readLobbyPasscode = (gameId: string): string | null => {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(buildKey(gameId));
  } catch {
    return null;
  }
};

export const clearLobbyPasscode = (gameId: string) => {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(buildKey(gameId));
  } catch (error) {
    console.warn('Failed to clear lobby passcode cache', error);
  }
};
