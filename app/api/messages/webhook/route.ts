import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');
  const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || 'gulfcareer_token';

  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new NextResponse('Forbidden', { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) return NextResponse.json({ success: true, ignored: true });

    const db = getFirebaseAdminDb();
    
    const from = message.from;
    const textBody = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || '';
    
    // Identity Detection (Direct Implementation)
    let tag = 'CANDIDATE';
    const AGENCY_KEYWORDS = ['vacancy', 'requirement', 'demand letter', 'job order', 'hiring'];
    const lowerBody = textBody.toLowerCase();
    
    // Check if registered agency
    const agenciesSnap = await db.ref('agencies').orderByChild('contact').equalTo(from).once('value');
    if (agenciesSnap.exists()) {
        tag = 'AGENCY';
    } else if (AGENCY_KEYWORDS.some(kw => lowerBody.includes(kw))) {
        tag = 'POTENTIAL_AGENCY';
    }

    const messageData = {
      from,
      body: textBody,
      type: message.type || 'text',
      timestamp: new Date().toISOString(),
      direction: 'inbound',
      tag: tag,
      messageId: message.id
    };

    // Store directly in Firebase
    await db.ref(`messages/${from}`).push(messageData);
    console.log(`[Next.js Webhook] Success: from=${from}, tag=${tag}`);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Native Webhook Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
