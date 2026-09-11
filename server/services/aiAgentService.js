/**
 * AI Agent Service
 * Central Gemini 2.0 Flash utilities for vacancy scanning and structured AI responses.
 */

const axios = require('axios');
const { getNextAvailableKey, hasAnyKeys, markKeySuccess, markKeyRateLimited, markKeyBanned } = require('./aiKeyPoolService');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_PAID_API_KEY = process.env.GEMINI_PAID_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function getGeminiUrl(model = GEMINI_MODEL, apiKey = GEMINI_API_KEY) {
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

function cleanJsonFence(text = '') {
  return String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(parts, { temperature = 0.4, responseMimeType = 'application/json', useGoogleSearch = false } = {}) {
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      responseMimeType,
    },
  };

  if (useGoogleSearch) {
    body.tools = [{ google_search: {} }];
  }

  const poolActive = await hasAnyKeys('gemini');
  const triedPoolIds = [];
  const legacyRetryDelaysMs = [2000, 5000];
  const maxAttempts = poolActive ? 6 : legacyRetryDelaysMs.length + 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let currentApiKey;
    let currentKeyId = null;

    if (poolActive) {
      // Dashboard-managed key pool: skip RED (rate-limited/banned) keys automatically.
      const poolKey = await getNextAvailableKey('gemini', triedPoolIds);
      if (!poolKey) break;
      currentApiKey = poolKey.key;
      currentKeyId = poolKey.id;
      triedPoolIds.push(currentKeyId);
    } else {
      const usePaidKey = attempt > 0 && GEMINI_PAID_API_KEY;
      currentApiKey = usePaidKey ? GEMINI_PAID_API_KEY : GEMINI_API_KEY;
      if (usePaidKey) {
        console.log(`[Gemini] Free key rate-limited (429). Auto-switching to PAID API Key...`);
      }
    }

    if (!currentApiKey) break;

    try {
      const response = await axios.post(
        getGeminiUrl(GEMINI_MODEL, currentApiKey),
        body,
        { headers: { 'Content-Type': 'application/json' }, timeout: 120000 }
      );
      if (currentKeyId) await markKeySuccess(currentKeyId);
      const text = response.data?.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('\n').trim();
      return text || '';
    } catch (err) {
      const status = err.response?.status;

      if (status === 429) {
        if (currentKeyId) {
          console.log(`[Gemini] Key rate-limited (429), marking RED and trying next pool key...`);
          await markKeyRateLimited(currentKeyId, err.response?.data);
          continue;
        }
        if (attempt === legacyRetryDelaysMs.length) throw err;
        await sleep(legacyRetryDelaysMs[attempt]);
        continue;
      }

      if (status === 403 && currentKeyId) {
        console.log(`[Gemini] Key rejected (403), marking RED for extended cooldown...`);
        await markKeyBanned(currentKeyId, err.response?.data?.error?.message || err.message);
        continue;
      }

      throw err;
    }
  }

  throw new Error('ALL_GEMINI_KEYS_EXHAUSTED');
}

async function callGeminiJson(parts, options = {}) {
  const raw = await callGemini(parts, { ...options, responseMimeType: 'application/json' });
  return JSON.parse(cleanJsonFence(raw) || '{}');
}

function inferCountryFromText(text = '') {
  const lower = String(text).toLowerCase();
  if (lower.includes('saudi')) return 'Saudi';
  if (lower.includes('uae') || lower.includes('dubai') || lower.includes('abu dhabi')) return 'UAE';
  if (lower.includes('qatar')) return 'Qatar';
  if (lower.includes('kuwait')) return 'Kuwait';
  if (lower.includes('oman')) return 'Oman';
  if (lower.includes('bahrain')) return 'Bahrain';
  return 'Gulf';
}

function inferSkillFromText(text = '') {
  const lower = String(text).toLowerCase();
  const skills = [
    'carpenter', 'plumber', 'electrician', 'ac technician', 'mason', 'welder',
    'painter', 'driver', 'security guard', 'cook', 'cleaner', 'fabricator',
    'mechanic', 'helper', 'tiler', 'hvac technician', 'general'
  ];
  const found = skills.find(skill => lower.includes(skill));
  return found ? found.split(' ').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ') : 'General';
}

function inferSalaryFromText(text = '') {
  const match = String(text).match(/(\d[\d,\s]{2,}\s?(?:PKR|SAR|AED|QAR|OMR|BHD|riyal|riyal)?)/i);
  return match ? match[1].replace(/\s+/g, ' ').trim() : 'Negotiable';
}

function buildInternalTemplateLabel(details = {}) {
  const skill = String(details.skill || 'general')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const country = String(details.country || 'gulf')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `recruiter_update_${skill}_${country}`.slice(0, 80);
}

function buildSimpleTemplates(details = {}) {
  const skill = details.skill || 'candidate';
  const country = details.country || 'Gulf';
  const salary = details.salary || 'Attractive salary';
  return [
    {
      id: 'urgent_hinglish',
      text: `${skill} ki urgent hiring ${country} ke liye. Salary ${salary}. Interested hon to foran reply karein.`
    },
    {
      id: 'pro_english',
      text: `Urgent hiring for ${skill} in ${country}. Salary: ${salary}. Gulf Career Gateway is now taking applications.`
    },
    {
      id: 'arabic_marketing',
      text: `${country} ke liye ${skill} ki hiring open hai. Salary ${salary}. Apply with Gulf Career Gateway today.`
    }
  ];
}

async function extractVacancyFromImage(imageBuffer, mimeType = 'image/jpeg') {
  const result = await callGeminiJson([
    {
      text: `You are extracting vacancy information from a recruitment poster image.
Return JSON only:
{
  "rawText": "string",
  "details": {
    "skill": "string",
    "country": "string",
    "salary": "string",
    "company": "string",
    "serviceCharge": "string",
    "documents": ["string"],
    "timeline": "string",
    "quantity": "string"
  },
  "templates": [
    { "id": "urgent_hinglish", "text": "string" },
    { "id": "pro_english", "text": "string" },
    { "id": "arabic_marketing", "text": "string" }
  ]
}
Rules:
- If some fields are missing in the image, infer conservatively or return empty string.
- rawText should contain the readable vacancy text in one string.
- Keep templates practical and recruiter-friendly.`
    },
    {
      inline_data: {
        mime_type: mimeType || 'image/jpeg',
        data: imageBuffer.toString('base64'),
      }
    }
  ], { temperature: 0.2 });

  const rawText = String(result.rawText || '').trim();
  if (!rawText) {
    throw new Error('CORRUPT_OR_EMPTY_IMAGE');
  }

  const details = {
    skill: result.details?.skill || inferSkillFromText(rawText),
    country: result.details?.country || inferCountryFromText(rawText),
    salary: result.details?.salary || inferSalaryFromText(rawText),
    company: result.details?.company || '',
    serviceCharge: result.details?.serviceCharge || '',
    documents: Array.isArray(result.details?.documents) ? result.details.documents : [],
    timeline: result.details?.timeline || '',
    quantity: result.details?.quantity || '',
  };

  return {
    rawText,
    details,
    templates: Array.isArray(result.templates) && result.templates.length > 0 ? result.templates : buildSimpleTemplates(details),
  };
}

async function processVacancyPoster(imageBuffer, mimeType = 'image/jpeg') {
  try {
    const scan = await extractVacancyFromImage(imageBuffer, mimeType);
    return {
      success: true,
      rawText: scan.rawText,
      templates: scan.templates,
      details: scan.details,
      assignedTemplateName: buildInternalTemplateLabel(scan.details),
    };
  } catch (error) {
    console.error('[AI Agent] Vacancy poster scan failed:', error.message);
    if (error.message === 'CORRUPT_OR_EMPTY_IMAGE') {
      throw error;
    }
    throw new Error('CORRUPT_OR_EMPTY_IMAGE');
  }
}

async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  try {
    const response = await callGemini([
      {
        text: 'Listen to this audio and return the transcription as plain text. If it is a command or question, just write the words spoken. No prefix or chatter. English/Hinglish as spoken.',
      },
      {
        inline_data: {
          mime_type: mimeType || 'audio/ogg',
          data: audioBuffer.toString('base64'),
        },
      },
    ], { temperature: 0.1, responseMimeType: 'text/plain' });

    return String(response || '').trim();
  } catch (err) {
    console.error('[AI Agent] Transcription failed:', err.message);
    return '';
  }
}

module.exports = {
  GEMINI_MODEL,
  callGemini,
  callGeminiJson,
  processVacancyPoster,
  transcribeAudio,
};
