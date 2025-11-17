'use server';

import type { FirebaseOptions } from 'firebase/app';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { getRandomWord, normalizeWord } from '@/lib/words.server';

// A simple random ID generator
function generateGameId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

function parseMinutes(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value !== 'unlimited') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function addMinutes(baseIso: string, minutes: number | null): string | null {
  if (!minutes) return null;
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + minutes * 60 * 1000).toISOString();
}

const shouldUseEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';

const requiredFirebaseKeys: Array<keyof FirebaseOptions> = [
  'apiKey',
  'authDomain',
  'projectId',
  'storageBucket',
  'messagingSenderId',
  'appId',
];

const cleanEnvValue = (value?: string): string | undefined => {
  if (!value) return undefined;
  let normalized = value.trim();
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // ignore decode errors
  }
  normalized = normalized
    .replace(/^['"`]+/, '')
    .replace(/['"`]+$/, '')
    .replace(/\s+/g, '');
  return normalized || undefined;
};

const resolveFirebaseConfig = (incoming: FirebaseOptions): FirebaseOptions => {
  const fallbackEnv = {
    apiKey: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
    authDomain: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
    projectId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
    storageBucket: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
    appId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  } satisfies FirebaseOptions;

  const resolvedConfig: FirebaseOptions = {
    ...fallbackEnv,
    ...incoming,
  };

  const missingKeys = requiredFirebaseKeys.filter((key) => !resolvedConfig[key]);
  if (missingKeys.length) {
    throw new Error(`Firebase config is missing: ${missingKeys.join(', ')}`);
  }

  return resolvedConfig;
};

export async function createGame(
  settings: any,
  firebaseConfig: FirebaseOptions,
  authToken?: string
) {
  const { creatorId, ...gameSettings } = settings;

  if (!creatorId) {
    throw new Error("Creator ID is missing. The client must provide the user's UID.");
  }
  
  if (!firebaseConfig?.apiKey) {
    throw new Error('Firebase config is missing.');
  }

  try {
    const resolvedConfig = resolveFirebaseConfig(firebaseConfig);
    if (!process.env.FIREBASE_ADMIN_PROJECT_ID && resolvedConfig.projectId) {
      process.env.FIREBASE_ADMIN_PROJECT_ID = resolvedConfig.projectId;
    }

    let verifiedUid: string | null = null;
    if (authToken) {
      try {
        const decoded = await adminAuth.verifyIdToken(authToken);
        verifiedUid = decoded.uid;
      } catch (authError) {
        if (!shouldUseEmulators) {
          throw new Error('Failed to verify auth token.');
        }
      }
    }

    if (!verifiedUid && !shouldUseEmulators) {
      throw new Error('Auth token required to create a game.');
    }

    if (verifiedUid && verifiedUid !== creatorId) {
      throw new Error('Creator ID mismatch with authenticated user.');
    }

    const gameId = generateGameId();

    const wordLength = typeof gameSettings.wordLength === 'number' ? gameSettings.wordLength : 5;
    const normalizedLength = Math.max(4, Math.min(6, wordLength));
    const solution = normalizeWord(getRandomWord(normalizedLength));
    const maxAttempts = 6;
    
    const createdAt = new Date().toISOString();
    const initialStatus = gameSettings.gameType === 'multiplayer' ? 'waiting' : 'in_progress';
    const matchMinutes = parseMinutes(gameSettings.matchTime);
    const initialMatchDeadline = initialStatus === 'in_progress' && matchMinutes
      ? addMinutes(createdAt, matchMinutes)
      : null;
    const initialGameData = {
      ...gameSettings,
      wordLength: normalizedLength,
      creatorId,
      status: initialStatus,
      players: [creatorId],
      activePlayers: [creatorId],
      turnOrder: [],
      currentTurnPlayerId: null,
      createdAt,
      solution,
      maxAttempts,
      guesses: [],
      winnerId: null,
      endVotes: [],
      completionMessage: null,
      endedBy: null,
      lobbyClosesAt: null,
      lastActivityAt: createdAt,
      inactivityClosesAt: initialStatus === 'in_progress' ? addMinutes(createdAt, 30) : null,
      matchDeadline: initialMatchDeadline,
      turnDeadline: null,
      completedAt: null,
    };

    await adminDb.collection('games').doc(gameId).set(initialGameData);

    return gameId;
  } catch (error) {
    console.error("Error creating game:", error);
    return null;
  }
}
