import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { getFirebaseAdmin } from '../lib/firebaseAdmin.js';

const expectedOrigin =
  (process.env.PASSKEY_ORIGIN || 'https://habit-tracker-three-mocha.vercel.app').replace(/\/+$/, '');

const expectedRPID = (process.env.PASSKEY_RP_ID || 'habit-tracker-three-mocha.vercel.app').replace(/^https:\/\//, '');

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
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

function getMillisFromFirestoreTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  return null;
}

function base64UrlToBuffer(b64url) {
  if (typeof b64url !== 'string' || !b64url) return null;
  try {
    return Buffer.from(b64url, 'base64url');
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

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

  const { sessionId, credential } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' });
    return;
  }

  if (!credential || typeof credential !== 'object') {
    res.status(400).json({ ok: false, error: 'CREDENTIAL_REQUIRED' });
    return;
  }

  try {
    const { db, auth } = getFirebaseAdmin();

    const sessionRef = db.collection('passkeyChallenges').doc(sessionId);

    const result = await db.runTransaction(async (tx) => {
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) throw new ApiError(404, 'CHALLENGE_NOT_FOUND');

      const sessionData = sessionSnap.data() || {};

      if (sessionData.type !== 'authentication') throw new ApiError(400, 'INVALID_CHALLENGE_TYPE');

      const expiresAtMs = getMillisFromFirestoreTimestamp(sessionData.expiresAt);
      if (!expiresAtMs) throw new ApiError(410, 'CHALLENGE_EXPIRED');
      if (Date.now() > expiresAtMs) throw new ApiError(410, 'CHALLENGE_EXPIRED');

      // Never trust browser uid.
      // Challenge uid is what we use as the authenticated identity in this flow.
      const challengeUid = sessionData.uid;
      if (!challengeUid || typeof challengeUid !== 'string') throw new ApiError(400, 'INVALID_CHALLENGE_UID');

      // Ensure the signed-in Firebase token matches the challenge uid
      // (prevents using an authentication challenge created for a different signed-in account).
      if (challengeUid !== user.uid) throw new ApiError(403, 'CHALLENGE_USER_MISMATCH');

      const storedRPID = sessionData.rpID;
      const storedExpectedOrigin = sessionData.expectedOrigin;

      if (storedRPID !== expectedRPID) throw new ApiError(400, 'CHALLENGE_CONFIGURATION_MISMATCH');
      if (storedExpectedOrigin !== expectedOrigin) throw new ApiError(400, 'CHALLENGE_CONFIGURATION_MISMATCH');

      const response = credential;
      if (!response?.response) throw new ApiError(400, 'CREDENTIAL_INVALID');

      const decodedId = response?.response?.credentialId;
      const credentialId = typeof decodedId === 'string' && decodedId ? decodedId : null;
      if (!credentialId) throw new ApiError(400, 'CREDENTIAL_ID_REQUIRED');

      // Look up credential by credentialId
      const credRef = db.collection('passkeyCredentials').doc(credentialId);
      const credSnap = await tx.get(credRef);
      if (!credSnap.exists) throw new ApiError(404, 'PASSKEY_CREDENTIAL_NOT_FOUND');

      const credData = credSnap.data() || {};
      const credUid = credData.uid;
      if (!credUid || credUid !== challengeUid) throw new ApiError(403, 'CREDENTIAL_UID_MISMATCH');

      const publicKeyBase64Url = credData.publicKey;
      if (!publicKeyBase64Url || typeof publicKeyBase64Url !== 'string') {
        throw new ApiError(400, 'PASSKEY_PUBLIC_KEY_MISSING');
      }

      const publicKey = base64UrlToBuffer(publicKeyBase64Url);
      if (!publicKey) throw new ApiError(400, 'PASSKEY_PUBLIC_KEY_INVALID');

      const storedCounter = typeof credData.counter === 'number' ? credData.counter : Number(credData.counter) || 0;

      let verification;
      try {
        verification = await verifyAuthenticationResponse({
          response: response,
          expectedChallenge: sessionData.challenge,
          expectedOrigin,
          expectedRPID,
          credentialPublicKey: publicKey,
          // Note: verifyAuthenticationResponse will handle counter checks.
          // We pass stored counter to ensure correct replay protection.
          counter: storedCounter,
        });
      } catch {
        throw new ApiError(400, 'AUTHENTICATION_VERIFICATION_FAILED');
      }

      if (!verification || verification.verified !== true) {
        throw new ApiError(400, 'AUTHENTICATION_VERIFICATION_FAILED');
      }

      const newCounter =
        typeof verification.authenticationInfo?.newCounter === 'number'
          ? verification.authenticationInfo.newCounter
          : storedCounter;

      const nowMs = Date.now();
      const Timestamp = db.constructor?.Timestamp;
      const lastUsedAt = Timestamp?.fromMillis ? Timestamp.fromMillis(nowMs) : new Date(nowMs);

      // Update credential counter + lastUsedAt
      tx.update(credRef, {
        counter: newCounter,
        lastUsedAt,
        updatedAt: lastUsedAt,
      });

      // Delete one-time challenge
      tx.delete(sessionRef);

      // Create Firebase custom token for the stored uid
      const firebaseCustomToken = await auth.createCustomToken(challengeUid);

      return {
        ok: true,
        firebaseCustomToken,
      };
    });

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.status).json({ ok: false, error: err.code });
      return;
    }
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
}

