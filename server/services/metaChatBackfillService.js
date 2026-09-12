/**
 * Meta Chat Backfill Service
 * One-time (re-runnable) import of a Page's full Messenger + Instagram DM
 * history into the same `messages/{contactId}` / `candidates/{id}` shape the
 * live webhook path writes, so conversations that happened before the bot
 * was properly wired up (or before a token/webhook fix) aren't invisible to
 * it. Safe to re-run: messages are deduped by Meta's own message id.
 */

const axios = require('axios');
const { rtdbGet, rtdbGetAll, rtdbPush, rtdbSet, rtdbUpdate, safeFirebaseKey } = require('./firebaseService');

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

async function graphGet(path, params, accessToken) {
  const res = await axios.get(`${GRAPH_BASE}${path}`, {
    params: { ...params, access_token: accessToken },
  });
  return res.data;
}

async function fetchAllPages(path, params, accessToken, { maxPages = 50 } = {}) {
  const items = [];
  let next = { path, params };
  let pageCount = 0;

  while (next && pageCount < maxPages) {
    pageCount += 1;
    const data = next.url
      ? (await axios.get(next.url)).data
      : await graphGet(next.path, next.params, accessToken);

    items.push(...(data.data || []));

    if (data.paging?.next) {
      next = { url: data.paging.next };
    } else {
      next = null;
    }
  }

  return items;
}

async function importConversation({ conversation, channel, pageId, pageAccessToken, stats }) {
  const other = (conversation.participants?.data || []).find((p) => p.id && p.id !== pageId);
  if (!other?.id) return;

  const contactId = channel === 'whatsapp' ? String(other.id).replace(/\D/g, '') : String(other.id);
  if (!contactId) return;

  // A conversation's messages were previously fetched with a flat .limit(200)
  // and no further pagination — any thread with more than 200 messages had its
  // older half silently dropped. Follow paging.next on the messages edge
  // itself so long-running threads come back in full, not just the newest 200.
  let messages;
  try {
    messages = await fetchAllPages(
      `/${conversation.id}/messages`,
      { fields: 'message,from,created_time,id', limit: 200 },
      pageAccessToken
    );
  } catch (err) {
    stats.conversationErrors += 1;
    stats.errors.push(`conversation ${conversation.id}: ${err.response?.data?.error?.message || err.message}`);
    return;
  }

  if (messages.length === 0) return;

  const existing = await rtdbGet(`messages/${contactId}`);
  const existingMessageIds = new Set(
    Object.values(existing || {}).map((m) => m.metaMessageId).filter(Boolean)
  );

  let importedForThisContact = 0;

  for (const msg of messages) {
    if (!msg.id || existingMessageIds.has(msg.id)) continue;

    const direction = msg.from?.id === pageId ? 'outbound' : 'inbound';
    await rtdbPush(`messages/${contactId}`, {
      from: direction === 'inbound' ? contactId : pageId,
      text: msg.message || '',
      body: msg.message || '',
      direction,
      channel,
      metaMessageId: msg.id,
      timestamp: msg.created_time || new Date().toISOString(),
      backfilled: true,
      backfilledAt: new Date().toISOString(),
    });
    importedForThisContact += 1;
  }

  stats.messagesImported += importedForThisContact;
  if (importedForThisContact > 0) {
    stats.conversationsWithNewMessages += 1;

    const candidateKey = channel === 'whatsapp' ? contactId : safeFirebaseKey(contactId);
    const existingCandidate = await rtdbGet(`candidates/${candidateKey}`);
    if (!existingCandidate) {
      // `phone` always holds the contact id (PSID for messenger/instagram, real
      // number for whatsapp) — findCandidateByPhone() in the live webhook path
      // only ever matches on this field, so leaving it blank for non-WhatsApp
      // channels (as this used to) meant a backfilled contact who later
      // messaged again got a second, duplicate candidate record created.
      await rtdbSet(`candidates/${candidateKey}`, {
        id: candidateKey,
        phone: contactId,
        metaContactId: channel !== 'whatsapp' ? contactId : '',
        name: other.username || other.name || '',
        channel,
        status: 'pending_update',
        stage: 'new',
        notes: `Imported from ${channel} chat history backfill.`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        backfilled: true,
      });
      stats.candidatesCreated += 1;
    }
  }
}

async function backfillChannel({ pageId, pageAccessToken, platform, channel, stats }) {
  const params = { fields: 'participants{id,name,username}' };
  if (platform) params.platform = platform;

  const conversations = await fetchAllPages(`/${pageId}/conversations`, params, pageAccessToken);
  stats.conversationsFound += conversations.length;

  for (const conversation of conversations) {
    await importConversation({ conversation, channel, pageId, pageAccessToken, stats });
  }
}

/**
 * Imports full Messenger + Instagram DM history for one Page into Firebase.
 * Idempotent: re-running only adds messages/candidates not already stored.
 */
async function backfillMetaChatHistory({ pageId, pageAccessToken }) {
  if (!pageId || !pageAccessToken) {
    throw new Error('pageId and pageAccessToken are required');
  }

  const stats = {
    conversationsFound: 0,
    conversationsWithNewMessages: 0,
    conversationErrors: 0,
    messagesImported: 0,
    candidatesCreated: 0,
    errors: [],
    startedAt: new Date().toISOString(),
  };

  await backfillChannel({ pageId, pageAccessToken, channel: 'messenger', stats });
  await backfillChannel({ pageId, pageAccessToken, platform: 'instagram', channel: 'instagram', stats });

  stats.finishedAt = new Date().toISOString();
  await rtdbSet('system_controls/last_meta_backfill', stats);

  return stats;
}

module.exports = {
  backfillMetaChatHistory,
};
