/**
 * Meta Webhook Parser Middleware
 * Normalizes official Meta WhatsApp Cloud API, Messenger, and Instagram
 * webhooks into a single flat format so downstream routes/services don't
 * need to know which channel a message came from.
 */

function parsePageOrInstagramEvent(body, channel) {
  const entry = body.entry?.[0];
  const messaging = entry?.messaging?.[0];
  if (!messaging) return null;

  // Delivery/read receipts and echoes of our own outbound messages carry no
  // "message" field with text - ignore those, only handle real inbound text.
  if (!messaging.message || messaging.message.is_echo) return null;

  const senderId = messaging.sender?.id;
  if (!senderId) return null;

  return {
    metaRaw: body,
    from: senderId,
    channel,
    name: 'User',
    id: messaging.message.mid || '',
    timestamp: messaging.timestamp || Date.now(),
    type: messaging.message.attachments?.length ? (messaging.message.attachments[0].type || 'file') : 'text',
    body: messaging.message.text || messaging.message.attachments?.[0]?.payload?.url || '',
    mediaId: null,
    mimeType: '',
    fileName: '',
    recipientPhone: null,
    recipientPhoneId: entry?.id || null,
    isMetaWebhook: true,
    isStatusUpdate: false,
  };
}

function metaWebhookParser(req, res, next) {
  const body = req.body;

  // Safe-guard for GET requests or empty bodies
  if (!body) return next();

  // Facebook Messenger (Page-linked webhook, object: 'page')
  if (body.object === 'page' && body.entry) {
    const parsed = parsePageOrInstagramEvent(body, 'messenger');
    if (parsed) req.body = parsed;
    return next();
  }

  // Instagram DMs (object: 'instagram')
  if (body.object === 'instagram' && body.entry) {
    const parsed = parsePageOrInstagramEvent(body, 'instagram');
    if (parsed) req.body = parsed;
    return next();
  }

  // 1. Check if it's a Meta structure
  if (body.object === 'whatsapp_business_account' && body.entry) {
    const entry = body.entry[0];
    const change = entry.changes?.[0];
    const value = change?.value;

    if (!value) return next();

    // -- INCOMING MESSAGES --
    if (value.messages && value.messages.length > 0) {
      const msg = value.messages[0];
      const contact = value.contacts?.[0];
      const mediaType = msg.type;
      const mediaPayload = msg[mediaType] || {};

      // Flatten into req.body for easier consumption
      req.body = {
        metaRaw: body,
        from: msg.from,
        wa_id: msg.from,
        channel: 'whatsapp',
        name: contact?.profile?.name || 'User',
        id: msg.id,
        timestamp: msg.timestamp,
        type: msg.type,
        body: msg.text?.body || mediaPayload?.caption || '',
        mediaId: mediaPayload?.id || null,
        mimeType: mediaPayload?.mime_type || '',
        fileName: mediaPayload?.filename || '',
        recipientPhone: value.metadata?.display_phone_number || null,
        recipientPhoneId: value.metadata?.phone_number_id || null,
        wabaId: entry.id || null,
        isMetaWebhook: true,
        isStatusUpdate: false
      };
    } 
    // -- OUTGOING STATUS UPDATES --
    else if (value.statuses && value.statuses.length > 0) {
      const status = value.statuses[0];
      req.body = {
        metaRaw: body,
        messageId: status.id,
        status: status.status, // sent, delivered, read, failed
        recipient_id: status.recipient_id,
        error: status.errors?.[0], // { code: ..., message: ... }
        isMetaWebhook: true,
        isStatusUpdate: true
      };
    }
  }

  next();
}

module.exports = metaWebhookParser;
