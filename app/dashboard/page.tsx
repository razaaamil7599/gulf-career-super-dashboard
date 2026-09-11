'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import TopBar from '@/components/layout/TopBar';
import Header from '@/components/layout/Header';
import Sidebar from '@/components/layout/Sidebar';
import AgencyPortal from '@/components/agency/AgencyPortal';
import CandidateGrid from '@/components/candidate/CandidateGrid';
import VacancyFeed from '@/components/agency/VacancyFeed';
import ChatPanel from '@/components/action/ChatPanel';
import ActionCenter from '@/components/action/ActionCenter';
import BlastReportPanel from '@/components/action/BlastReportPanel';
import { getCandidateCounts } from '@/lib/api';
import BotConfigPortal from '@/components/layout/BotConfigPortal';
import AIKeyPoolPortal from '@/components/layout/AIKeyPoolPortal';
import AIInstructionsPortal from '@/components/layout/AIInstructionsPortal';
import LeadsPortal from '@/components/candidate/LeadsPortal';

type Tab = 'agency' | 'candidates' | 'configs' | 'leads' | 'aikeys' | 'aiinstructions';
type RightPanelTab = 'chat' | 'vacancies' | 'report' | 'bulk';

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('candidates');
  const [activeSkill, setActiveSkill] = useState('');
  const [activeCountry, setActiveCountry] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [counts, setCounts] = useState({ skills: {}, countries: {} });
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [selectedCandidateForChat, setSelectedCandidateForChat] = useState<any | null>(null);
  const [gridRefreshKey, setGridRefreshKey] = useState(0);
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('report');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCandidateIds, setVisibleCandidateIds] = useState<string[]>([]);
  const [visibleCandidates, setVisibleCandidates] = useState<any[]>([]);
  const lastMessageEventId = useRef('');

  const selectedCandidates = visibleCandidates.filter((candidate) => selectedIds.includes(candidate.id));
  const selectedCandidateId = selectedCandidateForChat?.id || null;

  const normalizePhone = useCallback((phone: string = '') => String(phone || '').replace(/\D/g, ''), []);

  const phonesMatch = useCallback((left: string = '', right: string = '') => {
    const a = normalizePhone(left);
    const b = normalizePhone(right);
    if (!a || !b) return false;
    return a === b || a.endsWith(b) || b.endsWith(a);
  }, [normalizePhone]);

  const panelOptions = selectedCandidateForChat
    ? [
        { value: 'chat', label: 'Chat View' },
        { value: 'vacancies', label: 'Agency Queue' },
        { value: 'report', label: 'Bulk Report' },
        { value: 'bulk', label: `Bulk Blast${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}` },
      ]
    : [
        { value: 'vacancies', label: 'Agency Queue' },
        { value: 'report', label: 'Bulk Report' },
        { value: 'bulk', label: `Bulk Blast${selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}` },
      ];

  const RightPanelTabs = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderBottom: '1px solid rgba(56,189,248,0.1)', background: 'rgba(11,17,32,0.72)' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: '#f8fafc', fontSize: 13, fontWeight: 700 }}>
          {rightPanelTab === 'chat'
            ? (selectedCandidateForChat ? `${selectedCandidateForChat.name} Chat` : 'Chat View')
            : rightPanelTab === 'vacancies'
              ? 'Agency Queue'
              : rightPanelTab === 'report'
                ? 'Bulk Report'
                : 'Bulk Blast'}
        </div>
        <div style={{ color: '#64748b', fontSize: 11 }}>
          {rightPanelTab === 'chat'
            ? 'Conversation-first view. Extra tools are inside the chat drawer.'
            : rightPanelTab === 'vacancies'
              ? 'Local review queue and converted vacancy views.'
              : rightPanelTab === 'report'
                ? 'Latest bulk campaign ka delivery, read aur reply tracker.'
                : 'Blast controls stay here without covering the chat.'}
        </div>
      </div>

      <select
        value={rightPanelTab}
        onChange={(e) => setRightPanelTab(e.target.value as RightPanelTab)}
        style={{
          minWidth: 170,
          background: 'rgba(15,23,42,0.88)',
          color: '#e2e8f0',
          border: '1px solid rgba(56,189,248,0.16)',
          borderRadius: 10,
          padding: '9px 12px',
          fontSize: 12,
          fontWeight: 700,
          outline: 'none',
        }}
      >
        {panelOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  // Fetch counts for sidebar
  const fetchCounts = useCallback(async () => {
    try {
      const data = await getCandidateCounts();
      setCounts((current) => {
        const next = { skills: data.skills || {}, countries: data.countries || {} };
        const currentSerialized = JSON.stringify(current);
        const nextSerialized = JSON.stringify(next);
        return currentSerialized === nextSerialized ? current : next;
      });
      const total = Object.values(data.skills as Record<string, number>).reduce((a, b) => a + b, 0);
      setTotalCandidates((current) => (current === total ? current : total));
    } catch (err) {
      console.error("Failed to fetch counts:", err);
    }
  }, []);

  useEffect(() => {
    fetchCounts();
    return () => {
    };
  }, [fetchCounts]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;

    const handleEvent = (payload: any) => {
      if (!payload?.id || payload.id === lastMessageEventId.current) return;
      lastMessageEventId.current = payload.id;

      if (payload.kind === 'inbound') {
        fetchCounts();
        setGridRefreshKey((prev) => prev + 1);
      } else if (payload.kind === 'outbound' || payload.kind === 'status') {
        setGridRefreshKey((prev) => prev + 1);
      }

      if (selectedCandidateForChat?.phone && phonesMatch(selectedCandidateForChat.phone, payload.phone || '')) {
        setChatRefreshKey((prev) => prev + 1);
      }
    };

    const connect = () => {
      eventSource = new EventSource('/api/dashboard/stream');

      eventSource.addEventListener('message', (event) => {
        try {
          handleEvent(JSON.parse((event as MessageEvent).data));
        } catch (err) {
          console.warn('Failed to parse dashboard realtime event:', err);
        }
      });

      eventSource.onerror = () => {
        eventSource?.close();
        if (reconnectTimer) {
          window.clearTimeout(reconnectTimer);
        }
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      eventSource?.close();
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
    };
  }, [fetchCounts, phonesMatch, selectedCandidateForChat?.phone]);

  useEffect(() => {
    if (!selectedCandidateId) return;

    const latestCandidate = visibleCandidates.find((candidate) => candidate.id === selectedCandidateId);
    if (!latestCandidate) return;

    setSelectedCandidateForChat((current: any) => {
      if (!current) return current;
      const merged = { ...current, ...latestCandidate };
      return JSON.stringify(current) === JSON.stringify(merged) ? current : merged;
    });
  }, [selectedCandidateId, visibleCandidates]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <TopBar />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar */}
        <Sidebar
          counts={counts}
          activeSkill={activeSkill}
          activeCountry={activeCountry}
          onSkillChange={(skill) => { 
            setActiveSkill(skill); 
            setSelectedIds([]); // reset selection on filter change
          }}
          onCountryChange={(country) => { 
            setActiveCountry(country); 
            setSelectedIds([]); 
          }}
          totalCandidates={totalCandidates}
        />

        {/* Main Workspace (Middle Column) */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'rgba(15,23,42,0.5)', overflow: 'hidden' }}>
          
          {/* Header for main content */}
          <Header 
            activeTab={activeTab} 
            setActiveTab={setActiveTab} 
            selectedCount={selectedIds.length} 
            onClearSelection={() => setSelectedIds([])}
          />

          {/* Content Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            <div className="animate-fade-in">
              {activeTab === 'candidates' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {/* Global Search Bar */}
                  <div style={{ position: 'relative' }}>
                    <input 
                      type="text"
                      placeholder="🔍 Search by Phone or Name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%', padding: '12px 16px', background: 'rgba(30,41,59,0.7)',
                        border: '1px solid rgba(56,189,248,0.2)', borderRadius: 10,
                        color: 'white', fontSize: 14, outline: 'none'
                      }}
                    />
                    {searchQuery && (
                      <button 
                        onClick={() => setSearchQuery('')}
                        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                      >✕</button>
                    )}
                  </div>

                  <CandidateGrid 
                    activeSkill={activeSkill} 
                    activeCountry={activeCountry} 
                    searchQuery={searchQuery}
                    selectedIds={selectedIds}
                    onSelectionChange={setSelectedIds}
                    onVisibleCandidateIdsChange={setVisibleCandidateIds}
                    onVisibleCandidatesChange={setVisibleCandidates}
                    onCandidateClick={(c) => {
                      setSelectedCandidateForChat(c);
                      setRightPanelTab('chat');
                    }}
                    activeCandidateId={selectedCandidateForChat?.id || null}
                    refreshKey={gridRefreshKey}
                  />
                </div>
              ) : activeTab === 'agency' ? (
                <AgencyPortal />
              ) : activeTab === 'leads' ? (
                <LeadsPortal />
              ) : activeTab === 'aikeys' ? (
                <AIKeyPoolPortal />
              ) : activeTab === 'aiinstructions' ? (
                <AIInstructionsPortal />
              ) : (
                <BotConfigPortal />
              )}
            </div>
          </div>
        </main>

        {/* Right Column: Dynamic Panel */}
        <aside style={{ width: selectedCandidateForChat ? 'clamp(560px, 48vw, 760px)' : 430, borderLeft: '1px solid rgba(56,189,248,0.1)', background: 'rgba(15,23,42,0.3)', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease' }}>
          {selectedCandidateForChat ? (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {RightPanelTabs}
              <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {rightPanelTab === 'chat' ? (
                  <ChatPanel
                    candidate={selectedCandidateForChat}
                    refreshKey={chatRefreshKey}
                    onClose={() => {
                      setSelectedCandidateForChat(null);
                      setRightPanelTab('report');
                    }}
                    onUpdate={() => {
                      fetchCounts();
                      setGridRefreshKey(prev => prev + 1);
                    }}
                    onCandidateUpdate={(updates) => {
                      setSelectedCandidateForChat({ ...selectedCandidateForChat, ...updates });
                    }}
                  />
                ) : rightPanelTab === 'vacancies' ? (
                  <VacancyFeed />
                ) : rightPanelTab === 'report' ? (
                  <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
                    <BlastReportPanel />
                  </div>
                ) : (
                  <ActionCenter
                    selectedCount={selectedIds.length}
                    selectedIds={selectedIds}
                    selectedCandidates={selectedCandidates}
                    visibleCandidateIds={visibleCandidateIds}
                    activeSkill={activeSkill}
                    activeCountry={activeCountry}
                    onClearSelection={() => setSelectedIds([])}
                    onReplaceSelection={setSelectedIds}
                  />
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              {RightPanelTabs}
              
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {rightPanelTab === 'vacancies' ? (
                  <VacancyFeed />
                ) : rightPanelTab === 'report' ? (
                  <div style={{ padding: 16 }}>
                    <BlastReportPanel />
                  </div>
                ) : (
                  <ActionCenter 
                    selectedCount={selectedIds.length}
                    selectedIds={selectedIds}
                    selectedCandidates={selectedCandidates}
                    visibleCandidateIds={visibleCandidateIds}
                    activeSkill={activeSkill}
                    activeCountry={activeCountry}
                    onClearSelection={() => setSelectedIds([])}
                    onReplaceSelection={setSelectedIds}
                  />
                )}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
