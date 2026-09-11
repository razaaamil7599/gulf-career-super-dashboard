const axios = require('axios');
const { normalizeWhatsAppNumber } = require('./whatsappService');

const DEFAULT_LOOKBACK_HOURS = 168;
const DEFAULT_MIN_TARGETS = 20;
const DEFAULT_CLUSTER_GAP_MINUTES = 20;

function getDatabaseUrl() {
  const baseUrl = String(process.env.FIREBASE_DATABASE_URL || '').trim().replace(/\/+$/g, '');
  if (!baseUrl) {
    throw new Error('FIREBASE_DATABASE_URL_MISSING');
  }
  return baseUrl;
}

async function fetchRealtimeNode(path) {
  const response = await axios.get(`${getDatabaseUrl()}/${path}.json`, {
    timeout: 60000,
  });
  return response.data || {};
}

function normalizePhone(value = '') {
  return normalizeWhatsAppNumber(value);
}

function normalizeCandidateValue(value = '', fallback = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return fallback;
  }

  const lowered = normalized.toLowerCase();
  if (lowered === 'string' || lowered === 'general' || lowered === 'gulf' || lowered === 'unspecified') {
    return fallback;
  }

  return normalized;
}

function buildCandidateLabel(phone = '') {
  return `Candidate ${String(phone || '').slice(-4)}`;
}

function flattenMessages(messagesRaw = {}) {
  const flattened = [];

  for (const [phoneKey, thread] of Object.entries(messagesRaw || {})) {
    const normalizedPhone = normalizePhone(phoneKey);
    if (!normalizedPhone || !thread || typeof thread !== 'object') {
      continue;
    }

    for (const [messageKey, message] of Object.entries(thread || {})) {
      if (!message || typeof message !== 'object') {
        continue;
      }

      const timestamp = message.timestamp || message.status_at || '';
      flattened.push({
        phone: normalizedPhone,
        messageKey,
        body: String(message.body || ''),
        direction: String(message.direction || ''),
        status: String(message.status || ''),
        timestamp,
        from: String(message.from || ''),
        type: String(message.type || ''),
      });
    }
  }

  return flattened.sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function buildCandidateIndex(candidatesRaw = {}) {
  const byPhone = new Map();

  for (const [candidateId, candidate] of Object.entries(candidatesRaw || {})) {
    const phone = normalizePhone(candidate?.phone || '');
    if (!phone) {
      continue;
    }

    byPhone.set(phone, {
      id: candidateId,
      name: normalizeCandidateValue(candidate?.name, buildCandidateLabel(phone)),
      phone,
      skill: normalizeCandidateValue(candidate?.skill, 'Unspecified'),
      country: normalizeCandidateValue(candidate?.country, 'Unspecified'),
      status: String(candidate?.status || ''),
      unreadCount: Number(candidate?.unreadCount || 0),
      lastInboundPreview: String(candidate?.lastInboundPreview || ''),
      lastInboundAt: String(candidate?.lastInboundAt || ''),
    });
  }

  return byPhone;
}

function isBulkBroadcastMessage(message = {}) {
  if (message.direction !== 'outbound') {
    return false;
  }

  const body = String(message.body || '');
  return body.startsWith('[BULK TEMPLATE:') || body.includes('Gulf Career Gateway');
}

function buildCampaignLabel(body = '') {
  if (body.startsWith('[BULK TEMPLATE:')) {
    return body.replace(/^\[BULK TEMPLATE:\s*/i, '').replace(/\]$/, '').trim();
  }

  return 'Custom GCC Broadcast';
}

function clusterBulkMessages(messages = [], { lookbackHours = DEFAULT_LOOKBACK_HOURS, minTargets = DEFAULT_MIN_TARGETS, clusterGapMinutes = DEFAULT_CLUSTER_GAP_MINUTES } = {}) {
  const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
  const byBody = new Map();

  messages
    .filter((message) => isBulkBroadcastMessage(message) && new Date(message.timestamp).getTime() >= cutoff)
    .forEach((message) => {
      const key = String(message.body || '');
      if (!byBody.has(key)) {
        byBody.set(key, []);
      }
      byBody.get(key).push(message);
    });

  const clusters = [];

  for (const [body, items] of byBody.entries()) {
    const sortedItems = [...items].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
    let currentCluster = [];

    for (const item of sortedItems) {
      const currentTs = new Date(item.timestamp).getTime();
      const lastTs = currentCluster.length
        ? new Date(currentCluster[currentCluster.length - 1].timestamp).getTime()
        : 0;

      if (currentCluster.length === 0 || currentTs - lastTs <= clusterGapMinutes * 60 * 1000) {
        currentCluster.push(item);
        continue;
      }

      clusters.push({ body, items: currentCluster });
      currentCluster = [item];
    }

    if (currentCluster.length > 0) {
      clusters.push({ body, items: currentCluster });
    }
  }

  return clusters
    .map((cluster) => {
      const uniquePhones = new Map();
      cluster.items.forEach((item) => uniquePhones.set(item.phone, item));
      const times = cluster.items.map((item) => new Date(item.timestamp).getTime());

      return {
        body: cluster.body,
        label: buildCampaignLabel(cluster.body),
        items: cluster.items,
        uniqueMessages: [...uniquePhones.values()],
        phoneCount: uniquePhones.size,
        firstTs: Math.min(...times),
        lastTs: Math.max(...times),
      };
    })
    .filter((cluster) => cluster.phoneCount >= minTargets)
    .sort((left, right) => right.lastTs - left.lastTs || right.phoneCount - left.phoneCount);
}

function summarizeStatus(target) {
  return target.status === 'read' || target.status === 'delivered'
    ? 'received'
    : target.status === 'sent'
      ? 'sent'
      : target.status === 'failed'
        ? 'failed'
        : 'unknown';
}

async function getLatestBlastReport(options = {}) {
  const [messagesRaw, candidatesRaw] = await Promise.all([
    fetchRealtimeNode('messages'),
    fetchRealtimeNode('candidates'),
  ]);

  const allMessages = flattenMessages(messagesRaw);
  const candidatesByPhone = buildCandidateIndex(candidatesRaw);
  const latestCluster = clusterBulkMessages(allMessages, options)[0];

  if (!latestCluster) {
    return {
      success: true,
      report: null,
    };
  }

  const targets = latestCluster.uniqueMessages.map((message) => {
    const candidate = candidatesByPhone.get(message.phone) || {
      id: '',
      name: buildCandidateLabel(message.phone),
      phone: message.phone,
      skill: 'Unspecified',
      country: 'Unspecified',
      status: '',
      unreadCount: 0,
      lastInboundPreview: '',
      lastInboundAt: '',
    };
    const outboundAt = new Date(message.timestamp).getTime();
    const replies = allMessages.filter((entry) => entry.phone === message.phone && entry.direction === 'inbound' && new Date(entry.timestamp).getTime() > outboundAt);

    return {
      candidateId: candidate.id || '',
      name: candidate.name,
      phone: message.phone,
      skill: candidate.skill || 'Unspecified',
      country: candidate.country || 'Unspecified',
      candidateStatus: candidate.status || '',
      unreadCount: candidate.unreadCount || 0,
      outboundAt: message.timestamp,
      status: String(message.status || 'unknown').toLowerCase(),
      deliveryBucket: summarizeStatus(message),
      replied: replies.length > 0,
      replyCount: replies.length,
      firstReplyAt: replies[0]?.timestamp || '',
      replyPreview: replies[0]?.body || candidate.lastInboundPreview || '',
      lastInboundAt: replies[replies.length - 1]?.timestamp || candidate.lastInboundAt || '',
    };
  }).sort((left, right) => new Date(left.outboundAt).getTime() - new Date(right.outboundAt).getTime());

  const receivedTargets = targets.filter((target) => target.status === 'delivered' || target.status === 'read');
  const repliedTargets = targets.filter((target) => target.replied);
  const sentOnlyTargets = targets.filter((target) => target.status === 'sent');
  const failedTargets = targets.filter((target) => target.status === 'failed');
  const readTargets = targets.filter((target) => target.status === 'read');

  return {
    success: true,
    report: {
      label: latestCluster.label,
      body: latestCluster.body,
      startedAt: new Date(latestCluster.firstTs).toISOString(),
      finishedAt: new Date(latestCluster.lastTs).toISOString(),
      summary: {
        targeted: targets.length,
        received: receivedTargets.length,
        delivered: receivedTargets.length,
        read: readTargets.length,
        replied: repliedTargets.length,
        sentOnly: sentOnlyTargets.length,
        failed: failedTargets.length,
      },
      allTargets: targets,
      receivedTargets,
      repliedTargets,
      sentOnlyTargets,
      failedTargets,
    },
  };
}

module.exports = {
  getLatestBlastReport,
};
