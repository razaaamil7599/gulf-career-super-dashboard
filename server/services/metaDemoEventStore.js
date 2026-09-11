/**
 * Meta Demo Event Store
 * In-memory ring buffer of recent inbound Page webhook events (messages and
 * feed/comment activity), keyed by the Facebook Page ID that received them.
 * Powers the live "Incoming webhook events" panel on /meta-demo — a
 * reviewer-facing page, so this intentionally never stores access tokens or
 * any other credential, only what's needed to render an event line.
 */

const MAX_EVENTS_PER_PAGE = 30;

/** @type {Map<string, Array<{id: string, type: string, summary: string, senderName: string, timestamp: string}>>} */
const eventsByPage = new Map();

let nextEventId = 1;

function recordEvent(pageId, { type, summary, senderName }) {
  if (!pageId) return;
  const list = eventsByPage.get(pageId) || [];
  list.push({
    id: String(nextEventId++),
    type: type || 'message',
    summary: String(summary || '').slice(0, 280),
    senderName: String(senderName || 'Unknown').slice(0, 120),
    timestamp: new Date().toISOString(),
  });
  while (list.length > MAX_EVENTS_PER_PAGE) list.shift();
  eventsByPage.set(pageId, list);
}

function getEvents(pageId, sinceId) {
  const list = eventsByPage.get(pageId) || [];
  if (!sinceId) return list;
  const cutoff = Number(sinceId) || 0;
  return list.filter((e) => Number(e.id) > cutoff);
}

module.exports = { recordEvent, getEvents };
