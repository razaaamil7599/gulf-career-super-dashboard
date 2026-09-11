/**
 * Identity Middleware
 * Decides if a message is from an Agency, Potential Agency, or Candidate.
 */

const { resolveIdentity } = require('../services/identityService');

async function identityMiddleware(req, res, next) {
  try {
    const { from, isStatusUpdate, body } = req.body;

    if (isStatusUpdate) return next();
    if (!from) return res.status(400).json({ error: 'Missing "from" number' });

    req.identity = await resolveIdentity({ from, body });
    next();
  } catch (err) {
    console.error('[Identity] Error:', err);
    next();
  }
}

module.exports = identityMiddleware;
