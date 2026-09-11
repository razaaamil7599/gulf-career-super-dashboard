'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getCandidateById, updateCandidate } from '@/lib/api';
import ChatPanel from '@/components/action/ChatPanel';
import { resolveMetaAccountInfo } from '@/lib/metaAccounts';

interface Candidate {
  id: string;
  name: string;
  phone: string;
  skill: string;
  country: string;
  experience: number;
  salary?: string;
  leadStatus?: string;
  leadReason?: string;
  isAgency?: boolean;
  cvLink?: string | null;
  photoLink?: string | null;
  status?: string;
  notes?: string;
  excludeFromBlast?: boolean;
  phoneNumberId?: string;
  wabaId?: string;
  lastRecipientPhoneId?: string;
  lastRecipientPhone?: string;
  businessAccountName?: string;
  botType?: string;
  bot_name?: string;
}

export default function CandidateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id } = use(params);

  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  // Edit fields state
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({
    name: '',
    skill: '',
    country: '',
    salary: '',
    experience: 0,
    leadReason: '',
    notes: '',
  });

  const loadCandidate = async () => {
    try {
      setError('');
      const data = await getCandidateById(id);
      if (data.success && data.candidate) {
        setCandidate(data.candidate);
        setEditData({
          name: data.candidate.name || '',
          skill: data.candidate.skill || '',
          country: data.candidate.country || '',
          salary: data.candidate.salary || '',
          experience: data.candidate.experience || 0,
          leadReason: data.candidate.leadReason || '',
          notes: data.candidate.notes || '',
        });
      } else {
        setError('Candidate details not found.');
      }
    } catch (err: any) {
      console.error('Failed to load candidate details:', err);
      setError(err?.response?.data?.error || err.message || 'Failed to load candidate.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (id) {
      loadCandidate();
    }
  }, [id, refreshKey]);

  const handleSaveProfile = async () => {
    if (!candidate) return;
    try {
      await updateCandidate(candidate.id, editData);
      setEditing(false);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to update candidate:', err);
      alert('Failed to update candidate profile');
    }
  };

  const handleLeadStatusChange = async (newStatus: string) => {
    if (!candidate) return;
    try {
      await updateCandidate(candidate.id, { leadStatus: newStatus });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to update lead status:', err);
      alert('Failed to update lead status');
    }
  };

  const handleToggleExcludeFromBlast = async (exclude: boolean) => {
    if (!candidate) return;
    try {
      await updateCandidate(candidate.id, { excludeFromBlast: exclude });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error('Failed to update block broadcast status:', err);
      alert('Failed to update broadcast status');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#090d16', color: 'white', alignItems: 'center', justifyContent: 'center' }}>
        <div className="spinner" style={{ width: 40, height: 40, border: '4px solid rgba(56, 189, 248, 0.1)', borderTopColor: '#38bdf8', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
        <p style={{ marginTop: 16, color: '#64748b', fontSize: 14 }}>Loading candidate details...</p>
        <style jsx global>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (error || !candidate) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', background: '#090d16', color: 'white', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
        <div style={{ fontSize: 48 }}>⚠️</div>
        <div style={{ color: '#f87171', fontSize: 16, fontWeight: 600 }}>{error || 'Candidate not found.'}</div>
        <button
          onClick={() => router.push('/dashboard')}
          style={{ background: '#0ea5e9', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#090d16', color: '#f8fafc', overflow: 'hidden' }}>
      {/* Top Navbar */}
      <header style={{ height: 56, background: '#0f172a', borderBottom: '1px solid rgba(56, 189, 248, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => router.push('/dashboard')}
            style={{
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              padding: '6px 12px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            ← Dashboard
          </button>
          <span style={{ fontSize: 14, fontWeight: 800, color: 'white', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Candidate Profile & Chat
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#f87171', background: 'rgba(244, 63, 94, 0.08)', padding: '6px 10px', borderRadius: '8px', border: '1px solid rgba(244, 63, 94, 0.16)', height: '32px' }}>
            <input
              type="checkbox"
              checked={Boolean(candidate.excludeFromBlast)}
              onChange={(e) => handleToggleExcludeFromBlast(e.target.checked)}
              style={{ cursor: 'pointer', margin: 0 }}
            />
            Block Broadcast
          </label>
          {/* Quick Lead status selector */}
          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>Lead Status:</span>
          <select
            value={candidate.leadStatus || ''}
            onChange={(e) => handleLeadStatusChange(e.target.value)}
            style={{
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              borderRadius: 8,
              color: 'white',
              fontSize: 12,
              fontWeight: 700,
              padding: '6px 12px',
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">Normal Lead</option>
            <option value="hot_lead">🔥 Hot Lead</option>
            <option value="talk_later">⏳ Talk Later</option>
            <option value="blocked">🚫 Blocked</option>
          </select>
        </div>
      </header>

      {/* Main split content */}
      {(() => {
        const metaAcc = resolveMetaAccountInfo(candidate);
        return (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left Side: Profile Details */}
            <aside style={{ width: 340, background: 'rgba(15, 23, 42, 0.6)', borderRight: '1px solid rgba(56, 189, 248, 0.1)', padding: 24, display: 'flex', flexDirection: 'column', gap: 20, overflowY: 'auto' }}>
              
              {/* Avatar and Name */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center', borderBottom: '1px solid rgba(56,189,248,0.08)', paddingBottom: 20 }}>
                <div style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  fontWeight: 800,
                  color: 'white',
                  boxShadow: '0 8px 24px rgba(14, 165, 233, 0.2)'
                }}>
                  {candidate.name?.charAt(0) || '?'}
                </div>
                <div>
                  <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>{candidate.name}</h1>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: '#38bdf8', fontWeight: 600 }}>{candidate.phone}</p>
                  
                  {/* Received-on Meta Account & Phone ID Pill */}
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.06)', border: `1px solid ${metaAcc.tagColor}40`, padding: '2px 8px', borderRadius: 6, marginTop: 4 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: metaAcc.tagColor }}>📱 To: {metaAcc.shortLabel}</span>
                    {metaAcc.phoneNumberId && (
                      <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>
                        (ID: {metaAcc.phoneNumberId})
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Status Badges */}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 }}>
                  {candidate.isAgency && (
                    <span style={{ fontSize: 9, background: '#fca311', color: 'black', fontWeight: 900, padding: '2px 8px', borderRadius: 4 }}>
                      AGENCY
                    </span>
                  )}
              {candidate.leadStatus === 'hot_lead' && (
                <span style={{ fontSize: 9, background: 'rgba(239,68,68,0.2)', color: '#f87171', fontWeight: 900, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(239,68,68,0.4)' }}>
                  🔥 HOT LEAD
                </span>
              )}
              {candidate.leadStatus === 'talk_later' && (
                <span style={{ fontSize: 9, background: 'rgba(245,158,11,0.2)', color: '#fbbf24', fontWeight: 900, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(245,158,11,0.4)' }}>
                  ⏳ TALK LATER
                </span>
              )}
              {candidate.leadStatus === 'blocked' && (
                <span style={{ fontSize: 9, background: 'rgba(148,163,184,0.2)', color: '#94a3b8', fontWeight: 900, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(148,163,184,0.4)' }}>
                  🚫 BLOCKED
                </span>
              )}
              {candidate.excludeFromBlast && (
                <span style={{ fontSize: 9, background: 'rgba(244,63,94,0.2)', color: '#f43f5e', fontWeight: 900, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(244,63,94,0.4)' }}>
                  🔇 MUTED
                </span>
              )}
              {candidate.leadReason && (
                <span style={{ fontSize: 9, background: 'rgba(56,189,248,0.15)', color: '#38bdf8', fontWeight: 700, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(56,189,248,0.3)' }}>
                  📌 {candidate.leadReason}
                </span>
              )}
            </div>
          </div>

          {/* Profile Fields Card */}
          <div style={{ background: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: 12, padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Candidate Info</span>
              {!editing && (
                <button
                  onClick={() => setEditing(true)}
                  style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 11, fontWeight: 700, cursor: 'pointer', padding: 0 }}
                >
                  Edit Profile
                </button>
              )}
            </div>

            {!editing ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Trade / Skill</div>
                  <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{candidate.skill || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Preferred Country</div>
                  <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{candidate.country || '-'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Experience</div>
                  <div style={{ fontSize: 13, color: 'white', fontWeight: 600 }}>{candidate.experience || 0} years</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b' }}>Expected Salary</div>
                  <div style={{ fontSize: 13, color: '#10b981', fontWeight: 600 }}>{candidate.salary || '-'}</div>
                </div>
                {candidate.notes && (
                  <div style={{ marginTop: 6, padding: '8px 12px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: 8, borderLeft: '3px solid #38bdf8' }}>
                    <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>Comments / Notes</div>
                    <div style={{ fontSize: 12, color: '#e2e8f0', whiteSpace: 'pre-wrap', marginTop: 4, lineHeight: 1.4 }}>{candidate.notes}</div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Full Name</label>
                  <input
                    type="text"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Trade / Skill</label>
                  <input
                    type="text"
                    value={editData.skill}
                    onChange={(e) => setEditData({ ...editData, skill: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Preferred Country</label>
                  <input
                    type="text"
                    value={editData.country}
                    onChange={(e) => setEditData({ ...editData, country: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Experience (years)</label>
                  <input
                    type="number"
                    value={editData.experience}
                    onChange={(e) => setEditData({ ...editData, experience: parseInt(e.target.value) || 0 })}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Expected Salary</label>
                  <input
                    type="text"
                    value={editData.salary}
                    onChange={(e) => setEditData({ ...editData, salary: e.target.value })}
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Specific Reason / Tag</label>
                  <input
                    type="text"
                    value={editData.leadReason}
                    onChange={(e) => setEditData({ ...editData, leadReason: e.target.value })}
                    placeholder="e.g. कुछ दिन बाद बात करेगा, Ready for Interview, etc."
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12 }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 10, color: '#64748b', display: 'block', marginBottom: 4 }}>Comments / Notes</label>
                  <textarea
                    value={editData.notes}
                    onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                    placeholder="Write notes / comments here... (What deal was made? When to speak again?)"
                    style={{ width: '100%', boxSizing: 'border-box', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', padding: '6px 10px', borderRadius: 8, fontSize: 12, height: 75, resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    onClick={handleSaveProfile}
                    style={{ flex: 1, background: '#0ea5e9', color: 'white', border: 'none', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    style={{ flex: 1, background: 'rgba(239, 68, 68, 0.12)', color: '#fca5a5', border: 'none', padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* CV & Photo asset links */}
          {(candidate.cvLink || candidate.photoLink) && (
            <div style={{ background: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Documents</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {candidate.cvLink && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a
                      href={candidate.cvLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', textDecoration: 'none', textAlign: 'center', background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                    >
                      Open CV 📄
                    </a>
                    <a
                      href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Candidate CV: ${candidate.name} (${candidate.skill || 'Trade'})\nLink: ${candidate.cvLink}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', textDecoration: 'none', textAlign: 'center', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', padding: '4px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}
                    >
                      ↗ Share on WhatsApp
                    </a>
                  </div>
                )}
                {candidate.photoLink && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a
                      href={candidate.photoLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', textDecoration: 'none', textAlign: 'center', background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.2)', color: '#38bdf8', padding: '8px 10px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}
                    >
                      Open Photo 🖼️
                    </a>
                    <a
                      href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Candidate Photo: ${candidate.name} (${candidate.skill || 'Trade'})\nLink: ${candidate.photoLink}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ display: 'block', textDecoration: 'none', textAlign: 'center', background: 'rgba(34, 197, 94, 0.12)', border: '1px solid rgba(34, 197, 94, 0.3)', color: '#4ade80', padding: '4px 6px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}
                    >
                      ↗ Share on WhatsApp
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meta WhatsApp Routing Details card */}
          <div style={{ background: 'rgba(30, 41, 59, 0.45)', border: '1px solid rgba(56, 189, 248, 0.12)', borderRadius: 12, padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              📱 Meta WhatsApp Routing
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Account:</span>
                <span style={{ color: metaAcc.tagColor, fontWeight: 700 }}>{metaAcc.accountName}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Received On:</span>
                <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{metaAcc.displayPhoneNumber || 'Primary Business'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>Phone Number ID:</span>
                <span style={{ color: '#38bdf8', fontFamily: 'monospace' }}>{metaAcc.phoneNumberId || 'N/A'}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>WABA Account ID:</span>
                <span style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{metaAcc.wabaId || 'N/A'}</span>
              </div>
            </div>
          </div>

          {/* Help Info card */}
          <div style={{ marginTop: 'auto', background: 'rgba(56, 189, 248, 0.03)', border: '1px solid rgba(56, 189, 248, 0.08)', borderRadius: 10, padding: 12 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 4 }}>Standalone Chat Mode</span>
            <span style={{ fontSize: 10.5, color: '#64748b', lineHeight: 1.4, display: 'block' }}>
              Changes to profile, lead status, or sending messages from this screen synchronize in real time with the main operational dashboard database.
            </span>
          </div>

        </aside>

        {/* Right Side: Chat Panel */}
        <main style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', background: '#020617', overflow: 'hidden' }}>
          <ChatPanel
            candidate={candidate}
            refreshKey={refreshKey}
            onClose={() => router.push('/dashboard')}
            onUpdate={() => setRefreshKey((k) => k + 1)}
            onCandidateUpdate={(updates) => setCandidate((c) => c ? { ...c, ...updates } : null)}
          />
        </main>
      </div>
        );
      })()}
    </div>
  );
}
