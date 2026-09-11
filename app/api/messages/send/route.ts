import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';
const { buildComponents } = require('../../../../server/services/templateService');
const { getTemplateLanguage } = require('../../../../server/services/templateService');

/**
 * Native Next.js API for Sending WhatsApp Messages
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { phone, message, templateName, candidateData, languageCode, components } = body;
    let finalComponents: any[] = [];
    
    if (templateName) {
      finalComponents = await buildComponents(templateName, candidateData || {});
      // Fallback to manually provided components if buildComponents fails or returns empty unexpectedly
      if (finalComponents.length === 0 && components && components.length > 0) {
        finalComponents = components;
      }
    }

    if (!phone) return NextResponse.json({ error: 'Phone is required' }, { status: 400 });
    if (!message && !templateName) return NextResponse.json({ error: 'message or templateName is required' }, { status: 400 });

    // Auto-add country code 91 for 10-digit Indian numbers
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    else if (cleanPhone.length === 12 && cleanPhone.startsWith('0091')) cleanPhone = cleanPhone.slice(2);

    const ACCESS_TOKEN = process.env.META_WHATSAPP_TOKEN;
    const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;

    const url = `https://graph.facebook.com/v21.0/${PHONE_NUMBER_ID}/messages`;

    // Build payload: Template message OR text message
    let payload: any;
    if (templateName) {
      const lang = languageCode || await getTemplateLanguage(templateName);
      payload = {
        messaging_product: 'whatsapp',
        to: cleanPhone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: lang },
          components: finalComponents
        }
      };
    } else {
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanPhone,
        type: 'text',
        text: { body: message }
      };
    }

    console.log(`[Send API] ${templateName ? 'Template' : 'Text'} message to ${cleanPhone}:`, JSON.stringify(payload));

    let result: { success: boolean; messageId: string | null; error: string | null } = { success: false, messageId: null, error: null };

    if (ACCESS_TOKEN && PHONE_NUMBER_ID) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      console.log(`[Send API] Meta Response (${response.status}):`, JSON.stringify(data));
      if (response.ok) {
        result = { success: true, messageId: data?.messages?.[0]?.id, error: null };
      } else {
        const errCode = data?.error?.code;
        let errMsg = data?.error?.message || 'Meta API Error';
        if (errCode === 131042) errMsg = 'BILLING_ISSUE (131042): Payment required';
        if (errCode === 131031) errMsg = 'ACCOUNT_RESTRICTED (131031)';
        if (errCode === 132001) errMsg = `TEMPLATE_NOT_FOUND (132001): '${templateName}' not found on Meta`;
        if (errCode === 100) errMsg = `INVALID_PARAM (100): ${errMsg}`;
        result = { success: false, messageId: null, error: errMsg };
      }
    } else {
      console.warn('[Send API] Missing credentials — using mock mode');
      result = { success: true, messageId: 'MOCK_ID', error: null };
    }

    // Log to Firebase
    const db = getFirebaseAdminDb();
    await db.ref(`messages/${cleanPhone}`).push({
      from: 'SYSTEM',
      to: cleanPhone,
      body: templateName ? `[META TEMPLATE: ${templateName}]` : message,
      direction: 'outbound',
      timestamp: new Date().toISOString(),
      status: result.success ? 'sent' : 'failed',
      error: result.error || null
    });

    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error, phone: cleanPhone }, { status: 400 });
    }

    return NextResponse.json({ ...result, phone: cleanPhone });
  } catch (err: any) {
    console.error('[Send API Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
