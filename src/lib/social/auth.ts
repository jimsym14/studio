import type { DecodedIdToken } from 'firebase-admin/auth';
import { NextRequest } from 'next/server';

import { adminAuth, adminDb } from '@/lib/firebase-admin';

import { ApiError } from './errors';
import type { RequestUser } from './types';

const PROFILES_COLLECTION = 'profiles';
const bearerRegex = /^Bearer\s+(.+)$/i;

const readAuthToken = (request: NextRequest): string | null => {
  const headerToken = request.headers.get('authorization');
  if (headerToken) {
    const match = headerToken.match(bearerRegex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const directHeader = request.headers.get('x-firebase-token');
  if (directHeader) {
    return directHeader.trim();
  }

  const sessionCookie = request.cookies.get('__session')?.value;
  if (sessionCookie) {
    return sessionCookie;
  }

  return null;
};

const fetchProfile = async (uid: string) => {
  try {
    const snapshot = await adminDb.collection(PROFILES_COLLECTION).doc(uid).get();
    if (!snapshot.exists) return null;
    return snapshot.data() as { username?: string; displayName?: string; authProvider?: string };
  } catch (error) {
    console.error('Failed to load profile', uid, error);
    return null;
  }
};

const deriveIsGuest = (decoded: DecodedIdToken, authProvider?: string | null) => {
  if (authProvider) {
    return authProvider === 'guest';
  }
  const providerId = decoded.firebase?.sign_in_provider;
  return providerId === 'anonymous';
};

export const resolveUserFromToken = async (token: string | null): Promise<RequestUser | null> => {
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    const profile = await fetchProfile(decoded.uid);
    return {
      uid: decoded.uid,
      username: profile?.username ?? decoded.uid,
      displayName: profile?.displayName ?? decoded.name ?? profile?.username ?? null,
      isGuest: deriveIsGuest(decoded, profile?.authProvider ?? null),
    } satisfies RequestUser;
  } catch (error) {
    console.error('Failed to decode auth token', error);
    return null;
  }
};

export const resolveRequestUser = async (request: NextRequest): Promise<RequestUser | null> => {
  const token = readAuthToken(request);
  return resolveUserFromToken(token);
};

export const requireRequestUser = async (request: NextRequest): Promise<RequestUser> => {
  const user = await resolveRequestUser(request);
  if (!user) {
    throw new ApiError(401, 'Authentication required');
  }
  return user;
};
