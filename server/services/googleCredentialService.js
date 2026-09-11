const crypto = require('crypto');
const path = require('path');

function stripOuterQuotes(value = '') {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2) return trimmed;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizePrivateKey(account = {}) {
  if (!account || typeof account !== 'object') return account;
  if (account.private_key) {
    const normalized = String(account.private_key).replace(/\\n/g, '\n');
    return { ...account, private_key: normalized };
  }
  return account;
}

function isValidPrivateKey(key = '') {
  try {
    crypto.createPrivateKey({ key });
    return true;
  } catch (_) {
    return false;
  }
}

function parseServiceAccountFromString(raw = '') {
  const trimmed = stripOuterQuotes(raw);
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return normalizePrivateKey(parsed);
  }

  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  if (decoded && decoded.trim().startsWith('{')) {
    const parsed = JSON.parse(decoded);
    return normalizePrivateKey(parsed);
  }

  return null;
}

function loadServiceAccount({ envKeys = [], fallbackPath } = {}) {
  for (const keyName of envKeys) {
    const raw = process.env[keyName];
    if (!raw) continue;
    try {
      const parsed = parseServiceAccountFromString(raw);
      if (parsed?.client_email && parsed?.private_key) {
        const validKey = isValidPrivateKey(parsed.private_key);
        if (!validKey) {
          console.warn(`[Creds] Parsed ${keyName} but private_key failed validation. Using it anyway.`);
        }
        return { account: parsed, source: `env:${keyName}` };
      }
    } catch (_) {
      continue;
    }
  }

  if (fallbackPath) {
    try {
      const fileAccount = require(path.resolve(fallbackPath));
      const normalized = normalizePrivateKey(fileAccount);
      if (normalized?.client_email && normalized?.private_key) {
        const validKey = isValidPrivateKey(normalized.private_key);
        if (!validKey) {
          console.warn('[Creds] Service account file private_key failed validation. Using it anyway.');
        }
        return { account: normalized, source: 'file' };
      }
    } catch (_) {
      return { account: null, source: 'missing' };
    }
  }

  return { account: null, source: 'missing' };
}

module.exports = {
  loadServiceAccount,
  parseServiceAccountFromString,
  normalizePrivateKey,
  stripOuterQuotes,
  isValidPrivateKey,
};
