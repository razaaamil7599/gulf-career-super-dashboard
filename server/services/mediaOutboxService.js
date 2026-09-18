/**
 * Media Outbox Service
 *
 * WhatsApp-style store-and-forward for media: when a candidate sends a
 * photo/document, it's held here — in a separate, small Firebase node, NOT
 * inside the main `messages` tree — until a connected device (the Android
 * app, the desktop app) downloads it and confirms it has saved a local
 * copy, at which point it's deleted from here. If no device is online, it
 * just waits; nothing is lost, and nothing bloats the hot-path data every
 * dashboard/API call reads. This is what actually fixed the server's
 * repeated heap-OOM crash — the earlier approach embedded the same base64
 * media permanently on the message record instead, which meant everything
 * that ever touched `messages` had to load it too.
 */

const { getDb } = require('./firebaseService');

const OUTBOX_PATH = 'media_outbox';

async function queueMediaForDelivery({ phone, msgId, dataUrl, mimeType, fileName, botType }) {
  if (!phone || !msgId || !dataUrl) return;
  const db = getDb();
  await db.ref(`${OUTBOX_PATH}/${phone}/${msgId}`).set({
    mediaUrl: dataUrl,
    mimeType: mimeType || '',
    fileName: fileName || '',
    botType: botType || 'GCG',
    queuedAt: new Date().toISOString(),
  });
}

/** Devices call this when they come online to fetch whatever's waiting. */
async function getPendingOutbox(limit = 50) {
  const db = getDb();
  const snap = await db.ref(OUTBOX_PATH).limitToFirst(limit).once('value');
  const val = snap.val();
  if (!val) return [];

  const items = [];
  for (const [phone, thread] of Object.entries(val)) {
    for (const [msgId, item] of Object.entries(thread || {})) {
      items.push({ phone, msgId, ...item });
    }
  }
  return items;
}

/** Devices call this once they've saved an item locally — frees it from the outbox. */
async function ackOutboxItem(phone, msgId) {
  if (!phone || !msgId) return;
  const db = getDb();
  await db.ref(`${OUTBOX_PATH}/${phone}/${msgId}`).remove();
}

module.exports = {
  queueMediaForDelivery,
  getPendingOutbox,
  ackOutboxItem,
};
