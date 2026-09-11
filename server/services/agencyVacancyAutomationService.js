const { rtdbGet, rtdbGetAll, rtdbPush, rtdbUpdate } = require('./firebaseService');
const { buildMetaTemplateName, createMetaTemplate, uploadMediaAsset } = require('./whatsappService');
const { callGeminiJson } = require('./aiAgentService');
const { generateVacancyPosterBuffer } = require('./vacancyPosterService');

const GCC_BRAND_NAME = 'Gulf Career Gateway';
const GCC_DEFAULT_EMAIL = 'gulfcareergateway@gmail.com';
const GCC_DEFAULT_ADDRESS = 'RZ-244, 4th Floor, Behind Croma, Pillar No. 658, Uttam Nagar East, New Delhi';
const TITLECASE_EXCEPTIONS = new Map([
  ['ac', 'AC'],
  ['aed', 'AED'],
  ['cv', 'CV'],
  ['gcc', 'GCC'],
  ['hvac', 'HVAC'],
  ['ot', 'OT'],
  ['pkr', 'PKR'],
  ['qa', 'QA'],
  ['qar', 'QAR'],
  ['saudi', 'Saudi'],
  ['sar', 'SAR'],
  ['sr', 'SR'],
  ['uae', 'UAE'],
]);

const SKILL_PATTERNS = [
  { pattern: /(haj|hajj)\s*khidmat|no\s*takamul/i, value: 'Hajj Khidmat Labour' },
  { pattern: /indoor\s+(?:labou?r|job)/i, value: 'Indoor Labour' },
  { pattern: /kitchen\s+helpers?/i, value: 'Kitchen Helper' },
  { pattern: /house\s+driver/i, value: 'House Driver' },
  { pattern: /courier\s+delivery\s+driver/i, value: 'Courier Delivery Driver' },
  { pattern: /load\s*\/?\s*unload/i, value: 'Load/Unload' },
  { pattern: /construction\s+helpers?/i, value: 'Construction Helper' },
  { pattern: /hvac\s+technician/i, value: 'HVAC Technician' },
  { pattern: /ac\s+technician/i, value: 'AC Technician' },
  { pattern: /security\s+guards?/i, value: 'Security Guard' },
  { pattern: /electricians?/i, value: 'Electrician' },
  { pattern: /plumbers?/i, value: 'Plumber' },
  { pattern: /carpenters?/i, value: 'Carpenter' },
  { pattern: /welders?/i, value: 'Welder' },
  { pattern: /masons?/i, value: 'Mason' },
  { pattern: /fabricators?/i, value: 'Fabricator' },
  { pattern: /mechanics?/i, value: 'Mechanic' },
  { pattern: /painters?/i, value: 'Painter' },
  { pattern: /cleaners?/i, value: 'Cleaner' },
  { pattern: /cooks?/i, value: 'Cook' },
  { pattern: /tilers?/i, value: 'Tiler' },
  { pattern: /drivers?/i, value: 'Driver' },
  { pattern: /helpers?/i, value: 'Helper' },
  { pattern: /labou?rs?/i, value: 'Labour' },
];

const COUNTRY_PATTERNS = [
  { pattern: /saudi\s*arabia|riyadh|jeddah|dammam|madinah|makkah/i, value: 'Saudi Arabia' },
  { pattern: /uae|dubai|abu\s*dhabi|sharjah/i, value: 'UAE' },
  { pattern: /qatar|doha/i, value: 'Qatar' },
  { pattern: /kuwait/i, value: 'Kuwait' },
  { pattern: /oman|muscat/i, value: 'Oman' },
  { pattern: /bahrain/i, value: 'Bahrain' },
  { pattern: /germany/i, value: 'Germany' },
  { pattern: /romania/i, value: 'Romania' },
  { pattern: /croatia/i, value: 'Croatia' },
];

const LOCATION_PATTERNS = [
  { pattern: /riyadh/i, value: 'Riyadh' },
  { pattern: /jeddah/i, value: 'Jeddah' },
  { pattern: /dammam/i, value: 'Dammam' },
  { pattern: /madinah/i, value: 'Madinah' },
  { pattern: /makkah/i, value: 'Makkah' },
  { pattern: /dubai/i, value: 'Dubai' },
  { pattern: /abu\s*dhabi/i, value: 'Abu Dhabi' },
  { pattern: /sharjah/i, value: 'Sharjah' },
  { pattern: /doha/i, value: 'Doha' },
  { pattern: /muscat/i, value: 'Muscat' },
];

const AGENCY_OFFICE_LOCATION_PATTERNS = [
  /mahim/i,
  /mumbai/i,
  /maharashtra/i,
  /new\s+delhi/i,
  /delhi/i,
  /uttam\s+nagar/i,
  /pillar\s*no/i,
  /behind\s+croma/i,
  /\bindia\b/i,
  /office/i,
  /gmail\.com/i,
  /recruit(?:ment|er)/i,
];

const PLACEHOLDER_FACT_VALUES = new Set([
  'string',
  'strings',
  'n/a',
  'na',
  'null',
  'undefined',
  'unknown',
  'not specified',
  'not provided',
  'value',
  'text',
]);

const EXTERNAL_BRAND_PATTERNS = [
  /\b(?!gulf\s+career\s+gateway\b)(?:[a-z][a-z&.\-]*\s+){0,4}(?:recruitment(?:\s+services?)?|manpower|consultancy|overseas|travels|placement|hr\s+services?)\b/gi,
  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
  /\b(?:https?:\/\/|www\.)\S+\b/gi,
  /\b[a-z][a-z\s]{1,24}:\s*(?:\+?\d[\d\s/-]{7,}\d)(?:\s*\/\s*[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})?/gi,
  /\b(?:contact|whatsapp|call|mobile|phone|email|mail|sampark)\s*(?:number|no|id|details?)?\s*[:\-]?\s*(?:\+?\d[\d\s/-]{7,}\d|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi,
  /\b(?:shagufta|rafiq|danish|roots|jadur|judur)\b/gi,
  /\+?\d[\d\s/-]{7,}\d/g,
  /\b[a-z0-9.-]+\.(?:com|in|net|org|ae|sa|pk)\b/gi,
];

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function normalizeWhitespace(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value = '') {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function toTitleCase(value = '') {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function toDisplayCase(value = '') {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const cleanPart = part.replace(/[^\w/+.-]/g, '');
      const lowerPart = cleanPart.toLowerCase();
      if (TITLECASE_EXCEPTIONS.has(lowerPart)) {
        return part.replace(cleanPart, TITLECASE_EXCEPTIONS.get(lowerPart));
      }
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function toSentence(value = '') {
  const normalized = normalizeWhitespace(value);
  if (!normalized) return '';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function isPlaceholderFactValue(value = '') {
  const normalized = normalizeWhitespace(value)
    .replace(/^[`"'()[\]{}]+|[`"'()[\]{}]+$/g, '')
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return PLACEHOLDER_FACT_VALUES.has(normalized) || PLACEHOLDER_FACT_VALUES.has(normalized.replace(/_/g, ' '));
}

function cleanFactValue(value = '') {
  const cleaned = normalizeWhitespace(value).replace(/[.\s]+$/g, '');
  return isPlaceholderFactValue(cleaned) ? '' : cleaned;
}

function stripExternalBranding(value = '') {
  let sanitized = String(value || '');
  EXTERNAL_BRAND_PATTERNS.forEach((pattern) => {
    sanitized = sanitized.replace(pattern, ' ');
  });

  return sanitized
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:])/g, '$1')
    .trim();
}

function singularizeRoleLabel(value = '') {
  return normalizeWhitespace(value)
    .replace(/\bdrivers\b/i, 'Driver')
    .replace(/\bhelpers\b/i, 'Helper')
    .replace(/\blabou?rs\b/i, 'Labour')
    .replace(/\bworkers\b/i, 'Worker')
    .replace(/\btechnicians\b/i, 'Technician')
    .replace(/\bpositions\b/i, 'Position')
    .replace(/\bvaccancies\b/i, 'Vacancy')
    .trim();
}

function extractRoleVariantsFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  if (!normalized) {
    return [];
  }

  const matches = [...normalized.matchAll(/(\d+)\s+(return|fresh)\s+([a-z][a-z\s/&-]{2,}?)(?=\s+(?:salary\b|indian\s+license\b|ksa\b|note\b|mode\s+of\s+selection\b))/ig)];
  if (matches.length === 0) {
    return [];
  }

  return matches.map((match, index) => {
    const start = match.index || 0;
    const end = index < matches.length - 1 ? (matches[index + 1].index || normalized.length) : normalized.length;
    const block = normalized.slice(start, end);
    const rawRole = singularizeRoleLabel(match[3]);
    const salaryMatch = block.match(
      /salary\s*[:\-]?\s*(.+?)(?=(?:\s+sc\b|\s+service\s*charge\b|\s+\d+\s+(?:return|fresh)\b|\s+note\b|\s+mode\s+of\s+selection\b|$))/i
    );
    const serviceChargeMatch = block.match(/(?:sc|service\s*charge)[^\d]{0,10}(\d[\d,./-]*)/i);

    return {
      quantity: match[1],
      variant: toDisplayCase(match[2]),
      role: toDisplayCase(rawRole),
      label: `${toDisplayCase(match[2])} ${toDisplayCase(rawRole)}`.trim(),
      salary: cleanFactValue(salaryMatch?.[1] || ''),
      serviceCharge: cleanFactValue(serviceChargeMatch?.[1] || ''),
    };
  });
}

function inferSkillFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const variants = extractRoleVariantsFromText(normalized);
  const uniqueVariantRoles = [...new Set(variants.map((variant) => slugify(variant.role)).filter(Boolean))];
  if (uniqueVariantRoles.length === 1 && variants[0]?.role) {
    return variants[0].role;
  }

  const hybridSkill =
    /(haj|hajj)\s*khidmat|no\s*takamul/i.test(normalized) && /indoor\s+(?:labou?r|job)/i.test(normalized)
      ? 'Hajj Khidmat / Indoor Labour'
      : '';
  if (hybridSkill) {
    return hybridSkill;
  }

  const matched = SKILL_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return matched?.value || 'General';
}

function inferCountryFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const matched = COUNTRY_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return matched?.value || 'Gulf';
}

function inferLocationFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const matched = LOCATION_PATTERNS.find(({ pattern }) => pattern.test(normalized));
  return matched?.value || '';
}

function inferSalaryFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const variants = extractRoleVariantsFromText(normalized).filter((variant) => variant.salary);
  if (variants.length > 1) {
    return variants
      .map((variant) => `${variant.label}: ${variant.salary}`)
      .join('; ');
  }

  if (variants.length === 1 && variants[0].salary) {
    return variants[0].salary;
  }

  const explicitMatch = normalized.match(
    /salary\s*[:\-]?\s*(.+?)(?=(?:\s+duty\b|\s+contract\b|\s+note\b|\s+documents?\b|\s+requirements?\b|\s+contact\b|\s+email\b|\s+office\b|\s+joining\b|\s+timeline\b|\s+sc\b|\s+service\s*charge\b|\s+regards\b|$))/i
  );
  if (explicitMatch?.[1]) {
    return normalizeWhitespace(explicitMatch[1]);
  }

  const currencyAwareMatch = normalized.match(
    /(\d[\d,]{2,}(?:\s*\+\s*[a-z]+(?:\s*[a-z]+)*){0,3}\s*(?:AED|SAR|QAR|OMR|BHD|PKR|SR|riyal|riyals|rs)?(?:\s*\+\s*OT)?)/i
  );
  if (!currencyAwareMatch?.[1]) {
    return '';
  }

  const salaryCandidate = normalizeWhitespace(currencyAwareMatch[1]);
  const numericAmount = parseAmount(salaryCandidate);
  if (numericAmount < 100 && !/(aed|sar|qar|omr|bhd|pkr|sr|riyal|rs|\+\s*ot|\+\s*food)/i.test(salaryCandidate)) {
    return '';
  }

  return salaryCandidate;
}

function inferServiceChargeFromText(text = '') {
  const variants = extractRoleVariantsFromText(text).filter((variant) => variant.serviceCharge);
  if (variants.length > 1) {
    return variants
      .map((variant) => `${variant.variant}: ${variant.serviceCharge}`)
      .join(' / ');
  }

  if (variants.length === 1 && variants[0].serviceCharge) {
    return variants[0].serviceCharge;
  }

  const match = String(text || '').match(/(?:service\s*charge|charges?|fee|sc)[^\d]{0,10}(\d[\d,./-]*(?:\s*(?:k|thousand|lakh))?)/i);
  return match ? normalizeWhitespace(match[1].replace(/,/g, '')) : '';
}

function inferQuantityFromText(text = '') {
  const variants = extractRoleVariantsFromText(text);
  if (variants.length > 1) {
    const total = variants.reduce((sum, variant) => sum + Number(variant.quantity || 0), 0);
    const breakdown = variants
      .map((variant) => `${variant.quantity} ${variant.variant.toLowerCase()}`)
      .join(' + ');
    return total > 0 ? `${total} total (${breakdown})` : breakdown;
  }

  const match = String(text || '').match(/(\d+)\s*(?:helpers?|labou?r|workers?|drivers?|candidates?|positions?|vacancies?|qty)/i);
  return match ? match[1] : '';
}

function inferDocumentsFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const inferred = [];
  const keywordMap = [
    ['Updated CV', /\bcv\b/i],
    ['Passport scan copy', /passport\s+scan\s+copy/i],
    ['Passport copy', /passport\s+copy/i],
    ['Passport size photograph', /passport\s+size\s+photograph/i],
    ['White background photograph', /white\s+background\s+photograph/i],
    ['Introduction video', /introduction\s+video/i],
    ['Gamca medical', /gamca\s+medical/i],
    ['Supportive documents in one PDF', /supportive documents.*one pdf/i],
    ['KSA driving license', /\bksa\b.*original driving license|original driving license.*\bksa\b/i],
    ['Indian driving license', /indian original driving license|indian license accepted/i],
  ];

  keywordMap.forEach(([label, pattern]) => {
    if (pattern.test(normalized) && !inferred.includes(label)) {
      inferred.push(label);
    }
  });

  return inferred;
}

function inferDutyFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(
    /duty\s*[:\-]?\s*(.+?)(?=(?:\s+contract\b|\s+note\b|\s+documents?\b|\s+requirements?\b|\s+contact\b|\s+email\b|\s+office\b|\s+joining\b|\s+timeline\b|\s+sc\b|\s+service\s*charge\b|\s+regards\b|$))/i
  );
  return match ? normalizeWhitespace(match[1]) : '';
}

function inferContractFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(
    /contract\s*[:\-]?\s*(.+?)(?=(?:\s+note\b|\s+documents?\b|\s+requirements?\b|\s+contact\b|\s+email\b|\s+office\b|\s+joining\b|\s+timeline\b|\s+sc\b|\s+service\s*charge\b|\s+regards\b|$))/i
  );
  return match ? normalizeWhitespace(match[1]) : '';
}

function inferTimelineFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const exact = normalized.match(/(joining[^.]{0,80}|within\s+\d+\s+(?:day|days|week|weeks)|after selection[^.]{0,80}|timeline[^.]{0,80})/i);
  return exact ? exact[1] : '';
}

function inferNoteFromText(text = '') {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(
    /note\s*[:\-]?\s*(.+?)(?=(?:\s+mode\s+of\s+selection\b|\s+sc\b|\s+service\s*charge\b|\s+regards\b|$))/i
  );
  const highlights = [];

  if (/ecr\s*\/?\s*ecnr\s+all\s+accepted/i.test(normalized)) {
    highlights.push('ECR / ECNR accepted');
  }

  if (/kafil\s+visa|direct\s+sponsor\s+visa/i.test(normalized)) {
    highlights.push('Kafil visa / direct sponsor visa');
  }

  if (/indian\s+license\s+accepted/i.test(normalized)) {
    highlights.push('Indian license accepted for fresh candidates');
  }

  const modeMatch = normalized.match(/mode\s+of\s+selection\s*[:\-]?\s*(.+?)$/i);
  if (modeMatch?.[1]) {
    highlights.push(`Mode of selection: ${normalizeWhitespace(modeMatch[1])}`);
  }

  const baseNote = match
    ? normalizeWhitespace(match[1]).replace(/^[-–—:)\s]+/, '').replace(/\.\.+/g, '.')
    : '';

  return [...new Set([baseNote, ...highlights].filter(Boolean))]
    .join('. ')
    .replace(/\.\.+/g, '.')
    .replace(/\s+\./g, '.')
    .trim();
}

function parseAmount(value = '') {
  const match = String(value || '').match(/(\d[\d,]*)/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}

function normalizeDocuments(value = []) {
  if (Array.isArray(value)) {
    return value
      .map(item => cleanFactValue(item))
      .filter(Boolean)
      .slice(0, 8);
  }

  return String(value || '')
    .split(/[,/]| and /i)
    .map(part => cleanFactValue(part))
    .filter(Boolean)
    .slice(0, 8);
}

function sanitizeSourceVacancyText(value = '') {
  return stripExternalBranding(
    String(value || '')
    .replace(/here'?s the extracted job information, formatted as requested:\s*/i, '')
    .replace(/[*_`#]+/g, ' ')
    .replace(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/contact\s*[:\-][\s\S]*?(?=(?:office\s*[:\-]|email\s*[:\-]|$))/i, ' ')
    .replace(/email\s*[:\-][\s\S]*?(?=(?:office\s*[:\-]|$))/i, ' ')
    .replace(/office\s*[:\-][\s\S]*$/i, ' ')
    .replace(/regards[\s,:-].*$/i, ' ')
    .replace(/(?:roots|gulf|[a-z\s]+)?\s*recruitment\s+services?.*$/i, ' ')
  );
}

function isGenericSkillLabel(value = '') {
  return ['general', 'string', 'vacancy', 'job', 'position', 'worker'].includes(slugify(value));
}

function isGenericCountryLabel(value = '') {
  return ['gulf', 'string', 'country', 'location'].includes(slugify(value));
}

function shouldTrustExtractedSalary(value = '') {
  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return false;
  }

  const amount = parseAmount(normalized);
  if (amount >= 100) {
    return true;
  }

  return /(aed|sar|qar|omr|bhd|pkr|sr|riyal|riyals|rs|\+\s*ot|\+\s*food)/i.test(normalized);
}

function normalizeVacancyDetails(details = {}, rawText = '') {
  const safeRawText = sanitizeSourceVacancyText(rawText);
  const extractedSkill = cleanFactValue(details.skill);
  const inferredSkill = inferSkillFromText(safeRawText);
  const extractedCountry = cleanFactValue(details.country);
  const inferredCountry = inferCountryFromText(safeRawText);
  const extractedSalary = cleanFactValue(details.salary);
  const inferredSalary = inferSalaryFromText(safeRawText);
  const country = extractedCountry && !isGenericCountryLabel(extractedCountry) ? extractedCountry : inferredCountry;
  const skill = extractedSkill && !isGenericSkillLabel(extractedSkill) ? extractedSkill : inferredSkill;
  const location = sanitizeVacancyLocation(cleanFactValue(details.location), country, safeRawText);
  const extractedDocuments = normalizeDocuments(details.documents || []);
  const inferredDocuments = extractedDocuments.length > 0 ? extractedDocuments : normalizeDocuments(inferDocumentsFromText(safeRawText));

  return {
    skill: toDisplayCase(skill || 'General'),
    country: toDisplayCase(country || 'Gulf'),
    location: toDisplayCase(location || ''),
    salary: cleanFactValue(shouldTrustExtractedSalary(extractedSalary) ? extractedSalary : (inferredSalary || '')),
    company: '',
    serviceCharge: cleanFactValue(cleanFactValue(details.serviceCharge) || inferServiceChargeFromText(safeRawText) || ''),
    documents: inferredDocuments,
    timeline: cleanFactValue(cleanFactValue(details.timeline) || inferTimelineFromText(safeRawText) || ''),
    duty: cleanFactValue(cleanFactValue(details.duty) || inferDutyFromText(safeRawText) || ''),
    contract: cleanFactValue(cleanFactValue(details.contract) || inferContractFromText(safeRawText) || ''),
    note: cleanFactValue(stripExternalBranding(cleanFactValue(details.note) || inferNoteFromText(safeRawText) || '')),
    quantity: cleanFactValue(cleanFactValue(details.quantity) || inferQuantityFromText(safeRawText) || ''),
  };
}

function buildSourceFingerprint({ agencyPhone = '', rawText = '', details = {} } = {}) {
  const body = sanitizeSourceVacancyText(rawText)
    || [details.skill, details.country, details.salary, details.company].filter(Boolean).join(' ');

  return `${normalizePhone(agencyPhone)}|${slugify(body)}`.slice(0, 512);
}

function getGccContactPhone() {
  return normalizeWhitespace(
    process.env.WHATSAPP_CONTACT_NUMBER
    || process.env.CONTACT_PHONE
    || process.env.ADMIN_PHONE_1
    || process.env.ADMIN_PHONE_2
    || '+91 8920624361'
  );
}

function getGccContactEmail() {
  return normalizeWhitespace(
    process.env.CONTACT_EMAIL
    || process.env.COMPANY_EMAIL
    || process.env.SUPPORT_EMAIL
    || GCC_DEFAULT_EMAIL
  );
}

function getGccContactAddress() {
  return normalizeWhitespace(
    process.env.CONTACT_ADDRESS
    || process.env.COMPANY_ADDRESS
    || process.env.OFFICE_ADDRESS
    || GCC_DEFAULT_ADDRESS
  );
}

function sanitizeVacancyLocation(value = '', country = '', rawText = '') {
  const normalizedValue = normalizeWhitespace(value);
  const inferredLocation = inferLocationFromText(rawText);
  if (!normalizedValue) {
    return inferredLocation;
  }

  const lowerValue = normalizedValue.toLowerCase();
  const lowerCountry = normalizeWhitespace(country).toLowerCase();
  const looksLikeAgencyOffice = AGENCY_OFFICE_LOCATION_PATTERNS.some((pattern) => pattern.test(lowerValue));
  const inferredCountryFromLocation = inferCountryFromText(normalizedValue);
  const mismatchedCountry =
    Boolean(lowerCountry)
    && Boolean(inferredCountryFromLocation)
    && inferredCountryFromLocation.toLowerCase() !== 'gulf'
    && inferredCountryFromLocation.toLowerCase() !== lowerCountry
    && !lowerValue.includes(lowerCountry);

  if (looksLikeAgencyOffice || mismatchedCountry) {
    return inferredLocation || '';
  }

  return normalizedValue;
}

function buildLocationLine(details = {}) {
  if (details.location && details.country && details.location.toLowerCase() !== details.country.toLowerCase()) {
    return `${details.location}, ${details.country}`;
  }

  return details.location || details.country || 'Gulf';
}

function buildOfferLine(details = {}, rawText = '') {
  const variantOffers = extractRoleVariantsFromText(rawText).filter((variant) => variant.salary);
  if (variantOffers.length > 1) {
    return `Offers: ${variantOffers.map((variant) => `${variant.label} - ${variant.salary}`).join('; ')}.`;
  }

  const salary = cleanFactValue(details.salary);
  return salary
    ? `Offer: ${salary}.`
    : 'Offer employer discussion ke mutabiq share ki jayegi.';
}

function buildServiceChargeLine(details = {}, rawText = '') {
  const variantCharges = extractRoleVariantsFromText(rawText).filter((variant) => variant.serviceCharge);
  if (variantCharges.length > 1) {
    return `Service charge: ${variantCharges.map((variant) => `${variant.label} - ${variant.serviceCharge}`).join('; ')}.`;
  }

  const serviceCharge = cleanFactValue(details.serviceCharge);
  return serviceCharge ? `Service charge: ${serviceCharge}.` : '';
}

function buildDocumentsLine(details = {}) {
  if (details.documents?.length) {
    return `Required documents: ${details.documents.join(', ')}.`;
  }

  return 'Required documents: updated CV aur passport copy.';
}

function hasMeaningfulVacancyDetails(details = {}, rawText = '') {
  const hasSpecificRole = Boolean(details.skill && String(details.skill).toLowerCase() !== 'general');
  const hasSpecificCountry = Boolean(details.country && String(details.country).toLowerCase() !== 'gulf');
  const hasCommercialDetail = Boolean(details.salary || details.quantity || details.serviceCharge);
  const hasOperationalDetail = Boolean(details.documents?.length || details.duty || details.contract || details.timeline || details.note);
  return normalizeWhitespace(rawText).length >= 25 && (hasSpecificRole || hasSpecificCountry) && (hasCommercialDetail || hasOperationalDetail);
}

function buildCandidateUpdateText(details = {}, rawText = '') {
  const skill = details.skill || 'Vacancy';
  const location = buildLocationLine(details);
  const quantityLine = details.quantity ? `Open positions: ${details.quantity}.` : '';
  const dutyLine = details.duty ? `Duty: ${toSentence(cleanFactValue(details.duty))}.` : '';
  const contractLine = details.contract ? `Contract: ${toSentence(cleanFactValue(details.contract))}.` : '';
  const timelineLine = details.timeline ? `Joining timeline: ${toSentence(cleanFactValue(details.timeline))}.` : '';
  const noteLine = details.note ? `Important note: ${toSentence(cleanFactValue(details.note))}.` : '';
  const serviceChargeLine = buildServiceChargeLine(details, rawText);
  const gccPhone = getGccContactPhone();
  const gccEmail = getGccContactEmail();
  const gccAddress = getGccContactAddress();

  return normalizeWhitespace(
    `Assalam-o-Alaikum {name}, ${GCC_BRAND_NAME} ke paas ${skill} ki vacancy receive hui hai. Location: ${location}. ${quantityLine} ${buildOfferLine(details, rawText)} ${serviceChargeLine} ${dutyLine} ${contractLine} ${timelineLine} ${buildDocumentsLine(details)} ${noteLine} Interested candidates apna updated CV, passport copy, current location aur total experience reply mein share karein. Contact ${GCC_BRAND_NAME}: ${gccPhone}. Email: ${gccEmail}. Office: ${gccAddress}. Final shortlisting employer selection aur documentation par depend karegi.`
  );
}

function buildPosterFileName(details = {}) {
  const skillToken = slugify(details.skill || 'general');
  const countryToken = slugify(details.country || 'gulf');
  return `vacancy-card-${skillToken}-${countryToken}.png`;
}

function buildRecruiterTemplates(details = {}, rawText = '') {
  const skill = details.skill || 'General';
  const location = buildLocationLine(details);
  const gccPhone = getGccContactPhone();
  const gccEmail = getGccContactEmail();
  const gccAddress = getGccContactAddress();
  const quantityLine = details.quantity ? `Open positions: ${details.quantity}.` : '';
  const dutyLine = details.duty ? `Duty: ${toSentence(cleanFactValue(details.duty))}.` : '';
  const contractLine = details.contract ? `Contract: ${toSentence(cleanFactValue(details.contract))}.` : '';
  const timelineLine = details.timeline ? `Joining timeline: ${toSentence(cleanFactValue(details.timeline))}.` : '';
  const noteLine = details.note ? `Important note: ${toSentence(cleanFactValue(details.note))}.` : '';
  const serviceChargeLine = buildServiceChargeLine(details, rawText);
  const candidateText = buildCandidateUpdateText(details, rawText);

  return [
    {
      id: 'candidate_update',
      text: candidateText,
    },
    {
      id: 'meta_review',
      text: normalizeWhitespace(
        `Assalam-o-Alaikum, ${GCC_BRAND_NAME} ke paas ${skill} ki vacancy receive hui hai. Location: ${location}. ${quantityLine} ${buildOfferLine(details, rawText)} ${serviceChargeLine} ${dutyLine} ${contractLine} ${timelineLine} ${buildDocumentsLine(details)} ${noteLine} Interested candidates ${GCC_BRAND_NAME} ko is chat par reply karein. Final shortlisting employer selection aur documentation par depend karegi.`
      ),
    },
    {
      id: 'manager_summary',
      text: normalizeWhitespace(
        `New agency vacancy received for ${GCC_BRAND_NAME}: ${skill}. Location: ${location}. ${quantityLine} ${buildOfferLine(details, rawText)} ${serviceChargeLine} ${dutyLine} ${contractLine} ${timelineLine} ${noteLine} Raw source: ${rawText || 'Text not available.'}`
      ),
    },
  ];
}

function shouldAutoProcessAgencyLead(lead = {}) {
  const inquiryText = normalizeWhitespace(lead.inquiryText || lead.rawText || '');
  if (!inquiryText) return false;

  if (lead.skill || lead.country || lead.salary) return true;

  if (inquiryText.length < 25) return false;

  return /(vacancy|hiring|urgent|job|opening|salary|duty|require|required|need|passport|cv|food|accommodation|helpers?|labou?r|technician|driver|electrician|plumber|carpenter|welder|mason)/i.test(inquiryText);
}

async function extractVacancyFromText(rawText = '', fallbackDetails = {}) {
  const normalizedRawText = sanitizeSourceVacancyText(rawText);
  if (!normalizedRawText) {
    const details = normalizeVacancyDetails(fallbackDetails, rawText);
    return {
      rawText: '',
      details,
      templates: buildRecruiterTemplates(details),
    };
  }

  if (process.env.GEMINI_API_KEY) {
    try {
      const result = await callGeminiJson([
        {
          text: `You are parsing a manpower recruitment vacancy note from an agency.
Return JSON only:
{
  "details": {
    "skill": "string",
    "country": "string",
    "location": "string",
    "salary": "string",
    "company": "string",
    "serviceCharge": "string",
    "documents": ["string"],
    "timeline": "string",
    "duty": "string",
    "contract": "string",
    "note": "string",
    "quantity": "string"
  }
}
Rules:
- Infer conservatively from the source note.
- Never invent legal claims, licenses, approvals, or visa guarantees.
- Keep missing fields as empty string or empty array.
- Preserve recruiter wording when possible.
Agency note:
${normalizedRawText}`,
        },
      ], {
        temperature: 0.2,
      });

      const details = normalizeVacancyDetails({
        ...fallbackDetails,
        ...(result.details || {}),
      }, normalizedRawText);

      return {
        rawText: normalizedRawText,
        details,
        templates: buildRecruiterTemplates(details, normalizedRawText),
      };
    } catch (error) {
      console.warn('[Agency Vacancy Automation] Text parsing fallback:', error.message);
    }
  }

  const details = normalizeVacancyDetails(fallbackDetails, normalizedRawText);
  return {
    rawText: normalizedRawText,
    details,
    templates: buildRecruiterTemplates(details, normalizedRawText),
  };
}

async function upsertAgencyInbox({
  agencyPhone = '',
  agencyName = '',
  rawText = '',
  sourceType = 'text',
  details = {},
  sourceFingerprint = '',
} = {}) {
  const existingInbox = await rtdbGetAll('agency_inbox');
  const nowIso = new Date().toISOString();
  const matched = (existingInbox || []).find(item => {
    const samePhone = normalizePhone(item.phone || item.agencyPhone || '') === normalizePhone(agencyPhone);
    const sameFingerprint = item.sourceFingerprint && item.sourceFingerprint === sourceFingerprint;
    const sameText = normalizeWhitespace(item.inquiryText || item.rawText || '') === rawText;
    const updatedAt = new Date(item.updatedAt || item.createdAt || 0).getTime();
    return samePhone && (sameFingerprint || sameText) && updatedAt && Date.now() - updatedAt < 7 * 24 * 60 * 60 * 1000;
  });

  const payload = {
    phone: normalizePhone(agencyPhone),
    agencyPhone: normalizePhone(agencyPhone),
    agencyName: agencyName || '',
    inquiryText: rawText,
    skill: details.skill || '',
    country: details.country || '',
    salary: details.salary || '',
    serviceCharge: details.serviceCharge || '',
    documents: details.documents?.join(', ') || '',
    location: details.location || '',
    duty: details.duty || '',
    contract: details.contract || '',
    note: details.note || '',
    timeline: details.timeline || '',
    quantity: details.quantity || '',
    sourceType,
    sourceFingerprint,
    originalForm: rawText,
    updatedAt: nowIso,
  };

  if (matched?.id) {
    await rtdbUpdate(`agency_inbox/${matched.id}`, payload);
    return matched.id;
  }

  return rtdbPush('agency_inbox', {
    ...payload,
    createdAt: nowIso,
  });
}

function summarizeBlastResult(result = {}) {
  return {
    targeted: Number(result.targeted || 0),
    sent: Number(result.sent || 0),
    failed: Number(result.failed || 0),
    posterSent: Number(result.posterSent || 0),
    posterFailed: Number(result.posterFailed || 0),
    posterMediaAttached: Boolean(result.posterMediaAttached),
    failureReasons: result.failureReasons || {},
    failedTargets: result.failedTargets || [],
    mode: result.mode || 'custom_text',
    pendingTemplateApproval: Boolean(result.pendingTemplateApproval),
    completedAt: result.completedAt || new Date().toISOString(),
  };
}

function buildStoredDraftTemplates(generatedTemplates = [], candidateFacingText = '', templateDraftBody = '') {
  const templates = Array.isArray(generatedTemplates)
    ? generatedTemplates.map((template) => ({ ...template }))
    : [];

  const upsertTemplate = (id, text) => {
    const nextText = normalizeWhitespace(text);
    if (!nextText) return;

    const index = templates.findIndex((template) => template.id === id);
    if (index >= 0) {
      templates[index] = {
        ...templates[index],
        text: nextText,
      };
      return;
    }

    templates.push({ id, text: nextText });
  };

  upsertTemplate('candidate_update', candidateFacingText);
  upsertTemplate('meta_review', templateDraftBody);

  return templates;
}

function mapDraftWorkflowStatus(metaTemplateStatus = '', draftNeedsSubmission = false) {
  if (draftNeedsSubmission) {
    return 'pending_approval';
  }

  switch (String(metaTemplateStatus || '').trim().toUpperCase()) {
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

async function resolveAgencyDraftContext({ queueId = '', vacancyId = '' } = {}) {
  let resolvedQueueId = String(queueId || '').trim();
  let resolvedVacancyId = String(vacancyId || '').trim();

  let queueData = resolvedQueueId ? await rtdbGet(`agency_queue/${resolvedQueueId}`) : null;
  let vacancyData = resolvedVacancyId ? await rtdbGet(`vacancies/${resolvedVacancyId}`) : null;

  if (!vacancyData && queueData?.approvedVacancyId) {
    resolvedVacancyId = String(queueData.approvedVacancyId || '').trim();
    vacancyData = resolvedVacancyId ? await rtdbGet(`vacancies/${resolvedVacancyId}`) : null;
  }

  if (!queueData && vacancyData?.sourceQueueId) {
    resolvedQueueId = String(vacancyData.sourceQueueId || '').trim();
    queueData = resolvedQueueId ? await rtdbGet(`agency_queue/${resolvedQueueId}`) : null;
  }

  return {
    queueId: resolvedQueueId,
    queueData,
    vacancyId: resolvedVacancyId,
    vacancyData,
  };
}

async function saveAgencyTemplateDraft({
  queueId = '',
  vacancyId = '',
  candidateFacingText = '',
  templateDraftBody = '',
} = {}) {
  const context = await resolveAgencyDraftContext({ queueId, vacancyId });
  if (!context.queueData && !context.vacancyData) {
    throw new Error('AGENCY_TEMPLATE_DRAFT_NOT_FOUND');
  }

  const rawText = String(
    context.queueData?.rawText
    || context.queueData?.rawOcr
    || context.vacancyData?.rawText
    || context.vacancyData?.originalForm
    || ''
  ).trim();

  const details = normalizeVacancyDetails({
    ...(context.vacancyData || {}),
    ...(context.queueData?.extractedDetails || context.queueData?.extracted || {}),
  }, rawText);

  const fallbackCandidateText = buildCandidateUpdateText(details, rawText);
  const fallbackTemplateDraftBody = buildRecruiterTemplates(details, rawText)[1]?.text || fallbackCandidateText.replace('{name}, ', '');

  const nextCandidateFacingText = normalizeWhitespace(
    candidateFacingText
    || context.queueData?.candidateFacingText
    || context.vacancyData?.candidateFacingText
    || fallbackCandidateText
  );
  const nextTemplateDraftBody = normalizeWhitespace(
    templateDraftBody
    || context.queueData?.templateDraftBody
    || context.vacancyData?.templateDraftBody
    || fallbackTemplateDraftBody
  );

  const generatedTemplates = buildStoredDraftTemplates(
    context.queueData?.generatedTemplates || context.vacancyData?.generatedTemplates || [],
    nextCandidateFacingText,
    nextTemplateDraftBody,
  );

  const nowIso = new Date().toISOString();

    if (context.queueId) {
      await rtdbUpdate(`agency_queue/${context.queueId}`, {
        candidateFacingText: nextCandidateFacingText,
        templateDraftBody: nextTemplateDraftBody,
        generatedTemplates,
        draftNeedsSubmission: true,
        metaTemplateStatus: 'DRAFT_READY',
        metaTemplateError: '',
        draftUpdatedAt: nowIso,
        status: 'pending_approval',
        updatedAt: nowIso,
      });
    }

    if (context.vacancyId) {
      await rtdbUpdate(`vacancies/${context.vacancyId}`, {
        candidateFacingText: nextCandidateFacingText,
        templateDraftBody: nextTemplateDraftBody,
        generatedTemplates,
        draftNeedsSubmission: true,
        metaTemplateStatus: 'DRAFT_READY',
        metaTemplateError: '',
        approvalState: 'pending_approval',
        updatedAt: nowIso,
      });
    }

  return {
    success: true,
    queueId: context.queueId,
    vacancyId: context.vacancyId,
    candidateFacingText: nextCandidateFacingText,
    templateDraftBody: nextTemplateDraftBody,
    draftNeedsSubmission: true,
  };
}

async function submitAgencyTemplateDraft({
  queueId = '',
  vacancyId = '',
} = {}) {
  const context = await resolveAgencyDraftContext({ queueId, vacancyId });
  if (!context.queueData && !context.vacancyData) {
    throw new Error('AGENCY_TEMPLATE_DRAFT_NOT_FOUND');
  }

  const rawText = String(
    context.queueData?.rawText
    || context.queueData?.rawOcr
    || context.vacancyData?.rawText
    || context.vacancyData?.originalForm
    || ''
  ).trim();

  const details = normalizeVacancyDetails({
    ...(context.vacancyData || {}),
    ...(context.queueData?.extractedDetails || context.queueData?.extracted || {}),
  }, rawText);

  const candidateFacingText = normalizeWhitespace(
    context.queueData?.candidateFacingText
    || context.vacancyData?.candidateFacingText
    || buildCandidateUpdateText(details, rawText)
  );
  const templateDraftBody = normalizeWhitespace(
    context.queueData?.templateDraftBody
    || context.vacancyData?.templateDraftBody
    || buildRecruiterTemplates(details, rawText)[1]?.text
    || candidateFacingText.replace('{name}, ', '')
  );

  const generatedImageMediaId = String(
    context.queueData?.generatedImageMediaId
    || context.vacancyData?.generatedImageMediaId
    || (
      String(context.queueData?.imageSource || context.vacancyData?.imageSource || '').trim() === 'generated_vacancy_card'
        ? (context.queueData?.imageMediaId || context.vacancyData?.imageMediaId || '')
        : ''
    )
    || ''
  ).trim();

  const generatedImageMimeType = String(
    context.queueData?.generatedImageMimeType
    || context.vacancyData?.generatedImageMimeType
    || context.queueData?.imageMimeType
    || context.vacancyData?.imageMimeType
    || 'image/png'
  ).trim();

  const metaTemplateResult = await createMetaTemplate({
    name: buildMetaTemplateName({
      skill: details.skill || context.vacancyData?.skill || 'general',
      country: details.country || context.vacancyData?.country || 'gulf',
    }),
    bodyText: templateDraftBody.replace('{name}', 'Candidate'),
    category: 'MARKETING',
    language: 'hi',
    headerMediaId: generatedImageMediaId,
    headerImageUrl: '',
    headerMimeType: generatedImageMimeType || 'image/png',
    headerFileName: buildPosterFileName(details),
  });

  const nextMetaStatus = metaTemplateResult.success
    ? (metaTemplateResult.status || 'PENDING')
    : 'CREATE_FAILED';
  const draftNeedsSubmission = !metaTemplateResult.success;
  const workflowStatus = mapDraftWorkflowStatus(nextMetaStatus, draftNeedsSubmission);
  const nowIso = new Date().toISOString();

  const baseUpdates = {
    candidateFacingText,
    templateDraftBody,
    generatedTemplates: buildStoredDraftTemplates(
      context.queueData?.generatedTemplates || context.vacancyData?.generatedTemplates || [],
      candidateFacingText,
      templateDraftBody,
    ),
    metaTemplateId: metaTemplateResult.success ? (metaTemplateResult.id || '') : '',
    metaTemplateName: metaTemplateResult.success ? metaTemplateResult.name : '',
    metaTemplateStatus: nextMetaStatus,
    metaTemplateError: metaTemplateResult.success ? '' : (metaTemplateResult.error || 'META_TEMPLATE_CREATE_FAILED'),
    draftNeedsSubmission,
    submittedTemplateBody: metaTemplateResult.success ? templateDraftBody : '',
    updatedAt: nowIso,
  };

  if (context.queueId) {
    await rtdbUpdate(`agency_queue/${context.queueId}`, {
      ...baseUpdates,
      status: workflowStatus,
      approvedAt: metaTemplateResult.success ? nowIso : '',
      autoProcessedAt: nowIso,
      ...(context.vacancyId ? { approvedVacancyId: context.vacancyId } : {}),
    });
  }

  if (context.vacancyId) {
    await rtdbUpdate(`vacancies/${context.vacancyId}`, {
      ...baseUpdates,
      approvalState: workflowStatus,
      publishedAt: context.vacancyData?.publishedAt || nowIso,
    });
  }

  return {
    success: metaTemplateResult.success,
    queueId: context.queueId,
    vacancyId: context.vacancyId,
    candidateFacingText,
    templateDraftBody,
    metaTemplate: metaTemplateResult,
    draftNeedsSubmission,
    workflowStatus,
  };
}

async function ingestAgencyVacancy({
  agencyId = '',
  agencyPhone = '',
  agencyName = '',
  rawText = '',
  details = {},
  assignedTemplateName = '',
  sourceType = 'text',
  imageUrl = '',
  sourceImageMediaId = '',
  sourceImageMimeType = '',
  allowBroadcast = true,
} = {}) {
  const parsed = await extractVacancyFromText(rawText, details);
  const normalizedRawText = parsed.rawText || normalizeWhitespace(rawText);
  const normalizedDetails = normalizeVacancyDetails({ ...details, ...parsed.details }, normalizedRawText);
  const templates = buildRecruiterTemplates(normalizedDetails, normalizedRawText);
  const candidateFacingText = buildCandidateUpdateText(normalizedDetails, normalizedRawText);
  const reviewTemplateBody = templates[1]?.text || templates[0]?.text || candidateFacingText.replace('{name}, ', '');
  const sourceFingerprint = buildSourceFingerprint({
    agencyPhone,
    rawText: normalizedRawText,
    details: normalizedDetails,
  });
  const nowIso = new Date().toISOString();

  const existingQueue = (await rtdbGetAll('agency_queue')).find(item => {
    const samePhone = normalizePhone(item.agencyPhone || '') === normalizePhone(agencyPhone);
    return samePhone && item.sourceFingerprint === sourceFingerprint;
  });

  const originalSourceImageMediaId = String(
    sourceImageMediaId
    || existingQueue?.sourceImageMediaId
    || ''
  ).trim();
  const originalSourceImageMimeType = String(
    sourceImageMimeType
    || existingQueue?.sourceImageMimeType
    || ''
  ).trim();
  const originalSourceImageUrl = String(
    imageUrl
    || existingQueue?.sourceImageUrl
    || existingQueue?.imageUrl
    || ''
  ).trim();

  let generatedPosterMediaId = String(existingQueue?.generatedImageMediaId || '').trim();
  let generatedPosterMimeType = String(existingQueue?.generatedImageMimeType || '').trim();

  if (!generatedPosterMediaId && String(existingQueue?.imageSource || '').trim() === 'generated_vacancy_card') {
    generatedPosterMediaId = String(existingQueue?.imageMediaId || '').trim();
    generatedPosterMimeType = String(existingQueue?.imageMimeType || '').trim();
  }

  if (!generatedPosterMediaId) {
    try {
      const posterBuffer = await generateVacancyPosterBuffer(normalizedDetails);
      const posterUpload = await uploadMediaAsset(
        posterBuffer,
        'image/png',
        buildPosterFileName(normalizedDetails),
      );

      if (posterUpload.success && posterUpload.id) {
        generatedPosterMediaId = posterUpload.id;
        generatedPosterMimeType = posterUpload.mimeType || 'image/png';
      }
    } catch (error) {
      console.warn('[Agency Vacancy Automation] Poster card generation skipped:', error.message);
    }
  }

  const templateHeaderMediaId = generatedPosterMediaId;
  const templateHeaderMimeType = generatedPosterMimeType || 'image/png';
  const templateHeaderSource = generatedPosterMediaId ? 'generated_vacancy_card' : '';

  const inboxEntryId = await upsertAgencyInbox({
    agencyPhone,
    agencyName,
    rawText: normalizedRawText,
    sourceType,
    details: normalizedDetails,
    sourceFingerprint,
  });

  const queuePayload = {
    agencyId: agencyId || existingQueue?.agencyId || normalizePhone(agencyPhone),
    agencyName: agencyName || existingQueue?.agencyName || 'Unknown Agency',
    agencyPhone: normalizePhone(agencyPhone),
    rawText: normalizedRawText,
    rawOcr: normalizedRawText,
    extractedDetails: normalizedDetails,
    generatedTemplates: buildStoredDraftTemplates(
      existingQueue?.generatedTemplates || templates,
      existingQueue?.candidateFacingText || candidateFacingText,
      existingQueue?.templateDraftBody || reviewTemplateBody,
    ),
    assignedTemplateName: assignedTemplateName || existingQueue?.assignedTemplateName || 'recruiter_update',
    candidateFacingText: existingQueue?.candidateFacingText || candidateFacingText,
    templateDraftBody: existingQueue?.templateDraftBody || reviewTemplateBody,
    submittedTemplateBody: existingQueue?.submittedTemplateBody || '',
    draftNeedsSubmission: typeof existingQueue?.draftNeedsSubmission === 'boolean'
      ? existingQueue.draftNeedsSubmission
      : !String(existingQueue?.metaTemplateName || '').trim(),
    metaTemplateName: existingQueue?.metaTemplateName || '',
    metaTemplateStatus: existingQueue?.metaTemplateStatus || 'DRAFT_READY',
    metaTemplateError: existingQueue?.metaTemplateError || '',
    sourceType,
    sourceFingerprint,
    imageUrl: '',
    sourceImageUrl: originalSourceImageUrl,
    sourceImageMediaId: originalSourceImageMediaId,
    sourceImageMimeType: originalSourceImageMimeType,
    generatedImageMediaId: generatedPosterMediaId,
    generatedImageMimeType: generatedPosterMimeType,
    imageMediaId: templateHeaderMediaId,
    imageMimeType: templateHeaderMimeType,
    imageSource: templateHeaderSource,
    inboxEntryId,
    status: existingQueue?.status || 'pending_approval',
    updatedAt: nowIso,
  };

  let queueId = existingQueue?.id || '';
  if (queueId) {
    await rtdbUpdate(`agency_queue/${queueId}`, queuePayload);
  } else {
    queueId = await rtdbPush('agency_queue', {
      ...queuePayload,
      createdAt: nowIso,
    });
  }

  const allVacancies = await rtdbGetAll('vacancies');
  let vacancyId = existingQueue?.approvedVacancyId || '';
  let existingVacancy = vacancyId ? await rtdbGet(`vacancies/${vacancyId}`) : null;

  if (!existingVacancy) {
    const matchedVacancy = (allVacancies || []).find(item => item.sourceQueueId === queueId || item.sourceFingerprint === sourceFingerprint);
    if (matchedVacancy) {
      vacancyId = matchedVacancy.id;
      existingVacancy = matchedVacancy;
    }
  }

  const vacancyPayload = {
    agencyName: agencyName || existingVacancy?.agencyName || 'Agency Vacancy',
    skill: normalizedDetails.skill || existingVacancy?.skill || 'General',
    title: normalizedDetails.skill || existingVacancy?.title || 'General',
    country: normalizedDetails.country || existingVacancy?.country || 'Gulf',
    salary: normalizedDetails.salary || existingVacancy?.salary || '',
    companyName: normalizedDetails.company || existingVacancy?.companyName || '',
    serviceCharge: normalizedDetails.serviceCharge || existingVacancy?.serviceCharge || '',
    documents: normalizedDetails.documents || existingVacancy?.documents || [],
    timeline: normalizedDetails.timeline || existingVacancy?.timeline || '',
    location: normalizedDetails.location || existingVacancy?.location || '',
    duty: normalizedDetails.duty || existingVacancy?.duty || '',
    contract: normalizedDetails.contract || existingVacancy?.contract || '',
    note: normalizedDetails.note || existingVacancy?.note || '',
    quantity: normalizedDetails.quantity || existingVacancy?.quantity || '',
    assignedTemplateName: queuePayload.assignedTemplateName,
    metaTemplateId: existingQueue?.metaTemplateId || existingVacancy?.metaTemplateId || '',
    metaTemplateName: existingQueue?.metaTemplateName || existingVacancy?.metaTemplateName || '',
    metaTemplateStatus: existingQueue?.metaTemplateStatus || existingVacancy?.metaTemplateStatus || 'DRAFT_READY',
    metaTemplateError: existingQueue?.metaTemplateError || existingVacancy?.metaTemplateError || '',
    originalCharge: parseAmount(normalizedDetails.serviceCharge || existingVacancy?.originalCharge || 0),
    candidatePrice: existingVacancy?.candidatePrice || 0,
    candidateFacingText: queuePayload.candidateFacingText,
    templateDraftBody: queuePayload.templateDraftBody,
    submittedTemplateBody: existingQueue?.submittedTemplateBody || existingVacancy?.submittedTemplateBody || '',
    draftNeedsSubmission: typeof existingQueue?.draftNeedsSubmission === 'boolean'
      ? existingQueue.draftNeedsSubmission
      : true,
    generatedTemplates: queuePayload.generatedTemplates,
    originalForm: normalizedRawText,
    rawText: normalizedRawText,
    sourceType,
    sourceQueueId: queueId,
    sourceFingerprint,
    imageUrl: '',
    sourceImageUrl: originalSourceImageUrl,
    sourceImageMediaId: originalSourceImageMediaId,
    sourceImageMimeType: originalSourceImageMimeType,
    generatedImageMediaId: generatedPosterMediaId,
    generatedImageMimeType: generatedPosterMimeType,
    imageMediaId: templateHeaderMediaId,
    imageMimeType: templateHeaderMimeType,
    imageSource: templateHeaderSource,
    status: 'active',
    approvalState: mapDraftWorkflowStatus(
      existingQueue?.metaTemplateStatus || existingVacancy?.metaTemplateStatus || 'DRAFT_READY',
      typeof existingQueue?.draftNeedsSubmission === 'boolean'
        ? existingQueue.draftNeedsSubmission
        : true,
    ),
    publishedAt: existingVacancy?.publishedAt || nowIso,
    updatedAt: nowIso,
  };

  if (vacancyId) {
    await rtdbUpdate(`vacancies/${vacancyId}`, vacancyPayload);
  } else {
    vacancyId = await rtdbPush('vacancies', {
      ...vacancyPayload,
      createdAt: nowIso,
    });
  }

  const blastResult = summarizeBlastResult(existingQueue?.blastResult || existingVacancy?.autoBlast || {});

  await rtdbUpdate(`vacancies/${vacancyId}`, {
    autoBlast: blastResult,
    updatedAt: nowIso,
  });

  await rtdbUpdate(`agency_queue/${queueId}`, {
    approvedVacancyId: vacancyId,
    status: queuePayload.status,
    autoProcessedAt: nowIso,
    updatedAt: nowIso,
  });

  return {
    success: true,
    queueId,
    inboxEntryId,
    vacancyId,
    details: normalizedDetails,
    templates: queuePayload.generatedTemplates,
    candidateFacingText: queuePayload.candidateFacingText,
    templateDraftBody: queuePayload.templateDraftBody,
    metaTemplate: queuePayload.metaTemplateName
      ? {
          success: true,
          id: existingQueue?.metaTemplateId || '',
          name: queuePayload.metaTemplateName,
          status: queuePayload.metaTemplateStatus,
        }
      : {
          success: false,
          status: 'DRAFT_READY',
          error: 'ADMIN_SUBMISSION_REQUIRED',
        },
    blastResult,
    matchedCandidates: Number(existingQueue?.matchedCandidates || existingVacancy?.matchedCandidates || 0),
    duplicate: Boolean(existingQueue || existingVacancy),
    needsManualReview: true,
  };
}

module.exports = {
  buildRecruiterTemplates,
  buildCandidateUpdateText,
  extractVacancyFromText,
  ingestAgencyVacancy,
  normalizeVacancyDetails,
  saveAgencyTemplateDraft,
  submitAgencyTemplateDraft,
  shouldAutoProcessAgencyLead,
};
