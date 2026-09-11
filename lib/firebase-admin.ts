import "server-only";

import fs from "fs";
import admin from "firebase-admin";

type FirebaseServiceAccount = admin.ServiceAccount & {
  private_key?: string;
};

const DEFAULT_DATABASE_URL =
  process.env.FIREBASE_DATABASE_URL ||
  "https://gulf-career-whatsapp-dashboard-default-rtdb.asia-southeast1.firebasedatabase.app";

function parseServiceAccount(rawValue: string): FirebaseServiceAccount {
  const serviceAccount = JSON.parse(rawValue) as FirebaseServiceAccount;

  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
  }

  return serviceAccount;
}

function loadServiceAccountFromEnv(): FirebaseServiceAccount | null {
  const rawValue = process.env.FIREBASE_ADMIN_KEY?.trim();

  if (!rawValue) {
    return null;
  }

  try {
    return parseServiceAccount(rawValue);
  } catch {
    const decodedValue = Buffer.from(rawValue, "base64").toString("utf8");
    return parseServiceAccount(decodedValue);
  }
}

function loadServiceAccountFromFiles(): FirebaseServiceAccount | null {
  const candidatePaths = [
    "secrets/firebase-service-account.json",
    "/app/secrets/firebase-service-account.json",
  ];

  for (const filePath of candidatePaths) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    return parseServiceAccount(fs.readFileSync(filePath, "utf8"));
  }

  return null;
}

export function getFirebaseAdminApp() {
  if (admin.apps.length) {
    return admin.app();
  }

  if (process.env.FIREBASE_USE_EMULATOR === "true") {
    process.env.FIREBASE_DATABASE_EMULATOR_HOST ??= "127.0.0.1:9000";
    process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= "127.0.0.1:9199";

    return admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || "gulf-career-dashboard",
      databaseURL:
        process.env.FIREBASE_DATABASE_URL ||
        "http://127.0.0.1:9000/?ns=gulf-career-dashboard-default-rtdb",
      storageBucket: process.env.GCS_BUCKET_NAME || "gulf-career-dashboard.appspot.com",
    });
  }

  const serviceAccount = loadServiceAccountFromEnv() ?? loadServiceAccountFromFiles();

  if (!serviceAccount) {
    throw new Error("No Firebase service account found in env or expected file paths.");
  }

  return admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DEFAULT_DATABASE_URL,
    storageBucket: process.env.GCS_BUCKET_NAME,
  });
}

export function getFirebaseAdminDb() {
  getFirebaseAdminApp();
  return admin.database();
}
