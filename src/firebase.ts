import { FirebaseApp, initializeApp } from 'firebase/app';
import { Auth, getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, Firestore, getDocFromServer, getFirestore } from 'firebase/firestore';
import { FirebaseStorage, getStorage } from 'firebase/storage';

declare const __APPLET_FIRESTORE_DATABASE_ID__: string | undefined;
declare const __APPLET_PROJECT_ID__: string | undefined;

const rawDatabaseEnv = String(
  import.meta.env.VITE_FIREBASE_FIRESTORE_DATABASE_ID ||
    import.meta.env.VITE_FIREBASE_DATABASE_ID ||
    ''
).trim();

const isRtdbUrl = /^https?:\/\//i.test(rawDatabaseEnv) || rawDatabaseEnv.includes('firebaseio.com');

const projectIdFromEnv = String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
const appletDbId =
  typeof __APPLET_FIRESTORE_DATABASE_ID__ === 'string'
    ? __APPLET_FIRESTORE_DATABASE_ID__.trim()
    : '';
const appletProjectId =
  typeof __APPLET_PROJECT_ID__ === 'string' ? __APPLET_PROJECT_ID__.trim() : '';

const resolvedFirestoreDatabaseId =
  rawDatabaseEnv && !isRtdbUrl
    ? rawDatabaseEnv
    : appletDbId && (!appletProjectId || appletProjectId === projectIdFromEnv)
    ? appletDbId
    : '(default)';

const firebaseEnvConfig = {
  apiKey: String(import.meta.env.VITE_FIREBASE_API_KEY || '').trim(),
  authDomain: String(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim(),
  projectId: projectIdFromEnv,
  storageBucket: String(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '').trim(),
  messagingSenderId: String(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '').trim(),
  appId: String(import.meta.env.VITE_FIREBASE_APP_ID || '').trim(),
  databaseURL: isRtdbUrl ? rawDatabaseEnv : '',
  firestoreDatabaseId: resolvedFirestoreDatabaseId,
};

const REQUIRED_FIREBASE_ENV_KEYS: {
  field: 'apiKey' | 'authDomain' | 'projectId' | 'storageBucket' | 'messagingSenderId' | 'appId';
  envName: string;
}[] = [
  { field: 'apiKey', envName: 'VITE_FIREBASE_API_KEY' },
  { field: 'authDomain', envName: 'VITE_FIREBASE_AUTH_DOMAIN' },
  { field: 'projectId', envName: 'VITE_FIREBASE_PROJECT_ID' },
  { field: 'storageBucket', envName: 'VITE_FIREBASE_STORAGE_BUCKET' },
  { field: 'messagingSenderId', envName: 'VITE_FIREBASE_MESSAGING_SENDER_ID' },
  { field: 'appId', envName: 'VITE_FIREBASE_APP_ID' },
];

export const missingFirebaseEnvVars: string[] = REQUIRED_FIREBASE_ENV_KEYS
  .filter(({ field }) => !firebaseEnvConfig[field])
  .map(({ envName }) => envName);

export const isFirebaseConfigured = missingFirebaseEnvVars.length === 0;

let appInstance: FirebaseApp | null = null;
let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let storageInstance: FirebaseStorage | null = null;
let googleProviderInstance: GoogleAuthProvider | null = null;

if (isFirebaseConfigured) {
  appInstance = initializeApp({
    apiKey: firebaseEnvConfig.apiKey,
    authDomain: firebaseEnvConfig.authDomain,
    projectId: firebaseEnvConfig.projectId,
    storageBucket: firebaseEnvConfig.storageBucket,
    messagingSenderId: firebaseEnvConfig.messagingSenderId,
    appId: firebaseEnvConfig.appId,
    ...(firebaseEnvConfig.databaseURL ? { databaseURL: firebaseEnvConfig.databaseURL } : {}),
  });

  dbInstance = getFirestore(appInstance, firebaseEnvConfig.firestoreDatabaseId);
  authInstance = getAuth(appInstance);
  storageInstance = getStorage(appInstance);
  googleProviderInstance = new GoogleAuthProvider();
} else {
  console.error(
    `Guard AI halted: missing required Firebase environment variables: ${missingFirebaseEnvVars.join(', ')}`
  );
}

function unconfiguredErrorProxy<T extends object>(serviceName: string): T {
  return new Proxy({} as T, {
    get() {
      throw new Error(
        `Firebase ${serviceName} cannot be used because required environment variables are missing: ${missingFirebaseEnvVars.join(', ')}`
      );
    },
  });
}

export const db: Firestore = dbInstance ?? unconfiguredErrorProxy<Firestore>('Firestore');
export const auth: Auth = authInstance ?? unconfiguredErrorProxy<Auth>('Auth');
export const storage: FirebaseStorage =
  storageInstance ?? unconfiguredErrorProxy<FirebaseStorage>('Storage');
export const googleProvider: GoogleAuthProvider =
  googleProviderInstance ?? unconfiguredErrorProxy<GoogleAuthProvider>('GoogleAuthProvider');

export const ADMIN_EMAILS = ['admin@guardai.ng', 'abrahamuwe77@gmail.com'];

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const currentUser = authInstance?.currentUser ?? null;
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: currentUser?.uid ?? null,
      email: currentUser?.email ?? null,
      emailVerified: currentUser?.emailVerified ?? null,
      isAnonymous: currentUser?.isAnonymous ?? null,
      tenantId: currentUser?.tenantId ?? null,
      providerInfo:
        currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testConnection(): Promise<boolean> {
  if (!isFirebaseConfigured || !dbInstance) {
    return false;
  }
  try {
    await getDocFromServer(doc(dbInstance, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration — Firestore client is offline.');
      return false;
    }
    return true;
  }
}

if (isFirebaseConfigured) {
  void testConnection();
}
