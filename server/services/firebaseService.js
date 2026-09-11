/**
 * Firebase Admin SDK Service
 * Auto-detects Firebase Local Emulator when FIREBASE_USE_EMULATOR=true
 */

const admin = require('firebase-admin');
const { loadServiceAccount } = require('./googleCredentialService');

let db = null;
let storage = null;
let initialized = false;

function initFirebase() {
  if (initialized) return;

  const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';

  if (!admin.apps.length) {
    if (useEmulator) {
      admin.initializeApp({
        projectId: process.env.FIREBASE_PROJECT_ID || 'gulf-career-dashboard',
        databaseURL: process.env.FIREBASE_DATABASE_URL || 'http://127.0.0.1:9000/?ns=gulf-career-dashboard-default-rtdb',
        storageBucket: process.env.GCS_BUCKET_NAME || 'gulf-career-dashboard.appspot.com',
      });
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
      process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
      console.log('[Firebase] Connected to LOCAL EMULATOR');
    } else {
      console.log('[Firebase] Initializing Production...');
      console.log('[Firebase] DB URL:', process.env.FIREBASE_DATABASE_URL);

      const { account, source } = loadServiceAccount({
        envKeys: ['FIREBASE_ADMIN_KEY', 'OLD_FIREBASE_ADMIN_KEY'],
        fallbackPath: require('path').join(__dirname, '../../firebase-service-account.json'),
      });
      console.log(`[Firebase] Credential source: ${source}`);

        try {
          if (account) {
            admin.initializeApp({
              credential: admin.credential.cert(account),
              databaseURL: process.env.FIREBASE_DATABASE_URL,
              storageBucket: process.env.GCS_BUCKET_NAME,
            });
            console.log('[Firebase] Initialized via Service Account');
          } else {
            console.warn('[Firebase] No service account key found. Falling back to Application Default Credentials.');
            admin.initializeApp({
              credential: admin.credential.applicationDefault(),
              databaseURL: process.env.FIREBASE_DATABASE_URL,
              storageBucket: process.env.GCS_BUCKET_NAME,
            });
            console.log('[Firebase] Initialized via Application Default Credentials');
          }
        } catch (err) {
          console.warn('[Firebase] Primary initialization failed. Attempting final fallback to Application Default Credentials:', err.message);
          try {
            // Clear any partial initialization attempts if possible
            if (admin.apps.length === 0) {
              admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                databaseURL: process.env.FIREBASE_DATABASE_URL,
                storageBucket: process.env.GCS_BUCKET_NAME,
              });
              console.log('[Firebase] Recovered via Application Default Credentials');
            }
          } catch (fallbackErr) {
            console.error('[Firebase] CRITICAL: All initialization attempts failed. Server will continue but DB features might fail:', fallbackErr.message);
          }
        }
      }
  }

  db = admin.database();
  storage = admin.storage();
  initialized = true;
}

// RTDB Helpers

async function rtdbSet(path, data) {
  initFirebase();
  return db.ref(path).set(data);
}

async function rtdbPush(path, data) {
  initFirebase();
  const ref = db.ref(path).push();
  await ref.set({ ...data, id: ref.key });
  return ref.key;
}

async function rtdbGet(path) {
  initFirebase();
  const snap = await db.ref(path).once('value');
  return snap.val();
}

async function rtdbUpdate(path, data) {
  initFirebase();
  if (Array.isArray(data)) {
    console.warn(`[Firebase] rtdbUpdate converting Array to Object at "${path}"`);
    data = Object.assign({}, data);
  }
  return db.ref(path).update(data);
}

async function rtdbGetFiltered(path, field, value) {
  initFirebase();
  const snap = await db.ref(path).orderByChild(field).equalTo(value).once('value');
  return snap.val();
}

async function rtdbGetAll(path) {
  initFirebase();
  const snap = await db.ref(path).once('value');
  const val = snap.val();
  if (!val) return [];
  return Object.entries(val).map(([key, data]) => ({ ...data, id: key }));
}

function safeFirebaseKey(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64url');
}

module.exports = {
  initFirebase,
  rtdbSet,
  rtdbPush,
  rtdbGet,
  rtdbUpdate,
  rtdbGetFiltered,
  rtdbGetAll,
  safeFirebaseKey,
  getDb: () => { initFirebase(); return db; },
  getStorage: () => { initFirebase(); return storage; },
};
