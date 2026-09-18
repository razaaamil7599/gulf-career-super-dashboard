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

    // A phone-number search (by far the most common admin search — pasting
    // or typing digits) can use an indexed prefix query instead of pulling
    // every candidate over the wire. Free-text name search still needs a
    // full scan since Firebase can't do "contains" queries, but that's a
    // much rarer path than the default poll or a phone lookup.
    const isPhoneSearch = Boolean(search) && /^\d{3,}$/.test(search);
    const needsFullScan = Boolean(search) && !isPhoneSearch || Boolean(skill && skill !== 'All');

    let snapshot;
    if (isPhoneSearch) {
      snapshot = await db.ref('candidates').orderByChild('phone').startAt(search).endAt(search + '').once('value');
    } else if (needsFullScan) {
      // The default dashboard poll (no search, no skill filter) is by far
      // the most frequent call to this route and only ever needs the most
      // recently active candidates — loading and JSON-parsing all 4000+
      // candidate records into memory on every few-second refresh is what
      // was repeatedly crashing the free-tier instance with a heap OOM
      // (every crash briefly took the whole dashboard down, which is what
      // made chats look like they kept "disappearing"). Only fall back to
      // a full scan when the caller is actually searching/filtering across
      // the whole pool.
      snapshot = await db.ref('candidates').once('value');
    } else {
      snapshot = await db.ref('candidates').orderByChild('lastInboundAt').limitToLast(300).once('value');
    }
    const candidatesMap = snapshot.val() || {};

    // Filter on the raw keyed map before spreading into per-candidate
    // objects — for a full-scan search this avoids doubling memory by
    // cloning all 4000+ records just to throw most of them away a line
    // later.
    let ids = Object.keys(candidatesMap);
    if (search && !isPhoneSearch) {
      ids = ids.filter((id) => {
        const c = candidatesMap[id];
        return (c.name || '').toLowerCase().includes(search) || (c.phone || '').includes(search);
      });
    }
    if (skill && skill !== 'All') ids = ids.filter((id) => candidatesMap[id].skill === skill);
    let candidates = ids.map((id) => ({ id, ...candidatesMap[id] }));

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
