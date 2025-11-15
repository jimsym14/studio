'use server';

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { doc, setDoc, getFirestore } from 'firebase/firestore';
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

export async function createGame(settings: any, firebaseConfig: FirebaseOptions) {
  const { creatorId, ...gameSettings } = settings;

  if (!creatorId) {
    throw new Error("Creator ID is missing. The client must provide the user's UID.");
  }
  
  if (!firebaseConfig.apiKey) {
    throw new Error('Firebase config is missing.');
  }

  try {
    const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
    const db = getFirestore(app);

    const gameId = generateGameId();
    const gameRef = doc(db, 'games', gameId);

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

    await setDoc(gameRef, initialGameData);

    return gameId;
  } catch (error) {
    console.error("Error creating game:", error);
    return null;
  }
}
