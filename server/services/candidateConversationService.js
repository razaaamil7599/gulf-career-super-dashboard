const {
  rtdbGet,
  rtdbGetAll,
  rtdbPush,
  rtdbSet,
  rtdbUpdate,
  safeFirebaseKey,
} = require('./firebaseService');
const { sendMessage, sendImageMessage, sendDocumentMessage, sendAudioMessage } = require('./whatsappService');
const { sendMessengerMessage, sendInstagramMessage } = require('./metaChannelService');

async function sendChannelMessage(channel, to, body, senderContext) {
  if (channel === 'messenger') return sendMessengerMessage(to, body);
  if (channel === 'instagram') return sendInstagramMessage(to, body);
  return sendMessage(to, body, senderContext);
}

// A candidate's document/photo previously only got an in-chat "we received
// it, team will review" acknowledgement — nobody actually reviewed it,
// because the file never left Firebase; admin only saw it if they happened
// to open that exact candidate's chat in the dashboard. Forward it to the
// admin's own WhatsApp immediately so a real human sees it without having to
// go looking. WhatsApp-only for now (Messenger/Instagram media sending isn't
// built yet — see metaChannelService.js).
async function forwardCandidateMediaToAdmin({ phone, candidateName, type, mediaId, mimeType, fileName, caption, channel }) {
  if (channel && channel !== 'whatsapp') return;
  if (!mediaId) return;

  const admins = getAdminPhones();
  if (!admins.length) return;

  const label = `${candidateName || 'Candidate'} (${phone}) ne ${type || 'media'} bheja hai:`;

  for (const adminPhone of admins) {
    try {
      await sendMessage(adminPhone, label);
      if (type === 'image') {
        await sendImageMessage(adminPhone, { mediaId, caption: caption || '' });
      } else if (type === 'video') {
        await sendDocumentMessage(adminPhone, { mediaId, filename: fileName || 'video.mp4' });
      } else if (type === 'audio') {
        await sendAudioMessage(adminPhone, mediaId);
      } else {
        await sendDocumentMessage(adminPhone, { mediaId, filename: fileName || 'document' });
      }
    } catch (err) {
      console.error(`[Media Forward] Failed to forward ${type} from ${phone} to admin ${adminPhone}:`, err.message);
    }
  }
}
const { callGeminiJson, GEMINI_MODEL } = require('./aiAgentService');
const {
  callOpenClawPlannerJson,
  getOpenClawPlannerLabel,
  hasOpenClawPlannerPrereqs,
  shouldUseOpenClawPlanner,
} = require('./openclawService');
const {
  getConversationControl,
  getAdminAiProfile,
  getAdminAiProfileForNumber,
  queueAdminApprovalRequest,
  shouldEscalateToAdminApproval,
  getAdminPhones,
  notifyAdmins,
} = require('./adminControlService');
const { appendChatLog, getChatHistoryByPhone, appendAgentOutputLog } = require('./googleSheetsService');
const { ingestAgencyVacancy, shouldAutoProcessAgencyLead } = require('./agencyVacancyAutomationService');
const { publishDashboardMessageEvent } = require('./dashboardRealtimeService');
const {
  normalizeSkill: normalizeCandidateSkill,
  normalizeCountry: normalizeCandidateCountry,
  sanitizeCandidateName,
  hasUsableCandidateName,
  sanitizeCandidateProfile,
  getFallbackCandidateName,
  pickBestName,
} = require('./candidateProfileService');

const KNOWN_SKILLS = [
  'Carpenter', 'Plumber', 'Electrician', 'AC Technician', 'Mason',
  'Welder', 'Painter', 'Driver', 'Security Guard', 'Cook',
  'Cleaner', 'Fabricator', 'Mechanic', 'Helper', 'Tiler',
  'HVAC Technician', 'General'
];

const KNOWN_COUNTRIES = ['Saudi', 'UAE', 'Qatar', 'Kuwait', 'Oman', 'Bahrain', 'Dubai', 'Abu Dhabi', 'Germany', 'Poland'];
const GCC_DESK_PHONE = '+91 8920624361';
const GCC_DESK_EMAIL = 'gulfcareergateway@gmail.com';
const GCC_OFFICE_ADDRESS = 'RZ-244, 4th Floor, Behind Croma, Pillar No. 658, Uttam Nagar East, New Delhi';
const ARS_DESK_PHONE = '+91 87003 73356';
const ARS_WHATSAPP_PHONE = '+91 75995 10170';
const ARS_DESK_EMAIL = 'info.arstudio11@gmail.com';
const ARS_OFFICE_ADDRESS = 'RZ-244, 4th Floor, Behind Croma, Pillar No. 658, Uttam Nagar East, New Delhi';

function isArsBotProfile(adminProfile = {}, candidate = {}) {
  return String(adminProfile?.botType || candidate?.botType || '').trim().toUpperCase() === 'ARS';
}
const conversationLocks = new Map();

function resolveAssistantBrand(adminProfile = {}) {
  return String(adminProfile?.assistantName || '').trim() || 'Gulf Career Gateway';
}

function buildAdminInstructionSummary(adminProfile = {}) {
  const instructions = Array.isArray(adminProfile?.instructions)
    ? adminProfile.instructions.map(item => String(item || '').trim()).filter(Boolean).slice(0, 30)
    : [];

  return {
    assistantName: resolveAssistantBrand(adminProfile),
    ownerName: String(adminProfile?.ownerName || 'A R Khan').trim() || 'A R Khan',
    languageMode: String(adminProfile?.languageMode || 'hinglish').trim().toLowerCase() || 'hinglish',
    tone: String(adminProfile?.tone || '').trim(),
    instructions,
    lastInstruction: String(adminProfile?.lastInstruction || '').trim(),
  };
}

function normalizePhone(phone = '') {
  return String(phone).replace(/\D/g, '');
}

async function withPhoneConversationLock(phone, task) {
  const key = normalizePhone(phone);
  if (!key) return task();

  const previous = conversationLocks.get(key) || Promise.resolve();
  let releaseBarrier;
  const barrier = new Promise(resolve => {
    releaseBarrier = resolve;
  });
  const next = previous.catch(() => {}).then(() => barrier);
  conversationLocks.set(key, next);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    releaseBarrier();
    if (conversationLocks.get(key) === next) {
      conversationLocks.delete(key);
    }
  }
}

function hasArabicScript(text = '') {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(text || ''));
}

function hasDevanagariScript(text = '') {
  return /[\u0900-\u097F]/.test(String(text || ''));
}

function hasLatinScript(text = '') {
  return /[A-Za-z]/.test(String(text || ''));
}

function isLowSignalLatinMessage(text = '') {
  return /^(ok|okay|yes|hi|hii|hello|helo|hey|hy|hm|hmm|k|kk|g|ji|jee|han|haan|done|good)$/i.test(String(text || '').trim());
}

function looksLikeRomanUrduOrHinglish(text = '') {
  return /\b(aap|ap|kya|kaam|kis|desh|country|salary|vacancy|job|apply|assalam|walaikum|bhai|ji|passport|document|cv|ready|kab|kitna|kitni|haan|han|nahi|nahi)\b/i.test(String(text || ''));
}

function looksLikeEnglish(text = '') {
  return /\b(hello|hi|please|thanks|thank you|job|work|experience|location|documents|available|share|interested|apply|country|salary|details)\b/i.test(String(text || ''));
}

function detectReplyLanguage({ latestMessage = '', messages = [], candidate = {} } = {}) {
  const lowerLatest = String(latestMessage || '').trim().toLowerCase();
  if (/\benglish\b/i.test(lowerLatest) && !/\b(no|not|don't|dont)\s+english\b/i.test(lowerLatest)) {
    return { code: 'en', label: 'English' };
  }
  if (/\bhindi\b/i.test(lowerLatest) && !/\b(no|not|don't|dont)\s+hindi\b/i.test(lowerLatest)) {
    return { code: 'hi', label: 'Hindi Devanagari' };
  }
  if (/\b(hinglish|roman)\b/i.test(lowerLatest)) {
    return { code: 'roman', label: 'Roman Urdu/Hinglish' };
  }

  const samples = [
    latestMessage,
    ...messages
      .filter((message) => message.direction === 'inbound')
      .map((message) => String(message.body || ''))
      .reverse()
      .slice(0, 5),
  ].filter(Boolean);

  for (const sample of samples) {
    if (hasArabicScript(sample)) {
      return { code: 'ar', label: 'Arabic script' };
    }
    if (hasDevanagariScript(sample)) {
      return { code: 'hi', label: 'Hindi Devanagari' };
    }
    if (hasLatinScript(sample)) {
      const hasRecentNonLatinHistory = samples.some(item => item !== sample && (hasArabicScript(item) || hasDevanagariScript(item)));
      if (isLowSignalLatinMessage(sample) && hasRecentNonLatinHistory) {
        continue;
      }
      if (looksLikeEnglish(sample) && !looksLikeRomanUrduOrHinglish(sample)) {
        return { code: 'en', label: 'English' };
      }
      return { code: 'roman', label: 'Roman Urdu/Hinglish' };
    }
  }

  const storedCode = String(candidate.replyLanguage || '').trim().toLowerCase();
  if (['ar', 'hi', 'en', 'roman'].includes(storedCode)) {
    return { code: storedCode, label: storedCode };
  }

  return { code: 'roman', label: 'Roman Urdu/Hinglish' };
}

function replyMatchesLanguage(text = '', replyLanguage = { code: 'roman' }) {
  const body = String(text || '').trim();
  if (!body) return false;

  if (replyLanguage.code === 'ar') return hasArabicScript(body);
  if (replyLanguage.code === 'hi') return hasDevanagariScript(body) || hasLatinScript(body);
  if (replyLanguage.code === 'en') return hasLatinScript(body) && looksLikeEnglish(body) && !looksLikeRomanUrduOrHinglish(body);
  return hasLatinScript(body);
}

function pickLocalizedCopy(replyLanguage = { code: 'roman' }, variants = {}) {
  const code = String(replyLanguage?.code || 'roman').toLowerCase();
  return variants[code] || variants.roman || variants.en || variants.hi || variants.ar || '';
}

// Guards against the AI echoing its own JSON-schema placeholder text (e.g. literal
// "string") as a real field value instead of leaving the field empty/unknown.
const PLACEHOLDER_VALUE_PATTERN = /^(string|unknown|n\/?a|null|undefined|none|-|fresh\|return\|unknown|male\|female\|unknown)$/i;
function isUsableFreeTextValue(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return false;
  return !PLACEHOLDER_VALUE_PATTERN.test(trimmed);
}

function getMissingCandidateFields(candidate = {}) {
  const missing = [];

  if (!hasUsableCandidateName(candidate.name)) missing.push('name');
  if (!isUsableFreeTextValue(candidate.city)) missing.push('city');
  if (!candidate.skill || candidate.skill === 'General' || candidate.skill === 'Uncategorized') missing.push('skill');
  if (!isUsableFreeTextValue(candidate.workStatus)) missing.push('workStatus');
  if (!candidate.preferredCountry || candidate.preferredCountry === 'Unspecified') missing.push('preferredCountry');
  if (!candidate.budget) missing.push('budget');
  if ((candidate.budget || '').trim() && !candidate.budgetPeriod) missing.push('budgetPeriod');
  if (candidate.experience === null || candidate.experience === undefined || candidate.experience === '' || Number.isNaN(Number(candidate.experience)) || Number(candidate.experience) < 0) missing.push('experience');
  if (!candidate.documentsReady) missing.push('documentsReady');
  if (!candidate.availability) missing.push('availability');

  return missing;
}

function toTitleCase(value = '') {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function parseExperience(value) {
  if (value === null || value === undefined || value === '') return null;
  const match = String(value).match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function inferSkillFromText(text = '') {
  return normalizeCandidateSkill(text, text) || null;
}

function inferCountryFromText(text = '') {
  return normalizeCandidateCountry(text, text) || null;
}

function inferBudgetFromText(text = '') {
  const match = String(text).match(/(?:expected\s+salary|salary|salary expectation|budget|mahina|monthly|month|sr|aed|riyal)[^\d]{0,12}(\d[\d,\.]*)/i);
  if (match) return match[1].replace(/,/g, '');
  const rangeMatch = String(text).match(/(\d[\d,\.]*\s*(?:k|K)?\s*[-–]\s*\d[\d,\.]*\s*(?:k|K)?)/);
  return rangeMatch ? rangeMatch[1].replace(/\s+/g, '') : null;
}

function inferBudgetPeriod(text = '') {
  const lower = String(text).toLowerCase();
  if (/(monthly|per month|mahina|mahine|mahana)/i.test(lower)) return 'monthly';
  if (/(annual|annually|yearly|per year|saalana|salana|saal)/i.test(lower)) return 'annual';
  return null;
}

function normalizeText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s/+-]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeText(value = '') {
  return normalizeText(value)
    .split(' ')
    .filter(token => token && token.length > 1);
}

function roleLooksGeneric(role = '') {
  const normalized = normalizeText(role);
  return !normalized || /^(general|candidate|job|jobs|kaam|work|vacancy|opening|gulf)$/i.test(normalized);
}

function messageLooksLikeVacancyQuestion(text = '') {
  return /(vacancy|opening|job|jobs|kaam|role|duty|salary|package|kitna|kitni|kahan|where|available|apply|field|haj|hajj|khidmat|driver|helper|load|unload|وظيف|وظیف|راتب|عمل|شغل|نوکری|جاب|تنخواہ|ملازمت|काम|नौकरी|salary|opening)/iu.test(String(text || ''));
}

function messageLooksLikeComparisonRequest(text = '') {
  return /(compare|comparison|other|another|aur kya|aur kaun|kaun kaun si|kaun si aur|options|option)/iu.test(String(text || ''));
}

function messageLooksLikeOfficeQuestion(text = '') {
  return /(office|address|location|office kaha|office kahan|aapka office|apka office|address bhejo|location bhejo|map bhejo|where is your office)/iu.test(String(text || ''));
}

function messageLooksLikeOfficeAddressReference(text = '') {
  return /(rz[-\s]?244|pillar\s*no\.?\s*658|croma|uttam\s*nagar|new\s*delhi)/iu.test(String(text || ''));
}

function messageLooksLikeVisitingCardRequest(text = '') {
  return /(visiting card|business card|card bhejo|contact card|office card)/iu.test(String(text || ''));
}

function messageLooksLikeCallRequest(text = '') {
  return /(call me|call karo|call kar|baat kar|bat kar|baat karao|phone karo|bhaiya se baat|bhaiya bat|call kio nahi|call kyun nahi|number pe baat|abhi call)/iu.test(String(text || ''));
}

function messageLooksLikeServiceChargeQuestion(text = '') {
  return /(service charge|sc\b|charge kitna|kitne paise|kitna lagega|office charge|fees?|process charge|kharcha)/iu.test(String(text || ''));
}

function messageLooksLikeTimelineQuestion(text = '') {
  return /(kab bulaoge|kab bhejoge|kab aaye|kab tak|kitna time lagega|process timing|joining kab|selection kab)/iu.test(String(text || ''));
}

function extractRequestedRole(text = '', messages = []) {
  const lower = normalizeText(text);
  if (!lower) return '';

  const explicitPatterns = [
    { label: 'Hajj Khidmat Labour', pattern: /haj+i?\s*khidmat/ },
    { label: 'Load/Unload', pattern: /load\s*\/?\s*unload/ },
    { label: 'Indoor Labour', pattern: /indoor\s+labou?r/ },
    { label: 'Courier Delivery Driver', pattern: /courier|delivery\s+driver/ },
    { label: 'Shuttering Carpenter', pattern: /shuttering\s+carpenter/ },
    { label: 'Construction Helper', pattern: /construction\s+helper/ },
    { label: 'Steel Fixer', pattern: /steel\s+fixer/ },
  ];

  const explicit = explicitPatterns.find(item => item.pattern.test(lower));
  if (explicit) return explicit.label;

  const knownSkill = inferSkillFromText(lower);
  if (knownSkill && !roleLooksGeneric(knownSkill)) return knownSkill;

  const messagesToSearch = [...messages].reverse();
  for (const message of messagesToSearch) {
    const body = String(message.body || '');
    const match = body.match(/([A-Za-z][A-Za-z\s\/+-]{2,40})\s+ki vacancy/i);
    if (match && !roleLooksGeneric(match[1])) {
      return toTitleCase(match[1].trim());
    }
  }

  return '';
}

function getRecentVacancyCue(messages = []) {
  const recent = [...messages]
    .filter(message => String(message.direction || '').toLowerCase() === 'inbound')
    .slice(-8)
    .reverse();
  for (const message of recent) {
    const body = String(message.body || '');
    if (!messageLooksLikeVacancyQuestion(body)) continue;

    const role = extractRequestedRole(body, []);
    const country = inferCountryFromText(body) || '';
    const salary = inferBudgetFromText(body) || '';

    if (role || country || salary) {
      return { role, country, salary, body };
    }
  }
  return { role: '', country: '', salary: '', body: '' };
}

function normalizeChargeValue(value = '') {
  const match = String(value || '').match(/(\d[\d,\.]*)/);
  return match ? `${match[1].replace(/,/g, '')}/-` : '';
}

function extractChargeDetails(vacancy = {}) {
  // Freeform text (e.g. an OCR-scanned poster) can carry a Fresh/Return split — check that first
  // since it's more specific than a single structured number.
  const freeformSource = String([
    vacancy.candidateFacingText || '',
    vacancy.originalForm || '',
  ].filter(Boolean).join('\n'));

  if (freeformSource) {
    const returnMatch = freeformSource.match(/return[^\n\r]{0,120}?(?:sc|service\s*charge)\s*[:\-]?\s*(\d[\d,\.]*)/i);
    const freshMatch = freeformSource.match(/fresh[^\n\r]{0,120}?(?:sc|service\s*charge)\s*[:\-]?\s*(\d[\d,\.]*)/i);
    if (returnMatch || freshMatch) {
      const parts = [];
      if (returnMatch) parts.push(`Return ke liye ${normalizeChargeValue(returnMatch[1])}`);
      if (freshMatch) parts.push(`Fresh ke liye ${normalizeChargeValue(freshMatch[1])}`);
      return parts.join(' aur ');
    }

    const genericMatches = [...freeformSource.matchAll(/(?:^|[\s,;])(?:sc|service\s*charge)\s*[:\-]?\s*(\d[\d,\.]*)/gi)]
      .map(match => normalizeChargeValue(match[1]))
      .filter(Boolean);
    if (genericMatches.length === 1) return genericMatches[0];
    if (genericMatches.length > 1) return genericMatches.join(', ');
  }

  // Structured field from the dashboard/app edit form — e.g. "145000". This was previously being
  // fed into the same "SC:"-label regex above, which never matched a bare number, so a vacancy with
  // an explicit Service Charge set here was always answered with "will be confirmed later" instead.
  return normalizeChargeValue(vacancy.serviceCharge || '');
}

function extractTimelineDetails(vacancy = {}) {
  const source = String([
    vacancy.candidateFacingText || '',
    vacancy.originalForm || '',
  ].filter(Boolean).join('\n'));

  if (!source) return '';

  const directMatch = source.match(/(within\s+one\s+month|one\s+month|15\s+days|10\s+days|7\s+days|30\s+days|2\s+months|zoom interview)/i);
  return directMatch ? directMatch[1] : '';
}

function extractDutyDetails(vacancy = {}) {
  const source = String([
    vacancy.candidateFacingText || '',
    vacancy.originalForm || '',
  ].filter(Boolean).join('\n'));

  if (!source) return '';

  const dutyMatch = source.match(/duty\s*[:\-]?\s*([^\n\r]+)/i);
  return dutyMatch ? String(dutyMatch[1] || '').trim() : '';
}

function extractOfferDetails(vacancy = {}, latestMessage = '') {
  const source = String([
    vacancy.candidateFacingText || '',
    vacancy.originalForm || '',
  ].filter(Boolean).join('\n'));

  if (!source) return vacancy.salary || vacancy.candidatePrice || '';

  const wantsFresh = /\bfresh\b/i.test(latestMessage);
  const wantsReturn = /\breturn\b/i.test(latestMessage);
  const freshMatch = source.match(/fresh[^\n\r]{0,120}?salary\s*[:\-]?\s*([^\n\r]+)/i);
  const returnMatch = source.match(/return[^\n\r]{0,120}?salary\s*[:\-]?\s*([^\n\r]+)/i);

  if (wantsFresh && freshMatch) return `Fresh House Driver ke liye ${String(freshMatch[1] || '').trim()}`;
  if (wantsReturn && returnMatch) return `Return House Driver ke liye ${String(returnMatch[1] || '').trim()}`;

  if (freshMatch || returnMatch) {
    const parts = [];
    if (returnMatch) parts.push(`Return House Driver - ${String(returnMatch[1] || '').trim()}`);
    if (freshMatch) parts.push(`Fresh House Driver - ${String(freshMatch[1] || '').trim()}`);
    return parts.join('; ');
  }

  return vacancy.salary || vacancy.candidatePrice || '';
}

function isLowSignalMessage(text = '') {
  const normalized = String(text || '').trim().toLowerCase().replace(/[.!?،۔]+$/g, '');
  if (!normalized) return true;
  return /^(ok|okay|oky|yes|han|haan|hmm|hm|ji|jee|acha|theek|thik|done|k|kk|g|good|سلام|جی|جي|نعم|تمام|اوکی|اوك|شكرا|شکرا|ठीक|हाँ|जी)$/iu.test(normalized);
}

function isGreetingMessage(text = '') {
  const normalized = String(text || '').trim().toLowerCase().replace(/[.!?،۔]+$/g, '');
  if (!normalized) return false;
  return /^(hi|hii|hello|helo|hey|hy|salam|assalam|assalamualaikum|assalam-o-alaikum|asalamualaikum|ok|okay|ji|g|hlo|السلام عليكم|السلام علیکم|اسلام علیکم|سلام|مرحبا|أهلا|اهلا)$/iu.test(normalized);
}

function stripQuestionPunctuation(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[?!.,:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function questionLooksRepeated(a = '', b = '') {
  const left = stripQuestionPunctuation(a);
  const right = stripQuestionPunctuation(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function getPendingQuestion(candidate = {}, replyLanguage = { code: 'roman' }) {
  const [nextMissing] = getMissingCandidateFields(candidate);

  if (!nextMissing) {
    // Profile is already complete — don't tack on a redundant generic question.
    return '';
  }

  if (nextMissing === 'name') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کا پورا نام کیا ہے؟',
      hi: 'आपका पूरा naam kya hai?',
      en: 'What is your full name?',
      roman: 'Aapka poora naam kya hai?',
    });
  }

  if (nextMissing === 'city') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کس شہر میں رہتے ہیں؟',
      hi: 'आप किस city/शहर में रहते हैं?',
      en: 'Which city are you from?',
      roman: 'Aap kis city se hain?',
    });
  }
  if (nextMissing === 'skill') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کس کام کے لیے اپلائی کرنا چاہتے ہیں؟',
      hi: 'आप किस काम के लिए apply करना चाहते हैं?',
      en: 'Which job role would you like to apply for?',
      roman: 'Aap kis kaam ke liye apply karna chahte hain?',
    });
  }
  if (nextMissing === 'workStatus') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ پہلی بار جا رہے ہیں یا واپس جا رہے ہیں (fresh/return)؟',
      hi: 'आप fresh (पहली बार) जा रहे हैं ya return (पहले जा चुके हैं)?',
      en: 'Is this your first time going abroad, or are you a returning worker?',
      roman: 'Aap fresh (pehli baar) ja rahe hain ya return (pehle ja chuke hain)?',
    });
  }
  if (nextMissing === 'preferredCountry') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کس ملک میں جانا چاہتے ہیں؟',
      hi: 'आप किस country में जाना चाहते हैं?',
      en: 'Which country do you want to work in?',
      roman: 'Aap kis country jaana chahte hain?',
    });
  }
  if (nextMissing === 'budget') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کی expected salary کیا ہے؟',
      hi: 'आपकी expected salary क्या है?',
      en: 'What is your expected salary?',
      roman: 'Aapki expected salary kya hai?',
    });
  }
  if (nextMissing === 'budgetPeriod') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'یہ ماہانہ ہے یا سالانہ؟',
      hi: 'यह monthly hai ya annual?',
      en: 'Is that monthly or annual?',
      roman: 'Yeh monthly hai ya annual?',
    });
  }
  if (nextMissing === 'experience') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کے پاس اس کام کا کتنا تجربہ ہے؟',
      hi: 'आपके paas is काम का कितना experience hai?',
      en: 'How much experience do you have in this work?',
      roman: 'Aapke paas is kaam ka kitna experience hai?',
    });
  }
  if (nextMissing === 'documentsReady') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'پاسپورٹ، فوٹو اور دیگر دستاویزات تیار ہیں؟',
      hi: 'Passport, photo aur documents ready hain kya?',
      en: 'Are your passport, photo, and documents ready?',
      roman: 'Passport, photo aur documents ready hain kya?',
    });
  }
  if (nextMissing === 'availability') {
    return pickLocalizedCopy(replyLanguage, {
      ar: 'آپ کتنے وقت میں روانہ ہونے کے لیے تیار ہو سکتے ہیں؟',
      hi: 'आप कितने time में ready हो सकते हैं?',
      en: 'How soon can you be ready to travel?',
      roman: 'Aap kitne time mein ready ho sakte hain?',
    });
  }

  return pickLocalizedCopy(replyLanguage, {
    ar: 'آپ کی current location اور notice period کیا ہے؟',
    hi: 'आपकी current location aur notice period kya hai?',
    en: 'What is your current location and notice period?',
    roman: 'Aapka current location aur notice period kya hai?',
  });
}

function sanitizeReply(text = '') {
  return String(text || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function getDisplayName(candidate = {}, contactName = '') {
  const preferred = sanitizeCandidateName(candidate.name || '') || sanitizeCandidateName(contactName || '') || '';
  if (!preferred) return 'bhai';
  if (/^\d+$/.test(String(preferred).trim())) return 'bhai';
  return preferred;
}

function buildCandidateGreetingResponse({ candidate, contactName, replyLanguage, adminProfile = {} }) {
  const displayName = getDisplayName(candidate, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const nextQuestion = getPendingQuestion(candidate, replyLanguage);
  const assistantBrand = resolveAssistantBrand(adminProfile);

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `وعلیکم السلام۔ گلف کیریئر گیٹ وے میں خوش آمدید۔ ${nextQuestion}`,
      hi: `नमस्ते। Gulf Career Gateway में आपका स्वागत है। ${nextQuestion}`,
      en: `Hello and welcome to ${assistantBrand}. ${nextQuestion}`,
      roman: `Assalam-o-Alaikum. ${romanName}${assistantBrand} mein aapka swagat hai. ${nextQuestion}`,
    })),
    profile: {
      status: 'pending_re-profiling',
      stage: candidate.stage || 'profiling',
      summary: pickLocalizedCopy(replyLanguage, {
        ar: 'امیدوار نے سلام کیا اور ابتدائی پروفائلنگ سوال بھیجا گیا۔',
        hi: 'Candidate ne greeting bheji aur initial profiling question poocha gaya.',
        en: 'Candidate greeted and was asked the first profiling question.',
        roman: 'Candidate ne greeting bheji aur initial profiling question poocha gaya.',
      }),
      lastQuestionAsked: nextQuestion,
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function buildArsGreetingResponse({ candidate, contactName, replyLanguage, adminProfile = {} }) {
  const displayName = getDisplayName(candidate, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const assistantBrand = resolveAssistantBrand(adminProfile) || 'AR Studios';
  const nextQuestion = pickLocalizedCopy(replyLanguage, {
    ar: 'برائے مہربانی اپنا نام، شہر اور کس creative field میں دلچسپی ہے (اداکاری، رائٹنگ، ڈائریکشن، VFX، میوزک) بتائیں۔',
    hi: 'कृपया अपना नाम, शहर, और आपकी दिलचस्पी किस creative field में है (acting, writing, direction, VFX, music) बताएं।',
    en: 'Please share your name, city, and which creative field interests you (acting, writing, direction, VFX, music).',
    roman: 'Please apna naam, city, aur kis creative field mein interest hai (acting, writing, direction, VFX, music) bata dijiye.',
  });

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `وعلیکم السلام۔ ${assistantBrand} میں خوش آمدید۔ ${nextQuestion}`,
      hi: `नमस्ते। ${assistantBrand} में आपका स्वागत है। ${nextQuestion}`,
      en: `Hello and welcome to ${assistantBrand}. ${nextQuestion}`,
      roman: `Assalam-o-Alaikum. ${romanName}${assistantBrand} mein aapka swagat hai. ${nextQuestion}`,
    })),
    profile: {
      status: 'pending_re-profiling',
      stage: candidate.stage || 'profiling',
      summary: 'Candidate greeted on the AR Studios casting flow and asked for name/city/creative field.',
      lastQuestionAsked: nextQuestion,
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function buildArsFallbackResponse({ candidate, contactName, replyLanguage, adminProfile = {} }) {
  const assistantBrand = resolveAssistantBrand(adminProfile) || 'AR Studios';
  const displayName = getDisplayName(candidate, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `${romanName}آپ کی درخواست ${assistantBrand} کاسٹنگ ٹیم تک پہنچا دی گئی ہے۔ درخواست بالکل مفت ہے، ہماری ٹیم جلد آپ سے WhatsApp پر رابطہ کرے گی۔`,
      hi: `${romanName}आपकी details ${assistantBrand} की casting team तक पहुंचा दी गई हैं। Application बिल्कुल free है, हमारी team जल्द ही WhatsApp पर contact करेगी।`,
      en: `${romanName}your details have been shared with the ${assistantBrand} casting team. The application is completely free — our team will contact you on WhatsApp shortly.`,
      roman: `${romanName}aapki details ${assistantBrand} ki casting team tak pahuncha di gayi hain. Application bilkul free hai, hamari team jald hi WhatsApp par contact karegi.`,
    })),
    profile: {
      status: 'pending_update',
      stage: candidate.stage || 'profiling',
      summary: candidate.conversationSummary || 'Candidate interacted with the AR Studios casting bot.',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

async function findCandidateByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const candidates = await rtdbGetAll('candidates');
  return candidates.find(candidate => {
    const candidatePhone = normalizePhone(candidate.phone);
    if (!candidatePhone) return false;
    return candidatePhone === normalized
      || candidatePhone.endsWith(normalized)
      || normalized.endsWith(candidatePhone);
  }) || null;
}

function sortMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const aTs = new Date(a.timestamp || a.createdAt || 0).getTime() || Number(a.timestamp || 0);
    const bTs = new Date(b.timestamp || b.createdAt || 0).getTime() || Number(b.timestamp || 0);
    return aTs - bTs;
  });
}

async function getConversationContext(phone) {
  const messageMap = await rtdbGet(`messages/${phone}`) || {};
  const firebaseMessages = sortMessages(Object.values(messageMap)).map(message => ({
    direction: message.direction || 'unknown',
    body: message.body || '',
    timestamp: message.timestamp || '',
    type: message.type || 'text',
    source: 'firebase',
  }));
  const sheetMessages = await getChatHistoryByPhone(phone, 18);

  const merged = sortMessages([...sheetMessages, ...firebaseMessages]).filter(message => message.body);
  const deduped = [];
  const seen = new Set();
  for (const message of merged) {
    const key = `${message.direction}|${message.body}|${message.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }

  return deduped.slice(-30);
}

async function getRelevantVacancies(candidate = {}, latestMessage = '', messages = [], recipientPhone = '') {
  // Strictly prevent AR Studios candidates or conversations on ARS numbers from matching GCG recruitment vacancies
  const pnId = String(candidate.phone_number_id || candidate.lastRecipientPhoneId || '');
  const botName = String(candidate.bot_name || '').toLowerCase();
  const isArs = pnId === '1231432513384580' || pnId === '782096074998071' || botName.includes('ar studios') || String(recipientPhone).includes('7599510170') || String(recipientPhone).includes('8077345658');
  if (isArs) {
    return [];
  }

  const vacancies = await rtdbGetAll('vacancies');
  const active = vacancies
    .filter(vacancy => (vacancy.status || 'active') === 'active')
    .filter(vacancy => {
      if (!vacancy.assignedPhone) return true;
      if (!recipientPhone) return true;
      return String(vacancy.assignedPhone).replace(/\D/g, '') === String(recipientPhone).replace(/\D/g, '');
    })
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

  const recentCue = getRecentVacancyCue(messages);
  const candidateSkill = String(candidate.skill || candidate.preferredSkill || '').trim();
  const candidateCountry = String(candidate.preferredCountry || candidate.country || '').trim();
  const requestedRole = extractRequestedRole(latestMessage, messages) || recentCue.role || candidateSkill;
  const requestedCountry = inferCountryFromText(latestMessage) || recentCue.country || candidateCountry;
  const roleTokens = tokenizeText(requestedRole);
  const countryToken = normalizeText(requestedCountry);

  const scored = active.map(vacancy => {
    const searchable = normalizeText([
      vacancy.title,
      vacancy.skill,
      vacancy.country,
      vacancy.companyName,
      vacancy.originalForm,
      vacancy.rawText,
      vacancy.body,
      vacancy.candidateFacingText,
    ].filter(Boolean).join(' '));

    let score = 0;

    for (const token of roleTokens) {
      if (searchable.includes(token)) score += 4;
    }

    if (countryToken && searchable.includes(countryToken)) {
      score += 3;
    }

    const fallbackSkill = normalizeText(candidateSkill);
    const fallbackCountry = normalizeText(candidateCountry);
    if (!roleTokens.length && fallbackSkill && searchable.includes(fallbackSkill)) {
      score += 2;
    }
    if (!countryToken && fallbackCountry && searchable.includes(fallbackCountry)) {
      score += 1;
    }

    return { vacancy, score };
  });

  const ranked = scored
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const priorityA = Number.isFinite(Number(a.vacancy.priority)) ? Number(a.vacancy.priority) : Infinity;
      const priorityB = Number.isFinite(Number(b.vacancy.priority)) ? Number(b.vacancy.priority) : Infinity;
      if (priorityA !== priorityB) return priorityA - priorityB;
      return new Date(b.vacancy.createdAt || 0).getTime() - new Date(a.vacancy.createdAt || 0).getTime();
    })
    .map(entry => entry.vacancy);

  return ranked.slice(0, 8).map(vacancy => ({
    id: vacancy.id,
    skill: vacancy.skill,
    title: vacancy.title || vacancy.skill || '',
    country: vacancy.country,
    salary: vacancy.salary || vacancy.candidatePrice || '',
    candidatePrice: vacancy.candidatePrice || '',
    companyName: vacancy.companyName || vacancy.agencyName || '',
    metaTemplateName: vacancy.metaTemplateName || '',
    originalForm: vacancy.originalForm || vacancy.rawText || '',
    candidateFacingText: vacancy.candidateFacingText || vacancy.body || '',
    serviceCharge: vacancy.serviceCharge || '',
    priority: vacancy.priority,
  }));
}

const MAX_VACANCY_OPTION_LABEL_LENGTH = 60;

// A vacancy's skill/title field is meant to be a short role name, but the dashboard's
// vacancy-add form has no length limit, so a full marketing flyer pasted into that field
// (as happened with the Azerbaijan Warehouse Jobs entry) would otherwise get dumped into
// every single greeting/fallback reply sent to every candidate. Collapse whitespace and
// hard-cap the length so one bad data entry can never flood every reply again.
function shortVacancyLabel(value = '') {
  const collapsed = String(value || '').replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_VACANCY_OPTION_LABEL_LENGTH
    ? `${collapsed.slice(0, MAX_VACANCY_OPTION_LABEL_LENGTH - 1)}…`
    : collapsed;
}

function formatVacancyOption(vacancy = {}) {
  const role = shortVacancyLabel(vacancy.skill || vacancy.title) || 'Vacancy';
  const parts = [role];
  if (vacancy.country) parts.push(vacancy.country);
  if (vacancy.salary || vacancy.candidatePrice) parts.push(vacancy.salary || vacancy.candidatePrice);
  // Candidates were only learning the service charge if they explicitly asked for
  // it, several messages into the conversation — state it upfront alongside the
  // role/salary, same as it's already stated whenever the AI path answers a direct
  // charge question, so there's no gap in what the code-level fallback path shows.
  // Never state or imply visa/ticket are "free" here — strict legal-compliance rule.
  const serviceCharge = String(vacancy.serviceCharge || '').trim();
  if (serviceCharge) parts.push(`Service Charge Rs.${serviceCharge}`);
  return parts.join(' | ');
}

function buildVacancyOptionsText(vacancies = [], limit = 3) {
  return vacancies
    .slice(0, limit)
    .map((vacancy, index) => `${index + 1}. ${formatVacancyOption(vacancy)}`)
    .join('\n');
}

function buildFallbackResponse({ candidate, latestMessage, vacancies, messages = [], contactName, replyLanguage = { code: 'roman' } }) {
  const text = String(latestMessage || '').trim();
  const detectedSkill = inferSkillFromText(text) || candidate.skill || 'General';
  const detectedCountry = inferCountryFromText(text) || candidate.preferredCountry || candidate.country || 'Saudi';
  const detectedBudget = inferBudgetFromText(text) || candidate.budget || '';
  const detectedBudgetPeriod = inferBudgetPeriod(text) || candidate.budgetPeriod || '';
  // Gemini is unavailable in this fallback path, so it can't extract a name from free text
  // itself — without this, a candidate who correctly answers "Aapka poora naam kya hai?"
  // would see the same question forever. Reuse the same name-resolution logic the profile
  // backfill uses (checks whether we just asked for the name, then validates the reply).
  const resolvedName = sanitizeCandidateName(candidate.name || '') || pickBestName({
    existingName: candidate.name || '',
    contactName,
    messages,
  });
  const candidateName = getDisplayName({ ...candidate, name: resolvedName }, contactName);
  const romanName = candidateName !== 'bhai' ? `${candidateName}, ` : '';

  // Same gap as the name field, for whichever field the bot just asked about: with
  // Gemini unavailable, nothing here parses a plain-text reply into city/workStatus/
  // experience/etc., so a candidate who correctly answers keeps getting asked the same
  // question. Figure out what was actually pending BEFORE this reply and, if the message
  // looks like a direct answer (not a new question of its own), accept it.
  const previouslyPendingField = getMissingCandidateFields(candidate)[0];
  const looksLikeAnAnswerNotAQuestion = isUsableFreeTextValue(text)
    && text.length <= 60
    && !messageLooksLikeVacancyQuestion(text)
    && !messageLooksLikeOfficeQuestion(text)
    && !messageLooksLikeComparisonRequest(text);
  const fieldAnswerUpdates = {};
  if (looksLikeAnAnswerNotAQuestion) {
    if (previouslyPendingField === 'city') {
      fieldAnswerUpdates.city = text;
    } else if (previouslyPendingField === 'workStatus') {
      if (/fresh|fresher|first time|pehli baar|never worked|no experience/i.test(text)) {
        fieldAnswerUpdates.workStatus = 'fresh';
        fieldAnswerUpdates.experience = candidate.experience ?? 0;
      } else if (/return|second time|already worked|dobara|pehle.*kaam|abroad/i.test(text)) {
        fieldAnswerUpdates.workStatus = 'return';
      }
    } else if (previouslyPendingField === 'documentsReady') {
      fieldAnswerUpdates.documentsReady = text;
    } else if (previouslyPendingField === 'availability') {
      fieldAnswerUpdates.availability = text;
    } else if (previouslyPendingField === 'experience') {
      const match = text.match(/(\d+(?:\.\d+)?)/);
      if (match) fieldAnswerUpdates.experience = Number(match[1]);
    }
  }

  const candidateSnapshot = {
    ...candidate,
    name: resolvedName || candidate.name,
    skill: detectedSkill,
    preferredCountry: detectedCountry,
    country: candidate.country || detectedCountry,
    budget: detectedBudget,
    budgetPeriod: detectedBudgetPeriod,
    ...fieldAnswerUpdates,
  };
  const missingFields = getMissingCandidateFields(candidateSnapshot);

  const vacancyLine = vacancies.length > 0
    ? pickLocalizedCopy(replyLanguage, {
      ar: `اس وقت یہ active openings available ہیں:\n${buildVacancyOptionsText(vacancies, 3)}`,
      hi: `अभी ये active openings available हैं:\n${buildVacancyOptionsText(vacancies, 3)}`,
      en: `These active openings are available right now:\n${buildVacancyOptionsText(vacancies, 3)}`,
      roman: `Abhi ye active openings available hain:\n${buildVacancyOptionsText(vacancies, 3)}`,
    })
    : pickLocalizedCopy(replyLanguage, {
      ar: 'ہمارے پاس Gulf placement کی نئی vacancies آتی رہتی ہیں۔',
      hi: 'Hamare paas Gulf placement ki new vacancies aati rehti hain.',
      en: 'We regularly receive new Gulf placement openings.',
      roman: 'Hamare paas Gulf placement ke active openings aati rehti hain.',
    });

  const nextQuestion = getPendingQuestion(candidateSnapshot, replyLanguage);

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `${vacancyLine}\n\nآپ کا پیغام موصول ہوگیا۔ ${nextQuestion}`,
      hi: `${vacancyLine}\n\nआपका message मिल गया। ${nextQuestion}`,
      en: `${vacancyLine}\n\nWe received your message. ${nextQuestion}`,
      roman: `${vacancyLine}\n\n${romanName}aapka message mil gaya. ${nextQuestion}`,
    })),
    profile: {
      name: resolvedName || candidate.name || '',
      skill: detectedSkill,
      preferredCountry: detectedCountry,
      country: detectedCountry === 'Saudi' ? 'Saudi' : (candidate.country || 'Unspecified'),
      budget: detectedBudget || candidate.budget || '',
      budgetPeriod: detectedBudgetPeriod || candidate.budgetPeriod || '',
      ...fieldAnswerUpdates,
      status: missingFields.length > 0 ? 'pending_re-profiling' : 'pending_update',
      stage: missingFields.length > 0 ? 'profiling' : 'engaged',
      summary: `Candidate interested in ${detectedSkill || 'job opportunities'} for ${detectedCountry || 'Gulf'}.`,
      lastQuestionAsked: nextQuestion,
      replyLanguage: replyLanguage.code,
    }
  };
}

const PLACEHOLDER_VACANCY_VALUES = new Set(['undefined', 'null', 'nan', 'n/a', 'na', 'unknown', 'string']);

// Guards against a field literally holding the string "undefined"/"null" (e.g. from a bad
// String(possiblyUndefinedVar) somewhere upstream) leaking into the AI prompt and getting
// echoed back to a candidate verbatim (seen in chat history as "Service Charge: ₹undefined").
function cleanVacancyFieldValue(value) {
  const str = String(value || '').trim();
  return PLACEHOLDER_VACANCY_VALUES.has(str.toLowerCase()) ? '' : str;
}

function getVacancySummary(vacancies = []) {
  return vacancies
    .map(vacancy => {
      const headline = shortVacancyLabel(cleanVacancyFieldValue(vacancy.title) || cleanVacancyFieldValue(vacancy.skill)) || 'Vacancy';
      const serviceCharge = cleanVacancyFieldValue(vacancy.serviceCharge);
      const benefits = cleanVacancyFieldValue(vacancy.benefits);
      const visaInfo = cleanVacancyFieldValue(vacancy.visaInfo);
      const summary = [
        `Role: ${headline}`,
        `Country: ${cleanVacancyFieldValue(vacancy.country)}`,
        `Salary: ${cleanVacancyFieldValue(vacancy.salary) || cleanVacancyFieldValue(vacancy.candidatePrice)}`,
        serviceCharge ? `Service Charge: Rs.${serviceCharge}` : '',
        benefits ? `Benefits: ${benefits}` : '',
        visaInfo ? `Visa/Ticket: ${visaInfo}` : '',
      ].filter(Boolean).join(' | ');
      const sourceText = String(vacancy.candidateFacingText || vacancy.originalForm || '').replace(/\s+/g, ' ').trim();
      return sourceText ? `${summary}\nFull details: ${sourceText.slice(0, 500)}` : summary;
    })
    .join('\n\n---\n');
}

function buildAgencyFallbackResponse({ latestMessage, contactName, replyLanguage = { code: 'roman' } }) {
  const displayName = getDisplayName({}, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const text = String(latestMessage || '').toLowerCase();
  const asksForPrice = /price|rate|charge|budget|service/i.test(text);
  const asksForDocs = /document|passport|cv|photo|medical/i.test(text);
  let question = pickLocalizedCopy(replyLanguage, {
    ar: 'براہ کرم skill، country، salary، quantity اور joining timeline بھیج دیں۔',
    hi: 'Skill, country, salary, quantity aur joining timeline bhej dijiye.',
    en: 'Please share the skill, country, salary, quantity, and joining timeline.',
    roman: 'Skill, country, salary, quantity aur joining timeline bhej dijiye.',
  });
  if (asksForPrice) question = pickLocalizedCopy(replyLanguage, {
    ar: 'فی candidate price اور service charge confirm کر دیں۔',
    hi: 'Per candidate price aur service charge confirm kar dijiye.',
    en: 'Please confirm the per-candidate price and service charge.',
    roman: 'Per candidate price aur service charge confirm kar dijiye.',
  });
  if (asksForDocs) question = pickLocalizedCopy(replyLanguage, {
    ar: 'Required documents اور processing timeline بھی بتا دیں۔',
    hi: 'Required documents aur processing timeline bhi bata dijiye.',
    en: 'Please also share the required documents and processing timeline.',
    roman: 'Required documents aur processing timeline bhi bata dijiye.',
  });

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `وعلیکم السلام۔ vacancy details مل رہی ہیں۔ میں اسے save کر رہا ہوں۔ ${question}`,
      hi: `नमस्ते। Vacancy details मिल रही हैं। Main isko save kar raha hoon. ${question}`,
      en: `Hello. I am receiving the vacancy details and saving them now. ${question}`,
      roman: `Assalam-o-Alaikum. ${romanName}vacancy details mil rahi hain. Main isko save kar raha hoon. ${question}`,
    })),
    profile: {
      stage: 'agency_intake',
      status: 'pending_update',
      summary: 'Agency conversation active for vacancy intake.',
      lastQuestionAsked: question,
      notes: latestMessage || '',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {
      inquiryText: latestMessage || '',
    }
  };
}

function buildAgencyGreetingResponse({ contactName, replyLanguage = { code: 'roman' } }) {
  const displayName = getDisplayName({}, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const question = pickLocalizedCopy(replyLanguage, {
    ar: 'Vacancy کا text، poster یا basic details بھیج دیں: skill، country، salary، quantity اور service charge۔',
    hi: 'Vacancy ka text, poster ya basic details bhej dijiye: skill, country, salary, quantity aur service charge.',
    en: 'Please send the vacancy text, poster, or basic details: skill, country, salary, quantity, and service charge.',
    roman: 'Vacancy ka text, poster ya basic details bhej dijiye: skill, country, salary, quantity aur service charge.',
  });
  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `وعلیکم السلام۔ agency support active ہے۔ ${question}`,
      hi: `नमस्ते। Agency support active hai. ${question}`,
      en: `Hello. Agency support is active. ${question}`,
      roman: `Assalam-o-Alaikum. ${romanName}agency support active hai. ${question}`,
    })),
    profile: {
      stage: 'agency_intake',
      status: 'pending_update',
      summary: 'Agency conversation active for vacancy intake.',
      lastQuestionAsked: question,
      notes: '',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function buildAgencyFollowupResponse({ contactName, replyLanguage = { code: 'roman' }, lastQuestionAsked = '' }) {
  const displayName = getDisplayName({}, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const fallbackQuestion = pickLocalizedCopy(replyLanguage, {
    ar: 'Vacancy ki basic details bhej dijiye.',
    hi: 'Vacancy ki basic details bhej dijiye.',
    en: 'Please share the basic vacancy details.',
    roman: 'Vacancy ki basic details bhej dijiye.',
  });
  const question = String(lastQuestionAsked || '').trim() || fallbackQuestion;

  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `Ji, main yahin hoon. ${question}`,
      hi: `Ji, main yahin hoon. ${question}`,
      en: `Yes, I am here. ${question}`,
      roman: `Ji, ${romanName}main yahin hoon. ${question}`,
    })),
    profile: {
      stage: 'agency_intake',
      status: 'pending_update',
      summary: 'Agency conversation active for vacancy intake.',
      lastQuestionAsked: question,
      notes: '',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function buildAgencyMediaAckResponse({ contactName, replyLanguage = { code: 'roman' } }) {
  const displayName = getDisplayName({}, contactName);
  const romanName = displayName !== 'bhai' ? `${displayName}, ` : '';
  const question = pickLocalizedCopy(replyLanguage, {
    ar: 'میں اس media کو review queue میں save کر رہا ہوں۔ اگر available ہو تو skill، country، salary اور quantity بھی text میں بھیج دیں۔',
    hi: 'Main is media ko review queue mein save kar raha hoon. Agar available ho to skill, country, salary aur quantity bhi text mein bhej dijiye.',
    en: 'I am saving this media in the review queue. If available, please also share the skill, country, salary, and quantity in text.',
    roman: 'Main is media ko review queue mein save kar raha hoon. Agar available ho to skill, country, salary aur quantity bhi text mein bhej dijiye.',
  });
  return {
    shouldReply: true,
    replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
      ar: `وعلیکم السلام۔ poster/document موصول ہوگیا ہے۔ ${question}`,
      hi: `नमस्ते। Poster/document receive ho gaya hai. ${question}`,
      en: `Hello. The poster or document has been received. ${question}`,
      roman: `Assalam-o-Alaikum. ${romanName}poster/document receive ho gaya hai. ${question}`,
    })),
    profile: {
      stage: 'agency_intake',
      status: 'pending_update',
      summary: 'Agency media received for vacancy intake.',
      lastQuestionAsked: question,
      notes: '',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function isMaleName(name = '') {
  const n = String(name || '').toLowerCase();
  const maleNames = ['rahul', 'vijay', 'vikas', 'krishna', 'amit', 'raj', 'rohit', 'sanjay', 'deepak', 'sandeep', 'abhishek', 'anil', 'sunil', 'vivek', 'arjun', 'ranjit', 'mohammad', 'ali', 'ahmed', 'suresh', 'ramesh', 'ajay', 'vijay', 'vikas', 'vikram'];
  return maleNames.some(m => n.includes(m));
}

function buildCandidateMediaAckResponse({ contactName, replyLanguage = { code: 'roman' } }) {
  const displayName = getDisplayName({}, contactName);
  const namePrefix = displayName && displayName !== 'bhai' ? `${displayName}, ` : '';
  const replyText = pickLocalizedCopy(replyLanguage, {
    ar: `تم استلام ملفات الوسائط الخاصة بك بنجاح. سيقوم فريقنا بمراجعتها والتواصل معك قريبًا.`,
    hi: `आपके मीडिया फ़ाइलें (फ़ोटो/वीडियो) हमें प्राप्त हो गए हैं। हमारी टीम जल्द ही इनकी समीक्षा करके आपसे संपर्क करेगी।`,
    en: `We have received your media files successfully. Our team will review them and get back to you shortly.`,
    roman: `Aapke photos/videos (media files) hamein receive ho gaye hain. Humaari team jald hi inhein review karke aapko update karegi.`,
  });
  return {
    shouldReply: true,
    replyText: sanitizeReply(replyText),
    profile: {
      stage: 'media_received',
      status: 'clean',
      summary: 'Candidate media files received.',
      lastQuestionAsked: '',
      notes: 'Media files uploaded.',
      replyLanguage: replyLanguage.code,
    },
    vacancyLead: {},
  };
}

function buildOperationalIntentResponse({ candidate, latestMessage, vacancies, messages, contactName, replyLanguage = { code: 'roman' } }) {

  const text = String(latestMessage || '').trim();
  if (!text) return null;

  const officeIntent = messageLooksLikeOfficeQuestion(text) || messageLooksLikeOfficeAddressReference(text) || messageLooksLikeVisitingCardRequest(text);
  const callIntent = messageLooksLikeCallRequest(text);
  const serviceChargeIntent = messageLooksLikeServiceChargeQuestion(text);
  const timelineIntent = messageLooksLikeTimelineQuestion(text);
  const wantsDuty = /(duty|hours|hour|shift|kitne ghante|kitna hour)/iu.test(text);

  if (!officeIntent && !callIntent && !serviceChargeIntent && !timelineIntent && !wantsDuty) {
    return null;
  }

  const recentCue = getRecentVacancyCue(messages);
  const requestedRole = extractRequestedRole(text, messages) || recentCue.role || candidate.skill || '';
  const requestedCountry = inferCountryFromText(text) || recentCue.country || candidate.preferredCountry || candidate.country || '';
  const matchedVacancy = vacancies.length > 0 ? findBestVacancyMatch(vacancies, requestedRole, requestedCountry) : null;
  const chargeDetails = matchedVacancy ? extractChargeDetails(matchedVacancy) : '';
  const timelineDetails = matchedVacancy ? extractTimelineDetails(matchedVacancy) : '';
  const dutyDetails = matchedVacancy ? extractDutyDetails(matchedVacancy) : '';
  const offerDetails = matchedVacancy ? extractOfferDetails(matchedVacancy, text) : '';
  const roleLabel = matchedVacancy?.skill || matchedVacancy?.title || requestedRole || 'vacancy';
  const countryLabel = matchedVacancy?.country || requestedCountry || 'Saudi Arabia';

  let replyText = '';
  let nextQuestion = '';

  if (officeIntent) {
    replyText = pickLocalizedCopy(replyLanguage, {
      ar: `Ù‡Ù…Ø§Ø±ÛŒ office details ÛŒÛ ÛÛŒÚº: Phone ${GCC_DESK_PHONE}, Email ${GCC_DESK_EMAIL}, Office ${GCC_OFFICE_ADDRESS}.`,
      hi: `Hamari office details ye hain: Phone ${GCC_DESK_PHONE}, Email ${GCC_DESK_EMAIL}, Office ${GCC_OFFICE_ADDRESS}.`,
      en: `Our office details are: Phone ${GCC_DESK_PHONE}, Email ${GCC_DESK_EMAIL}, Office ${GCC_OFFICE_ADDRESS}.`,
      roman: `Hamari office details ye hain: Phone ${GCC_DESK_PHONE}, Email ${GCC_DESK_EMAIL}, Office ${GCC_OFFICE_ADDRESS}.`,
    });
    nextQuestion = getPendingQuestion(candidate, replyLanguage);
  } else if (callIntent) {
    replyText = pickLocalizedCopy(replyLanguage, {
      ar: `Call coordination Ú©Û’ Ù„ÛŒÛ’ hamara desk number ${GCC_DESK_PHONE} hai. Aap isi number par WhatsApp ya call kar sakte hain.`,
      hi: `Call coordination ke liye hamara desk number ${GCC_DESK_PHONE} hai. Aap isi number par WhatsApp ya call kar sakte hain.`,
      en: `For call coordination, our desk number is ${GCC_DESK_PHONE}. You can call or WhatsApp on this number.`,
      roman: `Call coordination ke liye hamara desk number ${GCC_DESK_PHONE} hai. Aap isi number par WhatsApp ya call kar sakte hain.`,
    });
    nextQuestion = getPendingQuestion(candidate, replyLanguage);
  } else if (serviceChargeIntent) {
    replyText = chargeDetails
      ? pickLocalizedCopy(replyLanguage, {
          ar: `${roleLabel} role ${countryLabel} Ú©Û’ Ù„ÛŒÛ’ service charge ${chargeDetails} hai.`,
          hi: `${roleLabel} role ${countryLabel} ke liye service charge ${chargeDetails} hai.`,
          en: `For the ${roleLabel} role in ${countryLabel}, the service charge is ${chargeDetails}.`,
          roman: `${roleLabel} role ${countryLabel} ke liye service charge ${chargeDetails} hai.`,
        })
      : pickLocalizedCopy(replyLanguage, {
          ar: `Is role Ú©Û’ service charge ka updated confirmation process ke dauran share kiya jayega.`,
          hi: `Is role ke service charge ka updated confirmation process ke dauran share kiya jayega.`,
          en: `The updated service charge confirmation for this role will be shared during the process.`,
          roman: `Is role ke service charge ka updated confirmation process ke dauran share kiya jayega.`,
        });
    nextQuestion = getPendingQuestion(candidate, replyLanguage);
  } else if (timelineIntent) {
    replyText = timelineDetails
      ? pickLocalizedCopy(replyLanguage, {
          ar: `${roleLabel} role ${countryLabel} ke liye current process timeline ${timelineDetails} hai.`,
          hi: `${roleLabel} role ${countryLabel} ke liye current process timeline ${timelineDetails} hai.`,
          en: `The current process timeline for the ${roleLabel} role in ${countryLabel} is ${timelineDetails}.`,
          roman: `${roleLabel} role ${countryLabel} ke liye current process timeline ${timelineDetails} hai.`,
        })
      : pickLocalizedCopy(replyLanguage, {
          ar: `${roleLabel} role ke liye exact timeline employer selection aur documentation ke mutabiq share ki jayegi.`,
          hi: `${roleLabel} role ke liye exact timeline employer selection aur documentation ke mutabiq share ki jayegi.`,
          en: `The exact timeline for the ${roleLabel} role will be shared subject to employer selection and documentation.`,
          roman: `${roleLabel} role ke liye exact timeline employer selection aur documentation ke mutabiq share ki jayegi.`,
        });
    nextQuestion = getPendingQuestion(candidate, replyLanguage);
  } else if (wantsDuty) {
    replyText = dutyDetails
      ? pickLocalizedCopy(replyLanguage, {
          ar: `${roleLabel} role ${countryLabel} ke liye duty ${dutyDetails} hai.`,
          hi: `${roleLabel} role ${countryLabel} ke liye duty ${dutyDetails} hai.`,
          en: `For the ${roleLabel} role in ${countryLabel}, the duty is ${dutyDetails}.`,
          roman: `${roleLabel} role ${countryLabel} ke liye duty ${dutyDetails} hai.`,
        })
      : pickLocalizedCopy(replyLanguage, {
          ar: `${roleLabel} role ${countryLabel} ke liye offer ${offerDetails || 'available'} hai.`,
          hi: `${roleLabel} role ${countryLabel} ke liye offer ${offerDetails || 'available'} hai.`,
          en: `For the ${roleLabel} role in ${countryLabel}, the offer is ${offerDetails || 'available'}.`,
          roman: `${roleLabel} role ${countryLabel} ke liye offer ${offerDetails || 'available'} hai.`,
        });
    nextQuestion = getPendingQuestion(candidate, replyLanguage);
  }

  if (!replyText) return null;

  return {
    shouldReply: true,
    replyText: sanitizeReply(`${replyText}\n\n${nextQuestion}`),
    // This reply already came from a curated, factual, non-committal template (real desk
    // phone/office/service-charge/timeline data) — it must never be silently discarded by the
    // admin-escalation keyword fallback afterward (that used to happen for e.g. "call me").
    skipAdminEscalation: true,
    profile: {
      skill: matchedVacancy?.skill || candidate.skill || requestedRole || '',
      preferredCountry: matchedVacancy?.country || candidate.preferredCountry || requestedCountry || '',
      country: matchedVacancy?.country || candidate.country || requestedCountry || '',
      status: 'pending_update',
      stage: candidate.stage || 'engaged',
      summary: `Candidate asked an operational question about ${roleLabel || 'the role'}.`,
      lastQuestionAsked: nextQuestion,
      replyLanguage: replyLanguage.code,
    },
  };
}

function findBestVacancyMatch(vacancies = [], role = '', country = '') {
  const roleTokens = tokenizeText(role);
  const countryToken = normalizeText(country);

  const scored = vacancies
    .map(vacancy => {
      const searchable = normalizeText([
        vacancy.title,
        vacancy.skill,
        vacancy.country,
        vacancy.companyName,
        vacancy.originalForm,
      ].filter(Boolean).join(' '));

      let score = 0;
      for (const token of roleTokens) {
        if (searchable.includes(token)) score += 2;
      }
      if (countryToken && searchable.includes(countryToken)) score += 2;
      if (!roleTokens.length && countryToken && searchable.includes(countryToken)) score += 1;
      return { vacancy, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].vacancy : vacancies[0] || null;
}

function buildVacancyInquiryResponse({ candidate, latestMessage, vacancies, messages, contactName, replyLanguage = { code: 'roman' } }) {
  if (!messageLooksLikeVacancyQuestion(latestMessage)) return null;

  const recentCue = getRecentVacancyCue(messages);
  const requestedRole = extractRequestedRole(latestMessage, messages) || recentCue.role || candidate.skill || '';
  const requestedCountry = inferCountryFromText(latestMessage) || recentCue.country || candidate.preferredCountry || candidate.country || '';
  const matchedVacancy = findBestVacancyMatch(vacancies, requestedRole, requestedCountry);
  const candidateName = getDisplayName(candidate, contactName);
  const genericRoleRequest = roleLooksGeneric(requestedRole);
  const asksLocation = /(kahan|where|kis desh|which country|country|location)/i.test(latestMessage);
  const asksSalary = /(salary|package|kitna|kitni|aed|sar|omr|qar|pkr)/i.test(latestMessage);
  const asksDuty = /(kya kaam|kaam kya|duty|role|work|kis kaam)/i.test(latestMessage);
  const asksAvailabilityList = /(kya kaam|kya vacancy|kitni vacancy|kaun si vacancy|konsi vacancy|available jobs|jobs hain|kaam hai|openings)/i.test(latestMessage);
  const asksComparison = messageLooksLikeComparisonRequest(latestMessage);

  if (!matchedVacancy && vacancies.length === 0) {
    const nextQuestion = requestedRole && !genericRoleRequest
      ? pickLocalizedCopy(replyLanguage, {
        ar: `آپ ${requestedRole} کے لیے کس ملک میں interested ہیں؟`,
        hi: `आप ${requestedRole} ke liye kis country mein interested hain?`,
        en: `Which country are you interested in for the ${requestedRole} role?`,
        roman: `Aap ${requestedRole} ke liye kis country mein interested hain?`,
      })
      : pickLocalizedCopy(replyLanguage, {
        ar: 'آپ کس کام اور کس ملک کے لیے اپلائی کرنا چاہتے ہیں؟',
        hi: 'आप किस काम aur kis country ke liye apply करना चाहते हैं?',
        en: 'Which job role and country would you like to apply for?',
        roman: 'Aap kis kaam aur kis country ke liye apply karna chahte hain?',
      });

    return {
      shouldReply: true,
      replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
        ar: `آپ کے پیغام کے مطابق ابھی کوئی live vacancy confirm نہیں ہو رہی۔\n\n${nextQuestion}`,
        hi: `आपके message के mutabiq अभी कोई live vacancy confirm नहीं दिख रही।\n\n${nextQuestion}`,
        en: `Based on your message, I cannot confirm a live vacancy match right now.\n\n${nextQuestion}`,
        roman: `Ji ${candidateName}, abhi aapke message ke mutabiq koi live vacancy confirm list mein nahi dikh rahi.\n\n${nextQuestion}`,
      })),
      profile: {
        skill: candidate.skill || requestedRole || '',
        preferredCountry: candidate.preferredCountry || requestedCountry || '',
        country: candidate.country || requestedCountry || '',
        status: 'pending_update',
        stage: 'profiling',
        summary: `Candidate asking about ${requestedRole || 'openings'} but no live vacancy matched yet.`,
        lastQuestionAsked: nextQuestion,
        replyLanguage: replyLanguage.code,
      },
    };
  }

  if (!matchedVacancy && vacancies.length > 0) {
    const nextQuestion = candidate.experience && Number(candidate.experience) > 0
      ? pickLocalizedCopy(replyLanguage, {
        ar: 'ان میں سے آپ کس role پر آگے بات کرنا چاہتے ہیں؟',
        hi: 'इनमें से kis role par aap aage baat karna chahte hain?',
        en: 'Which of these roles would you like to discuss further?',
        roman: 'In mein se kis role par aap aage baat karna chahte hain?',
      })
      : pickLocalizedCopy(replyLanguage, {
        ar: 'ان میں سے کس role پر بات کرنی ہے، اور اس field کا آپ کا کتنا experience ہے؟',
        hi: 'इनमें से kis role par baat karni hai, aur us field ka aapka kitna experience hai?',
        en: 'Which of these roles would you like to discuss, and how much experience do you have in that field?',
        roman: 'In mein se kis role par baat karni hai, aur us field ka aapka kitna experience hai?',
      });

    return {
      shouldReply: true,
      replyText: sanitizeReply(pickLocalizedCopy(replyLanguage, {
        ar: `${requestedRole && !genericRoleRequest ? `${requestedRole} کی exact vacancy ابھی confirm نہیں ہو رہی۔` : 'اس وقت یہ fresh openings available ہیں:'}\n${buildVacancyOptionsText(vacancies, 3)}\n\n${nextQuestion}`,
        hi: `${requestedRole && !genericRoleRequest ? `${requestedRole} ki exact vacancy abhi confirm list mein nahi dikh rahi.` : 'अभी ये fresh openings available हैं:'}\n${buildVacancyOptionsText(vacancies, 3)}\n\n${nextQuestion}`,
        en: `${requestedRole && !genericRoleRequest ? `The exact ${requestedRole} vacancy is not confirmed right now.` : 'These fresh openings are currently available:'}\n${buildVacancyOptionsText(vacancies, 3)}\n\n${nextQuestion}`,
        roman: `Ji ${candidateName}, ${requestedRole && !genericRoleRequest ? `${requestedRole} ki exact vacancy abhi confirm list mein nahi dikh rahi.` : 'abhi ye fresh openings available hain:'}\n${buildVacancyOptionsText(vacancies, 3)}\n\n${nextQuestion}`,
      })),
      profile: {
        skill: candidate.skill || requestedRole || vacancies[0]?.skill || '',
        preferredCountry: candidate.preferredCountry || requestedCountry || vacancies[0]?.country || '',
        country: candidate.country || requestedCountry || vacancies[0]?.country || '',
        status: 'pending_update',
        stage: 'engaged',
        summary: `Candidate asked for ${requestedRole || 'openings'} and shared alternative vacancies.`,
        lastQuestionAsked: nextQuestion,
        replyLanguage: replyLanguage.code,
      },
    };
  }

  const roleLabel = matchedVacancy.skill || matchedVacancy.title || requestedRole || 'is role';
  const countryLabel = matchedVacancy.country || requestedCountry || 'Gulf';
  const salaryLabel = extractOfferDetails(matchedVacancy, latestMessage) || matchedVacancy.salary || matchedVacancy.candidatePrice || '';
  const dutyLabel = extractDutyDetails(matchedVacancy);
  const alternativeVacancies = vacancies.filter(vacancy => vacancy.id !== matchedVacancy.id);

  let infoLine = pickLocalizedCopy(replyLanguage, {
    ar: `اس وقت ${roleLabel} کی vacancy ${countryLabel} کے لیے available ہے۔`,
    hi: `अभी ${roleLabel} ki vacancy ${countryLabel} ke liye available hai.`,
    en: `The ${roleLabel} vacancy is currently available for ${countryLabel}.`,
    roman: `Ji ${candidateName}, abhi ${roleLabel} ki vacancy ${countryLabel} ke liye available hai.`,
  });
  if (asksLocation) {
    infoLine = pickLocalizedCopy(replyLanguage, {
      ar: `یہ vacancy ${countryLabel} کے لیے ہے۔ Role ${roleLabel} کا ہے۔`,
      hi: `यह vacancy ${countryLabel} ke liye hai. Role ${roleLabel} ka hai.`,
      en: `This vacancy is for ${countryLabel}, and the role is ${roleLabel}.`,
      roman: `Ji ${candidateName}, yeh vacancy ${countryLabel} ke liye hai. Role ${roleLabel} ka hai.`,
    });
  } else if (asksSalary && salaryLabel) {
    infoLine = pickLocalizedCopy(replyLanguage, {
      ar: `${roleLabel} role ${countryLabel} کے لیے available ہے۔ Salary/offer ${salaryLabel} ہے۔`,
      hi: `${roleLabel} role ${countryLabel} ke liye available hai. Salary/offer ${salaryLabel} hai.`,
      en: `The ${roleLabel} role is available for ${countryLabel}. The salary or offer is ${salaryLabel}.`,
      roman: `Ji ${candidateName}, ${roleLabel} role ${countryLabel} ke liye available hai. Salary/offer ${salaryLabel} hai.`,
    });
  } else if (asksDuty) {
    infoLine = pickLocalizedCopy(replyLanguage, {
      ar: `اس vacancy میں role ${roleLabel} کا ہے اور location ${countryLabel} ہے۔`,
      hi: `इस vacancy mein role ${roleLabel} ka hai aur location ${countryLabel} hai.`,
      en: `In this vacancy, the role is ${roleLabel} and the location is ${countryLabel}.`,
      roman: `Ji ${candidateName}, is vacancy mein role ${roleLabel} ka hai aur location ${countryLabel} hai.`,
    });
    if (dutyLabel) {
      infoLine += pickLocalizedCopy(replyLanguage, {
        ar: ` Duty ${dutyLabel} hai.`,
        hi: ` Duty ${dutyLabel} hai.`,
        en: ` Duty ${dutyLabel}.`,
        roman: ` Duty ${dutyLabel} hai.`,
      });
    } else if (salaryLabel) {
      infoLine += pickLocalizedCopy(replyLanguage, {
        ar: ` Offer ${salaryLabel} ہے۔`,
        hi: ` Offer ${salaryLabel} hai.`,
        en: ` The offer is ${salaryLabel}.`,
        roman: ` Offer ${salaryLabel} hai.`,
      });
    }
  } else if (salaryLabel) {
    infoLine += pickLocalizedCopy(replyLanguage, {
      ar: ` Offer ${salaryLabel} ہے۔`,
      hi: ` Offer ${salaryLabel} hai.`,
      en: ` The offer is ${salaryLabel}.`,
      roman: ` Offer ${salaryLabel} hai.`,
    });
  }

  if (genericRoleRequest || asksAvailabilityList) {
    infoLine = pickLocalizedCopy(replyLanguage, {
      ar: `اس وقت یہ fresh openings available ہیں:\n${buildVacancyOptionsText(vacancies, 3)}`,
      hi: `अभी ये fresh openings available हैं:\n${buildVacancyOptionsText(vacancies, 3)}`,
      en: `These fresh openings are currently available:\n${buildVacancyOptionsText(vacancies, 3)}`,
      roman: `Ji ${candidateName}, abhi ye fresh openings available hain:\n${buildVacancyOptionsText(vacancies, 3)}`,
    });
  }

  const nextQuestion = getPendingQuestion(candidate, replyLanguage);
  const alternateLine = !genericRoleRequest && asksComparison && alternativeVacancies.length > 0
    ? pickLocalizedCopy(replyLanguage, {
      ar: `اگر آپ compare کرنا چاہیں تو یہ options بھی active ہیں:\n${buildVacancyOptionsText(alternativeVacancies, 2)}`,
      hi: `Agar aap compare karna chahen to ye options bhi active hain:\n${buildVacancyOptionsText(alternativeVacancies, 2)}`,
      en: `If you want to compare, these options are also active:\n${buildVacancyOptionsText(alternativeVacancies, 2)}`,
      roman: `Agar aap compare karna chahen to ye options bhi active hain:\n${buildVacancyOptionsText(alternativeVacancies, 2)}`,
    })
    : '';

  return {
    shouldReply: true,
    replyText: sanitizeReply(`${infoLine}${alternateLine ? `\n\n${alternateLine}` : ''}\n\n${nextQuestion}`),
    profile: {
      skill: matchedVacancy.skill || candidate.skill || requestedRole || '',
      preferredCountry: matchedVacancy.country || candidate.preferredCountry || requestedCountry || '',
      country: matchedVacancy.country || candidate.country || requestedCountry || '',
      status: 'pending_update',
      stage: 'engaged',
      summary: `Candidate discussing ${matchedVacancy.skill || requestedRole || 'job'} vacancy for ${matchedVacancy.country || requestedCountry || 'Gulf'}.`,
      lastQuestionAsked: nextQuestion,
      replyLanguage: replyLanguage.code,
    },
  };
}

// Editable-from-dashboard default. Admin can fully override via config.coreRules (AI Instructions tab).
// Only the identity intro, language-matching mechanics, and the literal JSON "Return shape" schema
// stay outside this block — those are the technical response contract the code parses, not content
// shown to candidates, so there is nothing for an admin to usefully edit there.
const DEFAULT_GCG_CORE_RULES = `- Ask only ONE focused question at a time, in ONE short sentence. Never stack multiple questions in the same message.
- For candidates, you must systematically learn/confirm ALL of the following over the conversation: real name, current city, job skill/role they want, whether this is their first time going abroad or they are a returning worker (fresh/return), preferred country, expected salary and whether it is monthly or annual, years of experience in that work, whether documents (passport/photo) are ready, and how soon they can travel. Ask for whichever of these is still missing, one at a time, in the order given, unless the candidate already volunteered it.
- First priority for candidates is to capture their real name, city, and actual job category correctly.
- MESSAGE LENGTH: Write like a real WhatsApp recruiter, not an essay. Each reply should normally be 1-2 short sentences (roughly 15-25 words). Never write long paragraphs or explain more than what was asked. Get straight to the point, then ask the next question. Keep the reply under 200 characters overall.
- If a candidate asks for vacancy details, use the provided active vacancies and mention the relevant ones briefly.
- If a candidate asks whether a role is available, do not say "not available" unless that role is clearly absent from the provided active vacancies. If the exact role is not present, mention the closest active options instead.
- For agencies, ask for the missing vacancy intake details: skill, country, salary, quantity, service charge, documents required, and timeline.
- If this contact is in agency mode, never ask candidate profiling questions like budget, experience, passport readiness, or country preference.
- If this contact is in agency mode and the latest message is just "hello", "hi", "ok", or another acknowledgement after you already asked for vacancy details, do not repeat the same question. Either stay silent or send a very short agency-side acknowledgement.
- Behave like a professional manpower recruitment agency team leader or desk manager, not like a casual chatbot.
- Documents required: Passport, PAN card, and Aadhar card copies/scans, along with a white background photograph (Scan passport, pan card, Aadhar card copy aur white background photograph chahiye hogi). Original documents must be submitted in person at the office (Aadhar card, pan card, aur original documents submit karne honge office aakar). Original Aadhar card is required for selection (Selection ke liye original Aadhar chahiye hoga).
- If the user already answered a question in past Firebase or Google Sheet history, acknowledge it and move to the next missing point.
- Do not repeat the same question if the latest few turns already asked it unless the user clearly did not answer.
- If the latest message is only "hello", "ok", "yes", or another low-signal acknowledgment, look at the stored history first. Avoid repeating the exact same wording. Either ask the next missing thing in fresh wording or keep the reply extremely short.
- If the latest content is a media placeholder like [IMAGE], [VOICE NOTE], [VIDEO], or [DOCUMENT], acknowledge receipt naturally and continue from the correct context.
- Never store instruction text, placeholder text, meta-prompt text, greeting words, or vacancy titles as the candidate name. If the real person name is not clearly stated, leave profile.name empty instead of guessing. If the latest message looks like a role, visa type, duty, or vacancy text, treat it as skill/context, not as the person's name.
- WORK STATUS: If the candidate says anything like "fresher", "fresh hoon", "pehli baar ja raha hoon", or "no experience", set profile.workStatus to "fresh" AND set profile.experience to 0 (zero is a valid, complete answer — do not leave experience blank in this case). If they say they have worked abroad before / are returning, set profile.workStatus to "return".
- VACANCY ACCURACY: You must ONLY mention vacancies that are explicitly listed in the "Active vacancy summary" section below. Never invent, guess, or hallucinate any role name, salary figure, or benefit that is not in that list. If you mention a salary, it must exactly match what is written in the vacancy data — do not round up, modify, or infer a different number. If a role is not in the list, say it is not available rather than inventing it.
- SALARY ACCURACY: Every salary figure you mention must be copied exactly from the vacancy data. Never substitute, estimate, or invent a salary. If the vacancy says "1200 + 200 AED", say exactly that — never say "1400 AED" or any other figure.
- If the user asks for a human callback, raises a complaint, asks about payment/refund/guarantee, or the reply needs human approval, set adminAssist.needsApproval=true and explain the reason briefly.
- Do not make legal or factual guarantees about visa, placement, approval, joining, salary, travel, or employer selection. Never mention license, licence, licensing status, registration status, permit status, or whether the company has or does not have a licence. Instead of promising outcomes, say things like "process ke dauran arrange/help/guide kiya jayega" or "subject to employer selection and documentation". Never say anything that can create legal risk, false commitment, or misleading employment guarantee.
- Do not ask candidates to manually dial or call coordinator phone numbers. Instead, inform them that their profile is being processed and they will be contacted.
- Service Charge: Never say or imply that visa and/or ticket are "free" — do not use the words "visa free", "ticket free", "visa aur ticket free", or any equivalent phrase in any language, ever, in any reply. This is a strict legal-compliance rule with zero exceptions. State this upfront, proactively, the FIRST time you present or discuss a specific vacancy — do not wait for the candidate to ask about cost. If the matched vacancy's own entry in the "Active vacancy summary" lists a "Service Charge" figure, state that exact amount in the same message (e.g. "Office service charge ₹<amount> pay karna hoga") and say it must be paid at the office. Never invent, round, or reuse a service-charge number from a different vacancy or from earlier in the conversation. If the current vacancy has no "Service Charge" line, do not state any figure; instead say the exact service charge will be confirmed by the office team. Once you've stated it in the conversation, you don't need to repeat it in every subsequent message — only bring it up again if the candidate asks.
- Common candidate questions — how to answer them (based on what real candidates actually ask most):
  * "Is this fraud/fake/scam?": Take it seriously, never sound defensive or scripted. Calmly confirm the company is a real recruitment agency, offer the office address/contact so they can visit or verify in person, and mention that no payment is ever asked for over chat (only the office service charge, if applicable, paid in person). Never argue or repeat "trust me" — offer verifiable proof instead (office visit, documents at the office).
  * Candidate states their own years of experience unprompted (e.g. "I have 8 years experience in Saudi"): Acknowledge it, save it, and move to the next missing profiling detail — do not ask "how much experience do you have" again.
  * "Is there an age limit?": If the matched vacancy's data states an age limit, quote it exactly. If it does not, say there's no specific age limit mentioned for this role and ask their age so the office can confirm eligibility — never invent a number.
  * "Do you have jobs for ladies/females?": Only mention a specific role as available for women if a currently active vacancy actually says so. If none do, say there is no specific vacancy for women available right now and that you'll inform them when one opens — never invent one.
  * "Can I get a refund / cancel?": Never state a refund amount or policy yourself — say this needs to be confirmed directly with the office team, and set adminAssist.needsApproval=true.
  * Duty hours / contract length questions: Answer only from the matched vacancy's own data if present; otherwise say the office will confirm exact duty hours/contract length once shortlisted — never estimate.`;

const DEFAULT_ARS_CORE_RULES = `- Ask only one focused question at a time.
- This is a CASTING/AUDITION conversation, not a Gulf/manpower recruitment conversation. Never mention Gulf jobs, visas, manpower vacancies, or overseas placement — that is a different business entirely.
- Try to learn or confirm: real name, city, and which creative field interests them (acting, writing, direction, VFX/technical, music/lyrics). For acting roles, also ask age. If they have a portfolio, reel, or past work link, ask them to share it.
- First priority is to capture their real name and which creative field they want correctly.
- Never store instruction text, placeholder text, meta-prompt text, or greeting words as the candidate name. If the real person name is not clearly stated, leave profile.name empty instead of guessing.
- NO FEE: The application/casting process is 100% free. There is no registration fee or service charge of any kind. If asked about payment, clearly say it is free.
- CASTING ACCURACY: Only mention specific current casting requirements if they are listed in the "Current active castings" section below. If nothing is listed there, do not invent roles — instead say the team keeps adding new castings and ask what creative field/role they are looking for, so the team can match them.
- Do not make guarantees about selection, shortlisting, or approval. Say the casting team will review profiles and get back to interested/matching candidates. Never mention license, licence, licensing, or registration status.
- If the user already answered a question in past conversation history, acknowledge it and move to the next missing point instead of repeating it.
- Do not repeat the same question if the latest few turns already asked it unless the user clearly did not answer.
- If the latest message is only "hello", "ok", "yes", or another low-signal acknowledgment, look at the stored history first and avoid repeating the exact same wording.
- If the latest content is a media placeholder like [IMAGE], [VOICE NOTE], [VIDEO], or [DOCUMENT], acknowledge receipt naturally (e.g. treat it as a photo/portfolio/reel submission) and continue from the correct context.
- If the user asks for a human callback, raises a complaint, or the reply needs human approval, set adminAssist.needsApproval=true and explain the reason briefly.`;

async function generateAiConversationPlan({ phone, contactName, candidate, messages, vacancies, latestMessage, adminProfile = {} }) {
  const lastQuestionAsked = candidate.lastQuestionAsked || '';
  const lastAutoReplyText = candidate.lastAutoReplyText || '';
  const lastAutoReplyAt = candidate.lastAutoReplyAt ? new Date(candidate.lastAutoReplyAt).getTime() : 0;
  const now = Date.now();
  const withinRecentWindow = lastAutoReplyAt && now - lastAutoReplyAt < 6 * 60 * 60 * 1000;
  const isAgencyConversation = candidate.isAgency === true;
  const isArsBot = isArsBotProfile(adminProfile, candidate);
  const replyLanguage = detectReplyLanguage({ latestMessage, messages, candidate });
  const latestLooksLikeMedia = /^\[(IMAGE|VOICE NOTE|VIDEO|DOCUMENT|MEDIA)\]/i.test(String(latestMessage || '').trim());
  const lowSignalLatest = isLowSignalMessage(latestMessage) || isGreetingMessage(latestMessage);

  if (isAgencyConversation && latestLooksLikeMedia) {
    return buildAgencyMediaAckResponse({ contactName, replyLanguage });
  }

  if (!isAgencyConversation && latestLooksLikeMedia) {
    return buildCandidateMediaAckResponse({ contactName, replyLanguage });
  }

  if (isAgencyConversation && lowSignalLatest && lastQuestionAsked && withinRecentWindow) {
    return buildAgencyFollowupResponse({ contactName, replyLanguage, lastQuestionAsked });
  }

  if (isAgencyConversation && lowSignalLatest) {
    return buildAgencyGreetingResponse({ contactName, replyLanguage });
  }

  if (!isAgencyConversation && lastQuestionAsked && withinRecentWindow && lowSignalLatest) {
    return {
      shouldReply: false,
      replyText: '',
      profile: {
        replyLanguage: replyLanguage.code,
      },
      vacancyLead: {},
    };
  }

  if (!isAgencyConversation && isGreetingMessage(latestMessage)) {
    return isArsBot
      ? buildArsGreetingResponse({ candidate, contactName, replyLanguage, adminProfile })
      : buildCandidateGreetingResponse({ candidate, contactName, replyLanguage, adminProfile });
  }

  if (!isAgencyConversation && !isArsBot) {
    const operationalIntentPlan = buildOperationalIntentResponse({
      candidate,
      latestMessage,
      vacancies,
      messages,
      contactName,
      replyLanguage,
    });
    if (operationalIntentPlan) {
      return operationalIntentPlan;
    }

    const vacancyIntentPlan = buildVacancyInquiryResponse({
      candidate,
      latestMessage,
      vacancies,
      messages,
      contactName,
      replyLanguage,
    });
    if (vacancyIntentPlan) {
      return vacancyIntentPlan;
    }
  }

  const plannerMode = shouldUseOpenClawPlanner() ? 'openclaw' : 'gemini';
  const plannerLabel = plannerMode === 'openclaw' ? getOpenClawPlannerLabel() : GEMINI_MODEL;
  const plannerReady = plannerMode === 'openclaw'
    ? hasOpenClawPlannerPrereqs()
    : Boolean(process.env.GEMINI_API_KEY);

  if (!plannerReady) {
    if (isAgencyConversation) {
      return buildAgencyFallbackResponse({ latestMessage, contactName, replyLanguage });
    }
    if (isArsBot) {
      return buildArsFallbackResponse({ candidate, contactName, replyLanguage, adminProfile });
    }
    return buildFallbackResponse({ candidate, latestMessage, vacancies, messages, contactName, replyLanguage });
  }

  const pendingQuestion = isAgencyConversation || isArsBot ? '' : getPendingQuestion(candidate, replyLanguage);
  const adminInstructionSummary = buildAdminInstructionSummary(adminProfile);
  const assistantBrand = adminInstructionSummary.assistantName;
  const adminInstructionLines = adminInstructionSummary.instructions.length > 0
    ? adminInstructionSummary.instructions.map((line, idx) => `  ${idx + 1}. ${line}`).join('\n')
    : '';
  const coreRulesOverride = String(adminProfile?.coreRules || '').trim();
  const gcgCoreRulesText = coreRulesOverride || DEFAULT_GCG_CORE_RULES;
  const arsCoreRulesText = coreRulesOverride || DEFAULT_ARS_CORE_RULES;
  const promptPayload = {
    adminControls: adminInstructionSummary,
    candidate: isAgencyConversation ? {
      phone,
      name: candidate.name || contactName || '',
      status: candidate.status || '',
      stage: candidate.stage || '',
      notes: candidate.notes || '',
      conversationSummary: candidate.conversationSummary || '',
      isAgency: true,
      replyLanguage: replyLanguage.code,
    } : {
      phone,
      name: candidate.name || contactName || '',
      skill: candidate.skill || '',
      country: candidate.country || '',
      preferredCountry: candidate.preferredCountry || '',
      experience: candidate.experience || '',
      budget: candidate.budget || '',
      budgetPeriod: candidate.budgetPeriod || '',
      status: candidate.status || '',
      stage: candidate.stage || '',
      notes: candidate.notes || '',
      conversationSummary: candidate.conversationSummary || '',
      replyLanguage: replyLanguage.code,
    },
    conversationHints: {
      pendingQuestion,
      lastQuestionAsked,
      latestMessageIsGreeting: isGreetingMessage(latestMessage),
      latestMessageIsLowSignal: isLowSignalMessage(latestMessage),
      repeatedQuestionRecently: Boolean(lastQuestionAsked && withinRecentWindow),
      replyLanguage: replyLanguage.code,
      replyLanguageLabel: replyLanguage.label,
    },
    recentConversation: messages,
    latestMessage,
    activeVacancies: isArsBot ? [] : vacancies,
  };

  const mode = isAgencyConversation ? 'agency' : (isArsBot ? 'ars_casting' : 'candidate');

  const arsSystemPrompt = `
You are ${assistantBrand}, working for AR Studios, a Bollywood film/music production house that runs a free casting portal for actors, writers, directors, VFX/technical crew, and music/lyricist talent. Your planning runtime is ${plannerLabel}. Continue the conversation naturally in the same language and script the user used most recently.

Rules:
- Admin controls override old branding defaults. If admin changed your display name, tone, or operating instructions, follow the latest admin controls below.
- When someone asks your name directly, use the admin-configured assistant name if one exists.
- Remember the prior conversation and do not ask the same thing again if it is already known.
- If this is an early conversation, greet warmly and keep the reply short.
- Match the user's script exactly whenever practical:
  - Arabic or Urdu written in Arabic script -> reply in Arabic script.
  - Hindi written in Devanagari -> reply in Devanagari.
  - English -> reply in English.
  - Roman Urdu/Hinglish -> reply in Roman Urdu/Hinglish.
- Our office contact (share only if asked): Phone ${ARS_DESK_PHONE}, WhatsApp ${ARS_WHATSAPP_PHONE}, Email ${ARS_DESK_EMAIL}, Office ${ARS_OFFICE_ADDRESS}.

${arsCoreRulesText}

- If the user asks for a human callback, raises a complaint, or the reply needs human approval, set adminAssist.needsApproval=true and explain the reason briefly.
- Current admin/owner name is ${adminInstructionSummary.ownerName}.
- Preferred admin language mode is ${adminInstructionSummary.languageMode} (override this if the user clearly writes in a different language). Preferred tone instruction: ${adminInstructionSummary.tone || 'warm, professional, and encouraging'}.
${adminInstructionLines ? `- Additional admin instructions for this bot, listed in PRIORITY ORDER (instruction 1 has the highest priority; apply all of them, and if two ever conflict with each other, the lower-numbered one wins):\n${adminInstructionLines}` : ''}
- Keep the reply under 420 characters.
- Return JSON only.

Current active castings:
${adminInstructionLines || 'No specific casting list provided by admin yet — ask the candidate for their preferred creative field/role so the team can match them once new castings open.'}

Return shape:
{
  "shouldReply": true,
  "replyText": "string",
  "adminAssist": {
    "needsApproval": false,
    "reason": "string",
    "questionForAdmin": "string",
    "suggestedReply": "string"
  },
  "profile": {
    "name": "string",
    "city": "string",
    "age": "string",
    "gender": "male|female|unknown",
    "bot_name": "AR Studios",
    "status": "clean|pending_update|pending_re-profiling",
    "stage": "new|profiling|engaged|qualified",
    "summary": "string",
    "lastQuestionAsked": "string",
    "notes": "string"
  },
  "vacancyLead": {}
}`.trim();

  const systemPrompt = `
You are ${assistantBrand}, working for Gulf Career Gateway's WhatsApp recruitment operations. Your planning runtime is ${plannerLabel}. Continue the conversation naturally in the same language and script the user used most recently.

Rules:
- Admin controls override old branding defaults. If admin changed your display name, tone, or operating instructions, follow the latest admin controls below and do not argue from static identity files.
- If admin says your name/persona has changed, accept it and continue naturally.
- When someone asks your name directly, use the admin-configured assistant name if one exists.
- Remember the prior conversation and do not ask the same thing again if it is already known.
- If this is an early conversation, greet warmly and keep the reply short.
- Match the user's script exactly whenever practical:
  - Arabic or Urdu written in Arabic script -> reply in Arabic script.
  - Hindi written in Devanagari -> reply in Devanagari.
- English -> reply in English.
- Roman Urdu/Hinglish -> reply in Roman Urdu/Hinglish.
- Never reply in Roman Hindi/Urdu when the user's current language is Arabic script.
- ${plannerMode === 'openclaw'
    ? 'OpenClaw is the primary responder. Use web search or web fetch only when it materially improves the reply.'
    : 'Gemini must be the primary responder. Do not fall back to robotic template-style wording unless no other safe option exists.'}
${gcgCoreRulesText}

- Current admin/owner name is ${adminInstructionSummary.ownerName}.
- Preferred admin language mode is ${adminInstructionSummary.languageMode} (Note: If the user requests to talk in English, Hindi, or Arabic, you must override this preferred mode and reply in the user's chosen language). Preferred tone instruction: ${adminInstructionSummary.tone || 'professional and helpful'}.
${adminInstructionLines ? `- Additional admin instructions for this bot, listed in PRIORITY ORDER (instruction 1 has the highest priority; apply all of them together with the rules above, and if two ever conflict with each other, the lower-numbered one wins):\n${adminInstructionLines}` : ''}
- The "Return shape" below is only a type template — never write the literal words "string", "unknown", "null", or a type hint (e.g. "fresh|return|unknown") as an actual field value. Use an empty string "" when you don't have real information for a field.
- Return JSON only.

Return shape:
{
  "shouldReply": true,
  "replyText": "string",
  "adminAssist": {
    "needsApproval": false,
    "reason": "string",
    "questionForAdmin": "string",
    "suggestedReply": "string"
  },
    "profile": {
      "name": "string",
      "skill": "string",
      "country": "string",
      "preferredCountry": "string",
      "budget": "string",
      "budgetPeriod": "monthly|annual|unknown",
      "experience": 0,
      "availability": "string",
      "documentsReady": "string",
      "age": "string",
      "city": "string",
      "workStatus": "fresh|return|unknown",
      "gender": "male|female|unknown",
      "bot_name": "string",
    "status": "clean|pending_update|pending_re-profiling",
    "stage": "new|profiling|engaged|qualified|agency_intake",
    "summary": "string",
    "lastQuestionAsked": "string",
    "notes": "string"
  },
  "vacancyLead": {
    "skill": "string",
    "country": "string",
    "salary": "string",
    "serviceCharge": "string",
    "documents": "string",
    "timeline": "string",
    "quantity": "string",
    "inquiryText": "string"
  }
}`.trim();

  try {
    const finalSystemPrompt = isArsBot ? arsSystemPrompt : systemPrompt;
    const vacancySection = isArsBot
      ? ''
      : `\n\nActive vacancy summary:\n${getVacancySummary(vacancies) || 'No active vacancies provided.'}`;
    const plannerPrompt = `${finalSystemPrompt}\n\nMode: ${mode}${vacancySection}\n\nConversation payload:\n${JSON.stringify(promptPayload)}`;
    const parsed = plannerMode === 'openclaw'
      ? await callOpenClawPlannerJson(
        [{ text: plannerPrompt }],
        { sessionKey: `recruiter-${phone || 'main'}` }
      )
      : await callGeminiJson(
        [{ text: plannerPrompt }],
        { temperature: 0.1 }
      );
    const replyText = sanitizeReply(parsed.replyText || '');
    const profile = sanitizeCandidateProfile({
      existingCandidate: candidate,
      contactName,
      latestMessage,
      messages,
      aiProfile: {
        ...(parsed.profile || {}),
        replyLanguage: parsed.profile?.replyLanguage || replyLanguage.code,
      },
    });

    if (
      lowSignalLatest &&
      withinRecentWindow &&
      lastAutoReplyText &&
      questionLooksRepeated(replyText, lastAutoReplyText)
    ) {
      return {
        shouldReply: false,
        replyText: '',
        profile,
        vacancyLead: parsed.vacancyLead || {},
      };
    }

    if (
      parsed.shouldReply !== false &&
      replyText &&
      !replyMatchesLanguage(replyText, replyLanguage)
    ) {
      if (isAgencyConversation) {
        return lowSignalLatest
          ? buildAgencyGreetingResponse({ contactName, replyLanguage })
          : buildAgencyFallbackResponse({ latestMessage, contactName, replyLanguage });
      }

      if (isArsBot) {
        return buildArsFallbackResponse({ candidate, contactName, replyLanguage, adminProfile });
      }

      const localizedVacancyPlan = buildVacancyInquiryResponse({
        candidate,
        latestMessage,
        vacancies,
        messages,
        contactName,
        replyLanguage,
      });
      if (localizedVacancyPlan) {
        return localizedVacancyPlan;
      }
      return buildFallbackResponse({ candidate, latestMessage, vacancies, messages, contactName, replyLanguage });
    }

    return {
      shouldReply: parsed.shouldReply !== false,
      replyText,
      adminAssist: parsed.adminAssist || {},
      profile,
      vacancyLead: parsed.vacancyLead || {},
    };
  } catch (error) {
    console.warn(`[Candidate Conversation] ${plannerLabel} planning failed, falling back:`, error.message);
    if (lowSignalLatest && withinRecentWindow && lastQuestionAsked) {
      return {
        shouldReply: false,
        replyText: '',
        profile: {
        stage: candidate.stage || (isAgencyConversation ? 'agency_intake' : 'profiling'),
        status: candidate.status || 'pending_update',
        summary: candidate.conversationSummary || '',
        lastQuestionAsked,
        replyLanguage: replyLanguage.code,
      },
      vacancyLead: {},
    };
  }
  if (isAgencyConversation) {
      return buildAgencyFallbackResponse({ latestMessage, contactName, replyLanguage });
  }
    if (isArsBot) {
      return buildArsFallbackResponse({ candidate, contactName, replyLanguage, adminProfile });
    }
    return buildFallbackResponse({ candidate, latestMessage, vacancies, messages, contactName, replyLanguage });
  }
}

function mergeCandidateUpdates(existingCandidate, contactName, profile = {}, extraData = {}) {
  const safeProfile = sanitizeCandidateProfile({
    existingCandidate,
    contactName,
    latestMessage: profile.notes || '',
    messages: [],
    aiProfile: profile,
  });
  const inferredSkill = inferSkillFromText(safeProfile.notes || '') || null;
  const preferredCountry =
    safeProfile.preferredCountry ||
    existingCandidate.preferredCountry ||
    safeProfile.country ||
    existingCandidate.country ||
    'Unspecified';
  const experience = parseExperience(safeProfile.experience);
  const budgetPeriod = safeProfile.budgetPeriod || inferBudgetPeriod(safeProfile.notes || '') || existingCandidate.budgetPeriod || '';
  const replyLanguage = safeProfile.replyLanguage || existingCandidate.replyLanguage || 'roman';

  const updates = {
    name: safeProfile.name || sanitizeCandidateName(existingCandidate.name || '') || sanitizeCandidateName(contactName || '') || getFallbackCandidateName(existingCandidate.phone),
    phone: existingCandidate.phone,
    skill: safeProfile.skill || normalizeCandidateSkill(existingCandidate.skill || '', existingCandidate.notes || '') || inferredSkill || 'General',
    country: safeProfile.country || normalizeCandidateCountry(existingCandidate.country || '', existingCandidate.notes || '') || 'Unspecified',
    preferredCountry,
    budget: safeProfile.budget || existingCandidate.budget || '',
    budgetPeriod,
    availability: safeProfile.availability || existingCandidate.availability || '',
    documentsReady: safeProfile.documentsReady || existingCandidate.documentsReady || '',
    experience: experience !== null ? experience : (existingCandidate.experience ?? ''),
    conversationSummary: safeProfile.summary || existingCandidate.conversationSummary || '',
    notes: safeProfile.notes || existingCandidate.notes || '',
    lastQuestionAsked: safeProfile.lastQuestionAsked || existingCandidate.lastQuestionAsked || '',
    stage: safeProfile.stage || existingCandidate.stage || 'profiling',
    status: safeProfile.status || existingCandidate.status || 'pending_re-profiling',
    replyLanguage,
    age: (isUsableFreeTextValue(safeProfile.age) ? safeProfile.age : '') || existingCandidate.age || '',
    city: (isUsableFreeTextValue(safeProfile.city) ? safeProfile.city : '') || existingCandidate.city || '',
    workStatus: (isUsableFreeTextValue(safeProfile.workStatus) ? safeProfile.workStatus : '') || existingCandidate.workStatus || '',
    gender: safeProfile.gender || existingCandidate.gender || 'unknown',
    bot_name: safeProfile.bot_name || existingCandidate.bot_name || extraData.businessAccountName || '',
    lastRecipientPhone: extraData.recipientPhone || existingCandidate.lastRecipientPhone || '',
    lastRecipientPhoneId: extraData.recipientPhoneId || existingCandidate.lastRecipientPhoneId || '',
    phoneNumberId: extraData.recipientPhoneId || existingCandidate.phoneNumberId || existingCandidate.lastRecipientPhoneId || '',
    // Explicit channel label ('whatsapp' | 'messenger' | 'instagram') so the
    // dashboard/mobile app can badge and filter conversations by channel
    // without needing to infer it from phoneNumberId on every read.
    channel: extraData.channel || existingCandidate.channel || 'whatsapp',
    wabaId: extraData.wabaId || existingCandidate.wabaId || '',
    businessAccountName: extraData.businessAccountName || existingCandidate.businessAccountName || '',
    updatedAt: new Date().toISOString(),
    lastInboundAt: new Date().toISOString(),
  };

  return updates;
}

async function ensureCandidateRecord(phone, contactName, profile = {}, extraData = {}) {
  const existingCandidate = await findCandidateByPhone(phone);
  const normalizedPhone = normalizePhone(phone);

  if (existingCandidate) {
    const updates = mergeCandidateUpdates({
      ...existingCandidate,
      phone: existingCandidate.phone || normalizedPhone,
    }, contactName, profile, extraData);
    await rtdbUpdate(`candidates/${existingCandidate.id}`, updates);
    return { id: existingCandidate.id, ...existingCandidate, ...updates };
  }

  const newCandidate = mergeCandidateUpdates({
    phone: normalizedPhone,
    skill: 'General',
    country: 'Unspecified',
    experience: '',
    status: 'pending_re-profiling',
    stage: 'new',
  }, contactName, profile, extraData);
  newCandidate.createdAt = new Date().toISOString();

  const id = await rtdbPush('candidates', newCandidate);
  return { id, ...newCandidate };
}

async function recordOutboundMessage(phone, body, sendResult, channel = 'whatsapp') {
  const timestamp = new Date().toISOString();
  const firebaseKey = await rtdbPush(`messages/${phone}`, {
    from: 'AI_AGENT',
    to: phone,
    body,
    wamId: sendResult.messageId || null,
    direction: 'outbound',
    timestamp,
    status: sendResult.success ? 'sent' : 'failed',
    error: sendResult.error || null,
  });

  await appendChatLog({
    phone,
    message: body,
    direction: 'OUTBOUND',
    timestamp,
    channel,
  });

  if (sendResult.success && sendResult.messageId) {
    await rtdbSet(`message_map/${safeFirebaseKey(sendResult.messageId)}`, {
      phone,
      firebaseKey,
    });
  }

  await publishDashboardMessageEvent({
    phone,
    kind: 'outbound',
    status: sendResult.success ? 'sent' : 'failed',
    body,
    messageId: sendResult.messageId || '',
  });
}

async function storeConversationMemory(phone, memory = {}) {
  await rtdbSet(`candidate_memory/${phone}`, {
    ...memory,
    phone,
    updatedAt: new Date().toISOString(),
  });
}

async function storeAgencyLead(phone, candidate, vacancyLead = {}, latestMessage = '') {
  if (!candidate?.isAgency) return;

  const normalizedInquiry = String(vacancyLead.inquiryText || latestMessage || '').trim();
  if (!normalizedInquiry) return;

  const existingInbox = await rtdbGetAll('agency_inbox');
  const recentDuplicate = (existingInbox || []).find(item => {
    const samePhone = normalizePhone(item.phone || item.agencyPhone || '') === phone;
    const sameText = String(item.inquiryText || '').trim() === normalizedInquiry;
    const updatedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return samePhone && sameText && updatedAt && Date.now() - updatedAt < 2 * 60 * 1000;
  });

  if (recentDuplicate) return;

  const leadPayload = {
    phone,
    agencyPhone: phone,
    candidateId: candidate.id,
    agencyName: candidate.name || '',
    inquiryText: normalizedInquiry,
    skill: vacancyLead.skill || inferSkillFromText(latestMessage || ''),
    country: vacancyLead.country || inferCountryFromText(latestMessage || '') || '',
    salary: vacancyLead.salary || '',
    serviceCharge: vacancyLead.serviceCharge || '',
    documents: vacancyLead.documents || '',
    timeline: vacancyLead.timeline || '',
    quantity: vacancyLead.quantity || '',
    sourceType: vacancyLead.sourceType || 'text',
    originalForm: normalizedInquiry,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await rtdbPush('agency_inbox', leadPayload);

  if (shouldAutoProcessAgencyLead(leadPayload)) {
    try {
      await ingestAgencyVacancy({
        agencyId: candidate.id || phone,
        agencyPhone: phone,
        agencyName: candidate.name || '',
        rawText: normalizedInquiry,
        details: {
          skill: leadPayload.skill,
          country: leadPayload.country,
          salary: leadPayload.salary,
          serviceCharge: leadPayload.serviceCharge,
          documents: leadPayload.documents,
          timeline: leadPayload.timeline,
          quantity: leadPayload.quantity,
        },
        sourceType: leadPayload.sourceType || 'text',
        allowBroadcast: true,
      });
    } catch (error) {
      console.warn('[Candidate Conversation] Agency text vacancy auto-ingest failed:', error.message);
    }
  }
}

// QA test numbers: every inbound message from these phones is always treated as fresh — none
// of the duplicate/cooldown suppression below applies. Add/remove numbers here as needed while
// testing a live flow end-to-end (normalized, no leading "91" needed or not, either works).
const TEST_MODE_PHONES = new Set(['919149196972', '9149196972']);

async function shouldSkipAutoReply(phone, messageId, body, existingMemory) {
  if (TEST_MODE_PHONES.has(normalizePhone(phone))) {
    return false;
  }

  if (messageId) {
    const seen = await rtdbGet(`processed_inbound/${safeFirebaseKey(messageId)}`);
    if (seen) return true;
  }

  const lastReplyAt = existingMemory?.lastAutoReplyAt ? new Date(existingMemory.lastAutoReplyAt).getTime() : 0;
  const lastInboundBody = String(existingMemory?.lastInboundMessage || '').trim().toLowerCase();
  const lastQuestionAsked = String(existingMemory?.lastQuestionAsked || '').trim();
  const lastAutoReplyText = String(existingMemory?.lastAutoReplyText || '').trim();
  const now = Date.now();
  const normalizedBody = String(body || '').trim().toLowerCase();
  const latestLooksLikeMedia = /^\[(image|voice note|video|document|media)\]/i.test(String(body || '').trim());
  const lastInboundLooksLikeMedia = /^\[(image|voice note|video|document|media)\]/i.test(lastInboundBody);

  if (
    normalizedBody &&
    lastInboundBody &&
    normalizedBody === lastInboundBody &&
    lastReplyAt &&
    now - lastReplyAt < 90 * 1000
  ) {
    return true;
  }

  if (
    normalizedBody &&
    (isLowSignalMessage(normalizedBody) || isGreetingMessage(normalizedBody)) &&
    lastReplyAt &&
    now - lastReplyAt < 20 * 60 * 1000 &&
    (lastQuestionAsked || lastAutoReplyText)
  ) {
    return true;
  }

  if (
    latestLooksLikeMedia &&
    lastInboundLooksLikeMedia &&
    lastReplyAt &&
    now - lastReplyAt < 90 * 1000
  ) {
    return true;
  }

  return false;
}

async function markInboundProcessed(messageId, phone, body) {
  if (!messageId) return;
  await rtdbSet(`processed_inbound/${safeFirebaseKey(messageId)}`, {
    phone,
    body: body || '',
    processedAt: new Date().toISOString(),
  });
}

async function handleCandidateConversation({
  from,
  name,
  body,
  type = 'text',
  mediaId = '',
  mediaUrl = '',
  mimeType = '',
  fileName = '',
  inboundStored = false,
  messageId = '',
  identityTag = 'CANDIDATE',
  recipientPhone = '',
  recipientPhoneId = '',
  wabaId = '',
  businessAccountName = '',
  channel = 'whatsapp',
}) {
  const phone = normalizePhone(from);
  if (!phone) {
    return { success: false, reason: 'INVALID_PHONE' };
  }

  return withPhoneConversationLock(phone, async () => {

  const storedMemory = await rtdbGet(`candidate_memory/${phone}`);
  if (await shouldSkipAutoReply(phone, messageId, body, storedMemory)) {
    await markInboundProcessed(messageId, phone, body);
    return { success: true, replied: false, skipped: 'duplicate_or_cooldown' };
  }

  if (!inboundStored) {
    await rtdbPush(`messages/${phone}`, {
      from: phone,
      body: body || '',
      type,
      mediaId: mediaId || null,
      mediaUrl: mediaUrl || null,
      mimeType: mimeType || null,
      fileName: fileName || null,
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      messageId: messageId || null,
      phoneNumberId: recipientPhoneId || null,
      wabaId: wabaId || null,
      receivedOnPhone: recipientPhone || null,
      businessAccountName: businessAccountName || null,
    });
  }

  const [existingCandidate, messages] = await Promise.all([
    findCandidateByPhone(phone),
    getConversationContext(phone),
  ]);
  const [control, adminProfile] = await Promise.all([
    getConversationControl(phone),
    getAdminAiProfileForNumber(recipientPhone || recipientPhoneId),
  ]);

  const vacancies = await getRelevantVacancies(existingCandidate || {}, body || '', messages, recipientPhone);
  const isAgencyConversation = identityTag === 'AGENCY' || existingCandidate?.isAgency === true || storedMemory?.agencyMode === true;

  if (!isAgencyConversation && mediaId) {
    forwardCandidateMediaToAdmin({
      phone,
      candidateName: existingCandidate?.name || name || '',
      type,
      mediaId,
      mimeType,
      fileName,
      channel,
    }).catch((err) => console.error(`[Media Forward] Unexpected error for ${phone}:`, err.message));
  }

  const candidateContext = {
    ...(existingCandidate || {}),
    ...(storedMemory || {}),
    isAgency: isAgencyConversation,
    botType: adminProfile.botType || 'GCG',
  };

  const plan = await generateAiConversationPlan({
    phone,
    contactName: name,
    candidate: candidateContext,
    messages,
    vacancies,
    latestMessage: body || '',
    adminProfile,
  });

  const candidate = await ensureCandidateRecord(phone, name, plan.profile || {}, {
    recipientPhone,
    recipientPhoneId,
    wabaId,
    businessAccountName,
    channel,
  });

  // Hard Filter for Gender & Eligibility (AR Studios music video workflow -> Male)
  const isMale = (candidate.gender === 'male' || isMaleName(candidate.name) || isMaleName(name));
  const isARStudios = (adminProfile.botType === 'ARS' || candidate.botType === 'ARS' || candidate.bot_name === 'AR Studios' || plan.profile?.bot_name === 'AR Studios' || String(body).toLowerCase().includes('ar studios') || String(body).toLowerCase().includes('music video'));

  if (isARStudios && isMale) {
    console.log(`[Gender Hard Filter] Routing Male candidate ${candidate.name} (${phone}) to backup talent database`);
    
    // Save directly to backup talent database
    const backupData = {
      id: candidate.id || phone,
      phone,
      name: candidate.name || name,
      gender: 'male',
      bot_name: 'AR Studios',
      botType: 'ARS',
      routedAt: new Date().toISOString(),
    };
    await rtdbSet(`backup_talent/${phone}`, backupData);

    // Remove from active candidate list/funnel
    if (candidate.id) {
      const adminInstance = require('firebase-admin');
      await adminInstance.database().ref(`candidates/${candidate.id}`).remove();
    }

    const replyLanguage = detectReplyLanguage({ latestMessage: body, messages, candidate });
    const replyText = pickLocalizedCopy(replyLanguage, {
      ar: `تمت إضافة ملفك الشخصي إلى قاعدة بيانات المواهب الاحتياطية. شكرًا لك.`,
      hi: `आपका प्रोफाइल बैकअप टैलेंट डेटाबेस में जोड़ दिया गया है। धन्यवाद।`,
      en: `Your profile has been added to the backup talent database. Thank you.`,
      roman: `Aapka profile backup talent database mein save kar diya gaya hai. Thank you.`,
    });
    
    await sendChannelMessage(channel, phone, replyText, recipientPhoneId || recipientPhone);
    await recordOutboundMessage(phone, replyText, { success: true }, channel);

    // Pause/stop conversation control block
    await rtdbUpdate(`conversation_control/${phone}`, { autoReplyPaused: true });
    await markInboundProcessed(messageId, phone, body);
    
    return { success: true, replied: true, skipped: 'backup_talent_routing' };
  }

  await rtdbUpdate(`candidates/${candidate.id}`, {
    unreadCount: Number(candidate.unreadCount || 0) + 1,
    lastInboundPreview: String(body || '').slice(0, 140),
  });
  await publishDashboardMessageEvent({
    phone,
    kind: 'inbound',
    status: 'received',
    body,
    messageId: messageId || '',
  });
  await storeConversationMemory(phone, {
    candidateId: candidate.id,
    conversationSummary: plan.profile?.summary || candidate.conversationSummary || '',
    lastQuestionAsked: plan.profile?.lastQuestionAsked || '',
    stage: plan.profile?.stage || candidate.stage || 'profiling',
    lastInboundMessage: body || '',
    latestVacancyIds: vacancies.map(v => v.id),
    agencyMode: isAgencyConversation,
    replyLanguage: plan.profile?.replyLanguage || candidate.replyLanguage || candidateContext.replyLanguage || 'roman',
  });
  await storeAgencyLead(phone, candidate, plan.vacancyLead || {}, body || '');

  if (control?.autoReplyPaused) {
    await markInboundProcessed(messageId, phone, body);
    return { success: true, replied: false, candidateId: candidate.id, skipped: 'admin_paused' };
  }

  if (control?.pendingApproval?.active) {
    await markInboundProcessed(messageId, phone, body);
    return { success: true, replied: false, candidateId: candidate.id, skipped: 'pending_admin_approval' };
  }

  const adminEscalation = plan.skipAdminEscalation
    ? { needsApproval: false, reason: '', questionForAdmin: '', suggestedReply: '' }
    : shouldEscalateToAdminApproval({
        latestMessage: body || '',
        replyText: plan.replyText,
        isAgencyConversation,
        adminAssist: plan.adminAssist || {},
      });

  if (adminEscalation.needsApproval) {
    await queueAdminApprovalRequest({
      phone,
      candidateName: candidate.name || name || '',
      latestMessage: body || '',
      suggestedReply: adminEscalation.suggestedReply || plan.replyText,
      reason: adminEscalation.reason || '',
      questionForAdmin: adminEscalation.questionForAdmin || '',
      identityTag,
    });
    await markInboundProcessed(messageId, phone, body);
    return {
      success: true,
      replied: false,
      candidateId: candidate.id,
      skipped: 'awaiting_admin_approval',
    };
  }

  if (!plan.shouldReply || !plan.replyText) {
    await markInboundProcessed(messageId, phone, body);
    return { success: true, replied: false, candidateId: candidate.id };
  }

  const sendResult = await sendChannelMessage(channel, phone, plan.replyText, recipientPhoneId || recipientPhone);
  await recordOutboundMessage(phone, plan.replyText, sendResult, channel);
  await appendAgentOutputLog({
    phone,
    task: isAgencyConversation ? 'agency_auto_reply' : 'candidate_auto_reply',
    title: candidate.skill || candidate.preferredCountry || 'auto reply',
    content: plan.replyText,
    source: getOpenClawPlannerLabel() || 'ai',
    metadata: plan.profile?.stage ? `stage=${plan.profile.stage}` : '',
  });
  await storeConversationMemory(phone, {
    ...(storedMemory || {}),
    candidateId: candidate.id,
    conversationSummary: plan.profile?.summary || candidate.conversationSummary || '',
    lastQuestionAsked: plan.profile?.lastQuestionAsked || '',
    stage: plan.profile?.stage || candidate.stage || 'profiling',
    lastInboundMessage: body || '',
    latestVacancyIds: vacancies.map(v => v.id),
    lastAutoReplyAt: new Date().toISOString(),
    lastAutoReplyText: plan.replyText,
    agencyMode: isAgencyConversation,
    replyLanguage: plan.profile?.replyLanguage || candidate.replyLanguage || candidateContext.replyLanguage || 'roman',
  });
  await markInboundProcessed(messageId, phone, body);

  // Auto-dispatch candidate details to coordinator at the end of profiling flow
  const updatedMissingFields = getMissingCandidateFields(candidate);
  if (updatedMissingFields.length === 0 && !candidate.dispatchedToCoordinator) {
    console.log(`[Auto Dispatch] Profiling complete for candidate ${candidate.name} (${phone}). Dispatching to senior coordinator.`);
    
    const age = candidate.age || 'Not specified';
    const city = candidate.city || candidate.currentLocation || candidate.preferredCountry || 'Not specified';
    const photos = [];
    if (candidate.photoLink) photos.push(candidate.photoLink);
    if (candidate.photoUrl) photos.push(candidate.photoUrl);
    
    const dispatchPayload = {
      candidateId: candidate.id,
      name: candidate.name,
      phone: candidate.phone,
      age,
      city,
      photos,
      timestamp: new Date().toISOString(),
    };

    // Save to coordinator_dispatches in Firebase RTDB
    await rtdbSet(`coordinator_dispatches/${phone}`, dispatchPayload);

    // Update candidate flag
    await rtdbUpdate(`candidates/${candidate.id}`, { dispatchedToCoordinator: true });

    // Publish dashboard event
    await publishDashboardMessageEvent({
      phone,
      kind: 'dispatch',
      status: 'dispatched',
      body: `[AUTO DISPATCH] Extracted Summary for Senior Coordinator:\nName: ${candidate.name}\nAge: ${age}\nCity: ${city}\nPhotos: ${photos.length ? 'Attached' : 'None'}`,
      messageId: `dispatch-${Date.now()}`,
    });

    // The candidate was previously only told "your profile has been sent to
    // our coordinator" while nothing actually reached a human — this was the
    // core "deal closed but admin never finds out" gap. Send a real WhatsApp
    // message to every admin number now.
    const adminSummary = [
      `[PROFILING COMPLETE] Candidate ready for follow-up:`,
      `Name: ${candidate.name || 'Unknown'}`,
      `Phone: ${phone}`,
      `Skill: ${candidate.skill || 'Not specified'}`,
      `Country: ${candidate.preferredCountry || candidate.country || 'Not specified'}`,
      `Age: ${age}`,
      `City: ${city}`,
      `Work status: ${candidate.workStatus || 'Not specified'}`,
      `Documents ready: ${candidate.documentsReady || 'Not specified'}`,
      photos.length ? `Photos: ${photos.join(', ')}` : '',
      `Chat: whatsapp.com/send?phone=${phone}`,
    ].filter(Boolean).join('\n');
    notifyAdmins(adminSummary).catch((err) => console.error(`[Auto Dispatch] Failed to notify admins for ${phone}:`, err.message));

    const replyLanguage = detectReplyLanguage({ latestMessage: body, messages, candidate });
    const dispatchMsg = pickLocalizedCopy(replyLanguage, {
      ar: `تم إرسال بياناتك تلقائيًا إلى المنسق الأول لدينا. سيتصلون بك مباشرة قريبًا. للتواصل المباشر: ${GCC_DESK_PHONE}.`,
      hi: `आपका प्रोफाइल विवरण हमारे सीनियर कोऑर्डिनेटर को भेज दिया गया है। वे जल्द ही आपसे सीधे संपर्क करेंगे। सीधे संपर्क के लिए: ${GCC_DESK_PHONE}.`,
      en: `Your profile details have been automatically sent to our senior coordinator. They will contact you directly soon. For direct contact: ${GCC_DESK_PHONE}.`,
      roman: `Aapki profile details automatically hamare senior coordinator ko dispatch kar di gayi hain. Woh jald hi aapse directly contact karenge. Direct contact ke liye: ${GCC_DESK_PHONE}.`,
    });

    await sendChannelMessage(channel, phone, dispatchMsg, recipientPhoneId || recipientPhone);
    await recordOutboundMessage(phone, dispatchMsg, { success: true }, channel);
    
    await storeConversationMemory(phone, {
      ...(storedMemory || {}),
      lastQuestionAsked: '',
      lastAutoReplyText: dispatchMsg,
      lastAutoReplyAt: new Date().toISOString(),
    });
  }

  return {
    success: sendResult.success,
    replied: sendResult.success,
    candidateId: candidate.id,
    replyText: plan.replyText,
    error: sendResult.error || null,
  };
  });
}

module.exports = {
  handleCandidateConversation,
  normalizePhone,
  findCandidateByPhone,
};
