'use client';

import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db, hasFirebaseConfig } from '@/lib/firebase';
import { getCandidates } from '@/lib/api';
import { resolveMetaAccountInfo } from '@/lib/metaAccounts';

interface Candidate {
  id: string;
  name: string;
  phone: string;
  skill: string;
  country: string;
  experience: number;
  leadStatus?: string;
  leadReason?: string;
  notes?: string;
  excludeFromBlast?: boolean;
  isAgency?: boolean;
  phoneNumberId?: string;
  wabaId?: string;
  lastRecipientPhoneId?: string;
  lastRecipientPhone?: string;
  businessAccountName?: string;
  botType?: string;
  bot_name?: string;
}

const COUNTRY_FLAGS: Record<string, string> = {
  Saudi: 'SA',
  UAE: 'UAE',
  Qatar: 'QA',
  Kuwait: 'KW',
  Oman: 'OM',
  Bahrain: 'BH',
};

export default function LeadsPortal() {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'hot_lead' | 'talk_later' | 'blocked'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!hasFirebaseConfig || !db) {
      // REST fallback
      getCandidates()
        .then((res) => {
          if (res.success && res.candidates) {
            setCandidates(res.candidates);
          }
          setLoading(false);
        })
        .catch((err) => {
          console.error('[LeadsPortal] REST fetch failed:', err);
          setLoading(false);
        });
      return;
    }

    const candidatesRef = ref(db, 'candidates');
    const unsubscribe = onValue(
      candidatesRef,
      (snapshot) => {
        const val = snapshot.val();
        if (val) {
          const list = Object.entries(val).map(([id, data]: [string, any]) => ({
            id,
            ...data,
          })) as Candidate[];
          setCandidates(list);
        } else {
          setCandidates([]);
        }
        setLoading(false);
      },
      (error) => {
        console.error('[LeadsPortal] Firebase subscribe failed:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Filter candidates that have any leadStatus categorized, matching the filter and search query
  const filteredCandidates = candidates.filter((c) => {
    // Must be categorized
    if (!c.leadStatus) return false;

    // Match category filter
    if (filter !== 'all' && c.leadStatus !== filter) return false;

    // Match search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const nameMatch = String(c.name || '').toLowerCase().includes(q);
      const phoneMatch = String(c.phone || '').includes(q);
      const skillMatch = String(c.skill || '').toLowerCase().includes(q);
      if (!nameMatch && !phoneMatch && !skillMatch) return false;
    }

    return true;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Search and Filters Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Categorized Leads</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
            {loading ? 'Loading...' : `${filteredCandidates.length} leads found`}
          </p>
        </div>

        {/* Category sub-filters */}
        <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(56,189,248,0.18)' }}>
          {[
            { value: 'all', label: 'All Leads' },
            { value: 'hot_lead', label: '🔥 Hot' },
            { value: 'talk_later', label: '⏳ Talk Later' },
            { value: 'blocked', label: '🚫 Blocked' },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value as any)}
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '6px 14px',
                cursor: 'pointer',
                border: 'none',
                background: filter === opt.value ? 'rgba(56,189,248,0.15)' : 'rgba(15,23,42,0.6)',
                color: filter === opt.value ? '#38bdf8' : '#64748b',
                transition: 'all 0.2s',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Local Search Bar */}
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          placeholder="🔍 Search leads by name, phone or trade..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 16px',
            background: 'rgba(30,41,59,0.7)',
            border: '1px solid rgba(56,189,248,0.2)',
            borderRadius: 10,
            color: 'white',
            fontSize: 14,
            outline: 'none',
          }}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            style={{
              position: 'absolute',
              right: 12,
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'none',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        )}
      </div>

      {/* Grid of Leads */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      ) : filteredCandidates.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No Leads Found</div>
          <div style={{ fontSize: 12 }}>Categorize candidates in the chat panel to see them here.</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {filteredCandidates.map((c) => {
            const metaAcc = resolveMetaAccountInfo(c);
            return (
              <div
                key={c.id}
                onClick={() => window.open(`/candidate/${c.id}`, '_blank')}
                className="candidate-card"
                style={{
                  cursor: 'pointer',
                  background: 'rgba(30, 41, 59, 0.45)',
                  border: '1px solid rgba(56, 189, 248, 0.08)',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: '50%',
                        background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 14,
                        fontWeight: 800,
                        color: 'white',
                      }}
                    >
                      {c.isAgency ? 'AG' : c.name?.charAt(0) || '?'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: 'white', display: 'flex', gap: 6, alignItems: 'center' }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11, color: '#38bdf8' }}>{c.phone}</div>
                      
                      {/* Received-on Meta Account & Phone ID Pill */}
                      <div
                        title={`Received on: ${metaAcc.accountName} (${metaAcc.displayPhoneNumber || 'N/A'})\nPhone Number ID: ${metaAcc.phoneNumberId || 'N/A'}\nWhatsApp Business Account ID: ${metaAcc.wabaId || 'N/A'}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 9,
                          fontWeight: 700,
                          color: metaAcc.tagColor,
                          background: 'rgba(255,255,255,0.06)',
                          border: `1px solid ${metaAcc.tagColor}35`,
                          padding: '1px 5px',
                          borderRadius: 4,
                          marginTop: 2,
                          cursor: 'help',
                        }}
                      >
                        <span>📱 To: {metaAcc.shortLabel}</span>
                        {metaAcc.phoneNumberId && (
                          <span style={{ fontSize: 8, opacity: 0.75, fontFamily: 'monospace' }}>
                            ({metaAcc.phoneNumberId.slice(-4)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Lead Status Badge */}
                  {c.leadStatus === 'hot_lead' && (
                    <span style={{ fontSize: 9, background: 'rgba(239,68,68,0.18)', color: '#f87171', fontWeight: 900, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.35)' }}>
                      🔥 HOT
                    </span>
                  )}
                  {c.leadStatus === 'talk_later' && (
                    <span style={{ fontSize: 9, background: 'rgba(245,158,11,0.18)', color: '#fbbf24', fontWeight: 900, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(245,158,11,0.35)' }}>
                      ⏳ LATER
                    </span>
                  )}
                  {c.leadStatus === 'blocked' && (
                    <span style={{ fontSize: 9, background: 'rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 900, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(148,163,184,0.35)' }}>
                      🚫 BLOCKED
                    </span>
                  )}
                </div>

              {/* Discussion Reason & Mute Badges */}
              {(c.leadReason || c.excludeFromBlast) && (
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  {c.leadReason && (
                    <span style={{ fontSize: 9, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontWeight: 700, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(56,189,248,0.25)' }}>
                      📌 {c.leadReason}
                    </span>
                  )}
                  {c.excludeFromBlast && (
                    <span style={{ fontSize: 9, background: 'rgba(244,63,94,0.18)', color: '#f43f5e', fontWeight: 900, padding: '2px 6px', borderRadius: 4, border: '1px solid rgba(244,63,94,0.35)' }}>
                      🔇 MUTED
                    </span>
                  )}
                </div>
              )}

              {/* Notes Snippet */}
              {c.notes && (
                <div style={{ fontSize: 11, color: '#cbd5e1', background: 'rgba(15,23,42,0.5)', padding: '6px 10px', borderRadius: 6, borderLeft: '2px solid #38bdf8', lineHeight: 1.35, maxHeight: 48, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                  💬 {c.notes}
                </div>
              )}

              {/* Tags */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: '#38bdf8', background: 'rgba(56,189,248,0.08)', borderRadius: 4, padding: '2px 6px' }}>
                  Skill {c.skill}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(148,163,184,0.08)', borderRadius: 4, padding: '2px 6px' }}>
                  {COUNTRY_FLAGS[c.country] || 'GLB'} {c.country}
                </span>
                <span style={{ fontSize: 10, color: '#94a3b8', background: 'rgba(148,163,184,0.08)', borderRadius: 4, padding: '2px 6px' }}>
                  {c.experience}yr exp
                </span>
              </div>

              {/* Open page action indicator */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                  Open Details Page ↗
                </span>
              </div>
            </div>
          );
        })}
        </div>
      )}
    </div>
  );
}
