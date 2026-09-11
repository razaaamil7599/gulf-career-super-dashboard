/**
 * Matching Service
 * Real-time vacancy ↔ candidate matching logic.
 * Queries RTDB /candidates filtered by normalized skill + country.
 */

const { rtdbGetAll } = require('./firebaseService');
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

async function matchCandidates({ skill, country, search } = {}) {
  try {
    const allCandidates = await rtdbGetAll('candidates');
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

async function getSkillCounts() {
  const allCandidates = await rtdbGetAll('candidates');
  return buildCategoryCounts(Array.isArray(allCandidates) ? allCandidates : []);
}

async function getCountryCounts() {
  const allCandidates = await rtdbGetAll('candidates');
  return buildCountryCounts(Array.isArray(allCandidates) ? allCandidates : []);
}

module.exports = {
  matchCandidates,
  getSkillCounts,
  getCountryCounts,
  getInferredCountry,
};
