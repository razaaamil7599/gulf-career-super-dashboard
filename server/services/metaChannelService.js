/**
 * Meta Channel Service
 * Handles outgoing Facebook Messenger and Instagram DM messages via the
 * unified Meta Send API (Page-linked, uses PAGE_ACCESS_TOKEN).
 */

const axios = require('axios');
const { rtdbGet, rtdbGetAll, rtdbPush } = require('./firebaseService');
const { appendChatLog } = require('./googleSheetsService');

function getPageConfig() {
  return {
    accessToken: (process.env.PAGE_ACCESS_TOKEN || '').trim(),
    pageId: (process.env.PAGE_ID || '').trim(),
  };
}

async function sendUnifiedMessage(recipientId, text) {
  const { accessToken } = getPageConfig();
  if (!accessToken) {
    console.error('[Meta Channel Service] Missing PAGE_ACCESS_TOKEN.');
    return { success: false, error: 'PAGE_ACCESS_TOKEN_MISSING' };
  }
  if (!recipientId) {
    return { success: false, error: 'RECIPIENT_ID_MISSING' };
  }

  try {
    const payload = {
      recipient: { id: String(recipientId) },
      message: { text: String(text || '').slice(0, 2000) },
      messaging_type: 'RESPONSE',
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/me/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { success: true, messageId: response.data?.message_id, to: recipientId };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[Meta Channel Service] Send Error:', JSON.stringify(errorData));
    return { success: false, error: errorData.message, code: errorData.code, to: recipientId };
  }
}

async function sendMessengerMessage(recipientId, text) {
  return sendUnifiedMessage(recipientId, text);
}

async function sendInstagramMessage(recipientId, text) {
  return sendUnifiedMessage(recipientId, text);
}

// Every manual "send a reply" entry point (web dashboard, mobile app, Hermes)
// used to always call WhatsApp's send function regardless of the contact's
// actual channel — harmless for a real WhatsApp number, but a Messenger/
// Instagram contact is a PSID, not a phone number, so WhatsApp's API rejected
// it outright ("Message undeliverable") and admins could never manually reply
// to those candidates even though the AI bot's own replies routed correctly.
// Detect the channel from the phoneNumberId recorded on the contact's own
// past messages (it's set to whichever surface — WhatsApp phone number id,
// the Page id, or the Instagram business account id — the message came in
// on) so every send route can share one source of truth instead of each
// re-implementing (or forgetting to implement) this check.
async function resolveContactChannel(phone) {
  const pageId = (process.env.PAGE_ID || '').trim();
  const igId = (process.env.IG_ACCOUNT_ID || '').trim();
  if (!pageId && !igId) return 'whatsapp';

  try {
    const thread = await rtdbGet(`messages/${phone}`);
    if (!thread) return 'whatsapp';
    const messages = Object.values(thread).sort(
      (a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime()
    );
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const pid = String(messages[i]?.phoneNumberId || '').trim();
      if (!pid) continue;
      if (pageId && pid === pageId) return 'messenger';
      if (igId && pid === igId) return 'instagram';
      return 'whatsapp';
    }
  } catch (_) {
    // fall through to the safe default below
  }
  return 'whatsapp';
}

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Meta's messaging window policy: a business can only send a standard
// (non-tagged) message to someone who messaged within the last 24 hours —
// outside that, the Send API rejects it outright. So a "broadcast to
// everyone" for Messenger/Instagram isn't a WhatsApp-style feature we could
// build; the only thing actually deliverable is targeting contacts who are
// still inside that window right now.
//
// Deliberately checks the actual last INBOUND message timestamp in the
// contact's own message thread, not candidate.lastInboundAt/updatedAt —
// those get overwritten by unrelated writes (e.g. a one-time chat-history
// backfill sets updatedAt to "now" regardless of when the contact really
// last messaged), which would otherwise mark long-inactive contacts as
// falsely "eligible" for the last-24-hours window.
async function getEligibleRecentContacts(channel) {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const candidates = await rtdbGetAll('candidates');
  const candidatesOnChannel = candidates.filter((c) => c.channel === channel && c.phone);

  const checks = await Promise.all(
    candidatesOnChannel.map(async (c) => {
      const thread = await rtdbGet(`messages/${c.phone}`);
      if (!thread) return null;
      let lastInboundTs = 0;
      for (const msg of Object.values(thread)) {
        if (msg?.direction !== 'inbound') continue;
        const ts = new Date(msg.timestamp || 0).getTime();
        if (ts > lastInboundTs) lastInboundTs = ts;
      }
      return lastInboundTs >= cutoff ? c : null;
    })
  );

  return checks.filter(Boolean);
}

async function bulkSendToRecentContacts(channel, message) {
  const sender = channel === 'messenger' ? sendMessengerMessage : sendInstagramMessage;
  const eligible = await getEligibleRecentContacts(channel);
  const results = [];
  for (const candidate of eligible) {
    const to = String(candidate.phone || '').trim();
    if (!to) continue;
    const result = await sender(to, message);
    const timestamp = new Date().toISOString();

    await rtdbPush(`messages/${to}`, {
      from: 'SYSTEM',
      to,
      body: message,
      wamId: result.messageId || null,
      direction: 'outbound',
      channel,
      timestamp,
      status: result.success ? 'sent' : 'failed',
      error: result.error || null,
    });
    await appendChatLog({ phone: to, message, direction: 'OUTBOUND', timestamp, channel });

    results.push({ id: candidate.id, name: candidate.name || '', phone: to, success: !!result.success, error: result.error || null });
  }
  const sent = results.filter((r) => r.success).length;
  return { targeted: eligible.length, sent, failed: results.length - sent, results };
}

module.exports = {
  sendMessengerMessage,
  sendInstagramMessage,
  getPageConfig,
  resolveContactChannel,
  getEligibleRecentContacts,
  bulkSendToRecentContacts,
};
