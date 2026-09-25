/**
 * Meta WhatsApp Business Accounts Dictionary & Resolver
 * Maps Phone Number IDs, WhatsApp Business Account IDs (WABA IDs), and Display Numbers
 */

const KNOWN_META_ACCOUNTS = {
  // 1. gcg arstudio (+91 80773 45658)
  '1231432513384580': {
    phoneNumberId: '1231432513384580',
    wabaId: '2042807033001085',
    displayPhoneNumber: '+91 80773 45658',
    cleanNumber: '918077345658',
    accountName: 'gcg arstudio',
    shortLabel: 'ARS (+91 80773 45658)',
    tagColor: '#f59e0b',
    botType: 'ARS'
  },
  // 2. Aamils — aamils.com websites/apps (+91 75995 10170). Was Gulf Career
  // Gateway until 2026-09-25; handled by aamilsConversationService.
  '782096074998071': {
    phoneNumberId: '782096074998071',
    wabaId: '2077696422968224',
    displayPhoneNumber: '+91 75995 10170',
    cleanNumber: '917599510170',
    accountName: 'Aamils',
    shortLabel: 'AAMILS (+91 75995 10170)',
    tagColor: '#4da3ff',
    botType: 'AAMILS'
  },
  // 3. GUL CAREER GATEWAY1 (+91 94110 55707)
  '1004575229405481': {
    phoneNumberId: '1004575229405481',
    wabaId: '1636003747813268',
    displayPhoneNumber: '+91 94110 55707',
    cleanNumber: '919411055707',
    accountName: 'GUL CAREER GATEWAY1',
    shortLabel: 'GCG 1 (+91 94110 55707)',
    tagColor: '#10b981',
    botType: 'GCG'
  }
};

/**
 * Resolve full Meta Business Account info from phone number ID, display phone number, or WABA ID
 */
function resolveMetaAccountInfo({ phoneNumberId, displayPhoneNumber, wabaId } = {}) {
  const cleanId = String(phoneNumberId || '').trim();
  const cleanPhone = String(displayPhoneNumber || '').replace(/\D/g, '');
  const cleanWaba = String(wabaId || '').trim();

  // 1. Match by Phone Number ID
  if (cleanId && KNOWN_META_ACCOUNTS[cleanId]) {
    return KNOWN_META_ACCOUNTS[cleanId];
  }

  // 2. Match by clean phone number
  if (cleanPhone) {
    for (const acc of Object.values(KNOWN_META_ACCOUNTS)) {
      if (acc.cleanNumber === cleanPhone || acc.cleanNumber.endsWith(cleanPhone) || cleanPhone.endsWith(acc.cleanNumber)) {
        return acc;
      }
    }
  }

  // 3. Match by WABA ID
  if (cleanWaba) {
    for (const acc of Object.values(KNOWN_META_ACCOUNTS)) {
      if (acc.wabaId === cleanWaba) {
        return acc;
      }
    }
  }

  // Fallback for custom or newly added numbers
  return {
    phoneNumberId: cleanId || null,
    wabaId: cleanWaba || null,
    displayPhoneNumber: displayPhoneNumber || (cleanPhone ? `+${cleanPhone}` : null),
    cleanNumber: cleanPhone || null,
    accountName: displayPhoneNumber ? `Business (${displayPhoneNumber})` : 'Meta Business Account',
    shortLabel: displayPhoneNumber || cleanId || 'Meta Number',
    tagColor: '#64748b',
    botType: 'GCG'
  };
}

module.exports = {
  KNOWN_META_ACCOUNTS,
  resolveMetaAccountInfo
};
