import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';

/**
 * Native Next.js API for Message History
 */

export async function GET(req: NextRequest, { params }: { params: Promise<{ phone: string }> }) {
  try {
    const { phone } = await params;
    if (!phone) return NextResponse.json({ error: 'Missing phone' }, { status: 400 });

    const db = getFirebaseAdminDb();
    const cleanPhone = phone.replace(/\D/g, '');
    let mergedMessages: any = {};
    const direct = (await db.ref(`messages/${cleanPhone}`).once('value')).val();
    if (direct && typeof direct === 'object') {
      Object.assign(mergedMessages, direct);
    }
 
    if (cleanPhone.length === 10) {
      const m91 = (await db.ref(`messages/91${cleanPhone}`).once('value')).val();
      if (m91 && typeof m91 === 'object') Object.assign(mergedMessages, m91);
      
      const m92 = (await db.ref(`messages/92${cleanPhone}`).once('value')).val();
      if (m92 && typeof m92 === 'object') Object.assign(mergedMessages, m92);
    } else if (cleanPhone.length === 12) {
      if (cleanPhone.startsWith('91')) {
        const mSuffix = (await db.ref(`messages/${cleanPhone.substring(2)}`).once('value')).val();
        if (mSuffix && typeof mSuffix === 'object') Object.assign(mergedMessages, mSuffix);
      } else if (cleanPhone.startsWith('92')) {
        const mSuffix = (await db.ref(`messages/${cleanPhone.substring(2)}`).once('value')).val();
        if (mSuffix && typeof mSuffix === 'object') Object.assign(mergedMessages, mSuffix);
      }
    }
 
    return NextResponse.json({ success: true, messages: mergedMessages });
  } catch (err: any) {
    console.error('[History API Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
