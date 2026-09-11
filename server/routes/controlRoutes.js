/**
 * Control Plane Routes  (/api/control/*)
 * ----------------------------------------------------------------------------
 * One unified API surface used by:
 *   - Hermes / OpenClaw  — to drive every WhatsApp function programmatically
 *   - The mobile app     — to view all chats and operate from the phone
 *
 * All routes here REQUIRE the `apiKeyAuth` middleware (Bearer / X-API-Key).
 *
 * Endpoints (groups):
 *
 *  Auth / health
 *    GET    /health
 *    GET    /me
 *    GET    /meta/status
 *
 *  Conversations / messages
 *    GET    /conversations                 ?limit&cursor&search
 *    GET    /conversations/:phone          (alias of history)
 *    POST   /conversations/:phone/read
 *    GET    /messages/history/:phone
 *    POST   /messages/send                 { phone, message }   (text reply)
 *    POST   /messages/send-template        { phone, templateName, languageCode?, components?, candidateData?, templateVariables? }
 *    POST   /messages/send-image           { phone, mediaId?|imageUrl?, caption? }
 *
 *  Auto-reply
 *    GET    /auto-reply                    => { global, overrides }
 *    POST   /auto-reply                    { enabled: bool }
 *    GET    /auto-reply/:phone
 *    POST   /auto-reply/:phone             { mode: 'on'|'off'|'inherit' }
 *
 *  Templates (Meta Cloud API)
 *    GET    /templates                     => cached + Meta
 *    POST   /templates                     { name, bodyText, category?, language?, headerImageUrl? } => submit to Meta
 *    DELETE /templates/:name               ?metaId=...
 *    POST   /templates/sync                => refresh cache from Meta
 *
 *  Broadcast / bulk
 *    POST   /broadcast                     { targets[], customMessage?, templateName?, templateVariables?, mediaOptions? }
 *    GET    /broadcast/latest-report
 *
 *  Identity helpers (used by mobile UI dropdowns)
 *    GET    /candidates                    proxies the existing candidates listing
 *
 * NOTE: This router intentionally re-uses the underlying services so that
 * behaviour stays in sync with the public webhook + legacy /api/messages/*
 * routes that the dashboard already depends on.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const mediaUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

const {
  rtdbGet,
  rtdbPush,
  rtdbUpdate,
  rtdbSet,
  rtdbGetAll,
  safeFirebaseKey,
} = require('../services/firebaseService');

const {
  sendMessage,
  sendTextMessage,
  sendTemplateMessage,
  sendImageMessage,
  sendAudioMessage,
  uploadMediaAsset,
  createMetaTemplate,
  deleteMetaTemplate,
  getMetaStatus,
  fetchMetaTemplates,
  bulkBlast,
  normalizeWhatsAppNumber,
} = require('../services/whatsappService');

const {
  getAvailableTemplates,
  syncStoredTemplateStatuses,
  buildComponents,
  getTemplateLanguage,
} = require('../services/templateService');

const autoReply = require('../services/autoReplyService');
const { publishDashboardMessageEvent } = require('../services/dashboardRealtimeService');

// All routes in this file are auth-protected.
router.use(apiKeyAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Auth / health
// ─────────────────────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'gulf-career-control-plane', time: new Date().toISOString() });
});

router.get('/me', (req, res) => {
  res.json({
    ok: true,
    auth: req.controlAuth || null,
    permissions: ['messages', 'conversations', 'auto-reply', 'templates', 'broadcast'],
  });
});

router.get('/meta/status', async (_req, res) => {
  try {
    const status = await getMetaStatus();
    res.json({ ok: true, status });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Conversations / messages
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Different ingestion paths write `timestamp` differently — older code paths write
 * an ISO-8601 string, some webhook writer (not in this checkout, but sharing the
 * same Firebase DB) writes a raw epoch-millis number instead. Normalize everything
 * to ISO-8601 so plain string comparisons (which ARE lexicographically correct for
 * ISO-8601) sort correctly and Android's Instant.parse() always succeeds.
 */
function normalizeTimestamp(ts) {
  if (ts == null) return '';
  if (typeof ts === 'number') {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  if (typeof ts === 'string') {
    if (/^\d{9,13}$/.test(ts)) {
      const d = new Date(Number(ts));
      return isNaN(d.getTime()) ? ts : d.toISOString();
    }
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toISOString();
  }
  return '';
}

/**
 * Internal helper: turn the raw `messages/<phone>` map into a flat array
 * sorted ascending by timestamp.
 */
function flattenHistory(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .map(([key, value]) => ({
      ...value,
      id: key,
      // Some writers (e.g. the AI reply path) only set `text`, not `body` — the
      // mobile app and web UI both read `body`, so without this the bubble
      // renders empty (only the timestamp/read-ticks show).
      body: value?.body ?? value?.text ?? '',
      timestamp: normalizeTimestamp(value?.timestamp),
    }))
    .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
}

router.get('/conversations', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
    const search = String(req.query.search || '').replace(/\D/g, '');
    const botTypeFilter = String(req.query.botType || '').trim();
    // NOTE: must use rtdbGet (raw object keyed by phone), not rtdbGetAll (which
    // flattens to an array-with-id) — Object.entries() on the flattened array
    // would yield array indices as "phone" instead of the real phone numbers.
    const all = (await rtdbGet('messages')) || {};
    const candidatesMap = (await rtdbGetAll('candidates')) || {};

    // Build a phone -> name/lead/botType index from candidates (best-effort).
    const nameIndex = {};
    const leadIndex = {};
    const botTypeIndex = {};
    Object.values(candidatesMap).forEach((c) => {
      if (!c || !c.phone) return;
      const digits = String(c.phone).replace(/\D/g, '');
      if (!digits) return;
      nameIndex[digits] = c.name || c.fullName || '';
      if (c.isHotLead) leadIndex[digits] = { isHotLead: true, hotLeadCategory: c.leadCategory || '' };
      // Candidate Pool tabs on the web dashboard split by bot_name, not a "botType" field.
      botTypeIndex[digits] = c.bot_name === 'AR Studios' ? 'ARS' : 'GCG';
    });

    const overrides = await autoReply.getAllOverrides();

    const items = [];
    for (const [phone, threadMap] of Object.entries(all)) {
      if (search && !phone.includes(search)) continue;
      const history = flattenHistory(threadMap);
      const last = history[history.length - 1] || null;
      const unreadCount = history.filter(
        (m) => m.direction === 'inbound' && !m.readAt,
      ).length;
      items.push({
        phone,
        name: nameIndex[phone] || '',
        lastMessage: last
          ? {
              body: last.body || '',
              type: last.type || 'text',
              direction: last.direction || '',
              status: last.status || '',
              timestamp: last.timestamp || null,
              messageId: last.wamId || last.messageId || last.msgId || null,
            }
          : null,
        unreadCount,
        autoReply: overrides[safeFirebaseKey(phone)]
          ? overrides[safeFirebaseKey(phone)].mode
          : 'inherit',
        messageCount: history.length,
        isHotLead: Boolean(leadIndex[phone]?.isHotLead),
        hotLeadCategory: leadIndex[phone]?.hotLeadCategory || '',
        botType: botTypeIndex[phone] || 'GCG',
      });
    }

    const filteredItems = botTypeFilter
      ? items.filter((it) => it.botType === botTypeFilter)
      : items;

    filteredItems.sort((a, b) => {
      const ta = String(a.lastMessage?.timestamp || '');
      const tb = String(b.lastMessage?.timestamp || '');
      return tb.localeCompare(ta);
    });

    res.json({ ok: true, total: filteredItems.length, items: filteredItems.slice(0, limit) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function fetchHistory(rawPhone) {
  const phone = String(rawPhone || '').replace(/\D/g, '');
  if (!phone) return { phone: '', messages: [] };
  
  let mergedMessages = {};
  let resolvedPhone = phone;
  
  const direct = await rtdbGet(`messages/${phone}`);
  if (direct && typeof direct === 'object') {
    Object.assign(mergedMessages, direct);
  }
  
  if (phone.length === 10) {
    const p91 = `91${phone}`;
    const m91 = await rtdbGet(`messages/${p91}`);
    if (m91 && typeof m91 === 'object') {
      Object.assign(mergedMessages, m91);
      resolvedPhone = p91;
    }
    
    const p92 = `92${phone}`;
    const m92 = await rtdbGet(`messages/${p92}`);
    if (m92 && typeof m92 === 'object') {
      Object.assign(mergedMessages, m92);
      resolvedPhone = p92;
    }
  } else if (phone.length === 12) {
    if (phone.startsWith('91')) {
      const suffix = phone.substring(2);
      const mSuffix = await rtdbGet(`messages/${suffix}`);
      if (mSuffix && typeof mSuffix === 'object') {
        Object.assign(mergedMessages, mSuffix);
      }
    } else if (phone.startsWith('92')) {
      const suffix = phone.substring(2);
      const mSuffix = await rtdbGet(`messages/${suffix}`);
      if (mSuffix && typeof mSuffix === 'object') {
        Object.assign(mergedMessages, mSuffix);
      }
    }
  }
  
  return { phone: resolvedPhone, messages: flattenHistory(mergedMessages) };
}

router.get('/messages/history/:phone', async (req, res) => {
  try {
    const data = await fetchHistory(req.params.phone);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/conversations/:phone', async (req, res) => {
  try {
    const data = await fetchHistory(req.params.phone);
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/conversations/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ ok: false, error: 'BAD_PHONE' });
    await rtdbSet(`messages/${phone}`, null);
    res.json({ ok: true, phone });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/conversations/:phone/read', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ ok: false, error: 'BAD_PHONE' });
    const threadMap = (await rtdbGet(`messages/${phone}`)) || {};
    const now = new Date().toISOString();
    const updates = {};
    let touched = 0;
    for (const [key, msg] of Object.entries(threadMap)) {
      if (msg && msg.direction === 'inbound' && !msg.readAt) {
        updates[`${key}/readAt`] = now;
        touched += 1;
      }
    }
    if (touched > 0) {
      await rtdbUpdate(`messages/${phone}`, updates);
    }
    res.json({ ok: true, phone, marked: touched });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

async function logOutbound({ phone, body, result, kind = 'text', templateName = '' }) {
  const firebaseKey = await rtdbPush(`messages/${phone}`, {
    from: 'SYSTEM',
    to: phone,
    body: templateName ? `[OFFICIAL TEMPLATE: ${templateName}]` : body,
    wamId: result?.messageId || null,
    direction: 'outbound',
    type: kind,
    timestamp: new Date().toISOString(),
    status: result?.success ? 'sent' : 'failed',
    error: result?.error || null,
    sentVia: 'control-plane',
  });

  if (result?.messageId) {
    await rtdbSet(`message_map/${safeFirebaseKey(result.messageId)}`, {
      phone,
      firebaseKey,
    });
  }

  try {
    await publishDashboardMessageEvent({
      phone,
      kind: 'outbound',
      status: result?.success ? 'sent' : 'failed',
      body: templateName ? `[OFFICIAL TEMPLATE: ${templateName}]` : body,
      messageId: result?.messageId || '',
    });
  } catch (err) {
    console.warn('[ControlRoutes] dashboard event publish failed:', err.message);
  }

  return firebaseKey;
}

router.post('/messages/send', async (req, res) => {
  try {
    const { phone, message } = req.body || {};
    if (!phone || !message) {
      return res.status(400).json({ ok: false, error: 'phone and message required' });
    }
    const to = normalizeWhatsAppNumber(phone);
    const result = await sendMessage(to, message);
    await logOutbound({ phone: to, body: message, result, kind: 'text' });
    res.json({ ok: result.success, phone: to, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/messages/send-template', async (req, res) => {
  try {
    const {
      phone,
      templateName,
      languageCode,
      components,
      candidateData,
      templateVariables,
    } = req.body || {};

    if (!phone || !templateName) {
      return res.status(400).json({ ok: false, error: 'phone and templateName required' });
    }

    const to = normalizeWhatsAppNumber(phone);
    let finalComponents = components || [];
    if (finalComponents.length === 0) {
      finalComponents = await buildComponents(
        templateName,
        candidateData || {},
        Array.isArray(templateVariables) ? templateVariables : [],
      );
    }
    const finalLang = languageCode || (await getTemplateLanguage(templateName));
    const result = await sendTemplateMessage(to, templateName, finalComponents, finalLang);
    await logOutbound({
      phone: to,
      body: `[OFFICIAL TEMPLATE: ${templateName}]`,
      result,
      kind: 'template',
      templateName,
    });
    res.json({ ok: result.success, phone: to, templateName, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/messages/send-image', async (req, res) => {
  try {
    const { phone, mediaId, imageUrl, caption } = req.body || {};
    if (!phone || (!mediaId && !imageUrl)) {
      return res.status(400).json({ ok: false, error: 'phone and mediaId or imageUrl required' });
    }
    const to = normalizeWhatsAppNumber(phone);
    const result = await sendImageMessage(to, { mediaId, imageUrl, caption });
    await logOutbound({
      phone: to,
      body: caption || '[IMAGE]',
      result,
      kind: 'image',
    });
    res.json({ ok: result.success, phone: to, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto-reply
// ─────────────────────────────────────────────────────────────────────────────
router.get('/auto-reply', async (_req, res) => {
  try {
    const [global, overrides] = await Promise.all([
      autoReply.getGlobalState(),
      autoReply.getAllOverrides(),
    ]);
    res.json({ ok: true, global, overrides });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/auto-reply', async (req, res) => {
  try {
    const { enabled } = req.body || {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ ok: false, error: 'enabled (boolean) required' });
    }
    const state = await autoReply.setGlobalState(enabled, req.controlAuth?.source || 'hermes');
    res.json({ ok: true, global: state });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/auto-reply/:phone', async (req, res) => {
  try {
    const o = await autoReply.getOverride(req.params.phone);
    res.json({ ok: true, override: o || { mode: 'inherit' } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/auto-reply/:phone', async (req, res) => {
  try {
    const { mode } = req.body || {};
    const updated = await autoReply.setOverride(
      req.params.phone,
      mode,
      req.controlAuth?.source || 'hermes',
    );
    res.json({ ok: true, override: updated });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Templates
// ─────────────────────────────────────────────────────────────────────────────
router.get('/templates', async (_req, res) => {
  try {
    const templates = await getAvailableTemplates();
    res.json({ ok: true, templates });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/templates', async (req, res) => {
  try {
    const {
      name,
      bodyText,
      bodyExample,
      category = 'MARKETING',
      language = 'hi',
      headerHandle,
      headerMediaId,
      headerImageUrl,
      headerMimeType,
      headerFileName,
    } = req.body || {};
    if (!name || !bodyText) {
      return res.status(400).json({ ok: false, error: 'name and bodyText required' });
    }
    const result = await createMetaTemplate({
      name,
      bodyText,
      bodyExample: Array.isArray(bodyExample) ? bodyExample : [],
      category,
      language,
      headerHandle,
      headerMediaId,
      headerImageUrl,
      headerMimeType,
      headerFileName,
    });
    res.status(result.success ? 200 : 400).json({ ok: result.success, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.delete('/templates/:name', async (req, res) => {
  try {
    const result = await deleteMetaTemplate({
      name: req.params.name,
      metaId: req.query.metaId || '',
    });
    res.status(result.success ? 200 : 400).json({ ok: result.success, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/templates/sync', async (_req, res) => {
  try {
    const fresh = await fetchMetaTemplates();
    await syncStoredTemplateStatuses(fresh);
    res.json({ ok: true, count: Array.isArray(fresh) ? fresh.length : 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Broadcast / bulk
// ─────────────────────────────────────────────────────────────────────────────
router.post('/broadcast', async (req, res) => {
  try {
    const {
      targets,
      customMessage = '',
      templateName = '',
      templateVariables = [],
      mediaOptions = {},
    } = req.body || {};
    if (!Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ ok: false, error: 'targets array required' });
    }
    if (!templateName && !customMessage) {
      return res.status(400).json({ ok: false, error: 'templateName or customMessage required' });
    }
    const result = await bulkBlast(targets, customMessage, templateName, templateVariables, mediaOptions);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/broadcast/latest-report', async (_req, res) => {
  try {
    const { getLatestReport } = require('../services/blastReportService');
    if (typeof getLatestReport === 'function') {
      const report = await getLatestReport();
      return res.json({ ok: true, report });
    }
    res.json({ ok: true, report: null });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Candidates pass-through (used by mobile to populate name search etc.)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/candidates', async (_req, res) => {
  try {
    const all = (await rtdbGetAll('candidates')) || {};
    const items = Object.entries(all).map(([id, c]) => ({ id, ...(c || {}) }));
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});


// ── Vacancy Management ────────────────────────────────────────────────────────
router.get('/vacancies', async (req, res) => {
  try {
    const data = await rtdbGetAll('vacancies');
    const items = data ? Object.entries(data).map(([id, val]) => ({ id, ...val })) : [];
    items.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Simple, direct field edit on an existing vacancy — no agency-approval pipeline,
// no markup/branding recompute. Intended for quick admin edits (e.g. from the mobile app).
router.patch('/vacancies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await rtdbGet(`vacancies/${id}`);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Vacancy not found' });
    }

    const { skill, country, title, salary, serviceCharge, priority, candidateFacingText, benefits, documents, visaInfo, status } = req.body || {};
    const updates = { updatedAt: new Date().toISOString() };
    if (skill !== undefined) updates.skill = String(skill);
    if (country !== undefined) updates.country = String(country);
    if (title !== undefined) updates.title = String(title);
    if (salary !== undefined) updates.salary = String(salary);
    if (serviceCharge !== undefined) updates.serviceCharge = String(serviceCharge);
    if (candidateFacingText !== undefined) updates.candidateFacingText = String(candidateFacingText);
    if (benefits !== undefined) updates.benefits = String(benefits);
    if (documents !== undefined) updates.documents = String(documents);
    if (visaInfo !== undefined) updates.visaInfo = String(visaInfo);
    if (status !== undefined) updates.status = String(status);
    if (priority !== undefined && priority !== '') {
      const normalizedPriority = Number(priority);
      if (Number.isFinite(normalizedPriority)) updates.priority = normalizedPriority;
    }

    await rtdbUpdate(`vacancies/${id}`, updates);
    res.json({ ok: true, id, vacancy: { ...existing, ...updates } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Simple, direct vacancy delete — matches the "simple direct edit" philosophy of the
// PATCH/POST-simple endpoints above. Intended for the mobile app's Delete option.
router.delete('/vacancies/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await rtdbGet(`vacancies/${id}`);
    if (!existing) {
      return res.status(404).json({ ok: false, error: 'Vacancy not found' });
    }
    await rtdbSet(`vacancies/${id}`, null);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Simple, direct vacancy creation — skips the agency queue/markup/branding/template
// approval pipeline used by POST /vacancies. Intended for quick admin adds (mobile app).
router.post('/vacancies/simple', async (req, res) => {
  try {
    const { skill, country, title, salary, serviceCharge, candidateFacingText, benefits, documents, visaInfo, priority } = req.body || {};
    if (!skill) {
      return res.status(400).json({ ok: false, error: 'skill required' });
    }

    const normalizedPriority = priority === '' || priority === null || priority === undefined
      ? null
      : Number(priority);

    const vacancyData = {
      skill: String(skill),
      title: title ? String(title) : String(skill),
      country: country ? String(country) : 'Unspecified',
      salary: salary ? String(salary) : '',
      serviceCharge: serviceCharge ? String(serviceCharge) : '',
      candidateFacingText: candidateFacingText ? String(candidateFacingText) : '',
      benefits: benefits ? String(benefits) : '',
      documents: documents ? String(documents) : '',
      visaInfo: visaInfo ? String(visaInfo) : '',
      status: 'active',
      priority: Number.isFinite(normalizedPriority) ? normalizedPriority : null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const vacancyId = await rtdbPush('vacancies', vacancyData);
    res.json({ ok: true, id: vacancyId, vacancy: { id: vacancyId, ...vacancyData } });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.get('/vacancies/queue', async (req, res) => {
  try {
    const data = await rtdbGetAll('agency_queue');
    const items = data ? Object.entries(data).map(([id, val]) => ({ id, ...val })) : [];
    items.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    res.json({ ok: true, total: items.length, items });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

const { 
  ingestAgencyVacancy, 
  saveAgencyTemplateDraft, 
  submitAgencyTemplateDraft 
} = require('../services/agencyVacancyAutomationService');

router.post('/vacancies', async (req, res) => {
  try {
    const { 
      skill, 
      country, 
      salary, 
      agencyName, 
      agencyPhone, 
      serviceCharge, 
      rawText 
    } = req.body;

    const result = await ingestAgencyVacancy({
      agencyId: 'HERMES_API_UPLOAD',
      agencyName: agencyName || 'Hermes Control Plane',
      agencyPhone: agencyPhone || '',
      rawText: rawText || '',
      details: { skill, country, salary, serviceCharge },
      sourceType: 'hermes_api',
      allowBroadcast: true,
    });

    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/vacancy/active', async (req, res) => {
  try {
    const { serviceCharge, botInstructions, updatedBy } = req.body || {};
    await rtdbUpdate('vacancies/active', {
      ...(serviceCharge ? { serviceCharge } : {}),
      ...(botInstructions ? { botInstructions } : {}),
      updatedBy: updatedBy || 'Admin App',
      updatedAt: new Date().toISOString(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.patch('/vacancies/draft', async (req, res) => {
  try {
    const { queueId, vacancyId, candidateFacingText, templateDraftBody } = req.body;
    const result = await saveAgencyTemplateDraft({
      queueId,
      vacancyId,
      candidateFacingText,
      templateDraftBody,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/vacancies/approve', async (req, res) => {
  try {
    const { queueId, vacancyId } = req.body;
    const result = await submitAgencyTemplateDraft({ queueId, vacancyId });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Knowledge Base (simple Q&A CRUD, mirrors legacy mobile app contract)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/knowledge-base', async (_req, res) => {
  try {
    const all = (await rtdbGetAll('knowledge_base')) || [];
    const entries = all
      .map((e) => ({
        id: e.id,
        question: e.question || '',
        answer: e.answer || '',
        source: e.source || 'manual',
        addedAt: e.addedAt || 0,
        addedBy: e.addedBy || 'admin',
      }))
      .sort((a, b) => b.addedAt - a.addedAt);
    res.json({ success: true, count: entries.length, entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/knowledge-base', async (req, res) => {
  try {
    const { question, answer, source, addedBy } = req.body || {};
    if (!question || !answer) {
      return res.status(400).json({ success: false, error: 'question and answer required' });
    }
    const id = await rtdbPush('knowledge_base', {
      question,
      answer,
      source: source || 'mobile_app',
      addedBy: addedBy || 'admin',
      addedAt: Date.now(),
    });
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Hot Leads / Suspects (stored on the candidate record, keyed by phone)
// ─────────────────────────────────────────────────────────────────────────────
async function findCandidateByPhone(phone) {
  const all = (await rtdbGetAll('candidates')) || [];
  return all.find((c) => String(c.phone || '').replace(/\D/g, '') === phone) || null;
}

router.post('/leads/suspects/add', async (req, res) => {
  try {
    const { phone, name, category } = req.body || {};
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    if (!cleanPhone || !category) {
      return res.status(400).json({ success: false, error: 'phone and category required' });
    }
    const now = Date.now();
    const existing = await findCandidateByPhone(cleanPhone);
    if (existing) {
      await rtdbUpdate('candidates', {
        [`${existing.id}/isHotLead`]: true,
        [`${existing.id}/leadCategory`]: category,
        [`${existing.id}/leadMarkedAt`]: now,
      });
    } else {
      await rtdbPush('candidates', {
        phone: cleanPhone,
        name: name || '',
        isHotLead: true,
        leadCategory: category,
        leadMarkedAt: now,
        createdAt: now,
      });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/leads/suspects/summary', async (_req, res) => {
  try {
    const all = (await rtdbGetAll('candidates')) || [];
    const hot = all.filter((c) => c.isHotLead);
    const summary = { total: hot.length, CALLED: 0, IN_TALKS: 0, CAN_GO: 0, FOLLOW_UP: 0, PENDING: 0 };
    const suspects = hot.map((c) => {
      const cat = c.leadCategory || 'PENDING';
      if (Object.prototype.hasOwnProperty.call(summary, cat)) summary[cat] += 1;
      else summary.PENDING += 1;
      return {
        phone: c.phone || '',
        name: c.name || 'Unknown',
        category: cat,
        markedAt: c.leadMarkedAt || 0,
        updatedAt: c.leadMarkedAt || 0,
      };
    });
    res.json({ success: true, summary, suspects });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Reminders (auto follow-up: flags inbound messages that never got a reply)
// ─────────────────────────────────────────────────────────────────────────────
const REMINDER_THRESHOLD_MS = 3 * 60 * 60 * 1000; // 3h since last inbound msg
const REMINDER_OVERDUE_MS = 24 * 60 * 60 * 1000; // 24h = overdue

router.get('/reminders', async (_req, res) => {
  try {
    const allMessages = (await rtdbGetAll('messages')) || [];
    const candidatesMap = (await rtdbGetAll('candidates')) || [];
    const reminderState = (await rtdbGet('reminder_state')) || {};

    const nameIndex = {};
    candidatesMap.forEach((c) => {
      const digits = String(c.phone || '').replace(/\D/g, '');
      if (digits) nameIndex[digits] = c.name || c.fullName || '';
    });

    const now = Date.now();
    const items = [];
    allMessages.forEach((thread) => {
      const phone = thread.id;
      if (!phone) return;
      const history = flattenHistory(thread);
      if (history.length === 0) return;
      const last = history[history.length - 1];
      if (last.direction !== 'inbound') return;

      const ts = new Date(last.timestamp || 0).getTime();
      if (!ts) return;
      const ageMs = now - ts;
      if (ageMs < REMINDER_THRESHOLD_MS) return;

      const state = reminderState[safeFirebaseKey(phone)];
      if (state?.doneAt && new Date(state.doneAt).getTime() > ts) return;
      if (state?.dismissedAt && new Date(state.dismissedAt).getTime() > ts) return;

      const reminderTime = new Date(ts).toISOString().replace(/\.\d{3}Z$/, '');
      items.push({
        id: phone,
        phone,
        customerName: nameIndex[phone] || 'Unknown',
        reminderTime,
        reason: 'Customer message not replied yet',
        originalMessage: last.body || '',
        direction: 'inbound',
        createdAt: ts,
        status: 'pending',
        notified: false,
        isOverdue: ageMs > REMINDER_OVERDUE_MS,
      });
    });

    items.sort((a, b) => a.createdAt - b.createdAt);
    res.json({ success: true, reminders: items });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/reminders/:phone/done', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ success: false, error: 'BAD_PHONE' });
    await rtdbSet(`reminder_state/${safeFirebaseKey(phone)}/doneAt`, new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete('/reminders/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    if (!phone) return res.status(400).json({ success: false, error: 'BAD_PHONE' });
    await rtdbSet(`reminder_state/${safeFirebaseKey(phone)}/dismissedAt`, new Date().toISOString());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Generic media send (image / document / audio) — mobile attachment picker
// ─────────────────────────────────────────────────────────────────────────────
router.post('/messages/send-media', mediaUpload.single('file'), async (req, res) => {
  try {
    const { phone, caption } = req.body || {};
    if (!phone || !req.file) {
      return res.status(400).json({ ok: false, error: 'phone and file required' });
    }
    const to = normalizeWhatsAppNumber(phone);
    const mimeType = req.file.mimetype || 'application/octet-stream';
    const fileName = req.file.originalname || `file_${Date.now()}`;

    const upload = await uploadMediaAsset(req.file.buffer, mimeType, fileName);
    if (!upload.success || !upload.id) {
      return res.status(500).json({ ok: false, error: upload.error || 'Media upload failed' });
    }

    let result;
    let kind;
    if (mimeType.startsWith('image/')) {
      result = await sendImageMessage(to, { mediaId: upload.id, caption: caption || '' });
      kind = 'image';
    } else if (mimeType.startsWith('audio/')) {
      result = await sendAudioMessage(to, upload.id);
      kind = 'audio';
    } else {
      const ACCESS_TOKEN = process.env.META_WHATSAPP_TOKEN;
      const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
      const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { id: upload.id, filename: fileName, caption: caption || '' },
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      result = response.ok
        ? { success: true, messageId: data?.messages?.[0]?.id }
        : { success: false, error: data?.error?.message || 'Meta API Error' };
      kind = 'document';
    }

    await logOutbound({
      phone: to,
      body: caption || `[${kind.toUpperCase()}] ${fileName}`,
      result,
      kind,
    });

    res.json({ ok: Boolean(result.success), phone: to, ...result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;

