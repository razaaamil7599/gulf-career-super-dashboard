const { rtdbGetAll } = require('./firebaseService');
const { isAdminPhone } = require('./adminControlService');

const AGENCY_KEYWORDS = ['vacancy', 'requirement', 'demand letter', 'job order', 'hiring'];

function normalizePhone(phone = '') {
  return String(phone || '').replace(/\D/g, '');
}

function phoneMatches(left = '', right = '') {
  const a = normalizePhone(left);
  const b = normalizePhone(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function candidatePhoneFields(record = {}) {
  return [record.phone, record.whatsapp, record.mobile, record.contact].filter(Boolean);
}

function agencyPhoneFields(record = {}) {
  return [record.contact, record.phoneNumber, record.phone, record.whatsapp, record.mobile].filter(Boolean);
}

async function resolveIdentity({ from = '', body = '' } = {}) {
  const normalizedFrom = normalizePhone(from);
  const [candidates, agencies] = await Promise.all([
    rtdbGetAll('candidates'),
    rtdbGetAll('agencies'),
  ]);

  const candidateRecord = (candidates || []).find((candidate) => (
    candidatePhoneFields(candidate).some((phone) => phoneMatches(phone, normalizedFrom))
  )) || null;

  const agencyRecord = (agencies || []).find((agency) => (
    agencyPhoneFields(agency).some((phone) => phoneMatches(phone, normalizedFrom))
  )) || null;

  const metadata = {
    ...(candidateRecord || {}),
    ...(agencyRecord || {}),
    id: agencyRecord?.id || candidateRecord?.id || '',
    phone: normalizedFrom,
  };

  if (isAdminPhone(normalizedFrom)) {
    return {
      tag: 'ADMIN',
      isAuthorized: true,
      metadata,
    };
  }

  if (candidateRecord?.isAgency === true || agencyRecord) {
    return {
      tag: 'AGENCY',
      isAuthorized: agencyRecord ? agencyRecord.isAuthorized !== false : true,
      metadata,
      candidateRecord,
      agencyRecord,
      source: candidateRecord?.isAgency === true ? 'candidate.isAgency' : 'agencies',
    };
  }

  const lowerBody = String(body || '').toLowerCase();
  const isPotential = AGENCY_KEYWORDS.some((keyword) => lowerBody.includes(keyword));
  if (isPotential) {
    return {
      tag: 'POTENTIAL_AGENCY',
      isAuthorized: false,
      metadata,
      candidateRecord,
      agencyRecord,
      source: 'keyword',
      alert: 'Potential agency detected',
    };
  }

  return {
    tag: 'CANDIDATE',
    isAuthorized: false,
    metadata,
    candidateRecord,
    agencyRecord,
    source: candidateRecord ? 'candidates' : 'default',
  };
}

module.exports = {
  normalizePhone,
  resolveIdentity,
};
