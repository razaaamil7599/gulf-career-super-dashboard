'use client';

import { useEffect } from 'react';
import { getCandidates, getMessageHistory } from '@/lib/api';

// Marker the Electron wrapper's main.js sets on its BrowserWindow's user
// agent (see Gulf-Career-Desktop-App/main.js). Only that app registers the
// offline cache service worker and runs the background prefetch below —
// regular browser visits to the web dashboard are untouched.
const DESKTOP_UA_MARKER = 'GulfCareerDesktop';

const PREFETCH_BATCH_SIZE = 60;
const PREFETCH_INTERVAL_MS = 5 * 60 * 1000;
const DELAY_BETWEEN_FETCHES_MS = 150;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// WhatsApp-style proactive caching: while the desktop app has internet,
// keep quietly re-fetching the most recently active candidates' chat
// history so the service worker's cache always has a recent copy on disk —
// that's what lets the app open with real data instead of a blank screen
// the moment the laptop loses internet.
async function prefetchRecentChats() {
  try {
    const candidates = await getCandidates();
    const list = Array.isArray(candidates) ? candidates : candidates?.candidates || [];
    const sorted = [...list]
      .sort((a, b) => {
        const at = new Date(a.lastInboundAt || a.updatedAt || a.createdAt || 0).getTime();
        const bt = new Date(b.lastInboundAt || b.updatedAt || b.createdAt || 0).getTime();
        return bt - at;
      })
      .slice(0, PREFETCH_BATCH_SIZE);

    for (const candidate of sorted) {
      if (!candidate.phone) continue;
      try {
        await getMessageHistory(candidate.phone);
      } catch {
        // offline mid-batch or one contact failed — keep going with the rest
      }
      await sleep(DELAY_BETWEEN_FETCHES_MS);
    }
  } catch {
    // no internet right now — nothing to prefetch, next interval will retry
  }
}

export default function DesktopSyncClient() {
  useEffect(() => {
    if (typeof navigator === 'undefined') return;
    if (!navigator.userAgent.includes(DESKTOP_UA_MARKER)) return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.register('/sw-desktop.js').catch(() => {});

    prefetchRecentChats();
    const interval = setInterval(prefetchRecentChats, PREFETCH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return null;
}
