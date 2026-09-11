/**
 * Gulf Career Super Dashboard — Template Service
 * Now supports Dynamic Meta Template Fetching & Positional Parameters.
 */

const { fetchMetaTemplates } = require('./whatsappService');
const { rtdbGetAll, rtdbUpdate } = require('./firebaseService');

// In-memory cache for templates (10 minute TTL)
let templateCache = {
  data: [],
  lastFetch: 0
};

let templateMediaCache = {
  data: new Map(),
  lastFetch: 0,
};

let templateStatusSyncCache = {
  lastSync: 0,
};

const CACHE_TTL = 60 * 1000; // 1 minute

async function getHiddenTemplateNames() {
  try {
    const hiddenTemplates = await rtdbGetAll('admin_hidden_templates');
    return new Set(
      (hiddenTemplates || [])
        .map((item) => String(item.name || '').trim())
        .filter(Boolean)
    );
  } catch (err) {
    console.warn('[Template Service] Hidden template lookup failed:', err.message);
    return new Set();
  }
}

function normalizeTemplateText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function inferParameterLabels(text = '') {
  const matches = [...String(text || '').matchAll(/\{\{\d+\}\}/g)];
  if (matches.length === 0) return [];

  return matches.map((match, index) => {
    const start = Math.max(0, match.index - 28);
    const end = Math.min(text.length, match.index + match[0].length + 28);
    const context = normalizeTemplateText(text.slice(start, end));

    if (/(salary|package|offer|per month|lagbhag|tak)/i.test(context)) return 'Salary / Offer';
    if (/(contact|sampark|call|whatsapp|reply|phone)/i.test(context)) return 'Contact Number';
    if (/(country|location|desh|germany|saudi|uae|qatar|oman|kuwait|bahrain)/i.test(context)) return 'Country / Location';
    if (/(skill|position|role|vacancy|technician|helper|driver|labour|carpenter|electrician|plumber|welder|mason|job)/i.test(context)) return 'Skill / Role';
    if (/(experience|exp)/i.test(context)) return 'Experience';
    if (/(name)/i.test(context)) return 'Candidate Name';
    return `Value ${index + 1}`;
  });
}

function formatContactNumber(value = '') {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2)}`;
  }
  if (digits.length === 10) {
    return `+91 ${digits}`;
  }
  return `+${digits}`;
}

function getDefaultParameterValue(label = '', data = {}, index = 0) {
  const normalizedLabel = normalizeTemplateText(label);
  const adminContact = formatContactNumber(
    process.env.ADMIN_PHONE_2
    || process.env.ADMIN_PHONE_1
    || process.env.CONTACT_PHONE
    || process.env.WHATSAPP_CONTACT_NUMBER
    || ''
  );

  if (normalizedLabel.includes('salary') || normalizedLabel.includes('offer')) {
    return data.salary || data.candidatePrice || data.offer || 'Attractive salary';
  }

  if (normalizedLabel.includes('contact')) {
    return adminContact || '+91 8920624361';
  }

  if (normalizedLabel.includes('country') || normalizedLabel.includes('location')) {
    return data.country || 'Gulf';
  }

  if (normalizedLabel.includes('skill') || normalizedLabel.includes('role')) {
    return data.skill || data.title || 'Position';
  }

  if (normalizedLabel.includes('experience')) {
    return data.experience || 'Experienced';
  }

  if (normalizedLabel.includes('candidate name') || normalizedLabel.includes('name')) {
    return data.name || 'Candidate';
  }

  const genericFallbacks = [
    data.skill,
    data.salary,
    adminContact,
    data.country,
    data.name,
  ].filter(Boolean);

  return genericFallbacks[index] || `Value ${index + 1}`;
}

/**
 * Get templates, with simple caching logic.
 */
async function getCachedTemplates(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && templateCache.data.length > 0 && (now - templateCache.lastFetch < CACHE_TTL)) {
    return templateCache.data;
  }

  try {
    const [templates, hiddenTemplateNames] = await Promise.all([
      fetchMetaTemplates(),
      getHiddenTemplateNames(),
    ]);
    const visibleTemplates = templates.filter((template) => !hiddenTemplateNames.has(template.name));
    templateCache = {
      data: visibleTemplates,
      lastFetch: now
    };
    return visibleTemplates;
  } catch (err) {
    console.error('[Template Service] Error refreshing templates:', err.message);
    if (templateCache.data.length === 0) {
      throw err;
    }
    return templateCache.data; // Return stale cache on error
  }
}

function normalizeStatusValue(value = '') {
  return String(value || '').trim().toUpperCase();
}

function mapWorkflowStatus(metaTemplateStatus = '', draftNeedsSubmission = false) {
  if (draftNeedsSubmission) {
    return 'pending_approval';
  }

  switch (normalizeStatusValue(metaTemplateStatus)) {
    case 'APPROVED':
      return 'meta_approved';
    case 'PENDING':
      return 'submitted_for_approval';
    case 'REJECTED':
      return 'meta_rejected';
    case 'CREATE_FAILED':
    case 'SUBMIT_FAILED':
      return 'template_retry_required';
    default:
      return 'pending_approval';
  }
}

async function resolveTemplateHeaderMedia(templateName, data = {}) {
  const explicitGeneratedMediaId = String(data.generatedImageMediaId || '').trim();
  const explicitImageSource = String(data.imageSource || '').trim();
  const explicitMediaId = String(
    explicitGeneratedMediaId
    || data.templateMediaId
    || ((explicitImageSource === 'generated_vacancy_card') ? data.imageMediaId : '')
    || data.posterMediaId
    || data.headerMediaId
    || data.mediaId
    || ''
  ).trim();
  const explicitImageUrl = String(
    data.templateImageUrl
    || data.imageUrl
    || data.headerImageUrl
    || ''
  ).trim();

  if (explicitMediaId || explicitImageUrl) {
    return {
      mediaId: explicitMediaId,
      imageUrl: explicitImageUrl,
      source: 'explicit_payload',
    };
  }

  const now = Date.now();
  if (now - templateMediaCache.lastFetch > CACHE_TTL) {
    templateMediaCache = {
      data: new Map(),
      lastFetch: now,
    };
  }

  if (templateMediaCache.data.has(templateName)) {
    return templateMediaCache.data.get(templateName);
  }

  const [vacancies, agencyQueue] = await Promise.all([
    rtdbGetAll('vacancies'),
    rtdbGetAll('agency_queue'),
  ]);

  const matchingEntries = [
    ...(vacancies || []).map((item) => ({ ...item, sourceBucket: 'vacancies' })),
    ...(agencyQueue || []).map((item) => ({ ...item, sourceBucket: 'agency_queue' })),
  ]
    .filter((item) => String(item.metaTemplateName || '').trim() === String(templateName || '').trim())
    .filter((item) => {
      const generatedMediaId = String(item.generatedImageMediaId || '').trim();
      const generatedImageUrl = String(
        item.imageSource === 'generated_vacancy_card' ? (item.imageUrl || '') : ''
      ).trim();
      return Boolean(generatedMediaId || generatedImageUrl);
    })
    .sort((left, right) => {
      const leftTs = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightTs = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightTs - leftTs;
    });

  const resolved = matchingEntries[0]
    ? {
        mediaId: String(
          matchingEntries[0].generatedImageMediaId
          || (matchingEntries[0].imageSource === 'generated_vacancy_card' ? matchingEntries[0].imageMediaId : '')
          || ''
        ).trim(),
        imageUrl: String(
          matchingEntries[0].generatedImageMediaId
            ? ''
            : (
              matchingEntries[0].imageSource === 'generated_vacancy_card'
                ? (matchingEntries[0].imageUrl || '')
                : ''
            )
        ).trim(),
        source: matchingEntries[0].sourceBucket || 'firebase',
      }
    : {
        mediaId: '',
        imageUrl: '',
        source: '',
      };

  templateMediaCache.data.set(templateName, resolved);
  return resolved;
}

/**
 * Builds Meta-compliant components array dynamically.
 * Detects how many parameters the template needs and maps them.
 */
async function buildComponents(templateName, data = {}, templateVariables = []) {
  const templates = await getCachedTemplates();
  const metaTemplate = templates.find(t => t.name === templateName);
  
  if (!metaTemplate) {
    console.warn(`[Template Audit] Template '${templateName}' not found in Meta cache!`);
    return [];
  }

  const finalComponents = [];

  // Helper to map parameters for a specific component
  const getMappedParameters = (text) => {
    const matches = text.match(/\{\{\d+\}\}/g) || [];
    if (matches.length === 0) return [];
    const labels = inferParameterLabels(text);

    return matches.map((match, index) => {
      const manualValue = String(templateVariables[index] || '').trim();
      const value = manualValue || getDefaultParameterValue(labels[index], data, index);

      return {
        type: 'text',
        text: String(value).substring(0, 1024) // Meta limit
      };
    });
  };

  // 1. Process BODY
  const bodyComp = metaTemplate.components.find(c => c.type === 'BODY');
  if (bodyComp) {
    const parameters = getMappedParameters(bodyComp.text);
    if (parameters.length > 0) {
      finalComponents.push({ type: 'BODY', parameters });
    }
  }

  // 2. Process HEADER (if text-based and has params)
  const headerComp = metaTemplate.components.find(c => c.type === 'HEADER');
  if (headerComp && headerComp.format === 'TEXT' && headerComp.text) {
    const parameters = getMappedParameters(headerComp.text);
    if (parameters.length > 0) {
      finalComponents.push({ type: 'HEADER', parameters });
    }
  }

  if (headerComp && headerComp.format === 'IMAGE') {
    const mediaContext = await resolveTemplateHeaderMedia(templateName, data);
    if (!mediaContext.mediaId && !mediaContext.imageUrl) {
      throw new Error(`TEMPLATE_HEADER_MEDIA_MISSING:${templateName}`);
    }

    finalComponents.push({
      type: 'HEADER',
      parameters: [
        mediaContext.mediaId
          ? { type: 'image', image: { id: mediaContext.mediaId } }
          : { type: 'image', image: { link: mediaContext.imageUrl } },
      ],
    });
  }

  return finalComponents;
}

/**
 * Get the native language of a template.
 * Defaults to 'hi' if not found.
 */
async function getTemplateLanguage(templateName) {
  const templates = await getCachedTemplates();
  const metaTemplate = templates.find(t => t.name === templateName);
  return metaTemplate ? metaTemplate.language : 'en_US';
}

async function getAvailableTemplates(forceRefresh = false) {
  const templates = await getCachedTemplates(forceRefresh);
  return templates.map(t => ({
    id: t.id,
    metaId: t.metaId,
    name: t.name,
    language: t.language,
    status: t.status,
    category: t.category,
    headerFormat: t.components.find(c => c.type === 'HEADER')?.format || '',
    paramCount: t.paramCount,
    text: t.components.find(c => c.type === 'BODY')?.text || '',
    paramLabels: inferParameterLabels(t.components.find(c => c.type === 'BODY')?.text || ''),
    fullData: t // Optional: for more complex UI logic
  }));
}

async function syncStoredTemplateStatuses(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && now - templateStatusSyncCache.lastSync < CACHE_TTL) {
    return { synced: false, reason: 'cache_fresh', updatedQueue: 0, updatedVacancies: 0 };
  }

  const templates = await getCachedTemplates(forceRefresh);
  const templateMap = new Map(
    templates
      .filter((template) => String(template.name || '').trim())
      .map((template) => [String(template.name || '').trim(), template])
  );

  const [queueItems, vacancies] = await Promise.all([
    rtdbGetAll('agency_queue'),
    rtdbGetAll('vacancies'),
  ]);

  let updatedQueue = 0;
  let updatedVacancies = 0;

  const queueUpdates = (queueItems || []).flatMap((item) => {
    const templateName = String(item.metaTemplateName || '').trim();
    if (!templateName) return [];

    const liveTemplate = templateMap.get(templateName);
    if (!liveTemplate) return [];

    const liveStatus = normalizeStatusValue(liveTemplate.status);
    const storedStatus = normalizeStatusValue(item.metaTemplateStatus);
    const liveMetaId = String(liveTemplate.metaId || '').trim();
    const storedMetaId = String(item.metaTemplateId || '').trim();
    const nextDraftNeedsSubmission = ['APPROVED', 'PENDING', 'REJECTED'].includes(liveStatus)
      ? false
      : Boolean(item.draftNeedsSubmission);
    const nextWorkflowStatus = mapWorkflowStatus(liveStatus, nextDraftNeedsSubmission);
    const currentWorkflowStatus = String(item.status || '').trim();
    const nextTemplateError = liveStatus === 'REJECTED'
      ? (item.metaTemplateError || 'Meta template review rejected.')
      : ((liveStatus === 'APPROVED' || liveStatus === 'PENDING') ? '' : (item.metaTemplateError || ''));

    if (
      liveStatus === storedStatus
      && (!liveMetaId || liveMetaId === storedMetaId)
      && nextDraftNeedsSubmission === Boolean(item.draftNeedsSubmission)
      && nextWorkflowStatus === currentWorkflowStatus
      && nextTemplateError === String(item.metaTemplateError || '')
    ) {
      return [];
    }

    updatedQueue += 1;
    return [
      rtdbUpdate(`agency_queue/${item.id}`, {
        metaTemplateStatus: liveStatus || item.metaTemplateStatus || '',
        metaTemplateId: liveMetaId || item.metaTemplateId || '',
        metaTemplateError: nextTemplateError,
        draftNeedsSubmission: nextDraftNeedsSubmission,
        status: nextWorkflowStatus,
        updatedAt: new Date().toISOString(),
      }),
    ];
  });

  const vacancyUpdates = (vacancies || []).flatMap((item) => {
    const templateName = String(item.metaTemplateName || '').trim();
    if (!templateName) return [];

    const liveTemplate = templateMap.get(templateName);
    if (!liveTemplate) return [];

    const liveStatus = normalizeStatusValue(liveTemplate.status);
    const storedStatus = normalizeStatusValue(item.metaTemplateStatus);
    const liveMetaId = String(liveTemplate.metaId || '').trim();
    const storedMetaId = String(item.metaTemplateId || '').trim();
    const nextDraftNeedsSubmission = ['APPROVED', 'PENDING', 'REJECTED'].includes(liveStatus)
      ? false
      : Boolean(item.draftNeedsSubmission);
    const nextWorkflowStatus = mapWorkflowStatus(liveStatus, nextDraftNeedsSubmission);
    const currentWorkflowStatus = String(item.approvalState || '').trim();
    const nextTemplateError = liveStatus === 'REJECTED'
      ? (item.metaTemplateError || 'Meta template review rejected.')
      : ((liveStatus === 'APPROVED' || liveStatus === 'PENDING') ? '' : (item.metaTemplateError || ''));

    if (
      liveStatus === storedStatus
      && (!liveMetaId || liveMetaId === storedMetaId)
      && nextDraftNeedsSubmission === Boolean(item.draftNeedsSubmission)
      && nextWorkflowStatus === currentWorkflowStatus
      && nextTemplateError === String(item.metaTemplateError || '')
    ) {
      return [];
    }

    updatedVacancies += 1;
    return [
      rtdbUpdate(`vacancies/${item.id}`, {
        metaTemplateStatus: liveStatus || item.metaTemplateStatus || '',
        metaTemplateId: liveMetaId || item.metaTemplateId || '',
        metaTemplateError: nextTemplateError,
        draftNeedsSubmission: nextDraftNeedsSubmission,
        approvalState: nextWorkflowStatus,
        updatedAt: new Date().toISOString(),
      }),
    ];
  });

  await Promise.all([...queueUpdates, ...vacancyUpdates]);
  templateStatusSyncCache.lastSync = now;

  return {
    synced: true,
    updatedQueue,
    updatedVacancies,
    templateCount: templateMap.size,
  };
}

module.exports = {
  buildComponents,
  getAvailableTemplates,
  getCachedTemplates,
  getHiddenTemplateNames,
  getTemplateLanguage,
  syncStoredTemplateStatuses,
};
