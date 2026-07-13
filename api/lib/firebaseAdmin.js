import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

export function getFirebaseAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();

  if (!projectId) throw new Error('MISSING_FIREBASE_PROJECT_ID');
  if (!clientEmail) throw new Error('MISSING_FIREBASE_CLIENT_EMAIL');
  if (!rawPrivateKey) throw new Error('MISSING_FIREBASE_PRIVATE_KEY');

  const privateKey = String(rawPrivateKey)
    .replace(/^"(.*)"$/s, '$1')
    .replace(/\\n/g, '\n');

  const hasBegin = privateKey.includes('-----BEGIN PRIVATE KEY-----');
  const hasEnd = privateKey.includes('-----END PRIVATE KEY-----');
  if (!hasBegin || !hasEnd) throw new Error('INVALID_PRIVATE_KEY_FORMAT');

  try {
    const existingApps = getApps();
    const adminApp =
      existingApps && existingApps.length
        ? existingApps[0]
        : initializeApp({
            credential: cert({
              projectId,
              clientEmail,
              privateKey,
            }),
          });

    return {
      adminApp,
      auth: getAuth(adminApp),
      db: getFirestore(adminApp),
    };
  } catch {
    throw new Error('FIREBASE_ADMIN_INIT_FAILED');
  }
}

