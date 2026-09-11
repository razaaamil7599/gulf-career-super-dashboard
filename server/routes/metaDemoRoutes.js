/**
 * Meta Demo Routes (/api/meta-demo/*)
 * Read-only support endpoint for the /meta-demo page shown to Meta App
 * Review reviewers. No auth — reviewers hit this straight from the browser
 * with only a Page ID, never a token. Never echoes back credentials.
 */

const express = require('express');
const router = express.Router();
const { getEvents } = require('../services/metaDemoEventStore');

router.get('/events', (req, res) => {
  const pageId = String(req.query.pageId || '').trim();
  if (!pageId) {
    return res.status(400).json({ error: 'PAGE_ID_REQUIRED' });
  }
  const sinceId = req.query.sinceId;
  const events = getEvents(pageId, sinceId);
  res.json({ events });
});

module.exports = router;
