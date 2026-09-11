/**
 * API Key Auth Middleware
 * ----------------------------------------------------------------------------
 * Protects the /api/control plane that Hermes, OpenClaw, and the mobile app
 * call. Compares the incoming key against process.env.HERMES_API_KEY (and
 * optionally OPENCLAW_API_KEY) using a timing-safe comparison so we don't leak
 * the key through response time.
 *
 * Accepts the key in any of the following headers (first non-empty wins):
 *   - Authorization: Bearer <key>
 *   - X-API-Key: <key>
 *   - X-Hermes-Key: <key>
 *
 * Multiple comma-separated keys can be set in HERMES_API_KEY (and
 * OPENCLAW_API_KEY) so you can rotate without downtime ("new,old").
 * Empty / missing config => 503.
 */

const crypto = require('crypto');

function extractKey(req) {
  const auth = req.get('authorization') || '';
  if (auth) {
    const match = auth.match(/^Bearer\s+(.+)$/i);
    if (match) return match[1].trim();
  }
  const x = req.get('x-api-key') || req.get('x-hermes-key') || '';
  return x.trim();
}

function timingSafeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ab.length !== bb.length) {
    // Still run a compare so length doesn't leak via timing
    const pad = Buffer.alloc(ab.length);
    crypto.timingSafeEqual(ab, pad);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

function getConfiguredKeys() {
  const hermes = process.env.HERMES_API_KEY || '';
  const openclaw = process.env.OPENCLAW_API_KEY || '';
  const combined = [hermes, openclaw].join(',');
  return combined
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function apiKeyAuth(req, res, next) {
  const configured = getConfiguredKeys();
  if (configured.length === 0) {
    return res.status(503).json({
      error: 'CONTROL_PLANE_DISABLED',
      message: 'HERMES_API_KEY is not configured on the server.',
    });
  }

  const presented = extractKey(req);
  if (!presented) {
    return res.status(401).json({
      error: 'MISSING_API_KEY',
      message: 'Provide the key as `Authorization: Bearer <key>` or `X-API-Key`.',
    });
  }

  const ok = configured.some((k) => timingSafeEqual(presented, k));
  if (!ok) {
    return res.status(403).json({ error: 'INVALID_API_KEY' });
  }

  // Annotate the request so handlers know it's a trusted control-plane call.
  req.controlAuth = { method: 'api-key', source: req.get('x-hermes-client') || 'unknown' };
  next();
}

module.exports = apiKeyAuth;
