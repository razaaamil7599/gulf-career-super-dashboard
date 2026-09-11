'use client';

import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { getCandidates } from '@/lib/api';
import { db, hasFirebaseConfig } from '@/lib/firebase';
import { resolveMetaAccountInfo } from '@/lib/metaAccounts';

interface Candidate {
  id: string;
  name: string;
  phone: string;
  skill: string;
  country: string;
  experience: number;
  status: 'clean' | 'pending_update' | 'pending_re-profiling';
  availability?: string;
  isAgency?: boolean;
  unreadCount?: number;
  lastInboundPreview?: string;
  lastInboundAt?: string;
  updatedAt?: string;
  createdAt?: string;
  cvLink?: string | null;
  photoLink?: string | null;
  bot_name?: string;
  botType?: string;
  leadStatus?: string;
  leadReason?: string;
  excludeFromBlast?: boolean;
  notes?: string;
  phoneNumberId?: string;
  wabaId?: string;
  lastRecipientPhoneId?: string;
  lastRecipientPhone?: string;
  businessAccountName?: string;
}

interface CandidateGridProps {
  activeSkill: string;
  activeCountry: string;
  searchQuery?: string;
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  onVisibleCandidateIdsChange?: (ids: string[]) => void;
  onVisibleCandidatesChange?: (candidates: Candidate[]) => void;
  onCandidateClick: (c: Candidate) => void;
  activeCandidateId?: string | null;
  refreshKey?: number;
}

const STATUS_MAP = {
  clean: { label: 'Clean', cls: 'badge-clean' },
  pending_update: { label: 'Pending', cls: 'badge-pending' },
  'pending_re-profiling': { label: 'Re-Profile', cls: 'badge-reprofile' },
};

const COUNTRY_FLAGS: Record<string, string> = {
  Saudi: 'SA',
  UAE: 'UAE',
  Qatar: 'QA',
  Kuwait: 'KW',
  Oman: 'OM',
  Bahrain: 'BH',
};

function getCandidateActivityTime(candidate: Candidate) {
  return new Date(candidate.lastInboundAt || candidate.updatedAt || candidate.createdAt || 0).getTime();
}

function formatCandidateActivityTime(candidate: Candidate): string {
  const ts = getCandidateActivityTime(candidate);
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

// Strictly chronological: whichever candidate has the most recent inbound/
// outbound activity sorts first, full stop — even a 1-second difference must
// move it to the top. No unread-count priority and no "pin the open chat"
// exception, since either would let an older conversation outrank a genuinely
// fresher one, which is exactly the ordering this list must never show.
function sortCandidates(candidates: Candidate[]) {
  return [...candidates].sort((a, b) => {
    const aTs = getCandidateActivityTime(a);
    const bTs = getCandidateActivityTime(b);
    if (aTs !== bTs) return bTs - aTs;

    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

const ARS_PASSWORD = 'Aamil$759922';

function isArsCandidate(candidate: Candidate) {
  return candidate.botType === 'ARS' || candidate.bot_name === 'AR Studios';
}

function matchesFilters(candidate: Candidate, activeSkill: string, activeCountry: string, searchQuery: string, botFilter: string, arsUnlocked: boolean) {
  const query = searchQuery.trim().toLowerCase();
  const matchesSkill = !activeSkill || candidate.skill === activeSkill;
  const matchesCountry = !activeCountry || candidate.country === activeCountry;
  const matchesQuery =
    !query
    || String(candidate.name || '').toLowerCase().includes(query)
    || String(candidate.phone || '').includes(query);
  const matchesBot =
    !botFilter
    || (botFilter === 'ARS' && isArsCandidate(candidate))
    || (botFilter === 'GCG' && !isArsCandidate(candidate));

  // ARS candidates stay hidden everywhere (including the "All" tab) until the
  // password is entered — not just when the ARS tab itself is selected.
  const arsGate = !isArsCandidate(candidate) || arsUnlocked;

  return matchesSkill && matchesCountry && matchesQuery && matchesBot && arsGate;
}

function mapRealtimeCandidates(raw: Record<string, any> | null | undefined): Candidate[] {
  return Object.entries(raw || {}).map(([id, value]) => ({
    id,
    ...(value || {}),
  })) as Candidate[];
}

export default function CandidateGrid({
  activeSkill,
  activeCountry,
  searchQuery = '',
  selectedIds,
  onSelectionChange,
  onVisibleCandidateIdsChange,
  onVisibleCandidatesChange,
  onCandidateClick,
  activeCandidateId,
  refreshKey,
}: CandidateGridProps) {
  const [rawCandidates, setRawCandidates] = useState<Candidate[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [botFilter, setBotFilter] = useState('');
  const [arsUnlocked, setArsUnlocked] = useState(false);
  const [showArsPasswordPrompt, setShowArsPasswordPrompt] = useState(false);
  const [arsPasswordInput, setArsPasswordInput] = useState('');
  const [arsPasswordError, setArsPasswordError] = useState('');

  // Card order is always the strict chronological sort below, recomputed on
  // every live data push — a fresh message anywhere must be visible at the
  // top immediately, even a 1-second difference. (forceResort is kept as a
  // parameter only because callers still pass it; it no longer changes the
  // behavior here — every call fully re-sorts.)
  const applyFilters = useCallback((source: Candidate[], _forceResort: boolean) => {
    const filtered = source.filter(candidate => matchesFilters(candidate, activeSkill, activeCountry, searchQuery, botFilter, arsUnlocked));
    setCandidates(sortCandidates(filtered));
    setTotal(filtered.length);
  }, [activeSkill, activeCountry, searchQuery, botFilter, arsUnlocked]);

  function requestArsAccess() {
    if (arsUnlocked) {
      setBotFilter('ARS');
      return;
    }
    setArsPasswordInput('');
    setArsPasswordError('');
    setShowArsPasswordPrompt(true);
  }

  function submitArsPassword() {
    if (arsPasswordInput === ARS_PASSWORD) {
      setArsUnlocked(true);
      setBotFilter('ARS');
      setShowArsPasswordPrompt(false);
      setArsPasswordInput('');
      setArsPasswordError('');
    } else {
      setArsPasswordError('Galat password. Dobara try karein.');
    }
  }

  const fetchCandidates = useCallback(async (withLoader = false) => {
    if (withLoader) {
      setLoading(true);
    }

    try {
      const data = await getCandidates(
        activeSkill || undefined,
        activeCountry || undefined,
        searchQuery || undefined,
      );
      const nextCandidates = data.candidates || [];

      startTransition(() => {
        setRawCandidates(nextCandidates);
        applyFilters(nextCandidates, true);
        setLoading(false);
      });
    } catch {
      startTransition(() => {
        setRawCandidates([]);
        setCandidates([]);
        setTotal(0);
        setLoading(false);
      });
    }
  }, [activeCountry, activeSkill, applyFilters, searchQuery]);

  const rawCandidatesRef = useRef<Candidate[]>([]);

  // Live data pushes (new message, unread count, etc.) update card content
  // without reshuffling the grid.
  useEffect(() => {
    rawCandidatesRef.current = rawCandidates;
    applyFilters(rawCandidates, false);
  }, [rawCandidates, applyFilters]);

  // Only an actual filter/search/tab change (i.e. applyFilters itself was
  // rebuilt) re-sorts the whole grid from scratch.
  useEffect(() => {
    applyFilters(rawCandidatesRef.current, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters]);

  useEffect(() => {
    onVisibleCandidateIdsChange?.(candidates.map((candidate) => candidate.id));
    onVisibleCandidatesChange?.(candidates);
  }, [candidates, onVisibleCandidateIdsChange, onVisibleCandidatesChange]);

  useEffect(() => {
    if (!hasFirebaseConfig || !db) {
      fetchCandidates(true);
      return;
    }

    setLoading(true);

    const candidatesRef = ref(db, 'candidates');
    const unsubscribe = onValue(
      candidatesRef,
      (snapshot) => {
        const nextCandidates = mapRealtimeCandidates(snapshot.val());
        startTransition(() => {
          setRawCandidates(nextCandidates);
          setLoading(false);
        });
      },
      () => {
        fetchCandidates(true);
      }
    );

    return () => unsubscribe();
  }, [fetchCandidates]);

  useEffect(() => {
    if (!refreshKey) return;
    fetchCandidates(false);
  }, [fetchCandidates, refreshKey]);

  useEffect(() => {
    const refreshFromServer = () => {
      if (document.hidden) return;
      fetchCandidates(false);
    };

    window.addEventListener('focus', refreshFromServer);
    document.addEventListener('visibilitychange', refreshFromServer);

    return () => {
      window.removeEventListener('focus', refreshFromServer);
      document.removeEventListener('visibilitychange', refreshFromServer);
    };
  }, [fetchCandidates]);

  function toggleSelect(id: string) {
    if (selectedIds.includes(id)) {
      onSelectionChange(selectedIds.filter((selectedId) => selectedId !== id));
    } else {
      onSelectionChange([...selectedIds, id]);
    }
  }

  function handleCardClick(candidate: Candidate) {
    onCandidateClick(candidate);
  }

  function selectAll() {
    onSelectionChange(candidates.map((candidate) => candidate.id));
  }

  function clearAll() {
    onSelectionChange([]);
  }

  const isInitialLoading = loading && candidates.length === 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>
            Candidate Pool
            {(activeSkill || activeCountry) && (
              <span style={{ fontSize: 14, color: '#38bdf8', fontWeight: 500, marginLeft: 10 }}>
                {[activeSkill, activeCountry].filter(Boolean).join(' · ')}
              </span>
            )}
          </h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
            {isInitialLoading ? 'Loading...' : `${total} matching candidates`}
            {selectedIds.length > 0 && (
              <span style={{ color: '#38bdf8', marginLeft: 10, fontWeight: 600 }}>
                · {selectedIds.length} selected
              </span>
            )}
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Bot Source Filter: All / GCG / ARS */}
          <div style={{ display: 'flex', gap: 0, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(56,189,248,0.18)' }}>
            {[
              { value: '', label: 'All', key: 'all' },
              { value: 'GCG', label: 'GCG', key: 'gcg' },
              { value: 'ARS', label: 'ARS', key: 'ars' },
            ].map((opt) => (
              <button
                key={opt.key}
                onClick={() => {
                  if (opt.value === 'ARS') {
                    requestArsAccess();
                  } else {
                    setBotFilter(opt.value);
                  }
                  onSelectionChange([]);
                }}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  padding: '5px 14px',
                  cursor: 'pointer',
                  border: 'none',
                  background: botFilter === opt.value
                    ? (opt.value === 'ARS' ? 'rgba(251,146,60,0.22)' : opt.value === 'GCG' ? 'rgba(34,197,94,0.18)' : 'rgba(56,189,248,0.15)')
                    : 'rgba(15,23,42,0.6)',
                  color: botFilter === opt.value
                    ? (opt.value === 'ARS' ? '#fb923c' : opt.value === 'GCG' ? '#4ade80' : '#38bdf8')
                    : '#64748b',
                  transition: 'all 0.2s',
                  letterSpacing: '0.03em',
                }}
              >
                {opt.value === 'ARS' && !arsUnlocked ? `🔒 ${opt.label}` : opt.label}
              </button>
            ))}
          </div>

          {selectedIds.length < candidates.length && (
            <button
              onClick={selectAll}
              style={{ fontSize: 12, color: '#38bdf8', background: 'none', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}
            >
              Select All
            </button>
          )}

          {selectedIds.length > 0 && (
            <button
              onClick={clearAll}
              style={{ fontSize: 12, color: '#64748b', background: 'none', border: '1px solid rgba(100,116,139,0.25)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}

          <button
            onClick={() => fetchCandidates(false)}
            style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: '1px solid rgba(100,116,139,0.25)', borderRadius: 6, padding: '5px 12px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>
      </div>

      {isInitialLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>
          <div className="spinner" style={{ width: 28, height: 28 }} />
        </div>
      )}

      {!isInitialLoading && candidates.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>People</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>No Matching Candidates</div>
          <div style={{ fontSize: 12 }}>
            {activeSkill || activeCountry
              ? 'Try different skill/country filters, or run seed data first.'
              : 'Load seed data to see candidates. Run: node data/seedData.js'}
          </div>
        </div>
      )}

      {!isInitialLoading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {candidates.map((candidate) => {
            const isSelected = selectedIds.includes(candidate.id);
            const isActiveChat = candidate.id === activeCandidateId;
            const hasUnread = Number(candidate.unreadCount || 0) > 0;
            const statusInfo = STATUS_MAP[candidate.status] || STATUS_MAP.pending_update;
            const metaAcc = resolveMetaAccountInfo(candidate);

            return (
              <div
                key={candidate.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest('.select-checkbox-area')) return;
                  handleCardClick(candidate);
                }}
                className={`candidate-card animate-fade-in ${isSelected ? 'selected' : ''}`}
                style={{
                  cursor: 'pointer',
                  border: isActiveChat
                    ? '1px solid rgba(56,189,248,0.5)'
                    : hasUnread
                      ? '1px solid rgba(34,197,94,0.35)'
                      : undefined,
                  boxShadow: isActiveChat
                    ? '0 0 0 1px rgba(56,189,248,0.12), 0 10px 24px rgba(14,165,233,0.08)'
                    : hasUnread
                      ? '0 8px 20px rgba(34,197,94,0.08)'
                      : undefined,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      className="select-checkbox-area"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleSelect(candidate.id);
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: isSelected
                          ? 'linear-gradient(135deg, #0ea5e9, #6366f1)'
                          : 'rgba(56,189,248,0.1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 700,
                        color: isSelected ? 'white' : '#38bdf8',
                        transition: 'all 0.2s',
                        cursor: 'pointer',
                      }}
                    >
                      {isSelected ? 'OK' : (candidate.isAgency ? 'AG' : candidate.name?.charAt(0) || '?')}
                    </div>

                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'white' }}>{candidate.name}</div>
                        {candidate.leadStatus === 'hot_lead' && (
                          <span style={{ fontSize: 8, background: 'rgba(239,68,68,0.18)', color: '#f87171', fontWeight: 900, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(239,68,68,0.35)', letterSpacing: '0.03em' }}>
                            🔥 HOT
                          </span>
                        )}
                        {candidate.leadStatus === 'talk_later' && (
                          <span style={{ fontSize: 8, background: 'rgba(245,158,11,0.18)', color: '#fbbf24', fontWeight: 900, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(245,158,11,0.35)', letterSpacing: '0.03em' }}>
                            ⏳ LATER
                          </span>
                        )}
                        {candidate.leadStatus === 'blocked' && (
                          <span style={{ fontSize: 8, background: 'rgba(148,163,184,0.18)', color: '#94a3b8', fontWeight: 900, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(148,163,184,0.35)', letterSpacing: '0.03em' }}>
                            🚫 BLOCKED
                          </span>
                        )}
                        {candidate.excludeFromBlast && (
                          <span style={{ fontSize: 8, background: 'rgba(244,63,94,0.18)', color: '#f43f5e', fontWeight: 900, padding: '1px 4px', borderRadius: 3, border: '1px solid rgba(244,63,94,0.35)', letterSpacing: '0.03em' }}>
                            🔇 MUTED
                          </span>
                        )}
                        {candidate.leadReason && (
                          <span style={{ fontSize: 8, background: 'rgba(56,189,248,0.12)', color: '#38bdf8', fontWeight: 700, padding: '1px 5px', borderRadius: 3, border: '1px solid rgba(56,189,248,0.25)', maxWidth: 130, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {candidate.leadReason}
                          </span>
                        )}
                        {(hasUnread || isActiveChat) && (
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: hasUnread ? '#22c55e' : '#38bdf8',
                              boxShadow: hasUnread
                                ? '0 0 0 4px rgba(34,197,94,0.12)'
                                : '0 0 0 4px rgba(56,189,248,0.12)',
                            }}
                          />
                        )}

                        {!!candidate.unreadCount && (
                          <span
                            style={{
                              minWidth: 16,
                              height: 16,
                              borderRadius: 999,
                              background: '#22c55e',
                              color: '#052e16',
                              fontSize: 9,
                              fontWeight: 900,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '0 5px',
                            }}
                          >
                            {candidate.unreadCount > 9 ? '9+' : candidate.unreadCount}
                          </span>
                        )}

                        {candidate.isAgency && (
                          <span
                            style={{
                              fontSize: 8,
                              background: '#fca311',
                              color: 'black',
                              fontWeight: 900,
                              padding: '1px 3px',
                              borderRadius: 2,
                            }}
                          >
                            AGENCY
                          </span>
                        )}

                        {/* Bot source badge: GCG (green) or ARS (orange) */}
                        {candidate.botType === 'ARS' || candidate.bot_name === 'AR Studios' ? (
                          <span
                            style={{
                              fontSize: 8,
                              background: 'rgba(251,146,60,0.18)',
                              color: '#fb923c',
                              fontWeight: 900,
                              padding: '1px 4px',
                              borderRadius: 3,
                              border: '1px solid rgba(251,146,60,0.35)',
                              letterSpacing: '0.03em',
                            }}
                          >
                            ARS
                          </span>
                        ) : (
                          <span
                            style={{
                              fontSize: 8,
                              background: 'rgba(34,197,94,0.13)',
                              color: '#4ade80',
                              fontWeight: 900,
                              padding: '1px 4px',
                              borderRadius: 3,
                              border: '1px solid rgba(34,197,94,0.3)',
                              letterSpacing: '0.03em',
                            }}
                          >
                            GCG
                          </span>
                        )}

                        {isActiveChat && (
                          <span
                            style={{
                              fontSize: 8,
                              background: 'rgba(56,189,248,0.15)',
                              color: '#7dd3fc',
                              fontWeight: 900,
                              padding: '1px 5px',
                              borderRadius: 999,
                              letterSpacing: '0.04em',
                            }}
                          >
                            LIVE
                          </span>
                        )}
                      </div>

                      <div style={{ fontSize: 11, color: '#64748b' }}>{candidate.phone}</div>

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
                          background: metaAcc.botType === 'ARS' ? 'rgba(251,146,60,0.12)' : metaAcc.phoneNumberId === '1004575229405481' ? 'rgba(52,211,153,0.12)' : 'rgba(56,189,248,0.12)',
                          border: `1px solid ${metaAcc.botType === 'ARS' ? 'rgba(251,146,60,0.3)' : metaAcc.phoneNumberId === '1004575229405481' ? 'rgba(52,211,153,0.3)' : 'rgba(56,189,248,0.3)'}`,
                          padding: '1.5px 5px',
                          borderRadius: 4,
                          marginTop: 3,
                          cursor: 'help',
                          maxWidth: 200,
                        }}
                      >
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          📱 To: {metaAcc.shortLabel}
                        </span>
                        {metaAcc.phoneNumberId && (
                          <span style={{ fontSize: 8, opacity: 0.8, fontFamily: 'monospace' }}>
                            (..{metaAcc.phoneNumberId.slice(-4)})
                          </span>
                        )}
                      </div>

                      {formatCandidateActivityTime(candidate) && (
                        <div style={{ fontSize: 9, color: '#475569', marginTop: 1, fontVariantNumeric: 'tabular-nums' }}>
                          {formatCandidateActivityTime(candidate)}
                        </div>
                      )}

                      {candidate.lastInboundPreview && (
                        <div
                          style={{
                            fontSize: 10,
                            color: candidate.unreadCount ? '#86efac' : '#475569',
                            marginTop: 3,
                            maxWidth: 180,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {candidate.lastInboundPreview}
                        </div>
                      )}
                    </div>
                  </div>

                  <span className={`badge ${statusInfo.cls}`}>{statusInfo.label}</span>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: '#38bdf8', background: 'rgba(56,189,248,0.08)', borderRadius: 4, padding: '2px 7px' }}>
                    Skill {candidate.skill}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(148,163,184,0.08)', borderRadius: 4, padding: '2px 7px' }}>
                    {COUNTRY_FLAGS[candidate.country] || 'GLB'} {candidate.country}
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8', background: 'rgba(148,163,184,0.08)', borderRadius: 4, padding: '2px 7px' }}>
                    {candidate.experience}yr exp
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showArsPasswordPrompt && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(2,6,23,0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowArsPasswordPrompt(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#0f172a',
              border: '1px solid rgba(251,146,60,0.3)',
              borderRadius: 12,
              padding: '22px 24px',
              width: 300,
              boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 700, color: '#fb923c', marginBottom: 4 }}>
              🔒 ARS Access Locked
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
              Password daaliye ARS candidates dekhne ke liye.
            </div>
            <input
              type="password"
              autoFocus
              value={arsPasswordInput}
              onChange={(e) => { setArsPasswordInput(e.target.value); setArsPasswordError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') submitArsPassword(); }}
              placeholder="Password"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                borderRadius: 8,
                border: arsPasswordError ? '1px solid #f87171' : '1px solid rgba(148,163,184,0.25)',
                background: 'rgba(15,23,42,0.8)',
                color: 'white',
                fontSize: 13,
                marginBottom: 6,
              }}
            />
            {arsPasswordError && (
              <div style={{ fontSize: 11, color: '#f87171', marginBottom: 6 }}>{arsPasswordError}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowArsPasswordPrompt(false)}
                style={{ fontSize: 12, color: '#94a3b8', background: 'none', border: '1px solid rgba(100,116,139,0.25)', borderRadius: 6, padding: '6px 14px', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={submitArsPassword}
                style={{ fontSize: 12, color: '#0f172a', background: '#fb923c', border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontWeight: 700 }}
              >
                Unlock
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
