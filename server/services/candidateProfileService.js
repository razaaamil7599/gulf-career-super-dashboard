const NAME_PROMPT_GARBAGE_PATTERNS = [
  /only if clearly stated/i,
  /not generic words/i,
  /person'?s real first/i,
  /first\+last name/i,
  /generic words like/i,
  /real first last name/i,
];

const GENERIC_NAME_PATTERNS = [
  /^candidate$/i,
  /^user\s*\d+$/i,
  /^unknown$/i,
  /^name$/i,
  /^hello$/i,
  /^hi$/i,
  /^ok$/i,
  /^okay$/i,
  /^bhai$/i,
  /^sir$/i,
  /^madam$/i,
  /^customer$/i,
  /^assalam(?:u)?\s*alaikum$/i,
  /^walaikum(?:u)?\s*assalam$/i,
  /^salam$/i,
  /^hello\s*sir$/i,
  /^send\s*kero$/i,
  /^ok\s*send$/i,
  /^eng$/i,
  /^kk$/i,
  /^r$/i,
  /^g$/i,
  /^haan$/i,
  /^haa$/i,
  /^ha$/i,
  /^yes$/i,
  /^no$/i,
  /^kitna\s*h$/i,
  /^samajh\s*raha$/i,
  /^thank\s*you(?:\s*very\s*much)?$/i,
  /^where\s*are\s*you\s*now$/i,
  /^more\s*details\s*please$/i,
  /^kar\s*do$/i,
  /^details?\s*bto$/i,
  /^website\s*is\s*not\s*working$/i,
  /^paisa\s*kitna\s*dena\s*hoga$/i,
  /^abhi\s*mulakat\s*hogi\s*sar$/i,
  /^mtlb\s*do\s*report\s*chaiye$/i,
  /^aapko\s*(details?|information|process|batata|bhejta|de\s*sakta)/i,
  /^aapki\s*madad\s*kar\s*sakta/i,
];

const NAME_STOP_WORDS = new Set([
  'string', 'unknown', 'null', 'undefined', 'none', 'na', 'nil', 'empty', 'unspecified',
  'aap', 'ap', 'app', 'main', 'mai', 'mera', 'meri', 'mere', 'hum', 'ham', 'me', 'my',
  'naam', 'name', 'hello', 'hi', 'hii', 'hey', 'ok', 'okay', 'haan', 'haa', 'han', 'yes', 'no',
  'sir', 'madam', 'bhai', 'ji', 'customer', 'candidate',
  'jana', 'chahta', 'chahti', 'liye', 'liya', 'ke', 'ki', 'ka', 'hai', 'hu', 'hun', 'ho',
  'send', 'kero', 'karo', 'call', 'office', 'address', 'visa', 'salary', 'budget', 'country',
  'location', 'experience', 'documents', 'document', 'passport', 'cv', 'ready',
  'driver', 'labour', 'helper', 'cleaner', 'job', 'work', 'vacancy', 'opening',
  'assalam', 'walaikum', 'salam', 'walekum', 'khaha', 'hua', 'batao',
  'interested', 'interest', 'hindi', 'english', 'arabic', 'urdu',
  'khidmat', 'khudmat', 'haj', 'hajj', 'indoor', 'saudi', 'dubai', 'return', 'fresh',
  'online', 'agree', 'okayyy', 'okey', 'okk', 'okk', 'helloji',
  'aapki', 'aapko', 'madad', 'sakta', 'sakti', 'kar', 'karta', 'karti',
  'detail', 'details', 'bhejta', 'bhejo', 'de', 'denge', 'saktahu',
  'kitna', 'samajh', 'raha', 'rahahai', 'where', 'are', 'you', 'now',
  'more', 'please', 'thank', 'very', 'much', 'information', 'process',
  'mulakat', 'report', 'reports', 'chaiye', 'hoga', 'working', 'website',
  'free', 'requirement', 'vaisa', 'bto', 'batata', 'bhejta', 'bhejdo',
  'service', 'charge', 'office', 'time', 'notice', 'period',
  'current', 'location', 'expected', 'salary', 'budget', 'reply',
  'intro', 'video', 'kindly', 'share', 'contact', 'number',
  'ghar', 'gharakaam', 'house', 'company', 'visa',
  'h', 'haii', 'rahe', 'rahi', 'raho', 'rahahu', 'rahahu',
  // Frustrated/filler replies that a candidate sends when the bot re-asks the same
  // question — these are plain-looking (letters only, short) and were getting
  // accepted as a "name" by the direct-answer fallback path. See memory:
  // feedback on the repeat-loop bug this masked.
  'baar', 'bhejiye', 'bhejye', 'bolo', 'bola', 'bolu', 'boliya', 'boliye', 'boliyea',
  'bolye', 'bataye', 'batao', 'batayen', 'batayiye', 'hlo', 'hllo', 'hy', 'hii', 'kam',
  'acha', 'accha', 'kya', 'kyu', 'kyun', 'apko', 'alone', 'ms', 'pk', 'sund', 'any',
  'updates', 'update', 'from', 'mumbai', 'delhi', 'or', 'and', 'loading', 'unloading',
  'aur', 'group', 'rrr', 'gaming', 'endup', 'ziddi', 'boy', 'aqua', 'pure', 'alison',
  'nothing', 'kuch', 'nahi', 'nhi', 'bhi', 'toh', 'to', 'q', 'kaha', 'kahan', 'kidhar',
]);

const SKILL_RULES = [
  { label: 'House Driver', patterns: [/\bhouse\s+driver\b/i] },
  { label: 'Company Driver', patterns: [/\bcompany\s+driver\b/i] },
  { label: 'Driver', patterns: [/\bdriver\b/i, /\bdriving license\b/i] },
  { label: 'Hajj Khidmat Labour', patterns: [/\bhaj+j?\s*khidmat\b/i, /\bhajj?\s*labou?r\b/i] },
  { label: 'Indoor Labour', patterns: [/\bindoor\s+labou?r\b/i] },
  { label: 'General Labour', patterns: [/\bgeneral\s+labou?r\b/i, /\blabou?r\b/i] },
  { label: 'Kitchen Helper', patterns: [/\bkitchen\s+helper\b/i, /\bkitchen\s+helpers\b/i] },
  { label: 'Storekeeper', patterns: [/\bstore\s*keeper\b/i, /\bstorekeeper\b/i] },
  { label: 'Load/Unload', patterns: [/\bload\s*\/?\s*unload\b/i, /\bloading\s*unloading\b/i] },
  { label: 'Cleaner', patterns: [/\bcleaner\b/i, /\bcleaning\b/i, /\bhousekeeping\b/i] },
  { label: 'Security Guard', patterns: [/\bsecurity\s+guard\b/i] },
  { label: 'Cook', patterns: [/\bcook\b/i, /\bchef\b/i, /\bcommi\b/i, /\bpastry\b/i] },
  { label: 'Counter Salesman', patterns: [/\bcounter\s+sales(?:man)?\b/i] },
  { label: 'Salesman', patterns: [/\bsales\s*man\b/i, /\bsalesman\b/i, /\bsales\b/i] },
  { label: 'Cashier', patterns: [/\bcashier\b/i, /\bcash\s+counter\b/i] },
  { label: 'Office Boy', patterns: [/\boffice\s+boy\b/i] },
  { label: 'Tea Boy', patterns: [/\btea\s+boy\b/i, /\bt\s*boy\b/i] },
  { label: 'Packing Helper', patterns: [/\bpacking\s+helper\b/i, /\bpacking\b/i] },
  { label: 'Delivery Boy', patterns: [/\bdelivery\s+boy\b/i] },
  { label: 'Warehouse Helper', patterns: [/\bwarehouse\b/i, /\bwearhouse\b/i] },
  { label: 'Tailor', patterns: [/\btailor(?:ing)?\b/i] },
  { label: 'Barista', patterns: [/\bbarista\b/i, /\bcoffee\s+maker\b/i] },
  { label: 'Data Entry Operator', patterns: [/\bdata\s+entry\b/i] },
  { label: 'Computer Operator', patterns: [/\bcomputer\s+operator\b/i] },
  { label: 'CCTV Technician', patterns: [/\bcctv\b/i] },
  { label: 'Fire Alarm Technician', patterns: [/\bfire\s+alarm\b/i] },
  { label: 'HVAC Technician', patterns: [/\bhvac\b/i] },
  { label: 'AC Technician', patterns: [/\bac\s+technician\b/i, /\bac tech\b/i] },
  { label: 'Electrician', patterns: [/\belectrician\b/i] },
  { label: 'Plumber', patterns: [/\bplumber\b/i] },
  { label: 'Welder', patterns: [/\bwelder\b/i] },
  { label: 'Mason', patterns: [/\bmason\b/i] },
  { label: 'Carpenter', patterns: [/\bcarpenter\b/i] },
  { label: 'Painter', patterns: [/\bpainter\b/i] },
  { label: 'Mechanic', patterns: [/\bmechanic\b/i] },
  { label: 'Tiler', patterns: [/\btiler\b/i] },
  { label: 'Fabricator', patterns: [/\bfabricator\b/i] },
  { label: 'Helper', patterns: [/\bhelper\b/i] },
];

const COUNTRY_RULES = [
  { label: 'Saudi Arabia', patterns: [/\bsaudi\b/i, /\bksa\b/i, /\briyadh\b/i, /\bjeddah\b/i, /\bmakkah\b/i, /\bmadina\b/i] },
  { label: 'UAE', patterns: [/\buae\b/i, /\bdubai\b/i, /\babu\s*dhabi\b/i] },
  { label: 'Qatar', patterns: [/\bqatar\b/i, /\bdoha\b/i] },
  { label: 'Kuwait', patterns: [/\bkuwait\b/i] },
  { label: 'Oman', patterns: [/\boman\b/i, /\bmuscat\b/i] },
  { label: 'Bahrain', patterns: [/\bbahrain\b/i] },
  { label: 'Germany', patterns: [/\bgermany\b/i] },
  { label: 'Poland', patterns: [/\bpoland\b/i] },
  { label: 'India', patterns: [/\bindia\b/i, /\bmumbai\b/i, /\bdelhi\b/i, /\bup\b/i, /\buttar pradesh\b/i] },
];

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toTitleCase(value = '') {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function stripOuterQuotes(value = '') {
  return String(value || '')
    .replace(/^["'`“”‘’]+/, '')
    .replace(/["'`“”‘’]+$/, '')
    .trim();
}

function looksLikeRoleOrVacancyText(value = '') {
  const text = normalizeWhitespace(stripOuterQuotes(value)).toLowerCase();
  if (!text) return false;
  return /(visa|vacancy|salary|duty|food|service charge|sc\b|office|address|contact|video|passport|document|documents|cv|reply|country|location|experience|fresh|return|duty|hours|mode of selection|kafil|sponsor)/i.test(text)
    || looksLikeSkillText(text);
}

function looksLikeSkillText(value = '') {
  const normalized = normalizeWhitespace(value);
  return SKILL_RULES.some((rule) => rule.patterns.some((pattern) => pattern.test(normalized)));
}

function normalizeSkill(value = '', fallbackText = '') {
  const source = normalizeWhitespace(`${value} ${fallbackText}`);
  if (!source) return '';

  for (const rule of SKILL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(source))) {
      return rule.label;
    }
  }

  return '';
}

function normalizeCountry(value = '', fallbackText = '') {
  const source = normalizeWhitespace(`${value} ${fallbackText}`);
  if (!source) return '';

  for (const rule of COUNTRY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(source))) {
      return rule.label;
    }
  }
  return '';
}

function getFallbackCandidateName(phone = '') {
  const digits = normalizePhone(phone);
  if (!digits) return 'User';
  return `User ${digits.slice(-4)}`;
}

function looksLikeNamePlaceholder(value = '') {
  const text = normalizeWhitespace(stripOuterQuotes(value));
  if (!text) return true;
  if (NAME_PROMPT_GARBAGE_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(text))) return true;
  if (/\d{4,}/.test(text)) return true;
  if (text.length > 48) return true;
  if (text.split(' ').length > 5) return true;
  if (/[@:/\\[\]{}()]/.test(text)) return true;
  if (looksLikeRoleOrVacancyText(text)) return true;
  return false;
}

function sanitizeCandidateName(value = '') {
  const text = normalizeWhitespace(stripOuterQuotes(value));
  if (looksLikeNamePlaceholder(text)) return '';
  // A bare "." or "-" matches the character class below (letters, marks, spaces,
  // period/apostrophe/hyphen) but has no actual letters — reject those outright
  // instead of accepting punctuation-only text as someone's name.
  if (!/\p{L}/u.test(text)) return '';
  if (/^[\p{L}\p{M}\s.'-]+$/u.test(text)) {
    // South Asian/Gulf full names routinely run 4 words (e.g. "Md Amair Ali Khan"),
    // so a 3-word cap was rejecting genuinely correct answers. 5 still blocks
    // full sentences from being mistaken for a name.
    if (text.split(' ').length > 5) return '';
    if (/[A-Za-z]/.test(text)) {
      const tokens = text
        .toLowerCase()
        .split(/\s+/)
        .map((token) => token.replace(/[^a-z]/g, ''))
        .filter(Boolean);
      if (tokens.some((token) => NAME_STOP_WORDS.has(token))) return '';
      return toTitleCase(text);
      }
      return text;
    }
  return '';
}

function outboundAskedForName(messages = [], index = -1) {
  for (let offset = 1; offset <= 2; offset += 1) {
    const previous = messages[index - offset];
    if (!previous) break;
    if (String(previous.direction || '').toLowerCase() !== 'outbound') continue;
    const body = normalizeWhitespace(previous.body || '');
    if (/(what is your full name|full name|poora naam|पूरा नाम|پورا نام|aapka naam|apka naam|your name)/i.test(body)) {
      return true;
    }
  }
  return false;
}

function findNameCandidateInText(text = '', { allowDirect = false } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const patterns = [
    /\bmy name is\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bname is\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bi am\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bi'm\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bthis is\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bmera naam\s+([A-Za-z][A-Za-z .'-]{1,40})/i,
    /\bmain\s+([A-Za-z][A-Za-z .'-]{1,40})\s+hu/i,
    /\bmai\s+([A-Za-z][A-Za-z .'-]{1,40})\s+hu/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const candidateName = sanitizeCandidateName(match?.[1] || '');
    if (candidateName) return candidateName;
  }

  if (allowDirect) {
    const directName = sanitizeCandidateName(raw);
    if (directName && directName.length <= 32) return directName;
  }

  return '';
}

function pickBestName({ aiName = '', contactName = '', existingName = '', messages = [] } = {}) {
  const directAiName = sanitizeCandidateName(aiName);
  if (directAiName) return directAiName;

  const directExisting = sanitizeCandidateName(existingName);
  if (directExisting) return directExisting;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    const extracted = findNameCandidateInText(message.body || '');
    if (extracted) return extracted;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    if (!outboundAskedForName(messages, index)) continue;
    const extracted = findNameCandidateInText(message.body || '', { allowDirect: true });
    if (extracted) return extracted;
  }

  const directContact = sanitizeCandidateName(contactName);
  if (directContact) return directContact;
  return '';
}

function extractSkillFromMessages(messages = []) {
  for (const message of [...messages].reverse()) {
    const body = String(message.body || '');
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    const normalizedSkill = normalizeSkill(body, body);
    if (normalizedSkill) return normalizedSkill;
  }
  return '';
}

function extractCountryFromMessages(messages = []) {
  for (const message of [...messages].reverse()) {
    const body = String(message.body || '');
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    const normalizedCountry = normalizeCountry(body, body);
    if (normalizedCountry) return normalizedCountry;
  }
  return '';
}

function extractExperienceFromMessages(messages = []) {
  for (const message of [...messages].reverse()) {
    const body = String(message.body || '');
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    const match = body.match(/(\d+(?:\.\d+)?)\s*(?:year|years|yr|yrs|saal)/i);
    if (match) {
      return Number(match[1]);
    }
  }
  return null;
}

function extractAvailabilityFromMessages(messages = []) {
  for (const message of [...messages].reverse()) {
    const body = String(message.body || '');
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    if (/(\d+\s*(?:day|days)|\bturant\b|\bimmediate\b|\bimmediately\b|\bone month\b|\b15 days\b)/i.test(body)) {
      return normalizeWhitespace(body).slice(0, 80);
    }
  }
  return '';
}

function extractDocumentsReadyFromMessages(messages = []) {
  for (const message of [...messages].reverse()) {
    const body = String(message.body || '');
    if (String(message.direction || '').toLowerCase() !== 'inbound') continue;
    if (/(document.*ready|documents.*ready|passport.*ready|cv.*ready|document to ready|ready h|ready hai|yes.*passport|pdf me sab)/i.test(body)) {
      return 'yes';
    }
  }
  return '';
}

function sanitizeCandidateProfile({
  existingCandidate = {},
  contactName = '',
  latestMessage = '',
  messages = [],
  aiProfile = {},
} = {}) {
  const safeName = pickBestName({
    aiName: aiProfile.name,
    contactName,
    existingName: existingCandidate.name,
    messages,
  });

  const safeSkill =
    normalizeSkill(aiProfile.skill, `${latestMessage} ${aiProfile.notes || ''}`) ||
    normalizeSkill(existingCandidate.skill || '') ||
    extractSkillFromMessages(messages) ||
    '';

  const safeCountry =
    normalizeCountry(aiProfile.country, latestMessage) ||
    normalizeCountry(existingCandidate.country || '', latestMessage) ||
    extractCountryFromMessages(messages) ||
    '';

  const safePreferredCountry =
    normalizeCountry(aiProfile.preferredCountry, latestMessage) ||
    normalizeCountry(existingCandidate.preferredCountry || '', latestMessage) ||
    safeCountry;

  const experienceMatch = aiProfile.experience !== undefined && aiProfile.experience !== null && aiProfile.experience !== ''
    ? Number(String(aiProfile.experience).match(/(\d+(?:\.\d+)?)/)?.[1] || '')
    : null;

  return {
    ...aiProfile,
    name: safeName,
    skill: safeSkill,
    country: safeCountry,
    preferredCountry: safePreferredCountry,
    experience: experienceMatch ?? existingCandidate.experience ?? extractExperienceFromMessages(messages) ?? 0,
    availability: normalizeWhitespace(aiProfile.availability || existingCandidate.availability || extractAvailabilityFromMessages(messages) || ''),
    documentsReady: normalizeWhitespace(aiProfile.documentsReady || existingCandidate.documentsReady || extractDocumentsReadyFromMessages(messages) || ''),
  };
}

function hasUsableCandidateName(value = '') {
  return Boolean(sanitizeCandidateName(value));
}

function buildCategoryCounts(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    const skill = normalizeSkill(candidate.skill || '', candidate.notes || '') || 'Uncategorized';
    counts[skill] = (counts[skill] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
  );
}

function buildCountryCounts(candidates = []) {
  const counts = {};
  for (const candidate of candidates) {
    const country = normalizeCountry(candidate.preferredCountry || candidate.country || '', candidate.notes || '') || 'Unspecified';
    counts[country] = (counts[country] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts).sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return a[0].localeCompare(b[0]);
    })
  );
}

module.exports = {
  normalizePhone,
  normalizeSkill,
  normalizeCountry,
  sanitizeCandidateName,
  hasUsableCandidateName,
  sanitizeCandidateProfile,
  buildCategoryCounts,
  buildCountryCounts,
  getFallbackCandidateName,
  pickBestName,
};
