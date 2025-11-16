import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

import type { UserPreferences } from '@/types/user';
import { DEFAULT_PREFERENCES, type UserProfile } from '@/types/user';

const PROFILES_COLLECTION = 'profiles';

export const usernameRegex = /^[a-zA-Z0-9._-]{3,20}$/;

export const sanitizeUsername = (value: string) => value.trim();
export const isUsernameValid = (value: string) => usernameRegex.test(sanitizeUsername(value));

const usernameToLower = (value: string) => sanitizeUsername(value).toLowerCase();

export async function isUsernameAvailable(
  db: Firestore,
  username: string,
  currentUserId?: string
): Promise<boolean> {
  const normalized = usernameToLower(username);
  const profilesRef = collection(db, PROFILES_COLLECTION);
  const snapshot = await getDocs(query(profilesRef, where('usernameLower', '==', normalized)));
  if (snapshot.empty) return true;
  return snapshot.docs.every((docSnapshot) => docSnapshot.id === currentUserId);
}

export type ProfileInput = {
  username: string;
  authProvider: UserProfile['authProvider'];
  email?: string | null;
  photoURL?: string | null;
  avatarSeed?: string;
  preferences?: UserPreferences;
};

export async function upsertProfile(db: Firestore, uid: string, payload: ProfileInput) {
  const profileRef = doc(collection(db, PROFILES_COLLECTION), uid);
  const now = serverTimestamp();
  const cleanUsername = sanitizeUsername(payload.username);
  const toSave: UserProfile = {
    uid,
    username: cleanUsername,
    usernameLower: usernameToLower(payload.username),
    authProvider: payload.authProvider,
    email: payload.email ?? null,
    photoURL: payload.photoURL ?? null,
    preferences: payload.preferences ?? DEFAULT_PREFERENCES,
    updatedAt: now,
  };

  if (typeof payload.avatarSeed === 'string' && payload.avatarSeed.length > 0) {
    toSave.avatarSeed = payload.avatarSeed;
  } else if (!payload.photoURL) {
    toSave.avatarSeed = cleanUsername;
  }

  const existing = await getDoc(profileRef);
  if (!existing.exists()) {
    toSave.createdAt = now;
  }

  await setDoc(profileRef, toSave, { merge: true });
}

export async function updatePreferences(db: Firestore, uid: string, preferences: Partial<UserPreferences>) {
  const profileRef = doc(collection(db, PROFILES_COLLECTION), uid);
  const payload: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };

  if (preferences.language) {
    payload['preferences.language'] = preferences.language;
  }

  if (preferences.theme) {
    payload['preferences.theme'] = preferences.theme;
  }

  await updateDoc(profileRef, payload);
}

export async function fetchProfile(db: Firestore, uid: string) {
  const profileRef = doc(collection(db, PROFILES_COLLECTION), uid);
  const snapshot = await getDoc(profileRef);
  return snapshot.exists() ? (snapshot.data() as UserProfile) : null;
}

export async function findEmailByUsername(db: Firestore, username: string): Promise<string | null> {
  const normalized = usernameToLower(username);
  const profilesRef = collection(db, PROFILES_COLLECTION);
  const snapshot = await getDocs(query(profilesRef, where('usernameLower', '==', normalized)));
  if (snapshot.empty) return null;
  const match = snapshot.docs[0].data() as UserProfile;
  return match.email ?? null;
}
