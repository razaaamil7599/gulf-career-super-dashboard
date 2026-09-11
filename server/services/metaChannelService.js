/**
 * Meta Channel Service
 * Handles outgoing Facebook Messenger and Instagram DM messages via the
 * unified Meta Send API (Page-linked, uses PAGE_ACCESS_TOKEN).
 */

const axios = require('axios');

function getPageConfig() {
  return {
    accessToken: (process.env.PAGE_ACCESS_TOKEN || '').trim(),
    pageId: (process.env.PAGE_ID || '').trim(),
  };
}

async function sendUnifiedMessage(recipientId, text) {
  const { accessToken } = getPageConfig();
  if (!accessToken) {
    console.error('[Meta Channel Service] Missing PAGE_ACCESS_TOKEN.');
    return { success: false, error: 'PAGE_ACCESS_TOKEN_MISSING' };
  }
  if (!recipientId) {
    return { success: false, error: 'RECIPIENT_ID_MISSING' };
  }

  try {
    const payload = {
      recipient: { id: String(recipientId) },
      message: { text: String(text || '').slice(0, 2000) },
      messaging_type: 'RESPONSE',
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/me/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { success: true, messageId: response.data?.message_id, to: recipientId };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[Meta Channel Service] Send Error:', JSON.stringify(errorData));
    return { success: false, error: errorData.message, code: errorData.code, to: recipientId };
  }
}

async function sendMessengerMessage(recipientId, text) {
  return sendUnifiedMessage(recipientId, text);
}

async function sendInstagramMessage(recipientId, text) {
  return sendUnifiedMessage(recipientId, text);
}

module.exports = {
  sendMessengerMessage,
  sendInstagramMessage,
  getPageConfig,
};
