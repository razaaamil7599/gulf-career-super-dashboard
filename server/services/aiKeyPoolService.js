/**
 * AI Key Pool Service
 * Lets the dashboard hold any number of Gemini API keys. Each key is tracked as
 * GREEN (usable) or RED (rate-limited / banned) and reds flip back to green on
 * their own once the tracked cooldown window passes — no redeploy needed.
 */

const { rtdbGetAll, rtdbPush, rtdbSet, rtdbUpdate } = require('./firebaseService');

const KEYS_PATH = 'ai_keys';
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000; // default per-minute quota reset
const QUOTA_EXHAUSTED_COOLDOWN_MS = 60 * 60 * 1000; // daily/free-tier quota fully used
const BANNED_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 403 permission-denied / invalid key

// Google's API-key-only endpoints never reveal which Google account or GCP
// project a bare key belongs to (that's a deliberate privacy boundary, not
// something we can query around) — so there is no way to definitively
// "reject" two keys from the same account at add-time. Two things we CAN do
// instead: (1) warn if two keys share the same admin-typed label, since
// someone adding keys from the same Gmail account will often label them the
// same way, and (2) notice when two different keys hit their DAILY quota
// within a couple minutes of each other — free-tier daily quotas are
// per-project, so keys that exhaust in lockstep repeatedly are a real signal
// (not proof) that they share a project/account and aren't adding real
// combined capacity.
const DUPLICATE_QUOTA_WINDOW_MS = 3 * 60 * 1000;

let roundRobinCursor = 0;

function maskKey(key = '') {
  const str = String(key || '');
  if (str.length <= 8) return '••••';
  return `${str.slice(0, 6)}••••${str.slice(-4)}`;
}

function toPublicShape(entry) {
  return {
    id: entry.id,
    label: entry.label || '',
    provider: entry.provider || 'gemini',
    status: entry.status || 'green',
    maskedKey: maskKey(entry.key),
    lastError: entry.lastError || '',
    addedAt: entry.addedAt || null,
    lastUsedAt: entry.lastUsedAt || null,
    lastSuccessAt: entry.lastSuccessAt || null,
    cooldownUntil: entry.cooldownUntil || null,
    possibleDuplicateAccount: entry.possibleDuplicateAccount || false,
    possibleDuplicateNote: entry.possibleDuplicateNote || '',
  };
}

/** Reads every stored key, flips expired reds back to green, persists the flip, returns raw entries (with real key values). */
async function syncAndGetRawKeys() {
  const all = await rtdbGetAll(KEYS_PATH);
  const now = Date.now();
  const updates = {};

  for (const entry of all) {
    if (entry.status === 'red' && entry.cooldownUntil && entry.cooldownUntil <= now) {
      entry.status = 'green';
      entry.lastError = '';
      updates[`${entry.id}/status`] = 'green';
      updates[`${entry.id}/lastError`] = '';
    }
  }

  if (Object.keys(updates).length > 0) {
    await rtdbUpdate(KEYS_PATH, updates);
  }

  return all;
}

async function listKeys() {
  const all = await syncAndGetRawKeys();
  return all
    .sort((a, b) => new Date(a.addedAt || 0).getTime() - new Date(b.addedAt || 0).getTime())
    .map(toPublicShape);
}

async function addKeys(rawInput, label = '', provider = 'gemini') {
  const candidates = Array.isArray(rawInput) ? rawInput : String(rawInput || '').split(/[\n,]+/);
  const cleanKeys = candidates.map(k => String(k || '').trim()).filter(Boolean);

  if (cleanKeys.length === 0) {
    throw new Error('No valid API key found in input');
  }

  const existing = await rtdbGetAll(KEYS_PATH);
  const existingValues = new Set(existing.map(e => e.key));

  const added = [];
  const skipped = [];

  for (const key of cleanKeys) {
    if (existingValues.has(key)) {
      skipped.push(maskKey(key));
      continue;
    }
    const id = await rtdbPush(KEYS_PATH, {
      key,
      label: label || '',
      provider,
      status: 'green',
      lastError: '',
      addedAt: new Date().toISOString(),
      lastUsedAt: null,
      lastSuccessAt: null,
      cooldownUntil: null,
    });
    existingValues.add(key);
    added.push(id);
  }

  // Can't verify which Google account a key belongs to (see note above), but
  // a duplicate label is a strong hint the admin themselves is reusing an
  // account/project name — flag it so they can double-check before assuming
  // this key adds real extra daily capacity.
  const normalizedLabel = String(label || '').trim().toLowerCase();
  const labelCollisionWarning = normalizedLabel && added.length > 0
    ? existing.some(e => String(e.label || '').trim().toLowerCase() === normalizedLabel)
    : false;

  return {
    addedCount: added.length,
    skippedCount: skipped.length,
    skipped,
    labelCollisionWarning,
  };
}

async function deleteKey(id) {
  await rtdbSet(`${KEYS_PATH}/${id}`, null);
}

/** Picks the next GREEN key for a provider, round-robin, skipping any id already tried this call. */
async function getNextAvailableKey(provider = 'gemini', excludeIds = []) {
  const all = await syncAndGetRawKeys();
  const excludeSet = new Set(excludeIds);
  const green = all.filter(e => (e.provider || 'gemini') === provider && e.status === 'green' && !excludeSet.has(e.id));

  if (green.length === 0) return null;

  roundRobinCursor = (roundRobinCursor + 1) % green.length;
  return green[roundRobinCursor];
}

async function hasAnyKeys(provider = 'gemini') {
  const all = await rtdbGetAll(KEYS_PATH);
  return all.some(e => (e.provider || 'gemini') === provider);
}

async function markKeySuccess(id) {
  await rtdbUpdate(`${KEYS_PATH}/${id}`, {
    status: 'green',
    lastError: '',
    lastUsedAt: new Date().toISOString(),
    lastSuccessAt: new Date().toISOString(),
    cooldownUntil: null,
  });
}

/** Parses Gemini's 429 error body for an explicit RetryInfo.retryDelay (e.g. "51s"), else falls back to a sane default. */
function extractRetryDelayMs(errorData) {
  try {
    const details = errorData?.error?.details || [];
    const retryInfo = details.find(d => String(d['@type'] || '').includes('RetryInfo'));
    const raw = retryInfo?.retryDelay;
    if (raw) {
      const seconds = parseFloat(String(raw).replace('s', ''));
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
  } catch {
    // fall through to default
  }

  const message = String(errorData?.error?.message || '').toLowerCase();
  if (message.includes('quota') || message.includes('per day') || message.includes('daily')) {
    return QUOTA_EXHAUSTED_COOLDOWN_MS;
  }
  return RATE_LIMIT_COOLDOWN_MS;
}

async function markKeyRateLimited(id, errorData) {
  const cooldownMs = extractRetryDelayMs(errorData);
  const message = errorData?.error?.message || 'Rate limited (429)';
  const now = Date.now();
  await rtdbUpdate(`${KEYS_PATH}/${id}`, {
    status: 'red',
    lastError: message,
    lastUsedAt: new Date().toISOString(),
    cooldownUntil: now + cooldownMs,
  });

  // Only a genuine DAILY quota hit (not a routine per-minute 429) is a useful
  // signal here — free-tier daily quotas are tracked per GCP project, so two
  // different keys both running out of their daily allowance within a few
  // minutes of each other is a real (if not certain) sign they share a
  // project/account and aren't giving the pool independent capacity.
  if (cooldownMs !== QUOTA_EXHAUSTED_COOLDOWN_MS) return;

  const all = await rtdbGetAll(KEYS_PATH);
  const recentlyQuotaExhausted = all.find((e) => {
    if (e.id === id) return false;
    if (!e.lastUsedAt) return false;
    const withinWindow = now - new Date(e.lastUsedAt).getTime() <= DUPLICATE_QUOTA_WINDOW_MS;
    const alsoQuotaMessage = /quota|per day|daily/i.test(String(e.lastError || ''));
    return withinWindow && alsoQuotaMessage;
  });

  if (recentlyQuotaExhausted) {
    const note = `Same daily-quota exhaustion window as key ${maskKey(recentlyQuotaExhausted.key)} — possibly the same Google account/project, which would mean no real extra capacity.`;
    await rtdbUpdate(KEYS_PATH, {
      [`${id}/possibleDuplicateAccount`]: true,
      [`${id}/possibleDuplicateNote`]: note,
      [`${recentlyQuotaExhausted.id}/possibleDuplicateAccount`]: true,
      [`${recentlyQuotaExhausted.id}/possibleDuplicateNote`]: `Same daily-quota exhaustion window as key ${maskKey(all.find(e => e.id === id)?.key)} — possibly the same Google account/project, which would mean no real extra capacity.`,
    });
  }
}

async function markKeyBanned(id, message) {
  await rtdbUpdate(`${KEYS_PATH}/${id}`, {
    status: 'red',
    lastError: message || 'Key rejected by provider (403)',
    lastUsedAt: new Date().toISOString(),
    cooldownUntil: Date.now() + BANNED_COOLDOWN_MS,
  });
}

module.exports = {
  listKeys,
  addKeys,
  deleteKey,
  getNextAvailableKey,
  hasAnyKeys,
  markKeySuccess,
  markKeyRateLimited,
  markKeyBanned,
};
