// lib/firebase.ts — Firebase Client SDK initialization
import { initializeApp, getApps } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.databaseURL
);

// Avoid crashing server-side builds when client env vars are not injected.
const app = hasFirebaseConfig
  ? (!getApps().length ? initializeApp(firebaseConfig) : getApps()[0])
  : null;

const db: Database | null = app ? getDatabase(app) : null;
const storage: FirebaseStorage | null = app ? getStorage(app) : null;

export { app, db, storage, hasFirebaseConfig };
