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

async function matchCandidates({ skill, country, search } = {}) {
  try {
    // A plain, unfiltered poll (the dashboard's default refresh, hit every
    // few seconds) is by far the most frequent caller here and only ever
    // needs the most recently active candidates — loading and JSON-parsing
    // all 4000+ candidate records into memory on every refresh is what was
    // repeatedly crashing the free-tier instance with a heap OOM (every
    // crash briefly took the whole dashboard down, which is what made
    // chats look like they kept "disappearing"). Only fall back to a full
    // scan when the caller is actually filtering/searching across the
    // whole pool.
    const isFiltered = Boolean(skill || country || search);
    const allCandidates = isFiltered ? await rtdbGetAll('candidates') : await fetchRecentCandidates();
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

// getSkillCounts/getCountryCounts used to each independently do a full
// rtdbGetAll('candidates') and were called together via Promise.all from
// the /counts route — two concurrent full-table JSON parses of the whole
// candidate pool at once, which was doubling the OOM risk on every counts
// request. getCandidateCounts() does the fetch once and computes both
// breakdowns from that same array.
async function getCandidateCounts() {
  const allCandidates = await rtdbGetAll('candidates');
  const candidates = Array.isArray(allCandidates) ? allCandidates : [];
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
  getCandidateCounts,
  getSkillCounts,
  getCountryCounts,
  getInferredCountry,
};
