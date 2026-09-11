const { rtdbGet, rtdbGetAll, rtdbUpdate } = require('./firebaseService');
const { getAllChatLogs } = require('./googleSheetsService');
const {
  normalizePhone,
  normalizeSkill,
  normalizeCountry,
  sanitizeCandidateName,
  sanitizeCandidateProfile,
  buildCategoryCounts,
  buildCountryCounts,
  getFallbackCandidateName,
} = require('./candidateProfileService');

function sortMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const left = new Date(a.timestamp || a.createdAt || 0).getTime() || 0;
    const right = new Date(b.timestamp || b.createdAt || 0).getTime() || 0;
    return left - right;
  });
}

function dedupeMessages(messages = []) {
  const seen = new Set();
  const deduped = [];

  for (const message of messages) {
    const key = `${message.direction}|${message.timestamp}|${message.body}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(message);
  }

  return deduped;
}

function indexSheetLogs(logs = []) {
  const byPhone = new Map();

  for (const log of logs) {
    const phone = normalizePhone(log.phone || '');
    if (!phone) continue;
    if (!byPhone.has(phone)) byPhone.set(phone, []);
    byPhone.get(phone).push({
      ...log,
      phone,
      source: 'google_sheet',
    });
  }

  return byPhone;
}

function indexFirebaseMessages(rawMessages = {}) {
  const byPhone = new Map();

  for (const [phoneKey, value] of Object.entries(rawMessages || {})) {
    const phone = normalizePhone(phoneKey);
    if (!phone) continue;
    const messages = Object.values(value || {}).map((entry) => ({
      direction: entry.direction || 'unknown',
      body: entry.body || '',
      timestamp: entry.timestamp || entry.createdAt || '',
      type: entry.type || 'text',
      source: 'firebase',
    })).filter((entry) => entry.body);
    byPhone.set(phone, messages);
  }

  return byPhone;
}

function buildCandidateUpdatePatch(candidateId, updates = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(updates)) {
    patch[`candidates/${candidateId}/${key}`] = value;
  }
  return patch;
}

async function runCandidateProfileBackfill({ apply = true } = {}) {
  const [candidates, rawMessages, sheetLogs] = await Promise.all([
    rtdbGetAll('candidates'),
    rtdbGet('messages'),
    getAllChatLogs(),
  ]);

  const firebaseIndex = indexFirebaseMessages(rawMessages || {});
  const sheetIndex = indexSheetLogs(sheetLogs || []);
  const aggregatePatch = {};
  const touched = [];

  const candidatesByPhone = new Map();
  for (const candidate of candidates) {
    const phone = normalizePhone(candidate.phone || '');
    if (phone) {
      candidatesByPhone.set(phone, candidate);
    }
  }

  const allPhones = new Set([
    ...candidatesByPhone.keys(),
    ...firebaseIndex.keys(),
    ...sheetIndex.keys(),
  ]);

  for (const phone of allPhones) {
    const candidate = candidatesByPhone.get(phone);
    const isNew = !candidate;

    const baseCandidate = candidate || {
      id: phone,
      phone: phone,
      name: '',
      skill: '',
      country: '',
      preferredCountry: '',
      experience: 0,
      availability: '',
      documentsReady: '',
      status: 'pending_re-profiling',
      createdAt: new Date().toISOString(),
    };

    const mergedMessages = dedupeMessages(sortMessages([
      ...(firebaseIndex.get(phone) || []),
      ...(sheetIndex.get(phone) || []),
    ]));

    const latestInbound = [...mergedMessages].reverse().find(
      (message) => String(message.direction || '').toLowerCase() === 'inbound'
    );

    const derived = sanitizeCandidateProfile({
      existingCandidate: baseCandidate,
      contactName: baseCandidate.name || '',
      latestMessage: latestInbound?.body || '',
      messages: mergedMessages,
      aiProfile: {},
    });

    const safeExistingName = sanitizeCandidateName(baseCandidate.name || '');
    const safeExistingSkill = normalizeSkill(baseCandidate.skill || '', baseCandidate.notes || '');
    const safeExistingCountry = normalizeCountry(baseCandidate.country || '', baseCandidate.notes || '');
    const safeExistingPreferredCountry = normalizeCountry(baseCandidate.preferredCountry || '', baseCandidate.notes || '');

    const next = {
      phone: phone,
      name: derived.name || safeExistingName || getFallbackCandidateName(phone),
      skill: derived.skill || safeExistingSkill || 'Uncategorized',
      country: derived.country || safeExistingCountry || 'Unspecified',
      preferredCountry: derived.preferredCountry || safeExistingPreferredCountry || derived.country || safeExistingCountry || 'Unspecified',
      experience: derived.experience ?? baseCandidate.experience ?? 0,
      availability: derived.availability || baseCandidate.availability || '',
      documentsReady: derived.documentsReady || baseCandidate.documentsReady || '',
      updatedAt: new Date().toISOString(),
    };

    if (isNew) {
      next.createdAt = baseCandidate.createdAt || new Date().toISOString();
      next.status = baseCandidate.status || 'pending_re-profiling';
    }

    const hasChanges = isNew ||
      String(baseCandidate.name || '') !== String(next.name || '') ||
      String(baseCandidate.skill || '') !== String(next.skill || '') ||
      String(baseCandidate.country || '') !== String(next.country || '') ||
      String(baseCandidate.preferredCountry || '') !== String(next.preferredCountry || '') ||
      Number(baseCandidate.experience || 0) !== Number(next.experience || 0) ||
      String(baseCandidate.availability || '') !== String(next.availability || '') ||
      String(baseCandidate.documentsReady || '') !== String(next.documentsReady || '');

    if (!hasChanges) continue;

    Object.assign(aggregatePatch, buildCandidateUpdatePatch(baseCandidate.id, next));
    touched.push({
      id: baseCandidate.id,
      phone,
      isNew,
      before: {
        name: baseCandidate.name || '',
        skill: baseCandidate.skill || '',
      },
      after: {
        name: next.name || '',
        skill: next.skill || '',
      },
    });
  }

  if (apply && Object.keys(aggregatePatch).length) {
    const entries = Object.entries(aggregatePatch);
    const chunkSize = 400;
    for (let index = 0; index < entries.length; index += chunkSize) {
      await rtdbUpdate('/', Object.fromEntries(entries.slice(index, index + chunkSize)));
    }
  }

  const refreshedCandidates = apply
    ? await rtdbGetAll('candidates')
    : candidates;

  return {
    scannedCandidates: allPhones.size,
    newCandidatesCreated: touched.filter(t => t.isNew).length,
    updatedCandidates: touched.filter(t => !t.isNew).length,
    samples: touched.slice(0, 25),
    skillCounts: buildCategoryCounts(refreshedCandidates),
    countryCounts: buildCountryCounts(refreshedCandidates),
  };
}

module.exports = {
  runCandidateProfileBackfill,
};
