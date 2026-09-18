/**
 * Matching Service
 * Real-time vacancy ↔ candidate matching logic.
 * Queries RTDB /candidates filtered by normalized skill + country.
 */

const { rtdbGetAll, getDb } = require('./firebaseService');
const {
  normalizeSkill,
  normalizeCountry,
  buildCategoryCounts,
  buildCountryCounts,
} = require('./candidateProfileService');

function normalizeSearchValue(value = '') {
  return String(value || '').trim().toLowerCase();
}

function normalizePhone(value = '') {
  return String(value || '').replace(/\D/g, '');
}

function getNormalizedCandidateSkill(candidate = {}) {
  return normalizeSkill(candidate.skill || '', candidate.notes || '') || 'Uncategorized';
}

function getInferredCountry(candidate = {}) {
  return normalizeCountry(candidate.preferredCountry || candidate.country || '', candidate.notes || '') || 'Unspecified';
}

async function fetchRecentCandidates(limit = 300) {
  const db = getDb();
  const snap = await db.ref('candidates').orderByChild('lastInboundAt').limitToLast(limit).once('value');
  const val = snap.val();
  if (!val) return [];
  return Object.entries(val).map(([key, data]) => ({ ...data, id: key }));
}

// A single shared, periodically-refreshed copy of the full candidate list.
// The whole dataset is small (~2MB), but this free-tier instance is tight
// enough on real usable memory that even ONE full JSON parse of it was
// crashing the process with a heap OOM whenever it happened often — and it
// was happening far more often than any dashboard polling: every single
// inbound WhatsApp/Messenger/Instagram message calls findCandidateByPhone(),
// which used to re-fetch and re-parse the entire node from Firebase on
// every message. Every caller that needs the full list (candidate counts,
// filtered dashboard search, and per-message phone lookups) now shares this
// one cache instead of each doing its own independent full scan — at most
// one full fetch happens per refresh window, no matter how much traffic
// (webhook messages or dashboard polling) is hitting the server.
const CANDIDATES_CACHE_TTL_MS = 3 * 60 * 1000;
let candidatesCache = null;
let candidatesCacheAt = 0;
let candidatesCacheInFlight = null;

async function getCachedCandidates() {
  const isFresh = candidatesCache && Date.now() - candidatesCacheAt < CANDIDATES_CACHE_TTL_MS;
  if (isFresh) return candidatesCache;
  if (candidatesCacheInFlight) return candidatesCacheInFlight;

  candidatesCacheInFlight = (async () => {
    try {
      const allCandidates = await rtdbGetAll('candidates');
      candidatesCache = Array.isArray(allCandidates) ? allCandidates : [];
      candidatesCacheAt = Date.now();
      return candidatesCache;
    } finally {
      candidatesCacheInFlight = null;
    }
  })();

  return candidatesCacheInFlight;
}

async function matchCandidates({ skill, country, search } = {}) {
  try {
    // A plain, unfiltered poll (the dashboard's default refresh, hit every
    // few seconds) is by far the most frequent dashboard-side caller here
    // and only ever needs the most recently active candidates, so it uses
    // a cheap indexed query instead of the full cached list. Filtered/
    // search calls need the whole pool, so they read from the shared cache
    // above instead of doing their own independent full scan.
    const isFiltered = Boolean(skill || country || search);
    const allCandidates = isFiltered ? await getCachedCandidates() : await fetchRecentCandidates();
    if (!Array.isArray(allCandidates)) return { count: 0, candidates: [] };

    const normalizedSkillFilter = normalizeSkill(skill || '', skill || '');
    const normalizedCountryFilter = normalizeCountry(country || '', country || '');
    const searchTerm = normalizeSearchValue(search);
    const numericSearch = normalizePhone(search);

    const matched = allCandidates.filter((candidate) => {
      const candidateSkill = getNormalizedCandidateSkill(candidate);
      const candidateCountry = getInferredCountry(candidate);
      const candidateName = normalizeSearchValue(candidate.name || '');
      const candidatePhone = normalizePhone(candidate.phone || '');
      const notes = normalizeSearchValue(candidate.notes || '');

      const skillMatch = !normalizedSkillFilter || candidateSkill === normalizedSkillFilter;
      const countryMatch = !normalizedCountryFilter || candidateCountry === normalizedCountryFilter;

      const searchMatch =
        !searchTerm ||
        candidateName.includes(searchTerm) ||
        notes.includes(searchTerm) ||
        (numericSearch && candidatePhone.includes(numericSearch));

      return skillMatch && countryMatch && searchMatch;
    });

    // Most recent activity first — the dashboard's candidate cards should read
    // as newest message/chat at the top, older ones further down.
    matched.sort((a, b) => {
      const aTs = new Date(a.lastInboundAt || a.updatedAt || a.createdAt || 0).getTime();
      const bTs = new Date(b.lastInboundAt || b.updatedAt || b.createdAt || 0).getTime();
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
    });

    return {
      count: matched.length,
      candidates: matched,
    };
  } catch (error) {
    console.error('[matchingService] matchCandidates failed:', error);
    return { count: 0, candidates: [] };
  }
}

async function getCandidateCounts() {
  const candidates = await getCachedCandidates();
  return {
    skills: buildCategoryCounts(candidates),
    countries: buildCountryCounts(candidates),
  };
}

async function getSkillCounts() {
  const { skills } = await getCandidateCounts();
  return skills;
}

async function getCountryCounts() {
  const { countries } = await getCandidateCounts();
  return countries;
}

module.exports = {
  matchCandidates,
  getCachedCandidates,
  getCandidateCounts,
  getSkillCounts,
  getCountryCounts,
  getInferredCountry,
};
