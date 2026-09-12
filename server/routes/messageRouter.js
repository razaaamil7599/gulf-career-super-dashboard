/**
 * Message Router
 * Handles incoming WhatsApp webhooks and manual overrides.
 */

const express = require('express');
const router = express.Router();
const identityMiddleware = require('../middleware/identityMiddleware');
const { rtdbPush, rtdbSet, rtdbUpdate, rtdbGet, safeFirebaseKey } = require('../services/firebaseService');
const { sendMessage, sendTemplateMessage, getMetaStatus, getMediaUrl, downloadMedia, sendTextMessage, deleteMetaTemplate, uploadMediaAsset, sendAudioMessage } = require('../services/whatsappService');
const multer = require('multer');
const uploadMemory = multer({ storage: multer.memoryStorage(), limits: { fileSize: 16 * 1024 * 1024 } });
const { getAvailableTemplates, syncStoredTemplateStatuses } = require('../services/templateService');
const { handleCandidateConversation } = require('../services/candidateConversationService');
const { shouldAutoReply } = require('../services/autoReplyService');
const { appendChatLog } = require('../services/googleSheetsService');
const { processVacancyPoster } = require('../services/aiAgentService');
const { ingestAgencyVacancy } = require('../services/agencyVacancyAutomationService');
const { publishDashboardMessageEvent } = require('../services/dashboardRealtimeService');
const { isAdminPhone, handleAdminCommand } = require('../services/adminControlService');
const aiKeyPoolService = require('../services/aiKeyPoolService');
const { backfillMetaChatHistory } = require('../services/metaChatBackfillService');
const { sendMessengerMessage, sendInstagramMessage, resolveContactChannel } = require('../services/metaChannelService');

function buildMessageLabel(type = 'text', body = '', fileName = '') {
  if (body) return body;
  if (type === 'image') return '[IMAGE]';
  if (type === 'audio') return '[VOICE NOTE]';
  if (type === 'video') return '[VIDEO]';
  if (type === 'document') return fileName ? `[DOCUMENT] ${fileName}` : '[DOCUMENT]';
  return '[MEDIA]';
}

function buildPhoneCandidates(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return [];

  const candidates = new Set([digits]);
  if (digits.length === 10) {
    candidates.add(`91${digits}`);
    candidates.add(`92${digits}`);
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    candidates.add(digits.slice(2));
  }
  if (digits.length === 12 && digits.startsWith('92')) {
    candidates.add(digits.slice(2));
  }

  return Array.from(candidates);
}

async function resolveStatusTarget(messageId = '', recipientId = '') {
  const safeMessageId = safeFirebaseKey(messageId);
  const mapped = await rtdbGet(`message_map/${safeMessageId}`);
  if (mapped?.phone && mapped?.firebaseKey) {
    return mapped;
  }

  for (const phoneCandidate of buildPhoneCandidates(recipientId)) {
    const phoneMessages = await rtdbGet(`messages/${phoneCandidate}`);
    if (!phoneMessages || typeof phoneMessages !== 'object') continue;

    const match = Object.entries(phoneMessages).find(([, item]) => item?.wamId === messageId);
    if (!match) continue;

    const [, item] = match;
    const resolvedTarget = {
      phone: phoneCandidate,
      firebaseKey: item?.id || match[0],
    };

    await rtdbSet(`message_map/${safeMessageId}`, resolvedTarget);
    return resolvedTarget;
  }

  return null;
}

async function hideTemplateInDashboard(name = '', metaId = '', reason = '') {
  const safeName = String(name || '').trim();
  if (!safeName) return;

  await rtdbSet(`admin_hidden_templates/${safeFirebaseKey(safeName)}`, {
    id: safeFirebaseKey(safeName),
    name: safeName,
    metaId: metaId || '',
    reason: reason || 'MANUAL_HIDE',
    hiddenAt: new Date().toISOString(),
  });
}

// GET /api/messages/health — Diagnostic Heartbeat
router.get('/health', (req, res) => res.send('OK'));

// GET /api/messages/templates — Available Official Templates
router.get('/templates', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === 'true';
    await syncStoredTemplateStatuses(forceRefresh);
    const templates = await getAvailableTemplates(forceRefresh);
    res.json({ success: true, templates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/templates — Delete an official template from Meta
router.delete('/templates', async (req, res) => {
  try {
    const { name, metaId } = req.body || {};
    if (!name) {
      return res.status(400).json({ error: 'Template name required' });
    }

    const result = await deleteMetaTemplate({ name, metaId });
    let warning = '';
    let deletedFromMeta = Boolean(result.success);

    if (!result.success) {
      const permissionBlocked =
        String(result.code || '') === '100'
        && /need permission/i.test(String(result.error || ''));

      if (!permissionBlocked) {
        return res.status(400).json({ error: result.error || 'Template delete failed', code: result.code || '' });
      }

      warning = 'Meta token ke paas template delete permission nahin hai. Template dashboard se hide kar diya gaya hai.';
      deletedFromMeta = false;
    }

    await hideTemplateInDashboard(
      name,
      metaId || result.metaId || '',
      deletedFromMeta ? 'META_DELETED' : 'META_DELETE_PERMISSION_REQUIRED'
    );

    let templates = [];
    try {
      templates = await getAvailableTemplates(true);
    } catch (refreshErr) {
      console.warn('[Message Router] Template refresh after delete failed:', refreshErr.message);
    }

    res.json({
      success: true,
      deletedTemplate: name,
      deletedFromMeta,
      hiddenInDashboard: true,
      warning,
      templates,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/configs — Fetch all WhatsApp configs
router.get('/configs', async (req, res) => {
  try {
    const data = await rtdbGet('settings/whatsapp_numbers');
    const list = data ? Object.values(data) : [];
    res.json({ success: true, configs: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/configs — Add/Update WhatsApp config
router.post('/configs', async (req, res) => {
  try {
    const config = req.body;
    if (!config.phone || !config.phoneId || !config.wabaId) {
      return res.status(400).json({ error: 'phone, phoneId, and wabaId are required' });
    }
    const cleanPhone = String(config.phone).replace(/\D/g, '');
    const safeKey = safeFirebaseKey(cleanPhone);
    
    await rtdbSet(`settings/whatsapp_numbers/${safeKey}`, {
      ...config,
      phone: cleanPhone,
      updatedAt: new Date().toISOString()
    });
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/messages/configs/:phone — Remove WhatsApp config
router.delete('/configs/:phone', async (req, res) => {
  try {
    const cleanPhone = String(req.params.phone).replace(/\D/g, '');
    const safeKey = safeFirebaseKey(cleanPhone);
    await rtdbSet(`settings/whatsapp_numbers/${safeKey}`, null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/ai-keys — List AI (Gemini) key pool with live green/red status
router.get('/ai-keys', async (req, res) => {
  try {
    const keys = await aiKeyPoolService.listKeys();
    res.json({ success: true, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/ai-keys — Add one or many API keys from the dashboard (paste box)
router.post('/ai-keys', async (req, res) => {
  try {
    const { key, keys, label, provider } = req.body || {};
    const input = keys || key;
    if (!input) {
      return res.status(400).json({ error: 'key or keys is required' });
    }
    const result = await aiKeyPoolService.addKeys(input, label, provider || 'gemini');
    const list = await aiKeyPoolService.listKeys();
    res.json({ success: true, ...result, keys: list });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/messages/ai-keys/:id — Remove a key from the pool
router.delete('/ai-keys/:id', async (req, res) => {
  try {
    await aiKeyPoolService.deleteKey(req.params.id);
    const list = await aiKeyPoolService.listKeys();
    res.json({ success: true, keys: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/backfill-meta-chats — Import full Messenger + Instagram DM history for the
// configured Page into Firebase (messages/candidates), so past conversations that predate a
// working webhook/token aren't invisible to the bot. Re-runnable; skips messages already stored.
router.post('/backfill-meta-chats', async (req, res) => {
  try {
    const pageId = (process.env.PAGE_ID || '').trim();
    const pageAccessToken = (process.env.PAGE_ACCESS_TOKEN || '').trim();
    if (!pageId || !pageAccessToken) {
      return res.status(400).json({ error: 'PAGE_ID / PAGE_ACCESS_TOKEN not configured on the server.' });
    }
    const stats = await backfillMetaChatHistory({ pageId, pageAccessToken });
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/status — Meta API Diagnostic
router.get('/status', async (req, res) => {
  try {
    const meta = await getMetaStatus();
    res.json({
      success: true,
      status: meta.isLive ? 'LIVE' : 'MOCK',
      config: meta
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/webhook — Meta Webhook Verification
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'gulfcareer_token';

  if (mode && token) {
    console.log(`[Webhook] Verification Request: mode=${mode}, token=${token}`);
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook Verified Successfully!');
      res.setHeader('Content-Type', 'text/plain');
      return res.status(200).send(challenge);
    }
    console.error(`Webhook Token Mismatch! Expected: ${VERIFY_TOKEN}, Received: ${token}`);
    return res.status(403).send('Forbidden');
  }
  res.status(400).send('Bad Request');
});

// POST /api/messages/webhook — Incoming from WhatsApp
router.post('/webhook', identityMiddleware, async (req, res) => {
  try {
    const {
      isStatusUpdate,
      from,
      body,
      type,
      mediaUrl,
      mimeType,
      mediaId,
      fileName,
      messageId,
      status,
      error,
      recipientPhone,
      recipientPhoneId,
      channel = 'whatsapp'
    } = req.body;

    // --- CASE A: STATUS UPDATE (sent, delivered, read, failed) ---
    if (isStatusUpdate) {
      const errorMessage = error?.message || error?.title || error?.details || '';
      console.log(`[Webhook] Status Update: ${messageId} -> ${status}${errorMessage ? ` (${errorMessage})` : ''}`);

      const map = await resolveStatusTarget(messageId, req.body.recipient_id || '');
      if (map && map.phone && map.firebaseKey) {
        const updateData = {
          status,
          status_at: new Date().toISOString()
        };
        if (error) updateData.error = error.message || error;

        await rtdbUpdate(`messages/${map.phone}/${map.firebaseKey}`, updateData);
        await publishDashboardMessageEvent({
          phone: map.phone,
          kind: 'status',
          status,
          body: errorMessage,
          messageId,
        });
      } else {
        console.warn(`[Webhook] Status target missing for ${messageId} (${req.body.recipient_id || 'unknown recipient'})`);
      }
      return res.json({ success: true, type: 'status' });
    }

    // --- CASE B: INCOMING MESSAGE ---
    const identity = req.identity;

    const isVoice = (body || '').includes('Voice:') || (body || '').includes('🎤');
    const finalType = type || (isVoice ? 'audio' : 'text');
    const storedBody = buildMessageLabel(finalType, body, fileName);

    if (isAdminPhone(from)) {
      const adminResult = await handleAdminCommand({
        from,
        body: storedBody,
        mediaId: mediaId || '',
        mimeType: mimeType || ''
      });
      if (adminResult?.replyText) {
        await sendTextMessage(from, adminResult.replyText);
      }
      return res.json({ success: true, admin: true, handled: Boolean(adminResult?.handled) });
    }

    const messageData = {
      from,
      body: storedBody,
      type: finalType,
      mediaUrl: mediaUrl || null,
      mediaId: mediaId || null,
      mimeType: mimeType || null,
      fileName: fileName || null,
      tag: identity.tag,
      timestamp: new Date().toISOString(),
      direction: 'inbound',
    };

    await rtdbPush(`messages/${from}`, messageData);
    await appendChatLog({
      phone: from,
      message: storedBody,
      direction: 'INBOUND',
      timestamp: messageData.timestamp,
    });

    if (identity.tag === 'AGENCY' && identity.isAuthorized && finalType === 'image' && req.body.mediaId) {
      console.log(`[Agency Guard] Authorized agency '${identity.metadata.name || from}' sent an image.`);
      (async () => {
        try {
          const directMediaUrl = await getMediaUrl(req.body.mediaId);
          if (!directMediaUrl) {
            console.error('[Agency Guard] Could not resolve Media URL.');
            return;
          }

          const imageBuffer = await downloadMedia(req.body.mediaId);
          const result = await processVacancyPoster(imageBuffer, mimeType || 'image/jpeg');
          await ingestAgencyVacancy({
            agencyId: identity.metadata.id || identity.metadata.contact || identity.metadata.phone || from,
            agencyName: identity.metadata.name || identity.metadata.agencyName || from,
            agencyPhone: from,
            imageUrl: directMediaUrl,
            sourceImageMediaId: req.body.mediaId || '',
            sourceImageMimeType: mimeType || 'image/jpeg',
            rawText: result.rawText,
            details: result.details,
            generatedTemplates: result.templates,
            assignedTemplateName: result.assignedTemplateName || '',
            sourceType: 'image',
            allowBroadcast: true,
          });

          await sendTextMessage(
            from,
            'Poster receive ho gaya hai. Vacancy dashboard par draft ke roop mein save ho gayi hai. Admin review aur edit ke baad hi Meta approval ke liye submit ki jayegi.'
          );
          console.log(`[Agency Guard] Poster queued for approval from ${identity.metadata.name || from}`);
        } catch (err) {
          console.error(`[Agency Guard] Processing Failed: ${err.message}`);
        }
      })();
    } else if (identity.tag === 'AGENCY') {
      const gate = await shouldAutoReply(from);
      if (!gate.allow) {
        console.log(`[AI Recruiter] AGENCY auto-reply SUPPRESSED for ${from} (${gate.reason})`);
      } else {
        console.log(`[AI Recruiter] Agency intake conversation from: ${from} (gate=${gate.reason})`);
        const result = await handleCandidateConversation({
          from,
          name: identity.metadata?.name || req.body.name || 'Agency',
          body: storedBody,
          type: finalType,
          mediaId: mediaId || '',
          mediaUrl: mediaUrl || '',
          mimeType: mimeType || '',
          fileName: fileName || '',
          inboundStored: true,
          messageId: req.body.id || req.body.messageId || '',
          identityTag: 'AGENCY',
          recipientPhone,
          recipientPhoneId,
          channel,
        });
        console.log(`[AI Recruiter] Agency reply status for ${from}: ${result.replied ? 'REPLIED' : 'SKIPPED'}`);
      }
    } else if (identity.tag === 'CANDIDATE') {
      const gate = await shouldAutoReply(from);
      if (!gate.allow) {
        console.log(`[AI Recruiter] CANDIDATE auto-reply SUPPRESSED for ${from} (${gate.reason})`);
      } else {
        console.log(`[AI Recruiter] Incoming message from candidate: ${from} (gate=${gate.reason})`);
        const result = await handleCandidateConversation({
          from,
          name: identity.metadata?.name || req.body.name || 'Candidate',
          body: storedBody,
          type: finalType,
          mediaId: mediaId || '',
          mediaUrl: mediaUrl || '',
          mimeType: mimeType || '',
          fileName: fileName || '',
          inboundStored: true,
          messageId: req.body.id || req.body.messageId || '',
          identityTag: identity.tag,
          recipientPhone,
          recipientPhoneId,
          channel,
        });
        console.log(`[AI Recruiter] Reply status for ${from}: ${result.replied ? 'REPLIED' : 'SKIPPED'}`);
      }
    }

    res.json({ success: true, identity });
  } catch (err) {
    console.error('[Webhook] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/send — Manual Override
router.post('/send', async (req, res) => {
  try {
    let { phone, message, templateName, components, candidateData, languageCode, templateVariables, senderPhoneId } = req.body;
    if (!phone || (!message && !templateName)) {
      return res.status(400).json({ error: 'Phone and either message or templateName required' });
    }

    phone = phone.replace(/\D/g, '');

    let activePhone = phone;
    if (phone.length === 10) {
      const indExists = await rtdbGet(`messages/91${phone}`);
      if (indExists) {
        activePhone = `91${phone}`;
      } else {
        const pakExists = await rtdbGet(`messages/92${phone}`);
        if (pakExists) activePhone = `92${phone}`;
      }
    } else {
      const directExists = await rtdbGet(`messages/${phone}`);
      if (!directExists) {
        if (!phone.startsWith('91')) {
          const indExists = await rtdbGet(`messages/91${phone}`);
          if (indExists) activePhone = `91${phone}`;
        }
        if (activePhone === phone && !phone.startsWith('92')) {
          const pakExists = await rtdbGet(`messages/92${phone}`);
          if (pakExists) activePhone = `92${phone}`;
        }
      }
    }

    const activeSenderPhoneId = senderPhoneId || candidateData?.lastRecipientPhoneId || candidateData?.lastRecipientPhone || null;

    // This route used to always send via WhatsApp regardless of the contact's
    // actual channel — a Messenger/Instagram contact (a PSID, not a phone
    // number) got rejected by WhatsApp's API ("Message undeliverable"), so
    // admins could never manually reply to those from the dashboard chat box
    // even though the AI bot's own replies already routed correctly.
    const contactChannel = await resolveContactChannel(activePhone);

    let result;
    if (contactChannel === 'messenger') {
      result = await sendMessengerMessage(activePhone, message);
    } else if (contactChannel === 'instagram') {
      result = await sendInstagramMessage(activePhone, message);
    } else if (req.body.templateName) {
      const { buildComponents, getTemplateLanguage } = require('../services/templateService');

      let finalComponents = components || [];
      if (finalComponents.length === 0) {
        finalComponents = await buildComponents(templateName, candidateData || {}, Array.isArray(templateVariables) ? templateVariables : []);
      }

      const finalLang = languageCode || await getTemplateLanguage(templateName);
      console.log(`[Message Router] Sending Template '${templateName}' in '${finalLang}' to ${activePhone} from ${activeSenderPhoneId || 'default'}`);

      result = await sendTemplateMessage(activePhone, req.body.templateName, finalComponents, finalLang, activeSenderPhoneId);
    } else {
      result = await sendMessage(activePhone, message, activeSenderPhoneId);
    }

    const firebaseKey = await rtdbPush(`messages/${activePhone}`, {
      from: 'SYSTEM',
      to: activePhone,
      body: req.body.templateName ? `[OFFICIAL TEMPLATE: ${req.body.templateName}]` : message,
      wamId: result.messageId || null,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      status: result.success ? 'sent' : 'failed',
      error: result.error || null
    });

    if (result.success && result.messageId) {
      await rtdbSet(`message_map/${safeFirebaseKey(result.messageId)}`, {
        phone: activePhone,
        firebaseKey: firebaseKey
      });
    }

    await appendChatLog({
      phone: activePhone,
      message: req.body.templateName ? `[OFFICIAL TEMPLATE: ${req.body.templateName}]` : message,
      direction: 'OUTBOUND',
      timestamp: new Date().toISOString(),
    });

    await publishDashboardMessageEvent({
      phone: activePhone,
      kind: 'outbound',
      status: result.success ? 'sent' : 'failed',
      body: req.body.templateName ? `[OFFICIAL TEMPLATE: ${req.body.templateName}]` : message,
      messageId: result.messageId || '',
    });

    res.json({ ...result, phone: activePhone });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/messages/history/:phone
router.get('/history/:phone', async (req, res) => {
  try {
    let { phone } = req.params;
    phone = phone.replace(/\D/g, '');

    let mergedMessages = {};
    const direct = await rtdbGet(`messages/${phone}`);
    if (direct && typeof direct === 'object') {
      Object.assign(mergedMessages, direct);
    }

    if (phone.length === 10) {
      const m91 = await rtdbGet(`messages/91${phone}`);
      if (m91 && typeof m91 === 'object') Object.assign(mergedMessages, m91);
      
      const m92 = await rtdbGet(`messages/92${phone}`);
      if (m92 && typeof m92 === 'object') Object.assign(mergedMessages, m92);
    } else if (phone.length === 12) {
      if (phone.startsWith('91')) {
        const mSuffix = await rtdbGet(`messages/${phone.substring(2)}`);
        if (mSuffix && typeof mSuffix === 'object') Object.assign(mergedMessages, mSuffix);
      } else if (phone.startsWith('92')) {
        const mSuffix = await rtdbGet(`messages/${phone.substring(2)}`);
        if (mSuffix && typeof mSuffix === 'object') Object.assign(mergedMessages, mSuffix);
      }
    }

    res.json({ success: true, messages: mergedMessages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/send-voice — Send recorded voice note via WhatsApp
router.post('/send-voice', uploadMemory.single('audio'), async (req, res) => {
  try {
    let { phone, senderPhoneId } = req.body;
    if (!phone || !req.file) {
      return res.status(400).json({ error: 'phone and audio file required' });
    }

    phone = phone.replace(/\D/g, '');

    // Resolve correct phone key in Firebase
    let activePhone = phone;
    if (phone.length === 10) {
      const indExists = await rtdbGet(`messages/91${phone}`);
      if (indExists) {
        activePhone = `91${phone}`;
      } else {
        const pakExists = await rtdbGet(`messages/92${phone}`);
        if (pakExists) activePhone = `92${phone}`;
      }
    } else {
      const directExists = await rtdbGet(`messages/${phone}`);
      if (!directExists) {
        if (!phone.startsWith('91')) {
          const indExists = await rtdbGet(`messages/91${phone}`);
          if (indExists) activePhone = `91${phone}`;
        }
        if (activePhone === phone && !phone.startsWith('92')) {
          const pakExists = await rtdbGet(`messages/92${phone}`);
          if (pakExists) activePhone = `92${phone}`;
        }
      }
    }

    const voiceChannel = await resolveContactChannel(activePhone);
    if (voiceChannel !== 'whatsapp') {
      return res.status(400).json({ error: `Voice notes aren't built for Messenger/Instagram yet — this contact is on ${voiceChannel}.` });
    }

    const mimeType = req.file.mimetype || 'audio/ogg';
    const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : mimeType.includes('mpeg') ? 'mp3' : 'ogg';
    const fileName = `voice_${Date.now()}.${ext}`;

    // Upload to Meta CDN
    const upload = await uploadMediaAsset(req.file.buffer, mimeType, fileName, senderPhoneId);
    if (!upload.success || !upload.id) {
      return res.status(500).json({ error: upload.error || 'Media upload failed' });
    }

    // Send WhatsApp audio message
    const result = await sendAudioMessage(activePhone, upload.id, senderPhoneId);

    // Save to Firebase
    const now = new Date().toISOString();
    const firebaseKey = await rtdbPush(`messages/${activePhone}`, {
      from: 'SYSTEM',
      to: activePhone,
      body: '[VOICE NOTE]',
      type: 'audio',
      mimeType,
      mediaId: upload.id,
      wamId: result.messageId || null,
      direction: 'outbound',
      timestamp: now,
      status: result.success ? 'sent' : 'failed',
    });

    if (result.success && result.messageId) {
      await rtdbSet(`message_map/${safeFirebaseKey(result.messageId)}`, {
        phone: activePhone,
        firebaseKey,
      });
    }

    await publishDashboardMessageEvent({
      phone: activePhone,
      kind: 'outbound',
      status: result.success ? 'sent' : 'failed',
      body: '[VOICE NOTE]',
      messageId: result.messageId || '',
    });

    res.json({ ...result, phone: activePhone });
  } catch (err) {
    console.error('[send-voice] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/request-repost — Triggered by "Manual Repost" button in UI
router.post('/request-repost', async (req, res) => {
  try {
    const { candidateName } = req.body;
    if (!candidateName) return res.status(400).json({ error: 'Candidate name required' });

    const { rtdbGetFiltered } = require('../services/firebaseService');
    const { requestNewDocumentPhoto } = require('../services/whatsappService');

    const candidates = await rtdbGetFiltered('candidates', 'name', candidateName);
    if (!candidates || Object.keys(candidates).length === 0) {
      return res.status(404).json({ error: 'Candidate not found.' });
    }

    const id = Object.keys(candidates)[0];
    const candidate = { id, ...candidates[id] };

    if (!candidate.phone) {
      return res.status(400).json({ error: 'Candidate has no phone number on record.' });
    }

    const result = await requestNewDocumentPhoto(candidate);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/messages/share — Share media or text to another WhatsApp number
router.post('/share', async (req, res) => {
  try {
    const { to, type, mediaId, mediaUrl, filename, text, senderPhoneId } = req.body;
    if (!to || !type) {
      return res.status(400).json({ error: 'recipient (to) and share type are required' });
    }

    const cleanTo = to.replace(/\D/g, '');
    const { sendTextMessage, sendImageMessage, sendAudioMessage, sendDocumentMessage } = require('../services/whatsappService');

    const shareChannel = await resolveContactChannel(cleanTo);
    if (shareChannel !== 'whatsapp' && type !== 'text') {
      return res.status(400).json({ error: `Sharing documents/images/audio isn't built for Messenger/Instagram yet — this contact is on ${shareChannel}.` });
    }

    let result;
    if (shareChannel === 'messenger' && type === 'text') {
      result = await sendMessengerMessage(cleanTo, text);
    } else if (shareChannel === 'instagram' && type === 'text') {
      result = await sendInstagramMessage(cleanTo, text);
    } else if (type === 'text') {
      if (!text) return res.status(400).json({ error: 'text body is required for text share' });
      result = await sendTextMessage(cleanTo, text, senderPhoneId);
    } else if (type === 'document') {
      result = await sendDocumentMessage(cleanTo, { mediaId, documentUrl: mediaUrl, filename: filename || 'CV.pdf' }, senderPhoneId);
    } else if (type === 'image') {
      result = await sendImageMessage(cleanTo, { mediaId, imageUrl: mediaUrl, caption: filename || 'Photo' }, senderPhoneId);
    } else if (type === 'audio') {
      result = await sendAudioMessage(cleanTo, { mediaId, audioUrl: mediaUrl }, senderPhoneId);
    } else {
      return res.status(400).json({ error: `unsupported share type: ${type}` });
    }

    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Share failed' });
    }

    // Save outbound log to database under the recipient's chat!
    let bodyText = '[SHARED MEDIA]';
    if (type === 'text') bodyText = text;
    else if (type === 'document') bodyText = `[SHARED DOCUMENT] ${filename || 'CV.pdf'}`;
    else if (type === 'image') bodyText = `[SHARED IMAGE] ${filename || 'Photo'}`;
    else if (type === 'audio') bodyText = '[SHARED VOICE NOTE]';

    const now = new Date().toISOString();
    const firebaseKey = await rtdbPush(`messages/${cleanTo}`, {
      from: 'SYSTEM',
      to: cleanTo,
      body: bodyText,
      type: type,
      mimeType: type === 'document' ? 'application/pdf' : type === 'image' ? 'image/jpeg' : type === 'audio' ? 'audio/ogg' : null,
      mediaId: mediaId || null,
      mediaUrl: mediaUrl || null,
      fileName: filename || null,
      wamId: result.messageId || null,
      direction: 'outbound',
      timestamp: now,
      status: 'sent',
    });

    if (result.messageId) {
      await rtdbSet(`message_map/${safeFirebaseKey(result.messageId)}`, {
        phone: cleanTo,
        firebaseKey,
      });
    }

    await publishDashboardMessageEvent({
      phone: cleanTo,
      kind: 'outbound',
      status: 'sent',
      body: bodyText,
      messageId: result.messageId || '',
    });

    res.json({ success: true, messageId: result.messageId, to: cleanTo });
  } catch (err) {
    console.error('[Share API] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
