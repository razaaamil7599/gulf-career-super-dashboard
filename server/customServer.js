/**
 * Gulf Career Super Dashboard — Unified Server (Final Restoration)
 * This server handles BOTH Next.js (Frontend) and Express (API)
 * Optimized for Cloud Run with Early Health Check.
 */

const path = require('path');
const express = require('express');
const next = require('next');
const cors = require('cors');

// ── Environment Configuration ────────────────────────────────────────────────
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });

const port = parseInt(process.env.PORT, 10) || 8080;
const dev = process.env.NODE_ENV !== 'production';

console.log(`[DEBUG] PORT=${port}, NODE_ENV=${process.env.NODE_ENV}, dev=${dev}`);

// Initialize Next.js
const app = next({ dev, dir: path.join(__dirname, '..') });
const handle = app.getRequestHandler();

// Import Middleware & Services
const metaWebhookParser = require('./middleware/metaWebhookParser');
const { initFirebase } = require('./services/firebaseService');
const { initSync } = require('./services/legacySyncService');
const { ensureDashboardStreamListener } = require('./services/dashboardStreamService');

// 1. Initial Bootstrap Server (Satisfies Cloud Run health check early)
const server = express();

// Disable restrictive CSP that blocks inline styles/scripts in some environments
server.use((req, res, next) => {
  res.setHeader("Content-Security-Policy", "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:;");
  next();
});

// Very early health check (before app.prepare)
server.get('/api/health', (req, res) => {
  if (global.isNextReady) {
    return res.json({
      status: 'READY',
      server: 'Unified Dashboard Server',
      timestamp: new Date().toISOString(),
      nextReady: true
    });
  }
  res.json({
    status: 'STARTING',
    server: 'Unified Dashboard Server',
    timestamp: new Date().toISOString(),
    nextReady: false
  });
});

console.log('[STARTUP] Unified Server initializing...');

// Initialize Next.js in the background
app.prepare()
  .then(() => {
    global.isNextReady = true;
    // 2. Core Middleware
    server.use(cors());
    server.use(express.json({ limit: '50mb' }));
    server.use(express.urlencoded({ extended: true, limit: '50mb' }));
    server.use(metaWebhookParser);

    // 3. Static Assets
    server.use('/tmp', express.static(path.join(process.cwd(), 'tmp')));

    // 4. Initialize Background Services
    try {
      initFirebase();
      initSync();
      ensureDashboardStreamListener();
    } catch (err) {
      console.warn('[STARTUP] Background services warning:', err.message);
    }

    // 5. API Routes
    server.use('/api/webhook', require('./routes/webhookRoutes'));
    server.use('/api/messages', require('./routes/messageRouter'));
    server.use('/api/candidates', require('./routes/candidateRoutes'));
    server.use('/api/document', require('./routes/documentRoutes'));
    server.use('/api/blast', require('./routes/blastRoutes'));
    server.use('/api/agency', require('./routes/agencyRoutes'));
    server.use('/api/dashboard', require('./routes/dashboardRoutes'));
    server.use('/api/control', require('./routes/controlRoutes'));
    server.use('/api/meta-demo', require('./routes/metaDemoRoutes'));

    // 6. Final Status Check
    server.get('/api/status', (req, res) => {
      res.json({
        status: 'online',
        mode: process.env.NODE_ENV || 'development',
        metaApi: 'LIVE',
        firebase: 'CONNECTED',
        timestamp: new Date().toISOString()
      });
    });

    // 7. Next.js Catch-all Handler
    server.use((req, res) => {
      return handle(req, res);
    });

    console.log('[STARTUP] Unified Server ready and prepared!');
  })
  .catch(err => {
    console.error('[CRITICAL] Failed to prepare Next.js app:', err.message);
    if (err.stack) {
      console.error('[CRITICAL] Stack trace:\n', err.stack);
    } else {
      console.error('[CRITICAL] Error object:', err);
    }
    process.exit(1);
  });

// Single Listen Call
server.listen(port, (err) => {
  if (err) {
    console.error('[CRITICAL] Startup Error:', err);
    process.exit(1);
  }
  console.log(`[STARTUP] Bootstrap server listening on port ${port}`);
});
