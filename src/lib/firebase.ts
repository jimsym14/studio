'use client';

import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';

function cleanEnvValue(value?: string): string | undefined {
  if (!value) return undefined;

  let normalized = value.trim();

  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Ignore decoding issues; fall back to raw string.
  }

  normalized = normalized
    .replace(/^['"`]+/, '')
    .replace(/[,'"`]+$/, '')
    .replace(/\s+/g, '');

  return normalized || undefined;
}

const firebaseConfig: FirebaseOptions = {
  apiKey: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_API_KEY),
  authDomain: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN),
  projectId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID),
  storageBucket: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID),
  appId: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_APP_ID),
  databaseURL: cleanEnvValue(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL),
};

const shouldUseEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
let emulatorsLinked = false;

function initializeFirebase() {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const rtdb = getDatabase(app);

  if (shouldUseEmulators && !emulatorsLinked) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
    const firestorePort = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT ?? '8080');
    const authPort = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT ?? '9099');
    const databasePort = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_DATABASE_PORT ?? '9000');
    connectFirestoreEmulator(db, host, firestorePort);
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectDatabaseEmulator(rtdb, host, databasePort);
    emulatorsLinked = true;
  }

  return { app, auth, db, rtdb };
}

export { initializeFirebase };
