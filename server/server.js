/**
 * Gulf Career Super Dashboard — Express Server
 * Port: 5001
 * Firebase RTDB + Local Emulator support
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initFirebase } = require('./services/firebaseService');

// ── Routes ────────────────────────────────────────────────────────────────────
const webhookRoutes = require('./routes/webhookRoutes');
const candidateRoutes = require('./routes/candidateRoutes');
const documentRoutes = require('./routes/documentRoutes');
const blastRoutes = require('./routes/blastRoutes');
const messageRouter = require('./routes/messageRouter');
const metaDemoRoutes = require('./routes/metaDemoRoutes');
const metaWebhookParser = require('./middleware/metaWebhookParser');

// ── App Init ──────────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.EXPRESS_PORT || 5005;

app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'] }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(metaWebhookParser);

// Root Heartbeat for Proxy Verification
app.get('/api/health', (req, res) => res.send('EXPRESS_IS_ALIVE'));

// Serve local tmp documents
app.use('/tmp', express.static(path.join(process.cwd(), 'tmp')));

// ── Initialize Firebase ───────────────────────────────────────────────────────
initFirebase();

// ── Start Legacy Sync Bridge ──────────────────────────────────────────────────
const { initSync } = require('./services/legacySyncService');
initSync();

const agencyRoutes = require('./routes/agencyRoutes');

// ── OpenClaw Integration Endpoints ──────────────────────────────────────────────
const openclawAuth = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
  const configuredKey = process.env.OPENCLAW_API_KEY || 'gulfcareer_token';
  
  if (!apiKey || (apiKey !== configuredKey && apiKey !== `Bearer ${configuredKey}`)) {
    // Also check against the legacy hardcoded key for safety during migration
    if (apiKey === 'gulfcareer_token' || apiKey === 'Bearer gulfcareer_token') {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }
  next();
};

const { rtdbPush } = require('./services/firebaseService');
app.post('/api/vacancies', openclawAuth, async (req, res) => {
  try {
    const vacancyData = {
      ...req.body,
      status: req.body.status || 'active',
      sourceType: 'openclaw_ai',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const vacancyId = await rtdbPush('vacancies', vacancyData);
    res.json({ success: true, vacancyId, vacancy: vacancyData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/webhook', webhookRoutes);

app.use('/api/candidates', candidateRoutes);
app.use('/api/document', documentRoutes);
app.use('/api/blast', blastRoutes);
app.use('/api/messages', messageRouter);
app.use('/api/agency', agencyRoutes);
app.use('/api/meta-demo', metaDemoRoutes);

// ── Root Route ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.send('<h1>Gulf Career Super Dashboard API</h1><p>Status: Running</p><p>Go to <a href="http://localhost:3000">Dashboard</a></p>');
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    server: 'Gulf Career Super Dashboard API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    emulator: process.env.FIREBASE_USE_EMULATOR === 'true',
  });
});

// ── Error Handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Gulf Career Super Dashboard — API Server       ║');
  // v6.0 Security Guard: Warn if keys missing, but don't crash now that Vision is optional
  const fs = require('fs');
  const hasVisionCreds = process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS);

  if (!process.env.GEMINI_API_KEY || !hasVisionCreds) {
    console.warn('\n' + '═'.repeat(60));
    console.warn(`║ WARNING: MISSION-CRITICAL KEYS MISSING IN .env.local       ║`);
    if (!process.env.GEMINI_API_KEY) console.warn('║ - GEMINI_API_KEY is missing.                               ║');
    if (!hasVisionCreds) console.warn('║ - GOOGLE_APPLICATION_CREDENTIALS file is missing or invalid. ║');
    console.warn('║ DOCUMENT VISION FEATURES WILL BE UNAVAILABLE.              ║');
    console.warn('═'.repeat(60) + '\n');
  }

  console.log('║   Gulf Career Gateway — Operational              ║');
  console.log(`║   Running on:  http://localhost:${PORT}             ║`);
  console.log(`║   Firebase:    ${process.env.FIREBASE_USE_EMULATOR === 'true' ? 'LOCAL EMULATOR (port 9000)    ' : 'PRODUCTION                    '}║`);
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
});

module.exports = app;
