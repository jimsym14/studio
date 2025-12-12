import type { FieldValue, Timestamp } from 'firebase/firestore';

export type AuthProviderType = 'guest' | 'google' | 'password';

export type UserLanguage = 'EN' | 'EL';
export type UserThemePreference = 'light' | 'dark' | 'system';

export interface UserPreferences {
  language: UserLanguage;
  theme: UserThemePreference;
}

export interface UserProfile {
  uid: string;
  username: string;
  usernameLower: string;
  authProvider: AuthProviderType;
  email?: string | null;
  photoURL?: string | null;
  avatarSeed?: string;
  preferences?: UserPreferences;
  createdAt?: Timestamp | FieldValue;
  updatedAt?: Timestamp | FieldValue;
  daily?: {
    lastSolvedDate: string; // ISO Date YYYY-MM-DD
    streak: number;
    maxStreak: number;
    history: Record<string, { word: string; guesses: number; result: 'won' | 'lost' }>;
    gameState?: {
      date: string;
      guesses: { word: string; evaluations: (string | null)[] }[];
    };
  };
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  language: 'EN',
  theme: 'system',
};

export const isGuestProfile = (profile?: UserProfile | null) => profile?.authProvider === 'guest';
