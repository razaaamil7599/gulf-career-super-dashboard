/**
 * Frontend Meta WhatsApp Business Accounts Helper
 * Maps Phone Number IDs, WhatsApp Business Account IDs (WABA IDs), and Display Numbers
 */

export interface MetaAccountInfo {
  phoneNumberId: string | null;
  wabaId: string | null;
  displayPhoneNumber: string | null;
  cleanNumber: string | null;
  accountName: string;
  shortLabel: string;
  tagColor: string;
  botType: 'GCG' | 'ARS';
}

export const KNOWN_META_ACCOUNTS: Record<string, MetaAccountInfo> = {
  // 1. gcg arstudio (+91 80773 45658)
  '1231432513384580': {
    phoneNumberId: '1231432513384580',
    wabaId: '2042807033001085',
    displayPhoneNumber: '+91 80773 45658',
    cleanNumber: '918077345658',
    accountName: 'gcg arstudio',
    shortLabel: 'ARS (+91 80773 45658)',
    tagColor: '#fb923c',
    botType: 'ARS'
  },
  // 2. Gulf Career Gateway (+91 75995 10170)
  '782096074998071': {
    phoneNumberId: '782096074998071',
    wabaId: '2077696422968224',
    displayPhoneNumber: '+91 75995 10170',
    cleanNumber: '917599510170',
    accountName: 'Gulf Career Gateway',
    shortLabel: 'GCG (+91 75995 10170)',
    tagColor: '#38bdf8',
    botType: 'GCG'
  },
  // 3. GUL CAREER GATEWAY1 (+91 94110 55707)
  '1004575229405481': {
    phoneNumberId: '1004575229405481',
    wabaId: '1636003747813268',
    displayPhoneNumber: '+91 94110 55707',
    cleanNumber: '919411055707',
    accountName: 'GUL CAREER GATEWAY1',
    shortLabel: 'GCG 1 (+91 94110 55707)',
    tagColor: '#34d399',
    botType: 'GCG'
  }
};

/**
 * Resolve Meta Account info from candidate or message metadata
 */
export function resolveMetaAccountInfo(params?: {
  phoneNumberId?: string | null;
  displayPhoneNumber?: string | null;
  wabaId?: string | null;
  lastRecipientPhoneId?: string | null;
  lastRecipientPhone?: string | null;
  botType?: string | null;
  bot_name?: string | null;
}): MetaAccountInfo {
  if (!params) {
    return {
      phoneNumberId: null,
      wabaId: null,
      displayPhoneNumber: null,
      cleanNumber: null,
      accountName: 'Gulf Career Gateway',
      shortLabel: 'GCG',
      tagColor: '#38bdf8',
      botType: 'GCG'
    };
  }

  const phoneId = String(params.phoneNumberId || params.lastRecipientPhoneId || '').trim();
  const phone = String(params.displayPhoneNumber || params.lastRecipientPhone || '').replace(/\D/g, '');
  const waba = String(params.wabaId || '').trim();

  // 1. Direct Phone Number ID match
  if (phoneId && KNOWN_META_ACCOUNTS[phoneId]) {
    return KNOWN_META_ACCOUNTS[phoneId];
  }

  // 2. Clean Phone Number match
  if (phone) {
    for (const acc of Object.values(KNOWN_META_ACCOUNTS)) {
      if (acc.cleanNumber === phone || acc.cleanNumber?.endsWith(phone) || phone.endsWith(acc.cleanNumber || '')) {
        return acc;
      }
    }
  }

  // 3. WABA ID match
  if (waba) {
    for (const acc of Object.values(KNOWN_META_ACCOUNTS)) {
      if (acc.wabaId === waba) {
        return acc;
      }
    }
  }

  // 4. Fallback from botType / bot_name
  if (params.botType === 'ARS' || params.bot_name === 'AR Studios') {
    return KNOWN_META_ACCOUNTS['1231432513384580'];
  }

  // Generic fallback if partial data exists
  if (phoneId || phone || waba) {
    return {
      phoneNumberId: phoneId || null,
      wabaId: waba || null,
      displayPhoneNumber: params.displayPhoneNumber || params.lastRecipientPhone || (phone ? `+${phone}` : null),
      cleanNumber: phone || null,
      accountName: params.displayPhoneNumber || params.lastRecipientPhone || (phoneId ? `ID: ${phoneId}` : 'Meta Account'),
      shortLabel: params.displayPhoneNumber || params.lastRecipientPhone || phoneId || 'Meta Number',
      tagColor: '#94a3b8',
      botType: 'GCG'
    };
  }

  // Default to main GCG account
  return KNOWN_META_ACCOUNTS['782096074998071'];
}
