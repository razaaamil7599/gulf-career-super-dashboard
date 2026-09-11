/**
 * Agency Routes
 * Handles manual vacancy poster uploads and authorized agency management.
 */

const express = require('express');
const multer = require('multer');
const router = express.Router();
const { processVacancyPoster } = require('../services/aiAgentService');
const { rtdbGetAll, rtdbGet, rtdbUpdate } = require('../services/firebaseService');
const {
  ingestAgencyVacancy,
  saveAgencyTemplateDraft,
  submitAgencyTemplateDraft,
} = require('../services/agencyVacancyAutomationService');
const { getHiddenTemplateNames, syncStoredTemplateStatuses } = require('../services/templateService');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

function isVisibleTemplateRecord(item = {}, hiddenTemplateNames = new Set()) {
  const templateName = String(item.metaTemplateName || '').trim();
  if (!templateName) {
    return true;
  }

  return !hiddenTemplateNames.has(templateName);
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

async function resolveSourceImageContext(item = {}, messageCache = new Map()) {
  const existingMediaId = String(item.sourceImageMediaId || '').trim();
  const existingMimeType = String(item.sourceImageMimeType || '').trim();
  const existingImageUrl = String(item.sourceImageUrl || item.imageUrl || '').trim();

  if (existingMediaId) {
    return {
      mediaId: existingMediaId,
      mimeType: existingMimeType,
      imageUrl: existingImageUrl,
    };
  }

  if (String(item.sourceType || '').trim().toLowerCase() !== 'image') {
    return { mediaId: '', mimeType: existingMimeType, imageUrl: existingImageUrl };
  }

  const phone = normalizePhone(item.agencyPhone || '');
  if (!phone) {
    return { mediaId: '', mimeType: existingMimeType, imageUrl: existingImageUrl };
  }

  if (!messageCache.has(phone)) {
    try {
      messageCache.set(phone, await rtdbGetAll(`messages/${phone}`));
    } catch (error) {
      console.warn('[Agency] Source image lookup failed:', error.message);
      messageCache.set(phone, []);
    }
  }

  const targetTimestamp = new Date(item.updatedAt || item.createdAt || item.timestamp || 0).getTime();
  const matchedMessage = (messageCache.get(phone) || [])
    .filter((message) =>
      String(message.direction || '').toLowerCase() === 'inbound'
      && String(message.type || '').toLowerCase() === 'image'
      && String(message.mediaId || '').trim()
    )
    .sort((left, right) => {
      const leftTs = new Date(left.timestamp || left.createdAt || 0).getTime();
      const rightTs = new Date(right.timestamp || right.createdAt || 0).getTime();
      return Math.abs(leftTs - targetTimestamp) - Math.abs(rightTs - targetTimestamp);
    })[0];

  return {
    mediaId: String(matchedMessage?.mediaId || '').trim(),
    mimeType: String(matchedMessage?.mimeType || existingMimeType || '').trim(),
    imageUrl: String(existingImageUrl || matchedMessage?.mediaUrl || '').trim(),
  };
}

// POST /api/agency/upload-poster
router.post('/upload-poster', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    console.log(`[Agency] Processing manual poster upload...`);
    const result = await processVacancyPoster(req.file.buffer, req.file.mimetype || 'image/jpeg');
    const automation = await ingestAgencyVacancy({
      agencyId: 'MANUAL_DASHBOARD_UPLOAD',
      agencyName: 'MANUAL_DASHBOARD_UPLOAD',
      agencyPhone: '',
      rawText: result.rawText,
      details: result.details,
      generatedTemplates: result.templates,
      assignedTemplateName: result.assignedTemplateName || '',
      sourceType: 'manual_upload',
      allowBroadcast: true,
    });

    res.json({ success: true, queueId: automation.queueId, vacancyId: automation.vacancyId, automation, ...result });
  } catch (err) {
    console.error('[Agency] Upload Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agency/queue
router.get('/queue', async (req, res) => {
  try {
    await syncStoredTemplateStatuses(req.query.refresh === 'true');
    const queue = await rtdbGetAll('agency_queue');
    const hiddenTemplateNames = await getHiddenTemplateNames();
    const visibleQueue = (queue || []).filter((item) => isVisibleTemplateRecord(item, hiddenTemplateNames));
    res.json({ success: true, queue: visibleQueue });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/demands', async (req, res) => {
  try {
    await syncStoredTemplateStatuses(req.query.refresh === 'true');
    const [agencyInbox, queue, vacancies, hiddenTemplateNames] = await Promise.all([
      rtdbGetAll('agency_inbox'),
      rtdbGetAll('agency_queue'),
      rtdbGetAll('vacancies'),
      getHiddenTemplateNames(),
    ]);

    const sortedInbox = (agencyInbox || []).sort(
      (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    );
    const sortedQueue = (queue || [])
      .filter((item) => isVisibleTemplateRecord(item, hiddenTemplateNames))
      .sort(
      (a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime()
    );

    const queueByApprovedVacancyId = new Map(
      sortedQueue
        .filter(item => item.approvedVacancyId)
        .map(item => [item.approvedVacancyId, item])
    );

    const messageCache = new Map();
    const officialVacancies = await Promise.all(
      (vacancies || [])
        .filter((vacancy) => isVisibleTemplateRecord(vacancy, hiddenTemplateNames))
        .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
        .map(async (vacancy) => {
          const sourceQueue = queueByApprovedVacancyId.get(vacancy.id);
          const sourceImage = await resolveSourceImageContext({
            ...vacancy,
            agencyPhone: sourceQueue?.agencyPhone || vacancy.agencyPhone || '',
            sourceType: sourceQueue?.sourceType || vacancy.sourceType || '',
            sourceImageMediaId: vacancy.sourceImageMediaId || sourceQueue?.sourceImageMediaId || '',
            sourceImageMimeType: vacancy.sourceImageMimeType || sourceQueue?.sourceImageMimeType || '',
            sourceImageUrl: vacancy.sourceImageUrl || sourceQueue?.sourceImageUrl || sourceQueue?.imageUrl || vacancy.imageUrl || '',
            updatedAt: sourceQueue?.updatedAt || vacancy.updatedAt || '',
            createdAt: sourceQueue?.createdAt || vacancy.createdAt || '',
            timestamp: sourceQueue?.timestamp || '',
          }, messageCache);

          if (sourceQueue?.id && sourceImage.mediaId && !sourceQueue.sourceImageMediaId) {
            await rtdbUpdate(`agency_queue/${sourceQueue.id}`, {
              sourceImageMediaId: sourceImage.mediaId,
              sourceImageMimeType: sourceImage.mimeType || '',
              sourceImageUrl: sourceImage.imageUrl || sourceQueue.imageUrl || '',
            });
          }

          if (vacancy.id && sourceImage.mediaId && !vacancy.sourceImageMediaId) {
            await rtdbUpdate(`vacancies/${vacancy.id}`, {
              sourceImageMediaId: sourceImage.mediaId,
              sourceImageMimeType: sourceImage.mimeType || '',
              sourceImageUrl: sourceImage.imageUrl || vacancy.imageUrl || '',
            });
          }

          const sourceQueuePayload = sourceQueue
            ? {
                id: sourceQueue.id,
                agencyName: sourceQueue.agencyName || '',
                agencyPhone: sourceQueue.agencyPhone || '',
                rawText: sourceQueue.rawText || sourceQueue.rawOcr || sourceQueue.inquiryText || '',
                extractedDetails: sourceQueue.extractedDetails || sourceQueue.extracted || {},
                assignedTemplateName: sourceQueue.assignedTemplateName || '',
                metaTemplateName: sourceQueue.metaTemplateName || vacancy.metaTemplateName || '',
                metaTemplateStatus: sourceQueue.metaTemplateStatus || vacancy.metaTemplateStatus || '',
                metaTemplateError: sourceQueue.metaTemplateError || vacancy.metaTemplateError || '',
                generatedTemplates: sourceQueue.generatedTemplates || [],
                status: sourceQueue.status || '',
                blastResult: sourceQueue.blastResult || {},
                candidateFacingText: sourceQueue.candidateFacingText || vacancy.candidateFacingText || '',
                templateDraftBody: sourceQueue.templateDraftBody || vacancy.templateDraftBody || '',
                submittedTemplateBody: sourceQueue.submittedTemplateBody || vacancy.submittedTemplateBody || '',
                draftNeedsSubmission: typeof sourceQueue.draftNeedsSubmission === 'boolean'
                  ? sourceQueue.draftNeedsSubmission
                  : Boolean(vacancy.draftNeedsSubmission),
                matchedCandidates: sourceQueue.matchedCandidates || vacancy.matchedCandidates || 0,
                approvalState: sourceQueue.status || vacancy.approvalState || '',
                createdAt: sourceQueue.createdAt || sourceQueue.timestamp || '',
                updatedAt: sourceQueue.updatedAt || sourceQueue.createdAt || sourceQueue.timestamp || '',
                sourceImageMediaId: sourceQueue.sourceImageMediaId || sourceImage.mediaId || '',
                sourceImageMimeType: sourceQueue.sourceImageMimeType || sourceImage.mimeType || '',
                sourceImageUrl: sourceQueue.sourceImageUrl || sourceQueue.imageUrl || sourceImage.imageUrl || '',
                generatedImageMediaId: sourceQueue.generatedImageMediaId || '',
                generatedImageMimeType: sourceQueue.generatedImageMimeType || '',
                imageMediaId: sourceQueue.imageMediaId || vacancy.imageMediaId || '',
                imageMimeType: sourceQueue.imageMimeType || vacancy.imageMimeType || '',
                imageSource: sourceQueue.imageSource || vacancy.imageSource || '',
              }
            : null;

          return {
            ...vacancy,
            sourceQueue: sourceQueuePayload,
            sourceImageMediaId: vacancy.sourceImageMediaId || sourceImage.mediaId || '',
            sourceImageMimeType: vacancy.sourceImageMimeType || sourceImage.mimeType || '',
            sourceImageUrl: vacancy.sourceImageUrl || vacancy.imageUrl || sourceImage.imageUrl || '',
            generatedImageMediaId: vacancy.generatedImageMediaId || sourceQueue?.generatedImageMediaId || '',
            generatedImageMimeType: vacancy.generatedImageMimeType || sourceQueue?.generatedImageMimeType || '',
            blastResult: sourceQueue?.blastResult || vacancy.autoBlast || {},
            candidateFacingText: sourceQueue?.candidateFacingText || vacancy.candidateFacingText || '',
            templateDraftBody: sourceQueue?.templateDraftBody || vacancy.templateDraftBody || '',
            submittedTemplateBody: sourceQueue?.submittedTemplateBody || vacancy.submittedTemplateBody || '',
            draftNeedsSubmission: typeof sourceQueue?.draftNeedsSubmission === 'boolean'
              ? sourceQueue.draftNeedsSubmission
              : Boolean(vacancy.draftNeedsSubmission),
            matchedCandidates: sourceQueue?.matchedCandidates || vacancy.matchedCandidates || 0,
            approvalState: sourceQueue?.status || vacancy.approvalState || '',
          };
        })
    );

    res.json({
      success: true,
      agencyInbox: sortedInbox,
      queue: sortedQueue,
      officialVacancies,
    });
  } catch (err) {
    console.error('[Agency] GET /demands error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agency/vacancy-priority
// Sets the display order in which the WhatsApp bot offers vacancies to candidates.
// Lower number = shown first. Empty/null = unprioritized (shown after prioritized ones).
router.patch('/vacancy-priority', async (req, res) => {
  try {
    const { vacancyId, priority } = req.body || {};

    if (!vacancyId) {
      return res.status(400).json({ error: 'vacancyId required' });
    }

    const existing = await rtdbGet(`vacancies/${vacancyId}`);
    if (!existing) {
      return res.status(404).json({ error: 'Vacancy not found' });
    }

    const normalizedPriority = priority === '' || priority === null || priority === undefined
      ? null
      : Number(priority);

    if (normalizedPriority !== null && !Number.isFinite(normalizedPriority)) {
      return res.status(400).json({ error: 'priority must be a number' });
    }

    await rtdbUpdate(`vacancies/${vacancyId}`, {
      priority: normalizedPriority,
      updatedAt: new Date().toISOString(),
    });

    res.json({ success: true, vacancyId, priority: normalizedPriority });
  } catch (err) {
    console.error('[Agency] Vacancy Priority Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/agency/template-draft
router.patch('/template-draft', async (req, res) => {
  try {
    const { queueId, vacancyId, candidateFacingText, templateDraftBody } = req.body || {};

    if (!queueId && !vacancyId) {
      return res.status(400).json({ error: 'queueId or vacancyId required' });
    }

    const result = await saveAgencyTemplateDraft({
      queueId,
      vacancyId,
      candidateFacingText,
      templateDraftBody,
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Agency] Draft Save Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agency/submit-template
router.post('/submit-template', async (req, res) => {
  try {
    const { queueId, vacancyId } = req.body || {};

    if (!queueId && !vacancyId) {
      return res.status(400).json({ error: 'queueId or vacancyId required' });
    }

    const submission = await submitAgencyTemplateDraft({ queueId, vacancyId });

    res.json({
      success: true,
      queueId: submission.queueId,
      vacancyId: submission.vacancyId,
      workflowStatus: submission.workflowStatus,
      draftNeedsSubmission: submission.draftNeedsSubmission,
      metaTemplate: submission.metaTemplate,
      candidateFacingText: submission.candidateFacingText,
      templateDraftBody: submission.templateDraftBody,
    });
  } catch (err) {
    console.error('[Agency] Submit Template Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/agency/approve
router.post('/approve', async (req, res) => {
  try {
    const { queueId } = req.body;

    const queueData = await rtdbGet(`agency_queue/${queueId}`);
    if (!queueData) return res.status(404).json({ error: 'Queue item not found' });

    const submission = await submitAgencyTemplateDraft({ queueId });

    res.json({
      success: true,
      vacancyId: submission.vacancyId,
      matchedCandidates: queueData.matchedCandidates || 0,
      metaTemplate: submission.metaTemplate,
      assignedTemplateName: queueData.assignedTemplateName || '',
      workflowStatus: submission.workflowStatus,
      draftNeedsSubmission: submission.draftNeedsSubmission,
    });
  } catch (err) {
    console.error('[Agency] Approve Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
