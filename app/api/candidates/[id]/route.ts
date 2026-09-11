import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: 'Missing candidate id' }, { status: 400 });

    const db = getFirebaseAdminDb();
    const snapshot = await db.ref(`candidates/${id}`).once('value');
    const candidate = snapshot.val();

    if (!candidate) {
      return NextResponse.json({ error: 'Candidate not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, candidate: { id, ...candidate } });
  } catch (err: any) {
    console.error('[Candidate By ID API Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
