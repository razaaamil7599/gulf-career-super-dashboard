/**
 * WhatsApp Service
 * Handles Meta WhatsApp Cloud API media downloads and outgoing messages.
 */

const axios = require('axios');
const FormData = require('form-data');

const META_CACHE_TTL = 10 * 60 * 1000;
let metaAppCache = {
  appId: '',
  name: '',
  fetchedAt: 0,
};

function normalizeWhatsAppNumber(value = '') {
  let digits = String(value || '').replace(/\D/g, '');

  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }

  if (digits.length === 11 && digits.startsWith('0')) {
    digits = `91${digits.slice(1)}`;
  } else if (digits.length === 10) {
    digits = `91${digits}`;
  }

  return digits;
}

function sanitizeTemplateToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

function buildMetaTemplateName({ skill = '', country = '' } = {}) {
  const skillToken = sanitizeTemplateToken(skill || 'general');
  const countryToken = sanitizeTemplateToken(country || 'gulf');
  return sanitizeTemplateToken(`gcg_${skillToken}_${countryToken}_${Date.now()}`).slice(0, 128);
}

function cleanTemplateBody(text = '') {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
}

function truncateText(text = '', maxLength = 1024) {
  return String(text || '').trim().slice(0, maxLength);
}

// Helper to get fresh environment variables
const getMetaConfig = () => {
  return {
    accessToken: (
      process.env.META_WHATSAPP_TOKEN || 
      process.env.META_ACCESS_TOKEN || 
      process.env.WHATSAPP_TOKEN || 
      ''
    ).trim(),
    phoneId: (
      process.env.META_PHONE_NUMBER_ID || 
      process.env.PHONE_NUMBER_ID || 
      process.env.META_PHONE_ID ||
      ''
    ).trim(),
    wabaId: (
      process.env.WABA_ID ||
      process.env.META_WABA_ID ||
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID ||
      ''
    ).trim(),
    appId: (
      process.env.META_APP_ID ||
      process.env.WHATSAPP_APP_ID ||
      process.env.META_FACEBOOK_APP_ID ||
      ''
    ).trim()
  };
};

async function getMetaConfigForSender(senderPhoneIdOrPhone) {
  const defaults = getMetaConfig();
  if (!senderPhoneIdOrPhone) return defaults;

  try {
    const { rtdbGet } = require('./firebaseService');
    const numberConfigs = await rtdbGet('settings/whatsapp_numbers');
    if (!numberConfigs) return defaults;

    const normalized = String(senderPhoneIdOrPhone || '').replace(/\D/g, '');
    const config = Object.values(numberConfigs).find(c =>
      c.phoneId === senderPhoneIdOrPhone ||
      String(c.phone || '').replace(/\D/g, '') === normalized
    );

    if (!config) return defaults;

    return {
      accessToken: (config.token || defaults.accessToken).trim(),
      phoneId: (config.phoneId || defaults.phoneId).trim(),
      wabaId: (config.wabaId || defaults.wabaId).trim(),
      appId: (config.appId || defaults.appId).trim()
    };
  } catch (err) {
    console.error('[WhatsApp Service] getMetaConfigForSender error:', err.message);
    return defaults;
  }
}

async function getMetaAppId(forceRefresh = false, senderPhoneIdOrPhone = null) {
  const { accessToken, appId: explicitAppId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (explicitAppId) {
    return explicitAppId;
  }

  const now = Date.now();
  if (!forceRefresh && metaAppCache.appId && now - metaAppCache.fetchedAt < META_CACHE_TTL) {
    return metaAppCache.appId;
  }

  if (!accessToken) {
    throw new Error('META_ACCESS_TOKEN_MISSING');
  }

  const response = await axios.get('https://graph.facebook.com/v21.0/app?fields=id,name', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  metaAppCache = {
    appId: String(response.data?.id || '').trim(),
    name: String(response.data?.name || '').trim(),
    fetchedAt: now,
  };

  if (!metaAppCache.appId) {
    throw new Error('META_APP_ID_MISSING');
  }

  return metaAppCache.appId;
}


/**
 * Download media from Meta Media API.
 */
async function downloadMedia(mediaId, senderPhoneIdOrPhone = null) {
  const { accessToken } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken) throw new Error('META_ACCESS_TOKEN_MISSING');

  try {
    const urlResponse = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const mediaUrl = urlResponse.data.url;
    const mediaResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    return Buffer.from(mediaResponse.data);
  } catch (err) {
    console.error('[WhatsApp Service] Media Download Error:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Get the direct URL of a media item from its ID.
 */
async function getMediaUrl(mediaId, senderPhoneIdOrPhone = null) {
  const { accessToken } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken) return null;
  try {
    const response = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data.url;
  } catch (err) {
    console.error('[WhatsApp Service] getMediaUrl Error:', err.response?.data || err.message);
    return null;
  }
}

async function fetchMediaAsset(mediaId, senderPhoneIdOrPhone = null) {
  const { accessToken } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken) throw new Error('META_ACCESS_TOKEN_MISSING');

  try {
    const metaResponse = await axios.get(`https://graph.facebook.com/v21.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const mediaUrl = metaResponse.data?.url;
    if (!mediaUrl) throw new Error('MEDIA_URL_MISSING');

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    return {
      buffer: Buffer.from(mediaResponse.data),
      mimeType: metaResponse.data?.mime_type || mediaResponse.headers['content-type'] || 'application/octet-stream',
      fileName: metaResponse.data?.file_name || `media-${mediaId}`,
    };
  } catch (err) {
    console.error('[WhatsApp Service] fetchMediaAsset Error:', err.response?.data || err.message);
    throw err;
  }
}

async function fetchRemoteAsset(url, fallbackMimeType = 'image/png', fallbackFileName = 'template-header-image') {
  if (!url) {
    throw new Error('REMOTE_MEDIA_URL_MISSING');
  }

  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
    });

    const contentType = String(response.headers['content-type'] || fallbackMimeType || 'application/octet-stream').trim();
    const urlPath = new URL(url).pathname || '';
    const rawFileName = urlPath.split('/').pop() || fallbackFileName;

    return {
      buffer: Buffer.from(response.data),
      mimeType: contentType,
      fileName: rawFileName || fallbackFileName,
    };
  } catch (err) {
    console.error('[WhatsApp Service] fetchRemoteAsset Error:', err.response?.data || err.message);
    throw err;
  }
}

async function uploadTemplateSampleMediaHandle(buffer, mimeType = 'image/png', fileName = 'template-header-image.png', senderPhoneIdOrPhone = null) {
  const { accessToken } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken) {
    return { success: false, error: 'META_ACCESS_TOKEN_MISSING' };
  }

  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    return { success: false, error: 'TEMPLATE_SAMPLE_MEDIA_EMPTY' };
  }

  try {
    const appId = await getMetaAppId(false, senderPhoneIdOrPhone);
    const sessionResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${appId}/uploads`,
      null,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          file_name: fileName || 'template-header-image.png',
          file_length: buffer.length,
          file_type: mimeType || 'image/png',
        },
      }
    );

    const uploadSessionId = String(sessionResponse.data?.id || '').trim();
    if (!uploadSessionId) {
      return { success: false, error: 'TEMPLATE_SAMPLE_UPLOAD_SESSION_MISSING' };
    }

    const uploadResponse = await axios.post(
      `https://graph.facebook.com/v21.0/${uploadSessionId}`,
      buffer,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
      }
    );

    const handle = String(uploadResponse.data?.h || '').trim();
    if (!handle) {
      return { success: false, error: 'TEMPLATE_SAMPLE_HANDLE_MISSING' };
    }

    return {
      success: true,
      handle,
      uploadSessionId,
      appId,
      mimeType,
      fileName,
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Template Sample Upload Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'TEMPLATE_SAMPLE_UPLOAD_FAILED',
      code: errorData.code || '',
    };
  }
}

async function resolveTemplateHeaderHandle({
  headerHandle = '',
  headerMediaId = '',
  headerImageUrl = '',
  headerMimeType = 'image/png',
  headerFileName = 'template-header-image.png',
  senderPhoneIdOrPhone = null,
} = {}) {
  const explicitHandle = String(headerHandle || '').trim();
  if (explicitHandle) {
    return { success: true, handle: explicitHandle };
  }

  let asset = null;
  if (headerMediaId) {
    asset = await fetchMediaAsset(headerMediaId, senderPhoneIdOrPhone);
  } else if (headerImageUrl) {
    asset = await fetchRemoteAsset(headerImageUrl, headerMimeType, headerFileName);
  }

  if (!asset?.buffer?.length) {
    return { success: false, error: 'TEMPLATE_HEADER_MEDIA_MISSING' };
  }

  return uploadTemplateSampleMediaHandle(
    asset.buffer,
    asset.mimeType || headerMimeType || 'image/png',
    asset.fileName || headerFileName || 'template-header-image.png',
    senderPhoneIdOrPhone
  );
}

async function uploadMediaAsset(buffer, mimeType = 'image/png', fileName = 'vacancy-card.png', senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  try {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', buffer, {
      filename: fileName || 'vacancy-card.png',
      contentType: mimeType || 'image/png',
    });

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...form.getHeaders(),
        },
        maxBodyLength: Infinity,
      }
    );

    return {
      success: true,
      id: response.data?.id || '',
      mimeType: mimeType || 'image/png',
      fileName: fileName || 'vacancy-card.png',
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Media Upload Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'MEDIA_UPLOAD_FAILED',
      code: errorData.code || '',
    };
  }
}

/**
 * Send an audio message using a previously uploaded Meta media ID.
 */
async function sendAudioMessage(to, mediaIdOrObj, senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  try {
    const normalizedTo = normalizeWhatsAppNumber(to);
    let audio = {};
    if (typeof mediaIdOrObj === 'object' && mediaIdOrObj !== null) {
      if (mediaIdOrObj.mediaId) audio = { id: mediaIdOrObj.mediaId };
      else if (mediaIdOrObj.audioUrl) audio = { link: mediaIdOrObj.audioUrl };
    } else if (typeof mediaIdOrObj === 'string') {
      if (mediaIdOrObj.startsWith('http')) audio = { link: mediaIdOrObj };
      else audio = { id: mediaIdOrObj };
    }

    if (!audio.id && !audio.link) {
      return { success: false, error: 'AUDIO_REFERENCE_MISSING' };
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'audio',
      audio,
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { success: true, messageId: response.data.messages[0].id, to: normalizedTo };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Audio Send Error:', JSON.stringify(errorData));
    return { success: false, error: errorData.message, code: errorData.code };
  }
}

/**
 * Send a simple text message.
 */
async function sendTextMessage(to, text, senderPhoneIdOrPhone = null) {
  return sendMessage(to, text, senderPhoneIdOrPhone);
}

/**
 * Send a message (Text or raw Meta JSON).
 */
async function sendMessage(to, body, senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    console.error('[WhatsApp Service] Missing Meta credentials.');
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  try {
    const normalizedTo = normalizeWhatsAppNumber(to);
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'text',
      text: { body }
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { success: true, messageId: response.data.messages[0].id, to: normalizedTo };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Send Error:', JSON.stringify(errorData));
    return { success: false, error: errorData.message, code: errorData.code, to: normalizeWhatsAppNumber(to) };
  }
}

/**
 * Send an Official Meta Template message.
 */
async function sendTemplateMessage(to, templateName, components = [], languageCode = 'hi', senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  try {
    const normalizedTo = normalizeWhatsAppNumber(to);
    const payload = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode || 'en_US' },
        components
      }
    };

    console.log(`[WhatsApp Service] Sending Template '${templateName}' to ${normalizedTo}`);
    console.log(`[WhatsApp Service] Payload: ${JSON.stringify(payload)}`);
    
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return { 
      success: true, 
      messageId: response.data.messages[0].id,
      status: 'sent',
      to: normalizedTo
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error(`[WhatsApp Service] Template Send Error (${templateName}):`, JSON.stringify(errorData));
    console.error(`[WhatsApp Service] Full Response:`, JSON.stringify(err.response?.data));
    
    // Check for specific error codes the user mentioned
    let errorMsg = errorData.message;
    if (errorData.code === 131042) errorMsg = 'Payment/Billing Issue (Meta Account)';
    if (errorData.code === 132001) {
      const details = errorData.error_data?.details ? ` ${errorData.error_data.details}` : '';
      errorMsg = `Template mismatch: '${templateName}' not found for language '${languageCode || 'unknown'}'.${details}`;
    }
    if (errorData.code === 100) errorMsg = 'Invalid parameter mapping in template.';

    return { success: false, error: errorMsg, code: errorData.code, to: normalizeWhatsAppNumber(to) };
  }
}

async function sendImageMessage(to, { mediaId = '', imageUrl = '', caption = '' } = {}, senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  if (!mediaId && !imageUrl) {
    return { success: false, error: 'IMAGE_REFERENCE_MISSING' };
  }

  try {
    const normalizedTo = normalizeWhatsAppNumber(to);
    const image = mediaId ? { id: mediaId } : { link: imageUrl };
    const normalizedCaption = truncateText(caption, 1024);

    if (normalizedCaption) {
      image.caption = normalizedCaption;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'image',
      image,
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      status: 'sent',
      to: normalizedTo,
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Image Send Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'IMAGE_SEND_FAILED',
      code: errorData.code || '',
      to: normalizeWhatsAppNumber(to),
    };
  }
}

async function sendDocumentMessage(to, { mediaId = '', documentUrl = '', filename = 'Document.pdf' } = {}, senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !phoneId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  if (!mediaId && !documentUrl) {
    return { success: false, error: 'DOCUMENT_REFERENCE_MISSING' };
  }

  try {
    const normalizedTo = normalizeWhatsAppNumber(to);
    const document = mediaId ? { id: mediaId } : { link: documentUrl };
    if (filename) {
      document.filename = filename;
    }

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: normalizedTo,
      type: 'document',
      document,
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return {
      success: true,
      messageId: response.data.messages[0].id,
      status: 'sent',
      to: normalizedTo,
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Document Send Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'DOCUMENT_SEND_FAILED',
      code: errorData.code || '',
      to: normalizeWhatsAppNumber(to),
    };
  }
}

async function createMetaTemplate({
  name,
  bodyText,
  bodyExample = [],
  category = 'MARKETING',
  language = 'hi',
  headerHandle = '',
  headerMediaId = '',
  headerImageUrl = '',
  headerMimeType = 'image/png',
  headerFileName = 'template-header-image.png',
}, senderPhoneIdOrPhone = null) {
  const { accessToken, wabaId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !wabaId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  const templateName = sanitizeTemplateToken(name || buildMetaTemplateName({}));
  const templateBody = cleanTemplateBody(bodyText);
  if (!templateBody) {
    return { success: false, error: 'TEMPLATE_BODY_EMPTY' };
  }

  // Meta requires a sample value for every {{n}} placeholder in the BODY component,
  // or template creation fails with INVALID_FORMAT. Fill in a generic sample for any
  // placeholder the caller didn't supply an example for.
  const variableCount = new Set(
    (templateBody.match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((m) => m.replace(/\D/g, ''))
  ).size;
  const bodyExampleValues = Array.from({ length: variableCount }, (_, i) => bodyExample[i] || 'Ali');

  try {
    const components = [];
    let resolvedHeaderHandle = '';
    if (headerHandle || headerMediaId || headerImageUrl) {
      const headerUpload = await resolveTemplateHeaderHandle({
        headerHandle,
        headerMediaId,
        headerImageUrl,
        headerMimeType,
        headerFileName,
        senderPhoneIdOrPhone,
      });

      if (!headerUpload.success || !headerUpload.handle) {
        return {
          success: false,
          error: headerUpload.error || 'TEMPLATE_HEADER_HANDLE_RESOLVE_FAILED',
          code: headerUpload.code || '',
        };
      }

      resolvedHeaderHandle = headerUpload.handle;
    }

    if (resolvedHeaderHandle) {
      components.push({
        type: 'HEADER',
        format: 'IMAGE',
        example: {
          header_handle: [resolvedHeaderHandle],
        },
      });
    }

    components.push({
      type: 'BODY',
      text: templateBody,
      ...(variableCount > 0 ? { example: { body_text: [bodyExampleValues] } } : {}),
    });

    const payload = {
      name: templateName,
      category,
      language,
      components,
    };

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
      payload,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );

    return {
      success: true,
      id: response.data?.id || '',
        name: response.data?.name || templateName,
        status: response.data?.status || 'PENDING',
        category,
        language,
        headerFormat: resolvedHeaderHandle ? 'IMAGE' : '',
      };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Meta Template Create Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'META_TEMPLATE_CREATE_FAILED',
      code: errorData.code || '',
    };
  }
}

async function deleteMetaTemplate({ name = '', metaId = '' } = {}, senderPhoneIdOrPhone = null) {
  const { accessToken, wabaId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !wabaId) {
    return { success: false, error: 'CREDENTIALS_MISSING' };
  }

  const templateName = sanitizeTemplateToken(name);
  if (!templateName) {
    return { success: false, error: 'TEMPLATE_NAME_MISSING' };
  }

  try {
    const response = await axios.delete(
      `https://graph.facebook.com/v21.0/${wabaId}/message_templates`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          name: templateName,
          ...(metaId ? { hsm_id: metaId } : {}),
        },
      }
    );

    return {
      success: true,
      name: templateName,
      metaId,
      result: response.data,
    };
  } catch (err) {
    const errorData = err.response?.data?.error || { message: err.message };
    console.error('[WhatsApp Service] Meta Template Delete Error:', JSON.stringify(errorData));
    return {
      success: false,
      error: errorData.message || 'META_TEMPLATE_DELETE_FAILED',
      code: errorData.code || '',
      name: templateName,
      metaId,
    };
  }
}

/**
 * Diagnostic check for Meta API Status.
 */
async function getMetaStatus(senderPhoneIdOrPhone = null) {
  const { accessToken, phoneId, wabaId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  const isConfigured = !!(accessToken && phoneId && wabaId);
  
  let isLive = false;
  if (isConfigured) {
    try {
      // Small check to see if token is valid
      const res = await axios.get(`https://graph.facebook.com/v21.0/${wabaId}`, {
        params: { fields: 'id,name' },
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      isLive = !!res.data.id;
    } catch (err) {
      isLive = false;
    }
  }

  const messenger = await getMessengerStatus();

  return {
    isConfigured,
    isLive,
    hasToken: !!accessToken,
    hasPhoneId: !!phoneId,
    hasWabaId: !!wabaId,
    mode: process.env.NODE_ENV || 'production',
    messenger,
  };
}

/**
 * Diagnostic check for Messenger (Facebook Page) readiness — separate from the
 * WhatsApp check above since they use different tokens/objects. Never returns
 * the token itself, only pass/fail facts, so this is safe to expose.
 */
async function getMessengerStatus() {
  const pageAccessToken = process.env.PAGE_ACCESS_TOKEN || '';
  const pageId = process.env.PAGE_ID || '';
  const result = {
    hasToken: !!pageAccessToken,
    hasPageId: !!pageId,
    tokenValid: false,
    tokenPageId: null,
    tokenPageName: null,
    pageIdMatches: null,
    appSubscribed: false,
    subscribedFields: [],
  };

  if (!pageAccessToken) return result;

  try {
    const meRes = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: { fields: 'id,name' },
      headers: { Authorization: `Bearer ${pageAccessToken}` },
    });
    result.tokenValid = !!meRes.data.id;
    result.tokenPageId = meRes.data.id || null;
    result.tokenPageName = meRes.data.name || null;
    result.pageIdMatches = pageId ? meRes.data.id === pageId : null;
  } catch (err) {
    result.tokenValid = false;
    result.tokenError = err?.response?.data?.error?.message || err.message;
    return result;
  }

  try {
    const subRes = await axios.get(`https://graph.facebook.com/v21.0/${result.tokenPageId}/subscribed_apps`, {
      params: { fields: 'subscribed_fields' },
      headers: { Authorization: `Bearer ${pageAccessToken}` },
    });
    const apps = subRes.data?.data || [];
    result.appSubscribed = apps.length > 0;
    result.subscribedFields = apps[0]?.subscribed_fields || [];
  } catch (err) {
    result.subscribedAppsError = err?.response?.data?.error?.message || err.message;
  }

  // Which scopes this specific token actually carries right now — independent
  // of App Review status. A rejected Advanced Access review doesn't revoke a
  // scope already granted directly by the page's own admin (Standard Access),
  // so this is the only reliable way to see whether pages_messaging etc. are
  // truly live on this token or not.
  const appId = process.env.META_APP_ID || '';
  const appSecret = process.env.META_APP_SECRET || '';
  if (appId && appSecret) {
    try {
      const debugRes = await axios.get('https://graph.facebook.com/v21.0/debug_token', {
        params: { input_token: pageAccessToken, access_token: `${appId}|${appSecret}` },
      });
      const info = debugRes.data?.data || {};
      result.tokenScopes = info.scopes || [];
      result.tokenIsValid = info.is_valid ?? null;
      result.tokenExpiresAt = info.expires_at ?? null;
      result.tokenType = info.type || null;
    } catch (err) {
      result.debugTokenError = err?.response?.data?.error?.message || err.message;
    }
  }

  return result;
}

/**
 * Fetch official message templates from Meta Graph API.
 */
async function fetchMetaTemplates(senderPhoneIdOrPhone = null) {
  const { accessToken, wabaId } = await getMetaConfigForSender(senderPhoneIdOrPhone);
  if (!accessToken || !wabaId) {
    throw new Error('META_CREDENTIAL_MISSING');
  }

  try {
    let allTemplates = [];
    let url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates?limit=100`;

    while (url) {
      console.log(`[WhatsApp Service] Fetching Meta templates from: ${url}`);
      const response = await axios.get(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      const pageData = response.data.data || [];
      allTemplates = [...allTemplates, ...pageData];
      
      // Check for next page
      url = response.data.paging?.next || null;
    }

    console.log(`[WhatsApp Service] Total raw templates fetched: ${allTemplates.length}`);

    // Process templates to extract param counts for every template status so
    // dashboard records can reconcile stale Meta review states.
    const templates = allTemplates
      .map(t => {
        // Find the body component to count {{n}} tags
        const bodyComp = t.components.find(c => c.type === 'BODY');
        const paramCount = bodyComp ? (bodyComp.text.match(/\{\{\d+\}\}/g) || []).length : 0;
        
        return {
          id: t.name, // We use name as ID for sending
          metaId: t.id,
          name: t.name,
          language: t.language,
          status: t.status,
          category: t.category,
          components: t.components,
          paramCount
        };
      });

    console.log(`[WhatsApp Service] Processed templates: ${templates.length}`);
    return templates;
  } catch (err) {
    console.error('[WhatsApp Service] Fetch Templates Error:', err.response?.data || err.message);
    throw err;
  }
}

/**
 * Bulk send messages to multiple targets.
 */
async function bulkBlast(targets, customMessage, templateName, templateVariables = [], mediaOptions = {}) {
  const { buildComponents } = require('./templateService');
  const { getTemplateLanguage } = require('./templateService');
  const { rtdbPush, rtdbSet, safeFirebaseKey } = require('./firebaseService');
  
  let sent = 0;
  let failed = 0;
  let posterSent = 0;
  let posterFailed = 0;
  const failureReasons = {};
  const failedTargets = [];

  console.log(`[WhatsApp Service] Bulk Blast started for ${targets.length} targets...`);

  for (const target of targets) {
    try {
      const to = normalizeWhatsAppNumber(target.phone);
      let result;

      if (templateName) {
        // Official Template Flow
        const components = await buildComponents(templateName, {
          ...target,
          templateMediaId: mediaOptions?.mediaId || target.templateMediaId || '',
          templateImageUrl: mediaOptions?.imageUrl || target.templateImageUrl || '',
        }, templateVariables);
        const languageCode = await getTemplateLanguage(templateName);
        result = await sendTemplateMessage(to, templateName, components, languageCode);
        result.templateUsedMediaHeader = components.some(
          (component) =>
            component.type === 'HEADER'
            && Array.isArray(component.parameters)
            && component.parameters.some((parameter) => ['image', 'video', 'document'].includes(String(parameter.type || '').toLowerCase()))
        );
      } else {
        // Custom Text Flow
        const finalMsg = customMessage
          .replace(/{name}/g, target.name || 'Candidate')
          .replace(/{skill}/g, target.skill || 'Position')
          .replace(/{country}/g, target.country || 'the Gulf');
        
        result = await sendMessage(to, finalMsg);
      }

      const deliveryPhone = result.to || to;

      // Log to history
      const firebaseKey = await rtdbPush(`messages/${deliveryPhone}`, {
        from: 'SYSTEM',
        to: deliveryPhone,
        body: templateName ? `[BULK TEMPLATE: ${templateName}]` : (customMessage || ''),
        wamId: result.messageId || null,
        direction: 'outbound',
        timestamp: new Date().toISOString(),
        status: result.success ? 'sent' : 'failed',
        error: result.error || null
      });

      // Map for updates
      if (result.success && result.messageId) {
        await rtdbSet(`message_map/${safeFirebaseKey(result.messageId)}`, {
          phone: deliveryPhone,
          firebaseKey
        });
      }

      if (result.success) {
        sent++;

        if ((mediaOptions?.mediaId || mediaOptions?.imageUrl) && !result.templateUsedMediaHeader) {
          const posterResult = await sendImageMessage(deliveryPhone, mediaOptions);
          const posterLabel = mediaOptions.caption ? `[VACANCY CARD] ${truncateText(mediaOptions.caption, 120)}` : '[VACANCY CARD]';
          const posterFirebaseKey = await rtdbPush(`messages/${deliveryPhone}`, {
            from: 'SYSTEM',
            to: deliveryPhone,
            body: posterLabel,
            wamId: posterResult.messageId || null,
            direction: 'outbound',
            timestamp: new Date().toISOString(),
            status: posterResult.success ? 'sent' : 'failed',
            error: posterResult.error || null
          });

          if (posterResult.success && posterResult.messageId) {
            await rtdbSet(`message_map/${safeFirebaseKey(posterResult.messageId)}`, {
              phone: deliveryPhone,
              firebaseKey: posterFirebaseKey
            });
            posterSent++;
          } else {
            posterFailed++;
          }
        }
      } else {
        failed++;
        const reason = result.error || 'UNKNOWN_SEND_FAILURE';
        failureReasons[reason] = (failureReasons[reason] || 0) + 1;
        if (failedTargets.length < 10) {
          failedTargets.push({
            name: target.name || 'Candidate',
            phone: deliveryPhone,
            reason,
          });
        }
      }
    } catch (err) {
      console.error(`[WhatsApp Service] Blast failed for ${target.phone}:`, err.message);
      failed++;
      const reason = err.message || 'UNEXPECTED_BULK_FAILURE';
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
      if (failedTargets.length < 10) {
        failedTargets.push({
          name: target.name || 'Candidate',
          phone: normalizeWhatsAppNumber(target.phone),
          reason,
        });
      }
    }
  }

  return {
    sent,
    failed,
    targeted: targets.length,
    failureReasons,
    failedTargets,
    posterSent,
    posterFailed,
    posterMediaAttached: Boolean(mediaOptions?.mediaId || mediaOptions?.imageUrl),
  };
}

async function sendReProfilingMessage(candidate = {}) {
  const approvedReprofileTemplate = 'gcg_reprofile_marketing_plain_hi_apr03';

  try {
    const { getCachedTemplates } = require('./templateService');
    const templates = await getCachedTemplates(true);
    const reprofileTemplate = templates.find(
      (template) =>
        template.name === approvedReprofileTemplate
        && String(template.status || '').toUpperCase() === 'APPROVED'
    );

    if (reprofileTemplate) {
      return sendTemplateMessage(candidate.phone, approvedReprofileTemplate, [], reprofileTemplate.language || 'hi');
    }
  } catch (error) {
    console.warn('[WhatsApp Service] Re-profile template lookup failed:', error.message);
  }

  const fallbackText = [
    `Assalam-o-Alaikum ${candidate.name || 'Candidate'},`,
    '',
    'Gulf Career Gateway aapki job profile dobara update kar raha hai.',
    '',
    'Reply mein apna current skill, preferred country, total experience, current location, passport status aur updated CV share karein.',
    '',
    'Aap WhatsApp par hi details bhej sakte hain. Final shortlist employer selection aur documents par depend karegi.',
    '',
    'Gulf Career Gateway',
  ].join('\n');

  return sendMessage(candidate.phone, fallbackText);
}


module.exports = {
  downloadMedia,
  getMediaUrl,
  fetchMediaAsset,
  uploadMediaAsset,
  sendMessage,
  sendTextMessage,
  sendAudioMessage,
  sendTemplateMessage,
  sendImageMessage,
  sendDocumentMessage,
  createMetaTemplate,
  deleteMetaTemplate,
  buildMetaTemplateName,
  getMetaStatus,
  fetchMetaTemplates,
  bulkBlast,
  normalizeWhatsAppNumber,
  sendReProfilingMessage
};
