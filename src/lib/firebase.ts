'use client';

import { initializeApp, getApps, getApp, type FirebaseOptions } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const shouldUseEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';
let emulatorsLinked = false;

function initializeFirebase() {
  const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
  const auth = getAuth(app);
  const db = getFirestore(app);

  if (shouldUseEmulators && !emulatorsLinked) {
    const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
    const firestorePort = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT ?? '8080');
    const authPort = Number(process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_AUTH_PORT ?? '9099');
    connectFirestoreEmulator(db, host, firestorePort);
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    emulatorsLinked = true;
  }

  return { app, auth, db };
}

export { initializeFirebase };
