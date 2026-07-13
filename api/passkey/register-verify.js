import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { getFirebaseAdmin } from '../lib/firebaseAdmin.js';

const expectedOrigin =
  (process.env.PASSKEY_ORIGIN || 'https://habit-tracker-three-mocha.vercel.app').replace(/\/+$/, '');

const expectedRPID = (process.env.PASSKEY_RP_ID || 'habit-tracker-three-mocha.vercel.app').replace(/^https:\/\//, '');
const rpName = process.env.PASSKEY_RP_NAME || 'Habit Tracker';

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

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function sanitizeDeviceName(name) {
  if (typeof name === 'string') {
    const s = name.trim().slice(0, 80);
    return s || 'Passkey device';
  }
  return 'Passkey device';
}

function getMillisFromFirestoreTimestamp(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.toDate === 'function') return ts.toDate().getTime();
  return null;
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

  const { sessionId, credential, deviceName } = req.body || {};
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ ok: false, error: 'SESSION_ID_REQUIRED' });
    return;
  }
  if (!credential || typeof credential !== 'object') {
    res.status(400).json({ ok: false, error: 'CREDENTIAL_REQUIRED' });
    return;
  }

  try {
    const { db } = getFirebaseAdmin();
    const challengeRef = db.collection('passkeyChallenges').doc(sessionId);

    const transactionResult = await db.runTransaction(async (tx) => {
      const challengeSnap = await tx.get(challengeRef);
      if (!challengeSnap.exists) throw new ApiError(404, 'CHALLENGE_NOT_FOUND');

      const challengeData = challengeSnap.data() || {};

      if (challengeData.type !== 'registration') throw new ApiError(400, 'INVALID_CHALLENGE_TYPE');
      if (challengeData.uid !== user.uid) throw new ApiError(403, 'CHALLENGE_USER_MISMATCH');

      const expiresAtMs = getMillisFromFirestoreTimestamp(challengeData.expiresAt);
      if (!expiresAtMs) throw new ApiError(410, 'CHALLENGE_EXPIRED');
      if (Date.now() > expiresAtMs) throw new ApiError(410, 'CHALLENGE_EXPIRED');

      const storedRPID = challengeData.rpID;
      const storedExpectedOrigin = challengeData.expectedOrigin;

      if (storedRPID !== expectedRPID) throw new ApiError(400, 'CHALLENGE_CONFIGURATION_MISMATCH');
      if (storedExpectedOrigin !== expectedOrigin) throw new ApiError(400, 'CHALLENGE_CONFIGURATION_MISMATCH');

      // verifyRegistrationResponse consumes the challenge by validating it; we still delete challenge below.
      let verification;
      try {
        verification = await verifyRegistrationResponse({
          response: credential,
          expectedChallenge: challengeData.challenge,
          expectedOrigin,
          expectedRPID,
          requireUserVerification: true,
        });
      } catch {
        throw new ApiError(400, 'REGISTRATION_VERIFICATION_FAILED');
      }

      if (!verification || verification.verified !== true || !verification.registrationInfo) {
        throw new ApiError(400, 'REGISTRATION_VERIFICATION_FAILED');
      }

      const info = verification.registrationInfo;
      const cred = info.credential || {};

      const credentialId = cred.id;
      if (typeof credentialId !== 'string' || !credentialId) {
        throw new ApiError(400, 'REGISTRATION_VERIFICATION_FAILED');
      }

      const publicKeyBuf = cred.publicKey;
      // In v11, publicKey is an ArrayBuffer/Uint8Array-like (COSE decoded). We store as base64url via Buffer.
      const publicKeyBase64Url = (() => {
        try {
          return Buffer.from(publicKeyBuf).toString('base64url');
        } catch {
          return null;
        }
      })();

      if (!publicKeyBase64Url) throw new ApiError(400, 'REGISTRATION_VERIFICATION_FAILED');

      const counter = typeof cred.counter === 'number' ? cred.counter : Number(cred.counter) || 0;
      const transports = Array.isArray(cred.transports) ? cred.transports : [];
      const deviceType = info.credentialDeviceType;
      const backedUp = !!info.credentialBackedUp;

      const credentialRef = db.collection('passkeyCredentials').doc(credentialId);
      const existingSnap = await tx.get(credentialRef);

      // Single-use challenge consumption is guaranteed by delete below (transaction commit).

      if (existingSnap.exists) {
        const existing = existingSnap.data() || {};
        if (existing.uid !== user.uid) throw new ApiError(409, 'CREDENTIAL_ALREADY_REGISTERED');

        // idempotent: do not overwrite public key/counter unexpectedly.
        tx.delete(challengeRef);
        return { status: 200, body: { ok: true, credentialId } };
      }

      const nowMs = Date.now();
      const Timestamp = db.constructor?.Timestamp;
      const createdAt = Timestamp?.fromMillis ? Timestamp.fromMillis(nowMs) : new Date(nowMs);
      const updatedAt = Timestamp?.fromMillis ? Timestamp.fromMillis(nowMs) : new Date(nowMs);

      tx.create(credentialRef, {
        uid: user.uid,
        credentialId,
        publicKey: publicKeyBase64Url,
        counter,
        transports,
        deviceType: deviceType || null,
        backedUp,
        deviceName: sanitizeDeviceName(deviceName),
        createdAt,
        updatedAt,
        lastUsedAt: null,
      });

      tx.delete(challengeRef);

      return { status: 200, body: { ok: true, credentialId } };
    });

    res.status(transactionResult.status).json(transactionResult.body);
  } catch (err) {
    if (err instanceof ApiError) {
      res.status(err.status).json({ ok: false, error: err.code });
      return;
    }
    res.status(500).json({ ok: false, error: 'INTERNAL_SERVER_ERROR' });
  }
}

