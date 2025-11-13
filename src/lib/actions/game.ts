'use server';

import { getApp, getApps, initializeApp } from 'firebase/app';
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

export async function createGame(settings: any) {
  const { creatorId, ...gameSettings } = settings;

  if (!creatorId) {
    throw new Error("Creator ID is missing. The client must provide the user's UID.");
  }

  try {
    const firebaseConfig = {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    };
    
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
