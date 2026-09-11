/**
 * Auto-Reply Service
 * ----------------------------------------------------------------------------
 * Controls whether the AI recruiter automatically replies to incoming
 * candidate / agency WhatsApp messages.
 *
 * Two layers:
 *   1. Global toggle  -> settings/autoReply/global = { enabled: bool, ... }
 *   2. Per-conversation override
 *                     -> settings/autoReply/overrides/<safePhone> =
 *                        { mode: 'on' | 'off' | 'inherit', updatedAt, by }
 *
 * Decision: per-conversation override wins; if 'inherit' (or unset), use the
 * global toggle.
 *
 * The service is intentionally light — the rest of the app calls
 * `shouldAutoReply(phone)` before triggering the AI recruiter handler.
 */

const {
  rtdbGet,
  rtdbSet,
  rtdbUpdate,
  safeFirebaseKey,
} = require('./firebaseService');

const GLOBAL_PATH = 'settings/autoReply/global';
const OVERRIDES_PATH = 'settings/autoReply/overrides';

const VALID_MODES = new Set(['on', 'off', 'inherit']);

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function getGlobalState() {
  const data = (await rtdbGet(GLOBAL_PATH)) || {};
  return {
    enabled: data.enabled !== false, // default ON
    updatedAt: data.updatedAt || null,
    by: data.by || null,
  };
}

async function setGlobalState(enabled, by = 'hermes') {
  const payload = {
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
    by,
  };
  await rtdbSet(GLOBAL_PATH, payload);
  return payload;
}

async function getAllOverrides() {
  const data = (await rtdbGet(OVERRIDES_PATH)) || {};
  // Map back to phone keys (they're already safe / digits-only).
  const out = {};
  for (const [key, value] of Object.entries(data)) {
    if (!value || value.mode === 'inherit') continue;
    out[key] = value;
  }
  return out;
}

async function getOverride(phone) {
  const safe = safeFirebaseKey(normalizePhone(phone));
  if (!safe) return null;
  const data = await rtdbGet(`${OVERRIDES_PATH}/${safe}`);
  if (!data || !data.mode) return null;
  return data;
}

async function setOverride(phone, mode, by = 'hermes') {
  const cleaned = normalizePhone(phone);
  if (!cleaned) {
    throw new Error('AUTO_REPLY_OVERRIDE_BAD_PHONE');
  }
  if (!VALID_MODES.has(mode)) {
    throw new Error('AUTO_REPLY_OVERRIDE_BAD_MODE');
  }
  const safe = safeFirebaseKey(cleaned);
  const payload = {
    phone: cleaned,
    mode,
    updatedAt: new Date().toISOString(),
    by,
  };
  await rtdbSet(`${OVERRIDES_PATH}/${safe}`, payload);
  return payload;
}

/**
 * Decision used by the incoming webhook handler before firing the AI recruiter.
 * Returns `{ allow: bool, reason: string }`. Designed to never throw — if the
 * Firebase read fails for any reason we fail OPEN (allow auto-reply) so the
 * service degrades to current behaviour.
 */
async function shouldAutoReply(phone) {
  try {
    const cleaned = normalizePhone(phone);
    const override = await getOverride(cleaned);
    if (override && override.mode === 'on') {
      return { allow: true, reason: 'override:on' };
    }
    if (override && override.mode === 'off') {
      return { allow: false, reason: 'override:off' };
    }
    const global = await getGlobalState();
    return {
      allow: global.enabled !== false,
      reason: global.enabled === false ? 'global:off' : 'global:on',
    };
  } catch (err) {
    console.warn('[AutoReply] shouldAutoReply fallback (open):', err.message);
    return { allow: true, reason: 'fallback' };
  }
}

module.exports = {
  getGlobalState,
  setGlobalState,
  getOverride,
  setOverride,
  getAllOverrides,
  shouldAutoReply,
};
