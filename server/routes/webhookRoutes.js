/**
 * Webhook Routes
 * - Agency vacancy ingestion
 * - Meta webhook verification + inbound handling
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const markupEngine = require('../middleware/markupEngine');
const brandingRewrite = require('../middleware/brandingRewrite');
const {
  rtdbPush,
  rtdbGet,
  rtdbSet,
  rtdbGetAll,
  rtdbUpdate,
  safeFirebaseKey,
} = require('../services/firebaseService');
const aiAgentService = require('../services/aiAgentService');
const whatsappService = require('../services/whatsappService');
const { handleCandidateConversation } = require('../services/candidateConversationService');
const { runWithGate } = require('../services/aiConcurrencyGateService');
const { archiveMediaAsDataUrl } = require('../services/mediaArchiveService');
const { matchCandidates } = require('../services/matchingService');
const { appendChatLog } = require('../services/googleSheetsService');
const { resolveIdentity } = require('../services/identityService');
const { ingestAgencyVacancy } = require('../services/agencyVacancyAutomationService');
const { getHiddenTemplateNames, syncStoredTemplateStatuses } = require('../services/templateService');
const { publishDashboardMessageEvent } = require('../services/dashboardRealtimeService');
const { resolveMetaAccountInfo } = require('../services/metaAccountHelper');
const metaDemoEventStore = require('../services/metaDemoEventStore');

function buildMessageLabel(type = 'text', body = '', fileName = '') {
  if (body) return body;
  if (type === 'image') return '[IMAGE]';
  if (type === 'audio') return '[VOICE NOTE]';
  if (type === 'video') return '[VIDEO]';
  if (type === 'document') return fileName ? `[DOCUMENT] ${fileName}` : '[DOCUMENT]';
  return '[MEDIA]';
}

function isVisibleTemplateRecord(item = {}, hiddenTemplateNames = new Set()) {
  const templateName = String(item.metaTemplateName || '').trim();
  if (!templateName) {
    return true;
  }

  return !hiddenTemplateNames.has(templateName);
}

router.get('/vacancies', async (req, res) => {
  try {
    await syncStoredTemplateStatuses(req.query.refresh === 'true');
    const hiddenTemplateNames = await getHiddenTemplateNames();
    const data = await rtdbGetAll('vacancies');
    const vacancies = data
      ? data
          .filter((vacancy) => isVisibleTemplateRecord(vacancy, hiddenTemplateNames))
          .map(v => ({ ...v }))
          .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      : [];
    res.json({ success: true, vacancies });
  } catch (err) {
    console.error('[Webhook] GET /vacancies error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/vacancy', markupEngine, brandingRewrite, async (req, res) => {
  try {
    const { skill, country, assignedPhone, priority, salary, title, candidateFacingText } = req.body;
    const { originalCharge, ourMargin, candidatePrice, markupType } = req.markup;
    const branding = req.brandedVacancy;
    const normalizedPriority = priority === '' || priority === null || priority === undefined
      ? null
      : Number(priority);

    const vacancyData = {
      // Spread first: branding/body echo raw, unnormalized values (e.g. priority as a string,
      // unnormalized assignedPhone) — the explicit fields below must win, not the other way round.
      ...branding,
      skill: skill || 'General',
      title: title || skill || 'General',
      country: country || 'Saudi',
      salary: salary || '',
      candidateFacingText: candidateFacingText || '',
      originalCharge,
      ourMargin,
      candidatePrice,
      markupType,
      status: 'active',
      priority: Number.isFinite(normalizedPriority) ? normalizedPriority : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assignedPhone: assignedPhone ? String(assignedPhone).replace(/\D/g, '') : '',
    };

    const vacancyId = await rtdbPush('vacancies', vacancyData);
    const { count, candidates } = await matchCandidates({ skill, country });

    res.json({
      success: true,
      vacancyId,
      vacancy: { id: vacancyId, ...vacancyData },
      matchedCandidates: count,
      candidates: candidates.slice(0, 10),
    });
  } catch (err) {
    console.error('[Webhook] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

const openclawWebhookAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
  if (!apiKey || (apiKey !== 'gulfcareer_token' && apiKey !== 'Bearer gulfcareer_token')) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

router.post('/vm-sync', openclawWebhookAuth, async (req, res) => {
  const { from, name, type, body, mediaId, mimeType, mediaUrl, fileName, messageId, timestamp, identityTag } = req.body;
  console.log(`[VM Sync] Receiving direct sync from OpenClaw VM for ${from}`);

  try {
    const messageData = {
      from,
      body: body || '[MEDIA]',
      type: type || 'text',
      mediaId: mediaId || null,
      mediaUrl: mediaUrl || null,
      mimeType: mimeType || null,
      fileName: fileName || null,
      tag: identityTag || 'CANDIDATE',
      timestamp: timestamp || new Date().toISOString(),
      direction: 'inbound',
      messageId: messageId || null,
    };

    await rtdbPush(`messages/${from}`, messageData);
    
    await appendChatLog({
      phone: from,
      message: messageData.body,
      direction: 'INBOUND',
      timestamp: messageData.timestamp,
    });

    // Dashboard handles AI reply via Meta WhatsApp API ONLY for candidates.
    // Admins are handled by OpenClaw on the VM.
    if (identityTag !== 'ADMIN') {
      await handleCandidateConversation({
        from,
        name,
        body: messageData.body,
        type: messageData.type,
        mediaId: messageData.mediaId || '',
        mediaUrl: messageData.mediaUrl || '',
        mimeType: messageData.mimeType || '',
        fileName: messageData.fileName || '',
        inboundStored: true,
        messageId: messageData.messageId || '',
        identityTag: identityTag || 'CANDIDATE',
      });
    } else {
      console.log(`[VM Sync] Admin command detected. Skipping candidate AI pipeline.`);
    }

    await publishDashboardMessageEvent({
      phone: from,
      kind: 'message',
      body: messageData.body,
      messageId: messageData.messageId,
      senderName: name || 'User',
      timestamp: messageData.timestamp
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('[VM Sync] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/webhook/data-deletion — Meta's Data Deletion Request Callback.
// Meta calls this (form-encoded `signed_request`) when a user removes the app
// or requests deletion from their Facebook/Instagram settings. We verify the
// signature with the App Secret, delete that user's stored messages/candidate
// record, and reply with the status URL + confirmation code Meta requires.
function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + '='.repeat(padLength), 'base64');
}

router.post('/data-deletion', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const signedRequest = req.body?.signed_request;
    if (!signedRequest || !signedRequest.includes('.')) {
      return res.status(400).json({ error: 'MISSING_SIGNED_REQUEST' });
    }

    const [encodedSig, encodedPayload] = signedRequest.split('.', 2);
    const appSecret = process.env.META_APP_SECRET || '';
    if (!appSecret) {
      console.error('[Data Deletion] META_APP_SECRET not configured — cannot verify request.');
      return res.status(500).json({ error: 'APP_SECRET_NOT_CONFIGURED' });
    }

    const expectedSig = crypto
      .createHmac('sha256', appSecret)
      .update(encodedPayload)
      .digest();
    const actualSig = base64UrlDecode(encodedSig);

    if (actualSig.length !== expectedSig.length || !crypto.timingSafeEqual(actualSig, expectedSig)) {
      console.warn('[Data Deletion] Invalid signature on signed_request.');
      return res.status(400).json({ error: 'INVALID_SIGNATURE' });
    }

    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    const userId = String(payload.user_id || '').trim();
    const confirmationCode = crypto.randomBytes(8).toString('hex');

    if (userId) {
      let deleted = { messages: false, candidate: false };
      try {
        await rtdbSet(`messages/${userId}`, null);
        deleted.messages = true;
      } catch (err) {
        console.error(`[Data Deletion] Failed to delete messages/${userId}:`, err.message);
      }
      try {
        const candidates = await rtdbGetAll('candidates');
        const match = (candidates || []).find((c) => c.id === userId || c.metaContactId === userId || c.phone === userId);
        if (match) {
          await rtdbSet(`candidates/${match.id}`, null);
          deleted.candidate = true;
        }
      } catch (err) {
        console.error(`[Data Deletion] Failed to delete candidate record for ${userId}:`, err.message);
      }
      await rtdbSet(`system_controls/data_deletion_requests/${safeFirebaseKey(confirmationCode)}`, {
        userId,
        deleted,
        requestedAt: new Date().toISOString(),
      });
      console.log(`[Data Deletion] Processed request for user ${userId}, confirmation ${confirmationCode}.`);
    }

    const statusUrl = `${process.env.PUBLIC_APP_URL || 'https://gulf-career-dashboard-257487919839.asia-south1.run.app'}/data-deletion?confirmation=${confirmationCode}`;
    return res.json({ url: statusUrl, confirmation_code: confirmationCode });
  } catch (err) {
    console.error('[Data Deletion] Error processing request:', err.message);
    return res.status(500).json({ error: 'DATA_DELETION_PROCESSING_FAILED' });
  }
});

router.get('/', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
      console.log('[Webhook] VERIFICATION SUCCESSFUL');
      return res.status(200).send(challenge);
    }

    console.warn('[Webhook] VERIFICATION FAILED: Token mismatch');
    return res.sendStatus(403);
  }

  res.sendStatus(400);
});

router.post('/', async (req, res) => {
  const data = req.body;

  // Page 'feed' changes (new posts/comments) aren't chat messages, so
  // metaWebhookParser leaves them as the raw Meta payload. Record them for
  // the /meta-demo live events panel (pages_manage_metadata demo), then ack.
  if (data.object === 'page' && Array.isArray(data.entry)) {
    const entry = data.entry[0];
    const feedChange = entry?.changes?.find((c) => c.field === 'feed');
    if (feedChange) {
      metaDemoEventStore.recordEvent(entry.id, {
        type: 'comment',
        summary: feedChange.value?.message || feedChange.value?.item || 'New feed activity',
        senderName: feedChange.value?.from?.name || 'Unknown',
      });
      return res.sendStatus(200);
    }
  }

  if (!data.isMetaWebhook) {
    return res.status(400).json({ error: 'NOT_A_META_WEBHOOK' });
  }

  // NOTE: A "OpenClaw Forwarding Bridge" used to mirror every inbound webhook to an
  // external VM here, which independently called handleCandidateConversation again via
  // /vm-sync. Since the Aug 2026 cutover, this dashboard already handles both admin
  // commands (handleAdminCommand, below) and candidate replies directly — so that bridge
  // was producing a second, ungrounded reply for every message (duplicate/garbled bot
  // replies seen in chat history). Removed; do not re-add without de-duplicating replies.

  if (data.isStatusUpdate) {
    const { messageId, status, error } = data;
    console.log(`[Webhook] Status Update: ${messageId} -> ${status}`);
    if (status === 'failed' && error) {
      console.error(`  - Reason: ${error.message} (Code: ${error.code})`);
    }

    const map = await rtdbGet(`message_map/${safeFirebaseKey(messageId)}`);
    if (map && map.phone && map.firebaseKey) {
      const updateData = {
        status,
        status_at: new Date().toISOString(),
      };
      if (error) updateData.error = error.message || error;
      await rtdbUpdate(`messages/${map.phone}/${map.firebaseKey}`, updateData);
      await publishDashboardMessageEvent({
        phone: map.phone,
        kind: 'status',
        status,
        body: error?.message || '',
        messageId,
      });
    }

    return res.sendStatus(200);
  }

  const { from, name, type, mediaId, body, id, mimeType, mediaUrl, fileName, channel, recipientPhone, recipientPhoneId, wabaId } = data;
  console.log(`[Webhook] Incoming from ${from} (${name}): ${type} [Received on PhoneId: ${recipientPhoneId || 'N/A'}]`);

  // Meta retries webhook delivery (on slow/non-200 responses) with the SAME message id.
  // Without this guard a retry re-runs the whole AI pipeline and sends a second, different
  // reply to the same inbound message — this is what produced the multi-message reply
  // bursts seen in chat history. First writer for a given id wins; later ones are dropped.
  if (id) {
    const dedupKey = `webhook_processed_messages/${safeFirebaseKey(id)}`;
    const alreadySeen = await rtdbGet(dedupKey);
    if (alreadySeen) {
      console.log(`[Webhook] Duplicate delivery for message ${id}, skipping re-processing.`);
      return res.sendStatus(200);
    }
    await rtdbSet(dedupKey, { at: new Date().toISOString(), from: from || '' });
  }

  if ((channel === 'messenger' || channel === 'instagram') && recipientPhoneId) {
    metaDemoEventStore.recordEvent(recipientPhoneId, {
      type: 'message',
      summary: buildMessageLabel(type, body, fileName),
      senderName: name || 'User',
    });
  }

  try {
    const identity = await resolveIdentity({ from, body });
    const storedBody = buildMessageLabel(type, body, fileName);
    const accountInfo = resolveMetaAccountInfo({
      phoneNumberId: recipientPhoneId,
      displayPhoneNumber: recipientPhone,
      wabaId: wabaId,
    });

    const messageData = {
      from,
      body: storedBody,
      type: type || 'text',
      mediaId: mediaId || null,
      mediaUrl: mediaUrl || null,
      mimeType: mimeType || null,
      fileName: fileName || null,
      tag: identity.tag === 'AGENCY' ? 'AGENCY' : 'CANDIDATE',
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      messageId: id || null,
      phoneNumberId: accountInfo.phoneNumberId || recipientPhoneId || null,
      wabaId: accountInfo.wabaId || wabaId || null,
      receivedOnPhone: accountInfo.displayPhoneNumber || recipientPhone || null,
      businessAccountName: accountInfo.accountName || null,
    };
    
    const { handleAdminCommand } = require('../services/adminControlService');

    if (identity.tag === 'ADMIN') {
      const adminResult = await handleAdminCommand({ 
        from, 
        body: storedBody,
        mediaId: mediaId || '',
        mimeType: mimeType || ''
      });
      if (adminResult?.replyText) {
        await whatsappService.sendTextMessage(from, adminResult.replyText);
      }
      return res.sendStatus(200);
    }

    if (identity.tag === 'AGENCY' && identity.isAuthorized) {
      console.log(`[Agency Guard] PASSED for ${identity.metadata.agencyName || identity.metadata.name || from}`);

      if (type === 'image' && mediaId) {
        await rtdbPush(`messages/${from}`, {
          ...messageData,
          type,
          mediaId,
          mimeType: mimeType || 'image/jpeg',
          tag: 'AGENCY',
        });
        await appendChatLog({
          phone: from,
          message: storedBody,
          direction: 'INBOUND',
          timestamp: messageData.timestamp,
        });

        await whatsappService.sendTextMessage(from, 'Scanning your vacancy poster... Please wait a moment.');
        const imageBuffer = await whatsappService.downloadMedia(mediaId);
        const directMediaUrl = mediaUrl || await whatsappService.getMediaUrl(mediaId);
        const scanResult = await aiAgentService.processVacancyPoster(imageBuffer, 'image/jpeg');
        const automationResult = await ingestAgencyVacancy({
          agencyId: identity.metadata.id || identity.metadata.contact || identity.metadata.phone || from,
          agencyName: identity.metadata.agencyName || identity.metadata.name || 'Unknown Agency',
          agencyPhone: from,
          imageUrl: directMediaUrl || '',
          sourceImageMediaId: mediaId || '',
          sourceImageMimeType: mimeType || 'image/jpeg',
          rawText: scanResult.rawText,
          details: scanResult.details,
          generatedTemplates: scanResult.templates,
          assignedTemplateName: scanResult.assignedTemplateName || '',
          sourceType: 'image',
          allowBroadcast: true,
        });

        await whatsappService.sendTextMessage(
          from,
          `Poster scanned successfully.\n\nExtracted: ${scanResult.details.skill} in ${scanResult.details.country}.\n\nVacancy dashboard par draft ke roop mein save ho gayi hai. Admin review aur edit ke baad hi Meta approval ke liye submit ki jayegi.`
        );

        return res.sendStatus(200);
      }
    }

    const pushedMessageKey = await rtdbPush(`messages/${from}`, messageData);
    await appendChatLog({
      phone: from,
      message: storedBody,
      direction: 'INBOUND',
      timestamp: messageData.timestamp,
      channel: channel || 'whatsapp',
    });

    // Fire-and-forget: WhatsApp/Meta only keeps a media file retrievable by
    // mediaId for a limited window after it was sent — after that it 404s
    // forever with no way to recover it. Archive it into our own database
    // now, while it's still fetchable, so an admin opening this chat weeks
    // later doesn't hit "MEDIA_FETCH_FAILED". Not awaited: must not delay
    // Meta's webhook ack or the candidate's reply on a large download.
    if (mediaId && (channel || 'whatsapp') === 'whatsapp') {
      archiveMediaAsDataUrl(mediaId, accountInfo.phoneNumberId || recipientPhoneId)
        .then((dataUrl) => {
          if (dataUrl) return rtdbUpdate(`messages/${from}/${pushedMessageKey}`, { mediaUrl: dataUrl });
        })
        .catch((err) => console.error(`[Webhook] Media archive failed for ${mediaId}:`, err.message));
    }

    // Fire-and-forget: gated so a second candidate's AI turn doesn't run
    // concurrently with one already in flight (see aiConcurrencyGateService),
    // and NOT awaited here so Meta gets its 200 ack immediately instead of
    // waiting on a call that may sit queued for up to 2 minutes.
    runWithGate(from, {
      from,
      name,
      body: storedBody,
      type,
      mediaId: mediaId || '',
      mediaUrl: mediaUrl || '',
      mimeType: mimeType || '',
      fileName: fileName || '',
      inboundStored: true,
      messageId: id || '',
      identityTag: identity.tag === 'AGENCY' ? 'AGENCY' : 'CANDIDATE',
      recipientPhone: accountInfo.displayPhoneNumber || recipientPhone,
      recipientPhoneId: accountInfo.phoneNumberId || recipientPhoneId,
      wabaId: accountInfo.wabaId || wabaId,
      businessAccountName: accountInfo.accountName,
      channel: channel || 'whatsapp',
    }, handleCandidateConversation).catch((err) => {
      console.error(`[Webhook] Async candidate conversation failed for ${from}:`, err.message);
    });

    res.sendStatus(200);
  } catch (err) {
    console.error('[Webhook] Internal Pipeline Error:', err);
    if (from) {
      await whatsappService.sendTextMessage(
        from,
        'Sorry, there was an error processing your message. Please try again in a moment.'
      );
    }
    res.sendStatus(200);
  }
});

module.exports = router;
