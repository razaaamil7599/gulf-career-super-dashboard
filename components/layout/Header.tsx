'use client';

interface HeaderProps {
  activeTab: 'candidates' | 'agency' | 'configs' | 'leads' | 'aikeys' | 'aiinstructions';
  setActiveTab: (tab: 'candidates' | 'agency' | 'configs' | 'leads' | 'aikeys' | 'aiinstructions') => void;
  selectedCount: number;
  onClearSelection: () => void;
}

export default function Header({ activeTab, setActiveTab, selectedCount, onClearSelection }: HeaderProps) {
  return (
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between',
      alignItems: 'center',
      borderBottom: '1px solid rgba(56,189,248,0.1)', 
      background: 'rgba(11,17,32,0.4)', 
      padding: '0 20px',
      height: 48
    }}>
      <div style={{ display: 'flex', height: '100%' }}>
        <button 
          className={`tab-btn ${activeTab === 'candidates' ? 'active' : ''}`}
          onClick={() => setActiveTab('candidates')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'candidates' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'candidates' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Candidate Portal
        </button>
        <button 
          className={`tab-btn ${activeTab === 'agency' ? 'active' : ''}`}
          onClick={() => setActiveTab('agency')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'agency' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'agency' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Agency Portal
        </button>
        <button 
          className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`}
          onClick={() => setActiveTab('leads')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'leads' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'leads' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Leads Portal
        </button>
        <button 
          className={`tab-btn ${activeTab === 'configs' ? 'active' : ''}`}
          onClick={() => setActiveTab('configs')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'configs' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'configs' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          Bot Portal Settings
        </button>
        <button
          className={`tab-btn ${activeTab === 'aikeys' ? 'active' : ''}`}
          onClick={() => setActiveTab('aikeys')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'aikeys' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'aikeys' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          AI Key Pool
        </button>
        <button
          className={`tab-btn ${activeTab === 'aiinstructions' ? 'active' : ''}`}
          onClick={() => setActiveTab('aiinstructions')}
          style={{ height: '100%', padding: '0 20px', background: 'none', border: 'none', color: activeTab === 'aiinstructions' ? '#38bdf8' : '#94a3b8', borderBottom: activeTab === 'aiinstructions' ? '2px solid #38bdf8' : 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
        >
          AI Instructions
        </button>
      </div>

      {selectedCount > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>
            {selectedCount} selected
          </span>
          <button 
            onClick={onClearSelection}
            style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', padding: '4px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer' }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
