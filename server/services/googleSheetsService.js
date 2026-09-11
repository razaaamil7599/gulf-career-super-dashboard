const axios = require('axios');
const { JWT, GoogleAuth } = require('google-auth-library');
const { normalizeWhatsAppNumber } = require('./whatsappService');
const { loadServiceAccount } = require('./googleCredentialService');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_SHEET_TAB = process.env.SHEET_TAB_NAME || 'Sheet1';
const DEFAULT_OUTPUT_SHEET_TAB = process.env.SHEET_OUTPUT_TAB_NAME || 'Sheet2';
const SHEET_TIMEZONE_OFFSET_MINUTES = 330;

// Messenger and Instagram get their own tabs (kept separate per business request)
// instead of piling into the WhatsApp tab; anything else keeps the original
// single-tab behavior.
const CHANNEL_SHEET_TABS = {
  messenger: 'Facebook Messenger',
  instagram: 'Instagram',
};
function resolveSheetTabForChannel(channel) {
  return CHANNEL_SHEET_TABS[String(channel || '').toLowerCase()] || DEFAULT_SHEET_TAB;
}

let warnedMissingSheetId = false;
const tabsKnownToExist = new Set();

function getSheetId() {
  return process.env.SHEET_ID || '';
}

function getServiceAccount() {
  const { account } = loadServiceAccount({
    envKeys: ['FIREBASE_ADMIN_KEY', 'OLD_FIREBASE_ADMIN_KEY'],
    fallbackPath: require('path').join(__dirname, '../../firebase-service-account.json'),
  });
  return account || null;
}

async function getAccessTokenFromServiceAccount() {
  const serviceAccount = getServiceAccount();
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('GOOGLE_SHEETS_SERVICE_ACCOUNT_MISSING');
  }

  const client = new JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: [SHEETS_SCOPE],
  });

  const tokenResponse = await client.authorize();
  if (!tokenResponse?.access_token) {
    throw new Error('GOOGLE_SHEETS_ACCESS_TOKEN_MISSING');
  }

  return tokenResponse.access_token;
}

async function getAccessToken() {
  try {
    return await getAccessTokenFromServiceAccount();
  } catch (error) {
    console.warn(`[Sheets] Service account auth failed, trying ADC fallback: ${error.message}`);
  }

  const auth = new GoogleAuth({ scopes: [SHEETS_SCOPE] });
  const client = await auth.getClient();
  const tokenResponse = await client.getAccessToken();
  const accessToken = typeof tokenResponse === 'string' ? tokenResponse : tokenResponse?.token;

  if (!accessToken) {
    throw new Error('GOOGLE_SHEETS_ADC_ACCESS_TOKEN_MISSING');
  }

  return accessToken;
}

function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const sheetDate = new Date(validDate.getTime() + SHEET_TIMEZONE_OFFSET_MINUTES * 60 * 1000);
  return sheetDate.toISOString().replace(/\.\d{3}Z$/, '+05:30');
}

function formatPhoneForSheet(value) {
  const normalized = normalizeWhatsAppNumber(value);
  if (!normalized) {
    return String(value || '').trim();
  }

  // Leading apostrophe keeps the plus sign visible in Google Sheets.
  return `'${`+${normalized}`}`;
}

async function getSheetValues(range) {
  const sheetId = getSheetId();
  if (!sheetId) {
    return [];
  }

  const accessToken = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;
  const response = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    timeout: 15000,
  });

  return response.data?.values || [];
}

// Creates the tab if the spreadsheet doesn't already have one with this exact
// name. Cached per-process (tabsKnownToExist) so this only hits the Sheets API
// once per tab name, not on every single message.
async function ensureSheetTabExists(sheetName) {
  if (tabsKnownToExist.has(sheetName)) return;

  const sheetId = getSheetId();
  if (!sheetId) return;

  const accessToken = await getAccessToken();
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  const metaRes = await axios.get(metaUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  const exists = (metaRes.data.sheets || []).some((s) => s.properties.title === sheetName);

  if (!exists) {
    await axios.post(
      `${metaUrl}:batchUpdate`,
      { requests: [{ addSheet: { properties: { title: sheetName } } }] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
    );
  }

  tabsKnownToExist.add(sheetName);
}

async function ensureSheetHeaders(sheetName, headers) {
  try {
    const existing = await getSheetValues(`${sheetName}!A1:${String.fromCharCode(64 + headers.length)}1`);
    if (existing && existing.length > 0 && existing[0]?.length) {
      return;
    }
  } catch (_) {
    // ignore and attempt to append headers anyway
  }

  const accessToken = await getAccessToken();
  const sheetId = getSheetId();
  if (!sheetId) return;

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(`${sheetName}!A1`)}:append`;
  await axios.post(
    url,
    {
      values: [headers],
      majorDimension: 'ROWS',
    },
    {
      params: {
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
}

async function appendRowsToSheet({ sheetName, rows }) {
  const sheetId = getSheetId();
  if (!sheetId) {
    if (!warnedMissingSheetId) {
      warnedMissingSheetId = true;
      console.warn('[Sheets] SHEET_ID missing, append skipped.');
    }
    return { skipped: true, reason: 'SHEET_ID_MISSING' };
  }

  const accessToken = await getAccessToken();
  const range = `${sheetName}!A:Z`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append`;

  await axios.post(
    url,
    {
      values: rows,
      majorDimension: 'ROWS',
    },
    {
      params: {
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
      },
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );

  return { success: true };
}

async function appendChatLog({ phone, message, direction, timestamp, channel = 'whatsapp' }) {
  const sheetId = getSheetId();
  if (!sheetId) {
    if (!warnedMissingSheetId) {
      warnedMissingSheetId = true;
      console.warn('[Sheets] SHEET_ID missing, chat log append skipped.');
    }
    return { skipped: true, reason: 'SHEET_ID_MISSING' };
  }

  const sheetName = resolveSheetTabForChannel(channel);
  const row = [
    formatTimestamp(timestamp),
    formatPhoneForSheet(phone),
    String(message || ''),
    String(direction || '').toUpperCase(),
  ];

  try {
    if (sheetName !== DEFAULT_SHEET_TAB) {
      await ensureSheetTabExists(sheetName);
    }
    await appendRowsToSheet({ sheetName, rows: [row] });
    return { success: true };
  } catch (error) {
    const details = error.response?.data?.error?.message || error.message;
    console.warn(`[Sheets] Chat append failed for ${phone || 'unknown phone'}: ${details}`);
    return { success: false, error: details };
  }
}

async function getChatHistoryByPhone(phone, limit = 20) {
  const normalizedPhone = String(phone || '').replace(/\D/g, '');
  if (!normalizedPhone) return [];

  try {
    const rows = await getSheetValues(`${DEFAULT_SHEET_TAB}!A:D`);
    const matched = rows
      .filter(row => String(row[1] || '').replace(/\D/g, '') === normalizedPhone)
      .slice(-limit)
      .map(row => ({
        timestamp: row[0] || '',
        phone: row[1] || '',
        body: row[2] || '',
        direction: String(row[3] || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
        source: 'google_sheet',
      }));

    return matched;
  } catch (error) {
    const details = error.response?.data?.error?.message || error.message;
    console.warn(`[Sheets] History fetch failed for ${phone || 'unknown phone'}: ${details}`);
    return [];
  }
}

async function getAllChatLogs() {
  try {
    const rows = await getSheetValues(`${DEFAULT_SHEET_TAB}!A:D`);
    return rows.map(row => ({
      timestamp: row[0] || '',
      phone: row[1] || '',
      body: row[2] || '',
      direction: String(row[3] || '').toLowerCase() === 'outbound' ? 'outbound' : 'inbound',
      source: 'google_sheet',
    })).filter(row => row.phone && row.body);
  } catch (error) {
    const details = error.response?.data?.error?.message || error.message;
    console.warn(`[Sheets] Full chat fetch failed: ${details}`);
    return [];
  }
}

async function appendAgentOutputLog({
  phone = '',
  task = '',
  title = '',
  content = '',
  source = 'openclaw',
  timestamp,
  metadata = '',
  sheetName = DEFAULT_OUTPUT_SHEET_TAB,
} = {}) {
  try {
    await ensureSheetHeaders(sheetName, [
      'Timestamp',
      'Phone',
      'Task',
      'Title',
      'Content',
      'Source',
      'Metadata',
    ]);

    const row = [
      formatTimestamp(timestamp),
      formatPhoneForSheet(phone),
      String(task || ''),
      String(title || ''),
      String(content || ''),
      String(source || ''),
      String(metadata || ''),
    ];

    await appendRowsToSheet({ sheetName, rows: [row] });
    return { success: true };
  } catch (error) {
    const details = error.response?.data?.error?.message || error.message;
    console.warn(`[Sheets] Output append failed for ${phone || 'unknown phone'}: ${details}`);
    return { success: false, error: details };
  }
}

module.exports = {
  appendChatLog,
  getChatHistoryByPhone,
  getAllChatLogs,
  appendAgentOutputLog,
};
