// Gates how many AI conversation turns run at once. With the Gemini free-tier
// quota this shallow (a handful of requests/day and a low per-minute limit),
// firing a separate concurrent AI call for every inbound message across many
// candidates burns through that quota fast and trips per-minute rate limits,
// which is what silently dropped the bot into its non-AI fallback template
// mid-conversation. When the AI is already busy with one candidate, a newly
// arriving candidate is queued and given up to a 2-minute window — long
// enough for the busy call to finish, and long enough to fold in any further
// quick messages that same candidate sends meanwhile — then processed once
// with whatever the latest message was by the time the window elapses.
const MAX_CONCURRENT_AI_CALLS = 1;
const BUSY_QUEUE_WAIT_MS = 2 * 60 * 1000;

let activeCount = 0;
const pendingByPhone = new Map(); // phone -> { timer, args }

function isBusy() {
  return activeCount >= MAX_CONCURRENT_AI_CALLS;
}

async function runWithGate(phone, args, handler) {
  const key = String(phone || '').trim();
  if (!key) {
    return handler(args);
  }

  if (!isBusy()) {
    activeCount++;
    try {
      return await handler(args);
    } finally {
      activeCount--;
    }
  }

  const existing = pendingByPhone.get(key);
  if (existing) {
    // Another message from this same candidate arrived while they were
    // already queued — just replace what we'll reply to; the original
    // 2-minute timer (started on their first queued message) keeps running.
    existing.args = args;
    return;
  }

  return new Promise((resolve) => {
    const timer = setTimeout(async () => {
      const entry = pendingByPhone.get(key);
      pendingByPhone.delete(key);
      if (!entry) return resolve();
      activeCount++;
      try {
        await handler(entry.args);
      } catch (err) {
        console.error(`[AiConcurrencyGate] Failed queued reply for ${key}:`, err.message);
      } finally {
        activeCount--;
        resolve();
      }
    }, BUSY_QUEUE_WAIT_MS);
    timer.unref?.();
    pendingByPhone.set(key, { timer, args });
  });
}

module.exports = { runWithGate, BUSY_QUEUE_WAIT_MS };
