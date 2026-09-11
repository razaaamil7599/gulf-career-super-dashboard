import { NextRequest, NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';

/**
 * Native Next.js API for Candidate List/Search
 */

// Without this, Next.js treats the route as static (no dynamic API usage it
// recognizes) and caches the very first response forever — new messages/chats
// never showed up because Firebase was never actually re-read after that.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.toLowerCase() || '';
    const skill = searchParams.get('skill') || '';

    const db = getFirebaseAdminDb();
    const snapshot = await db.ref('candidates').once('value');
    const candidatesMap = snapshot.val() || {};
    let candidates = Object.keys(candidatesMap).map(id => ({ id, ...candidatesMap[id] }));

    if (search) candidates = candidates.filter(c => (c.name || '').toLowerCase().includes(search) || (c.phone || '').includes(search));
    if (skill && skill !== 'All') candidates = candidates.filter(c => c.skill === skill);

    candidates.sort((a, b) => {
      // Most recent activity first (this is what the dashboard's card list
      // should read as: newest message/chat at the top, older ones below).
      const aTs = new Date(a.lastInboundAt || a.updatedAt || a.createdAt || 0).getTime();
      const bTs = new Date(b.lastInboundAt || b.updatedAt || b.createdAt || 0).getTime();
      if (aTs !== bTs) return bTs - aTs;

      const aActive = Number(a.unreadCount || 0);
      const bActive = Number(b.unreadCount || 0);
      if (aActive !== bActive) return bActive - aActive;

      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return NextResponse.json({ success: true, count: candidates.length, candidates: candidates.slice(0, 50) });
  } catch (err: any) {
    console.error('[Candidates API Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
