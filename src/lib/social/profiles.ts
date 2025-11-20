import { adminDb } from '@/lib/firebase-admin';

const PROFILES_COLLECTION = 'profiles';

export interface AdminProfileRecord {
  username?: string;
  displayName?: string;
  photoURL?: string | null;
  authProvider?: string | null;
}

export const fetchProfileById = async (uid: string): Promise<AdminProfileRecord | null> => {
  try {
    const snapshot = await adminDb.collection(PROFILES_COLLECTION).doc(uid).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as AdminProfileRecord;
  } catch (error) {
    console.error('Failed to fetch profile', uid, error);
    return null;
  }
};

export const fetchProfilesByIds = async (uids: string[]): Promise<Record<string, AdminProfileRecord | null>> => {
  const unique = Array.from(new Set(uids.filter((id) => typeof id === 'string' && id.length > 0)));
  const results: Record<string, AdminProfileRecord | null> = {};
  await Promise.all(
    unique.map(async (uid) => {
      results[uid] = await fetchProfileById(uid);
    })
  );
  return results;
};

export const isGuestProfile = (profile: AdminProfileRecord | null | undefined) => {
  if (!profile) return true;
  if (profile.authProvider) {
    return profile.authProvider === 'guest';
  }
  return false;
};
