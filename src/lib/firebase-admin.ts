import { cert, getApp, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const useEmulators = process.env.NEXT_PUBLIC_FIREBASE_USE_EMULATORS === 'true';

const readServiceAccount = (): ServiceAccount | null => {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (inline) {
    try {
      return JSON.parse(inline) as ServiceAccount;
    } catch (error) {
      console.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY', error);
      throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON');
    }
  }

  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const projectId =
    process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  if (clientEmail && privateKey && projectId) {
    return { projectId, clientEmail, privateKey } satisfies ServiceAccount;
  }

  return null;
};

const ensureFirestoreEmulator = () => {
  if (!useEmulators) return;
  const host = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_HOST ?? '127.0.0.1';
  const port = process.env.NEXT_PUBLIC_FIREBASE_EMULATOR_FIRESTORE_PORT ?? '8080';
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = `${host}:${port}`;
  }
};

const resolveProjectId = () => {
  return process.env.FIREBASE_ADMIN_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
};

const initAdminApp = () => {
  if (getApps().length) {
    return getApp();
  }

  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error('Missing Firebase project ID for admin SDK');
  }

  if (useEmulators) {
    ensureFirestoreEmulator();
    return initializeApp({ projectId });
  }

  const serviceAccount = readServiceAccount();
  if (!serviceAccount) {
    throw new Error(
      'Set FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_ADMIN_CLIENT_EMAIL/FIREBASE_ADMIN_PRIVATE_KEY to enable server writes.'
    );
  }

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.projectId ?? projectId,
  });
};

const adminApp = initAdminApp();
const adminAuth = getAuth(adminApp);
const adminDb = getFirestore(adminApp);

export { adminApp, adminAuth, adminDb };
