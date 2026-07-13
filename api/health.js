export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'GET') {
    res.status(405).json({
      ok: false,
      error: 'Method not allowed'
    });
    return;
  }

  res.status(200).json({
    ok: true,
    service: 'habit-tracker-passkey-api'
  });
}

