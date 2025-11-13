'use server';

import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { doc, setDoc, getFirestore } from 'firebase/firestore';

// A simple random ID generator
function generateGameId(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
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
    
    const initialGameData = {
      ...gameSettings,
      creatorId: creatorId,
      status: 'waiting',
      players: [creatorId],
      createdAt: new Date().toISOString(),
    };

    await setDoc(gameRef, initialGameData);

    return gameId;
  } catch (error) {
    console.error("Error creating game:", error);
    return null;
  }
}
