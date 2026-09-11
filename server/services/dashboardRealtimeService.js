const { rtdbSet, safeFirebaseKey } = require('./firebaseService');

function normalizeDashboardPhone(phone = '') {
  return String(phone || '').replace(/\D/g, '');
}

async function publishDashboardMessageEvent({
  phone = '',
  kind = 'message',
  status = '',
  body = '',
  messageId = '',
} = {}) {
  const nowIso = new Date().toISOString();
  const normalizedPhone = normalizeDashboardPhone(phone);
  const eventId = safeFirebaseKey(`${normalizedPhone}|${kind}|${status}|${messageId || nowIso}|${Date.now()}`);

  await rtdbSet('dashboard_events/messages', {
    id: eventId,
    phone: normalizedPhone,
    kind,
    status: String(status || '').toLowerCase(),
    bodyPreview: String(body || '').slice(0, 160),
    messageId: messageId || '',
    updatedAt: nowIso,
  });

  return eventId;
}

module.exports = {
  normalizeDashboardPhone,
  publishDashboardMessageEvent,
};
