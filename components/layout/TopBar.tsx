import { useEffect, useState } from 'react';
import { getMetaStatus } from '@/lib/api';

export default function TopBar() {
  const [metaStatus, setMetaStatus] = useState<'LIVE' | 'MOCK' | 'LOADING'>('LOADING');
  const [details, setDetails] = useState<any>(null);

  useEffect(() => {
    getMetaStatus()
      .then((res) => {
        if (res && res.success) {
          setMetaStatus(res.status);
          setDetails(res.config);
        } else {
          setMetaStatus('MOCK');
          setDetails({ error: 'API_RESPONSE_EMPTY', message: 'Backend returned success: false or empty response.' });
        }
      })
      .catch((err) => {
        console.error('[TopBar] Status Fetch Failed:', err);
        setMetaStatus('MOCK');
        setDetails({ error: 'FETCH_FAILED', message: err.message || 'Network error connecting to backend API.' });
      });
  }, []);

  const handleDiagnosticClick = () => {
    console.log('[Diagnostic] Icon clicked. Status:', metaStatus, 'Details:', details);

    if (!details) {
      alert('Diagnostic data still loading. If this persists for more than 10 seconds, check your server connection.');
      return;
    }

    if (details.error) {
      alert(
        `DIAGNOSTIC FAILURE\n----------------------------\nError: ${details.error}\nMessage: ${details.message}\n\nTip: The dashboard cannot reach the status endpoint. Ensure your server is running and API routes are accessible.`
      );
      return;
    }

    const report = [
      'META API DIAGNOSTIC REPORT',
      '----------------------------',
      `Current Status: ${metaStatus}`,
      `Token: ${details?.hasToken ? 'FOUND' : 'MISSING'}`,
      `Phone ID: ${details?.hasPhoneId ? 'FOUND' : 'MISSING'}`,
      `WABA ID: ${details?.hasWabaId ? 'FOUND' : 'MISSING'}`,
      `Mode: ${details?.mode || 'production'} (env)`,
      '----------------------------',
      metaStatus === 'MOCK'
        ? 'Tip: Configuration is incomplete. Ensure Token, Phone ID, and WABA ID are set in Cloud Run env variables.'
        : 'Status: Meta API is live.',
    ].join('\n');

    alert(report);
  };

  return (
    <header
      style={{
        background: 'rgba(11,17,32,0.95)',
        borderBottom: '1px solid rgba(56,189,248,0.12)',
        padding: '0 24px',
        height: '56px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          onClick={handleDiagnosticClick}
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: metaStatus === 'LIVE' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)',
            border: `1px solid ${metaStatus === 'LIVE' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 800,
            fontSize: 14,
            color: metaStatus === 'LIVE' ? '#10b981' : '#f59e0b',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            userSelect: 'none',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.filter = 'brightness(1.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.filter = 'brightness(1.0)';
          }}
        >
          N
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'white', lineHeight: 1.2 }}>Gulf Career Gateway</div>
          <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600, letterSpacing: '0.08em' }}>
            SUPER DASHBOARD - GULF CAREER GATEWAY
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: '#34d399',
              boxShadow: '0 0 8px #34d399',
              animation: 'pulse-sky 2s infinite',
            }}
          />
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>Dashboard Online</span>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            borderRadius: 20,
            background: 'rgba(15, 23, 42, 0.4)',
            border: '1px solid rgba(56, 189, 248, 0.1)',
          }}
        >
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: metaStatus === 'LIVE' ? '#10b981' : '#f59e0b',
              boxShadow: metaStatus === 'LIVE' ? '0 0 8px #10b981' : 'none',
            }}
          />
          <span style={{ fontSize: 12, color: '#64748b', fontWeight: 500 }}>
            Meta API: <span style={{ color: metaStatus === 'LIVE' ? '#10b981' : '#f59e0b', fontWeight: 700 }}>{metaStatus}</span>
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Admin Portal</div>
          <div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 600 }}>Admin</div>
        </div>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #0ea5e9, #6366f1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            color: 'white',
          }}
        >
          G
        </div>
      </div>
    </header>
  );
}
