/**
 * Media Archive Service
 *
 * WhatsApp/Meta only keeps an uploaded media file retrievable via the Graph
 * API for a limited window after it was sent — after that the mediaId 404s
 * permanently, with no way to get it back from Meta's side. Every document a
 * candidate ever sent was only ever referenced by mediaId, so any admin
 * opening an older chat got "MEDIA_FETCH_FAILED" for anything Meta had
 * already expired.
 *
 * There's no working cloud storage bucket configured (Firebase Storage needs
 * a GCS bucket + billing, and billing is currently unavailable), so instead
 * of relying on external storage, reasonably-sized media (the vast majority
 * of passport/ID photos and scanned documents) gets embedded directly as a
 * base64 data: URL on the message record in the Realtime Database — which
 * already works reliably with no extra infrastructure. Oversized files
 * (large videos, etc.) are skipped and keep relying on the live Meta fetch,
 * accepting the existing expiration risk only for that rare case.
 */

const { fetchMediaAsset } = require('./whatsappService');
const { rtdbGet, rtdbUpdate } = require('./firebaseService');

const MAX_ARCHIVE_BYTES = 4 * 1024 * 1024; // 4MB raw (~5.3MB after base64 inflation)

async function archiveMediaAsDataUrl(mediaId, senderPhoneIdOrPhone = null) {
  if (!mediaId) return null;

  try {
    const asset = await fetchMediaAsset(mediaId, senderPhoneIdOrPhone);
    if (!asset?.buffer) return null;
    if (asset.buffer.length > MAX_ARCHIVE_BYTES) {
      console.log(`[Media Archive] Skipping ${mediaId} — ${asset.buffer.length} bytes exceeds archive cap.`);
      return null;
    }

    const mimeType = asset.mimeType || 'application/octet-stream';
    const base64 = asset.buffer.toString('base64');
    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    console.error(`[Media Archive] Failed to archive ${mediaId}:`, err.message);
    return null;
  }
}

/**
 * One-time rescue pass: goes through recent inbound messages that still only
 * have a mediaId (no archived mediaUrl yet — i.e. everything that predates
 * the fix above) and tries to archive whatever Meta will still hand back.
 * Anything older than `days` is skipped outright since Meta's retention
 * window means it's almost certainly already gone.
 */
async function rescueRecentMedia(days = 5) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = (await rtdbGet('messages')) || {};

  const candidates = [];
  for (const [phone, thread] of Object.entries(all)) {
    for (const [key, m] of Object.entries(thread || {})) {
      if (m?.mediaId && !m?.mediaUrl && m?.direction === 'inbound') {
        const ts = new Date(m.timestamp || 0).getTime();
        if (ts >= cutoff) candidates.push({ phone, key, mediaId: m.mediaId, phoneNumberId: m.phoneNumberId });
      }
    }
  }
  candidates.sort((a, b) => b.key.localeCompare(a.key));

  let rescued = 0;
  let failed = 0;
  for (const c of candidates) {
    const dataUrl = await archiveMediaAsDataUrl(c.mediaId, c.phoneNumberId);
    if (dataUrl) {
      await rtdbUpdate(`messages/${c.phone}/${c.key}`, { mediaUrl: dataUrl });
      rescued++;
    } else {
      failed++;
    }
  }

  return { attempted: candidates.length, rescued, failed };
}

module.exports = {
  archiveMediaAsDataUrl,
  rescueRecentMedia,
  MAX_ARCHIVE_BYTES,
};
