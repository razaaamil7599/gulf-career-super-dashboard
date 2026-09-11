'use client';

export default function DashboardError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0b1120', color: '#e2e8f0', fontFamily: 'system-ui', gap: 16 }}>
      <div style={{ fontSize: 48 }}>⚠️</div>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Dashboard Error</h2>
      <p style={{ margin: 0, fontSize: 14, color: '#94a3b8', maxWidth: 500, textAlign: 'center' }}>{error?.message || 'Something went wrong'}</p>
      <pre style={{ fontSize: 10, color: '#64748b', maxWidth: 600, overflow: 'auto', padding: 12, background: 'rgba(30,41,59,0.5)', borderRadius: 8, maxHeight: 200 }}>{error?.stack}</pre>
      <button
        onClick={reset}
        style={{ padding: '10px 24px', background: 'rgba(56,189,248,0.15)', color: '#38bdf8', border: '1px solid rgba(56,189,248,0.3)', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}
      >
        Try Again
      </button>
    </div>
  );
}
