/**
 * Candidate Routes
 * GET /api/candidates?skill=Plumber&country=Saudi
 * GET /api/candidates/counts — skill & country breakdown
 */

const express = require('express');
const router = express.Router();
const { matchCandidates, getSkillCounts, getCountryCounts } = require('../services/matchingService');
const { rtdbGetAll, rtdbUpdate } = require('../services/firebaseService');
const { runCandidateProfileBackfill } = require('../services/candidateBackfillService');

// GET /api/candidates
router.get('/', async (req, res) => {
  try {
    const { skill, country, status, search } = req.query;
    console.log('🚀 API CALL: /api/candidates', { search, skill, country });
    const { count, candidates } = await matchCandidates({ skill, country, search });

    let filtered = candidates;
    if (status) {
      filtered = candidates.filter((c) => c.status === status);
    }

    res.json({ success: true, count: filtered.length, candidates: filtered });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/counts — sidebar counters
router.get('/counts', async (req, res) => {
  try {
    const [skills, countries] = await Promise.all([getSkillCounts(), getCountryCounts()]);
    res.json({ success: true, skills, countries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/candidates/backfill-profiles - rebuild names/skills/countries from chat history
router.post('/backfill-profiles', async (req, res) => {
  try {
    const result = await runCandidateProfileBackfill({
      apply: req.body?.apply !== false,
    });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/candidates/:id — get candidate profile by ID
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { rtdbGet } = require('../services/firebaseService');
    const candidate = await rtdbGet(`candidates/${id}`);
    if (!candidate) {
      return res.status(404).json({ error: 'Candidate not found' });
    }
    res.json({ success: true, candidate: { id, ...candidate } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/candidates/:id — update candidate profile
router.patch('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body, updatedAt: new Date().toISOString() };
    await rtdbUpdate(`candidates/${id}`, updates);
    res.json({ success: true, id, updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/candidates/:id/mark-agency — Mark a candidate as an agency (OpenClaw Endpoint)
router.patch('/:id/mark-agency', async (req, res) => {
  try {
    const { id } = req.params;
    const apiKey = req.headers['x-api-key'] || req.headers['authorization'];
    if (!apiKey || (apiKey !== 'gulfcareer_token' && apiKey !== 'Bearer gulfcareer_token')) {
      return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
    }

    const updates = { 
        tag: 'AGENCY', 
        isAgency: true,
        updatedAt: new Date().toISOString() 
    };
    await rtdbUpdate(`candidates/${id}`, updates);
    res.json({ success: true, id, message: 'Successfully marked as Agency', updates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// POST /api/candidates/bulk-status — mark multiple as clean
router.post('/bulk-status', async (req, res) => {
  try {
    const { ids, status } = req.body;
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids array required' });

    const updates = {};
    ids.forEach((id) => {
      updates[`candidates/${id}/status`] = status || 'clean';
      updates[`candidates/${id}/updatedAt`] = new Date().toISOString();
    });

    await rtdbUpdate('/', updates);

    res.json({ success: true, updated: ids.length, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
