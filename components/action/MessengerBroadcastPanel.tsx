'use client';

import { useEffect, useState } from 'react';
import { previewMessengerRecentBroadcast, sendMessengerRecentBroadcast } from '@/lib/api';

type Channel = 'messenger' | 'instagram';

const CHANNEL_META: Record<Channel, { label: string; color: string; bg: string }> = {
  messenger: { label: 'Facebook Messenger', color: '#60a5fa', bg: 'rgba(59,130,246,0.14)' },
  instagram: { label: 'Instagram', color: '#e879f9', bg: 'rgba(217,70,239,0.14)' },
};

export default function MessengerBroadcastPanel() {
  const [channel, setChannel] = useState<Channel>('messenger');
  const [message, setMessage] = useState('');
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendMessengerRecentBroadcast>> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingPreview(true);
    setEligibleCount(null);
    previewMessengerRecentBroadcast(channel)
      .then((res) => {
        if (!cancelled) setEligibleCount(res.eligibleCount);
      })
      .catch(() => {
        if (!cancelled) setEligibleCount(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [channel]);

  async function handleSend() {
    setError('');
    setResult(null);
    if (!message.trim()) {
      setError('Message khaali nahin ho sakta.');
      return;
    }
    if (!eligibleCount) {
      setError('Is channel par abhi koi bhi contact pichhle 24 ghante ke andar active nahin hai.');
      return;
    }
    setSending(true);
    try {
      const response = await sendMessengerRecentBroadcast(channel, message);
      setResult(response);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send fail ho gaya.';
      setError(msg);
    } finally {
      setSending(false);
    }
  }

  const meta = CHANNEL_META[channel];

  return (
    <section
      style={{
        border: '1px solid rgba(56,189,248,0.14)',
        borderRadius: 18,
        padding: 18,
        background: 'rgba(15,23,42,0.82)',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: meta.color, display: 'grid', placeItems: 'center', color: '#0b1120', fontSize: 20, fontWeight: 800 }}>
          {channel === 'messenger' ? 'FB' : 'IG'}
        </div>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 18, fontWeight: 800 }}>Messenger / Instagram Broadcast</div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Meta sirf pichhle 24 ghante mein message karne walon ko hi allow karta hai — WhatsApp jaisa full broadcast in par possible nahin hai.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        {(['messenger', 'instagram'] as Channel[]).map((ch) => (
          <button
            key={ch}
            onClick={() => {
              setChannel(ch);
              setResult(null);
              setError('');
            }}
            style={{
              flex: 1,
              border: channel === ch ? `1px solid ${CHANNEL_META[ch].color}` : '1px solid rgba(148,163,184,0.18)',
              background: channel === ch ? CHANNEL_META[ch].bg : 'rgba(15,23,42,0.7)',
              color: channel === ch ? CHANNEL_META[ch].color : '#94a3b8',
              borderRadius: 12,
              padding: '10px 14px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {CHANNEL_META[ch].label}
          </button>
        ))}
      </div>

      <div
        style={{
          border: '1px solid rgba(56,189,248,0.12)',
          borderRadius: 14,
          padding: 14,
          background: 'rgba(30,41,59,0.45)',
          color: '#e2e8f0',
          fontSize: 14,
        }}
      >
        {loadingPreview
          ? 'Eligible contacts count ho raha hai...'
          : eligibleCount === null
            ? 'Eligible contacts load nahin ho paye.'
            : eligibleCount === 0
              ? `Abhi ${meta.label} par koi bhi contact pichhle 24 ghante mein active nahin hai.`
              : `${eligibleCount} contact${eligibleCount === 1 ? '' : 's'} abhi 24-ghante ki window ke andar hain — inhi ko message jayega.`}
      </div>

      <div>
        <div style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Message</div>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          placeholder="Yahan apna message likhein..."
          style={{
            width: '100%',
            resize: 'vertical',
            background: 'rgba(15,23,42,0.84)',
            border: '1px solid rgba(56,189,248,0.16)',
            borderRadius: 14,
            padding: 14,
            color: '#f8fafc',
            outline: 'none',
            fontSize: 14,
            lineHeight: 1.5,
          }}
        />
      </div>

      {error && (
        <div style={{ borderRadius: 14, padding: 14, background: 'rgba(127,29,29,0.4)', border: '1px solid rgba(248,113,113,0.25)', color: '#fecaca' }}>
          {error}
        </div>
      )}

      {result && (
        <div style={{ borderRadius: 14, padding: 16, background: 'rgba(2,132,199,0.14)', border: '1px solid rgba(56,189,248,0.2)' }}>
          <div style={{ color: '#67e8f9', fontSize: 20, fontWeight: 800, marginBottom: 8 }}>Broadcast Complete</div>
          <div style={{ color: '#e2e8f0', fontSize: 15 }}>
            Targeted: {result.targeted} | Sent: {result.sent} | Failed: {result.failed}
          </div>
          {result.results.filter((r) => !r.success).length > 0 && (
            <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 13 }}>
              {result.results.filter((r) => !r.success).slice(0, 5).map((r) => (
                <div key={r.id}>{r.name || r.phone}: {r.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={handleSend}
        disabled={sending || loadingPreview || !eligibleCount}
        style={{
          border: 'none',
          borderRadius: 14,
          padding: '16px 20px',
          background: sending || loadingPreview || !eligibleCount ? 'rgba(56,189,248,0.4)' : `linear-gradient(135deg, ${meta.color}, #38bdf8)`,
          color: '#0b1120',
          fontSize: 16,
          fontWeight: 800,
          cursor: sending || loadingPreview || !eligibleCount ? 'not-allowed' : 'pointer',
          opacity: sending || loadingPreview || !eligibleCount ? 0.7 : 1,
        }}
      >
        {sending ? 'Sending...' : `Send to ${eligibleCount ?? 0} recent ${meta.label} contact${eligibleCount === 1 ? '' : 's'}`}
      </button>
    </section>
  );
}
