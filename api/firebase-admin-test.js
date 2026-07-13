import { getFirebaseAdmin } from './lib/firebaseAdmin.js';

export default function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  try {
    const { adminApp } = getFirebaseAdmin();

    if (!adminApp) {
      return res.status(200).json({
        ok: false,
        error: 'FIREBASE_ADMIN_INIT_FAILED',
      });
    }

    return res.status(200).json({
      ok: true,
      firebaseAdmin: 'connected',
      projectId: true,
    });
  } catch (e) {
    const allowedCodes = new Set([
      'MISSING_FIREBASE_PROJECT_ID',
      'MISSING_FIREBASE_CLIENT_EMAIL',
      'MISSING_FIREBASE_PRIVATE_KEY',
      'INVALID_PRIVATE_KEY_FORMAT',
      'FIREBASE_ADMIN_INIT_FAILED',
    ]);

    const code =
      e instanceof Error && allowedCodes.has(e.message)
        ? e.message
        : 'FIREBASE_ADMIN_INIT_FAILED';

    return res.status(200).json({ ok: false, error: code });
  }
}

