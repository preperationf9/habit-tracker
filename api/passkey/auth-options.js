import { generateAuthenticationOptions } from '@simplewebauthn/server';
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

function getMillisFromFirestoreTimestamp(ts) {

  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  // Secure CORS + strict origin match
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

  // SIGNED-OUT: auth-options must not require a Firebase currentUser.
  // We generate an authentication ceremony without tying it to a request UID.
  // However, generateAuthenticationOptions requires allowCredentials; we cannot safely
  // derive allowCredentials without a credential set. We therefore require that the
  // browser receives allowCredentials by using a default single-credential allow list.
  // If the account has multiple passkeys, the backend should be extended to support
  // discoverable credentials. For this build we accept allowCredentials-less auth is
  // not supported by generateAuthenticationOptions.

  try {
    const { db } = getFirebaseAdmin();

    // Read a small credential allow list; the verifier will still identify the user
    // exclusively from credentialId -> stored credential.uid.
    const credsSnap = await db
      .collection('passkeyCredentials')
      .limit(50)
      .get();


    const storedCreds = [];
    credsSnap.forEach((doc) => {
      const d = doc.data() || {};
      // credentialId stored as string; doc.id is also credentialId.
      const credentialId = typeof d.credentialId === 'string' && d.credentialId ? d.credentialId : doc.id;
      if (!credentialId) return;

      const counter = typeof d.counter === 'number' ? d.counter : Number(d.counter) || 0;
      const transports = Array.isArray(d.transports) ? d.transports : undefined;
      storedCreds.push({ credentialId, counter, transports });
    });


    if (!storedCreds.length) {
      res.status(404).json({ ok: false, error: 'NO_PASSKEY_CREDENTIAL' });
      return;
    }

    // For passkey authentication ceremony generation, SimpleWebAuthn requires a userID field.
    // For passwordless signed-out auth we use a stable placeholder userID.
    // The verifier will still identify the user exclusively from credentialId -> stored credential.uid.
    const placeholderUid = new TextEncoder().encode('passkey-auth');

    const authenticationOptions = await generateAuthenticationOptions({
      rpName,
      rpID: expectedRPID,
      userID: placeholderUid,
      userVerification: 'required',
      timeout: 60000,

      allowCredentials: storedCreds.map((c) => ({
        id: c.credentialId,
        type: 'public-key',
        ...(c.transports ? { transports: c.transports } : {}),
      })),
    });

    // Create secure one-time sessionId
    const sessionId = randomBytes(24).toString('base64url');
    const challenge = authenticationOptions.challenge;

    const nowMs = Date.now();
    const expiresAtMs = nowMs + 5 * 60 * 1000;

    const Timestamp = db.constructor?.Timestamp;
    const createdAt = Timestamp?.fromMillis ? Timestamp.fromMillis(nowMs) : new Date(nowMs);
    const expiresAt = Timestamp?.fromMillis ? Timestamp.fromMillis(expiresAtMs) : new Date(expiresAtMs);

    await db.collection('passkeyChallenges').doc(sessionId).set({
      uid: null,

      challenge,
      type: 'authentication',
      rpID: expectedRPID,
      expectedOrigin,
      createdAt,
      expiresAt,
    });

    res.status(200).json({
      ok: true,
      sessionId,
      options: authenticationOptions,
    });
  } catch {
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
}

