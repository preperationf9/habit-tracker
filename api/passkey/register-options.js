import { generateRegistrationOptions } from '@simplewebauthn/server';
import { randomBytes } from 'node:crypto';
import { getFirebaseAdmin } from '../lib/firebaseAdmin.js';

const expectedOrigin =
  (process.env.PASSKEY_ORIGIN || 'https://habit-tracker-three-mocha.vercel.app').replace(/\/+$/, '');

const expectedRPID = (process.env.PASSKEY_RP_ID || 'habit-tracker-three-mocha.vercel.app').replace(/^https:\/\//, '');
const rpName = process.env.PASSKEY_RP_NAME || 'Habit Tracker';

function normalizeRequestOrigin(origin) {
  if (typeof origin !== 'string') return null;
  return origin.trim().replace(/\/+$/, '');
}

function setCors(res, allowOrigin) {
  if (allowOrigin) res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function getBearerToken(req) {
  const auth = req.headers?.authorization;
  if (!auth || typeof auth !== 'string') return null;
  const parts = auth.split(' ');
  if (parts.length !== 2) return null;
  if (parts[0] !== 'Bearer') return null;
  return parts[1] || null;
}

async function requireFirebaseUser(req, res) {
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ ok: false, error: 'AUTHORIZATION_REQUIRED' });
    return null;
  }

  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const uid = decoded?.uid;
    if (!uid) {
      res.status(401).json({ ok: false, error: 'INVALID_FIREBASE_TOKEN' });
      return null;
    }

    // Guest must be rejected server-side.
    // In this project, Guest is unauthenticated; a valid Firebase token implies non-Guest.
    return {
      uid,
      email: decoded?.email || null,
      name: decoded?.name || decoded?.email || null,
    };
  } catch {
    res.status(401).json({ ok: false, error: 'INVALID_FIREBASE_TOKEN' });
    return null;
  }
}

function buildExcludeCredentialsFromStored(storedCreds) {
  // v11 expects base64url credential IDs
  const out = [];
  for (const cred of storedCreds) {
    if (!cred || typeof cred !== 'object') continue;
    const id = cred.credentialId;
    if (typeof id !== 'string' || !id) continue;
    const transports = Array.isArray(cred.transports) ? cred.transports : undefined;
    out.push({
      id,
      type: 'public-key',
      ...(transports ? { transports } : {}),
    });
  }
  return out;
}

function sanitizeDeviceName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().slice(0, 80) || '';
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Secure CORS
  const requestOrigin = typeof req.headers?.origin === 'string' ? req.headers.origin.trim().replace(/\/+$/, '') : null;
  if (requestOrigin && requestOrigin !== expectedOrigin) {
    res.status(403).json({ ok: false, error: 'ORIGIN_NOT_ALLOWED' });
    return;
  }

  setCors(res, requestOrigin ? expectedOrigin : null);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    return;
  }

  const user = await requireFirebaseUser(req, res);
  if (!user) return;

  try {
    const { db } = getFirebaseAdmin();

    const credsSnap = await db
      .collection('passkeyCredentials')
      .where('uid', '==', user.uid)
      .get();

    const storedCreds = [];
    credsSnap.forEach((doc) => {
      const d = doc.data() || {};
      storedCreds.push({
        credentialId: d.credentialId || doc.id,
        transports: Array.isArray(d.transports) ? d.transports : undefined,
      });
    });

    const excludeCredentials = buildExcludeCredentialsFromStored(storedCreds);

    const userID = new TextEncoder().encode(user.uid);

    // userName must be stable and safe
    const userName = user.email || user.uid;
    const userDisplayName = user.name || user.email || user.uid;

    const options = await generateRegistrationOptions({
      rpName,
      rpID: expectedRPID,
      userID,
      userName,
      userDisplayName,
      attestationType: 'none',
      timeout: 60000,
      authenticatorSelection: {
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      excludeCredentials,
    });

    const sessionId = randomBytes(24).toString('base64url');
    const challenge = options.challenge;

    const nowMs = Date.now();
    const expiresAtMs = nowMs + 5 * 60 * 1000;

    const Timestamp = db.constructor?.Timestamp;
    const createdAt = Timestamp?.fromMillis ? Timestamp.fromMillis(nowMs) : new Date(nowMs);
    const expiresAt = Timestamp?.fromMillis ? Timestamp.fromMillis(expiresAtMs) : new Date(expiresAtMs);

    await db
      .collection('passkeyChallenges')
      .doc(sessionId)
      .set({
        uid: user.uid,
        challenge,
        type: 'registration',
        rpID: expectedRPID,
        expectedOrigin,
        createdAt,
        expiresAt,
      });

    res.status(200).json({
      ok: true,
      sessionId,
      options,
    });
  } catch {
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
}

