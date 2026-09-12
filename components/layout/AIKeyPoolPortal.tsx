'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

interface AiKey {
  id: string;
  label: string;
  provider: string;
  status: 'green' | 'red';
  maskedKey: string;
  lastError: string;
  addedAt: string | null;
  lastUsedAt: string | null;
  lastSuccessAt: string | null;
  cooldownUntil: number | null;
  possibleDuplicateAccount?: boolean;
  possibleDuplicateNote?: string;
}

function formatCountdown(cooldownUntil: number | null): string {
  if (!cooldownUntil) return '';
  const msLeft = cooldownUntil - Date.now();
  if (msLeft <= 0) return 'refreshing...';
  const totalSeconds = Math.ceil(msLeft / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s me green hoga`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `${minutes} min me green hoga`;
  const hours = Math.floor(minutes / 60);
  return `${hours} ghante me green hoga`;
}

export default function AIKeyPoolPortal() {
  const [keys, setKeys] = useState<AiKey[]>([]);
  const [loading, setLoading] = useState(false);
  const [pasteBox, setPasteBox] = useState('');
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [, forceTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchKeys = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await axios.get('/api/messages/ai-keys');
      if (res.data?.success) {
        setKeys(res.data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch AI key pool:', err);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys(true);
    pollRef.current = setInterval(() => fetchKeys(false), 5000);
    const tickTimer = setInterval(() => forceTick(t => t + 1), 1000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      clearInterval(tickTimer);
    };
  }, [fetchKeys]);

  async function handleAddKeys() {
    const cleaned = pasteBox.trim();
    if (!cleaned) {
      alert('Pehle ek ya zyada API key paste karein (ek line me ek key).');
      return;
    }
    setAdding(true);
    try {
      const res = await axios.post('/api/messages/ai-keys', {
        keys: cleaned.split(/[\n,]+/).map(k => k.trim()).filter(Boolean),
        label: label.trim(),
        provider: 'gemini',
      });
      if (res.data?.success) {
        setPasteBox('');
        setLabel('');
        setKeys(res.data.keys || []);
        const { addedCount, skippedCount, labelCollisionWarning } = res.data;
        const warning = labelCollisionWarning
          ? `\n\n⚠️ Isi label ki ek key pehle se maujood hai. Agar ye same Google account/project se hai, to ye extra daily quota NAHI degi — sirf alag-alag account ki keys hi real capacity badhati hain.`
          : '';
        alert(`${addedCount} key(s) add ho gayi.${skippedCount ? ` ${skippedCount} pehle se maujood thi, skip kar di.` : ''}${warning}`);
      } else {
        alert('Key add nahi ho payi: ' + (res.data?.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(id: string, maskedKey: string) {
    if (!confirm(`"${maskedKey}" key hamesha ke liye delete ho jayegi. Confirm?`)) return;
    try {
      const res = await axios.delete(`/api/messages/ai-keys/${id}`);
      if (res.data?.success) {
        setKeys(res.data.keys || []);
      } else {
        alert('Delete fail ho gaya.');
      }
    } catch (err: any) {
      alert('Error deleting key: ' + err.message);
    }
  }

  const greenCount = keys.filter(k => k.status === 'green').length;
  const redCount = keys.length - greenCount;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: 24, height: 'calc(100vh - 150px)', overflow: 'hidden' }}>

      {/* Left panel: Add keys */}
      <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'white' }}>AI Key Pool</h3>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            Jitni marzi Gemini API keys daal do. Jo valid hai wo GREEN, jiski rate limit khatam ho gayi wo RED — aur apne time pe wapas GREEN ho jaayegi. Bot automatically GREEN keys use karega.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#4ade80' }}>{greenCount}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>GREEN (usable)</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, padding: '8px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#f87171' }}>{redCount}</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>RED (cooldown)</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid rgba(56,189,248,0.1)', paddingTop: 16 }}>
          <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
            Google account label (recommended — e.g. "raza.gmail")
          </label>
          <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 6, lineHeight: 1.4 }}>
            Har alag Google account ke liye alag label use karo. Google API se ye khud pata nahi kar sakte ki kaunsi key kaunse account ki hai — agar do keys ek hi account/project se hon to unse extra daily quota nahi milta, sirf label se hi track ho sakta hai.
          </div>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. raza.gmail"
            style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13, marginBottom: 12 }}
          />
          <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
            API Key(s) — ek line me ek key paste karein
          </label>
          <textarea
            value={pasteBox}
            onChange={(e) => setPasteBox(e.target.value)}
            placeholder={'AIzaSy...\nAIzaSy...\nAIzaSy...'}
            rows={8}
            style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 12, fontFamily: 'monospace', resize: 'vertical' }}
          />
          <button
            className="btn-primary"
            onClick={handleAddKeys}
            disabled={adding}
            style={{ width: '100%', marginTop: 12, padding: '10px 12px', fontSize: 13, opacity: adding ? 0.6 : 1 }}
          >
            {adding ? 'Adding...' : '+ Add Key(s) to Pool'}
          </button>
        </div>
      </div>

      {/* Right panel: Key list with live status */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(56,189,248,0.1)', paddingBottom: 12, marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'white', fontWeight: 700 }}>Key Status ({keys.length})</h3>
          <span style={{ fontSize: 11, color: '#64748b' }}>Auto-refresh every 5s</span>
        </div>

        {loading && <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading keys...</div>}

        {!loading && keys.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 12 }}>
            <div style={{ fontSize: 36 }}>🔑</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Koi key pool me nahi hai. Left side se pehli key add karein.</div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {keys.map((k) => {
            const isGreen = k.status === 'green';
            return (
              <div
                key={k.id}
                style={{
                  background: 'rgba(15,23,42,0.4)',
                  border: `1px solid ${k.possibleDuplicateAccount ? 'rgba(250,204,21,0.4)' : isGreen ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                  borderRadius: 10,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span
                      title={isGreen ? 'Valid — rate limit baaki hai' : 'Rate limited / rejected'}
                      style={{
                        width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                        background: isGreen ? '#4ade80' : '#f87171',
                        boxShadow: isGreen ? '0 0 8px rgba(74,222,128,0.6)' : '0 0 8px rgba(248,113,113,0.6)',
                      }}
                    />
                    <div style={{ minWidth: 0 }}>
                      <div style={{ color: 'white', fontWeight: 600, fontSize: 13, fontFamily: 'monospace' }}>{k.maskedKey}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>
                        {k.label || 'No label'}
                        {!isGreen && k.lastError ? ` — ${k.lastError}` : ''}
                      </div>
                      {!isGreen && k.cooldownUntil && (
                        <div style={{ color: '#fb923c', fontSize: 11, marginTop: 2 }}>{formatCountdown(k.cooldownUntil)}</div>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <span
                      style={{
                        fontSize: 9, fontWeight: 800, padding: '2px 8px', borderRadius: 4,
                        background: isGreen ? 'rgba(34,197,94,0.13)' : 'rgba(239,68,68,0.13)',
                        color: isGreen ? '#4ade80' : '#f87171',
                      }}
                    >
                      {isGreen ? 'GREEN' : 'RED'}
                    </span>
                    <button
                      onClick={() => handleDelete(k.id, k.maskedKey)}
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', padding: '5px 10px', borderRadius: 6, fontSize: 11, cursor: 'pointer' }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {k.possibleDuplicateAccount && (
                  <div style={{ background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.25)', borderRadius: 6, padding: '6px 10px', color: '#fde68a', fontSize: 11 }}>
                    ⚠️ Possibly same Google account/project: {k.possibleDuplicateNote}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
