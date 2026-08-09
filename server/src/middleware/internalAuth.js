const crypto = require('crypto');

/**
 * Guards service-to-service endpoints (the Python AI service calling back into
 * this API) with a shared secret in the X-Internal-Token header.
 *
 * Compared in constant time: a plain `===` on a secret leaks length and prefix
 * information through timing, which is exactly the kind of thing a shared-secret
 * check must avoid.
 *
 * These endpoints must never be reachable from the public internet — the shared
 * secret is the only thing standing between an attacker and forged safety alerts
 * or attendance records. Bind them to the internal network at the proxy layer.
 */
function internalAuth(req, res, next) {
  const expected = process.env.X_INTERNAL_TOKEN;

  // Fail closed: an unset/blank secret must never mean "allow everyone".
  if (!expected) {
    console.error('X_INTERNAL_TOKEN is not configured; refusing internal request.');
    return res.status(500).json({ error: 'Internal auth not configured' });
  }

  const provided = req.headers['x-internal-token'];
  if (!provided || typeof provided !== 'string') {
    return res.status(401).json({ error: 'X-Internal-Token required' });
  }

  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);

  // timingSafeEqual throws on length mismatch, so compare lengths first — but
  // still run the comparison so the timing profile stays flat.
  const lengthsMatch = providedBuf.length === expectedBuf.length;
  const contentMatches = lengthsMatch && crypto.timingSafeEqual(providedBuf, expectedBuf);

  if (!contentMatches) {
    return res.status(401).json({ error: 'Invalid internal token' });
  }

  next();
}

module.exports = internalAuth;
