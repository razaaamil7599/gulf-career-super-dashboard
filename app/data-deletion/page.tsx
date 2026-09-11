export default function DataDeletionPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#0B141A', color: '#E9EDEF', fontFamily: 'Segoe UI, Arial, sans-serif', padding: '48px 24px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1 style={{ fontSize: 24, marginBottom: 16 }}>Data Deletion Instructions</h1>
        <p style={{ color: '#D1D7DB', fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>
          Gulf Career Gateway ("we", "us") only stores the WhatsApp, Messenger, and Instagram
          messages, contact details, and candidate profile information you shared with us while
          discussing job opportunities.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 8 }}>How to request deletion</h2>
        <p style={{ color: '#D1D7DB', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
          To have your data deleted, send a message with the words "delete my data" from the same
          WhatsApp number, Messenger account, or Instagram account you contacted us from, or email
          us at{' '}
          <a href="mailto:gulfcareergateway@gmail.com" style={{ color: '#38bdf8' }}>
            gulfcareergateway@gmail.com
          </a>{' '}
          with your phone number / Instagram or Facebook username.
        </p>
        <p style={{ color: '#D1D7DB', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
          If you logged in via Facebook, you can also remove the app's access directly from your
          Facebook account under Settings &amp; Privacy → Settings → Apps and Websites — this
          revokes our access token immediately.
        </p>

        <h2 style={{ fontSize: 16, marginTop: 28, marginBottom: 8 }}>What happens next</h2>
        <p style={{ color: '#D1D7DB', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
          We permanently delete your conversation history, contact details, and candidate profile
          from our systems within 30 days of a verified request. Records we are legally required
          to retain (e.g. for active recruitment/visa processing you have consented to) are kept
          only as long as legally necessary, then deleted.
        </p>

        <p style={{ color: '#8696A0', fontSize: 12, marginTop: 32 }}>
          Gulf Career Gateway · <a href="https://gulfcareergateway.info/" style={{ color: '#38bdf8' }}>gulfcareergateway.info</a>
        </p>
      </div>
    </div>
  );
}
