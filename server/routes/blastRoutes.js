/**
 * Blast Routes
 * POST /api/blast/whatsapp — bulk WhatsApp message to filtered candidates
 */

const express = require('express');
const router = express.Router();
const { bulkBlast, normalizeWhatsAppNumber } = require('../services/whatsappService');
const { matchCandidates } = require('../services/matchingService');
const { getLatestBlastReport } = require('../services/blastReportService');
const { getEligibleRecentContacts, bulkSendToRecentContacts } = require('../services/metaChannelService');

function dedupeTargetsByPhone(targets = []) {
  const seen = new Set();
  const deduped = [];
  let duplicatesSkipped = 0;

  for (const target of targets) {
    const normalizedPhone = normalizeWhatsAppNumber(target.phone);
    if (!normalizedPhone) {
      continue;
    }

    if (seen.has(normalizedPhone)) {
      duplicatesSkipped++;
      continue;
    }

    seen.add(normalizedPhone);
    deduped.push({
      ...target,
      phone: normalizedPhone,
    });
  }

  return { deduped, duplicatesSkipped };
}

router.get('/latest-report', async (req, res) => {
  try {
    const lookbackHours = Number(req.query.lookbackHours || 168);
    const minTargets = Number(req.query.minTargets || 20);
    const report = await getLatestBlastReport({
      lookbackHours: Number.isFinite(lookbackHours) ? lookbackHours : 168,
      minTargets: Number.isFinite(minTargets) ? minTargets : 20,
    });
    res.json(report);
  } catch (err) {
    console.error('[Blast] Latest report error:', err);
    res.status(500).json({ error: err.message || 'BLAST_REPORT_FAILED' });
  }
});

// POST /api/blast/whatsapp
// Body: { skill, country, messageTemplate, candidateIds (optional override) }
router.post('/whatsapp', async (req, res) => {
  try {
    const { skill, country, messageTemplate, candidateIds, manualNumbers, templateVariables } = req.body;

    if (!messageTemplate && !req.body.templateName) {
      return res.status(400).json({ error: 'messageTemplate is required.' });
    }

    let targets;
    if (manualNumbers && Array.isArray(manualNumbers) && manualNumbers.length > 0) {
      const { candidates } = await matchCandidates({});
      const manualSet = new Set(manualNumbers.map(normalizeWhatsAppNumber).filter(Boolean));
      const known = candidates.filter((c) => manualSet.has(normalizeWhatsAppNumber(c.phone)));
      const knownSet = new Set(known.map((c) => normalizeWhatsAppNumber(c.phone)));
      const unknown = [...manualSet]
        .filter((phone) => !knownSet.has(phone))
        .map((phone) => ({
          id: `manual-${phone}`,
          name: `Candidate ${phone.slice(-4)}`,
          phone,
          skill: skill || 'General',
          country: country || 'Gulf',
        }));
      targets = [...known, ...unknown];
    } else if (candidateIds && Array.isArray(candidateIds) && candidateIds.length > 0) {
      // Use specific IDs from frontend selection
      const { candidates } = await matchCandidates({});
      targets = candidates.filter((c) => candidateIds.includes(c.id));
    } else {
      // Blast all matching candidates
      const { candidates } = await matchCandidates({ skill, country });
      targets = candidates;
    }

    // Strictly filter out AR Studios candidates from bulk blast targets
    const isArsCandidate = (c) => {
      const pnId = String(c.phone_number_id || c.lastRecipientPhoneId || '');
      const botName = String(c.bot_name || '').toLowerCase();
      return pnId === '1231432513384580' || pnId === '782096074998071' || botName.includes('ar studios');
    };

    targets = targets.filter(c => {
      if (isArsCandidate(c)) return false;
      
      // Exclude blocked candidates
      if (c.leadStatus === 'blocked') return false;
      
      // Exclude candidates who have Block Broadcast toggle active
      if (c.excludeFromBlast === true || c.excludeFromBlast === 'true') return false;
      
      // Exclude ongoing conversations (pending_update status or unread messages)
      if (c.status === 'pending_update') return false;
      if (c.unreadCount && Number(c.unreadCount) > 0) return false;
      
      return true;
    });

    const { deduped, duplicatesSkipped } = dedupeTargetsByPhone(targets);

    if (deduped.length === 0) {
      return res.status(404).json({ error: 'No matching candidates found.' });
    }

    console.log(`[Blast] Sending WhatsApp to ${deduped.length} candidates (Template: ${req.body.templateName || 'None'})...`);
    const result = await bulkBlast(deduped, messageTemplate, req.body.templateName, Array.isArray(templateVariables) ? templateVariables : []);

    res.json({
      success: true,
      requestedTargets: targets.length,
      duplicatesSkipped,
      ...result,
    });
  } catch (err) {
    console.error('[Blast] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/blast/messenger-recent/preview?channel=messenger|instagram
router.get('/messenger-recent/preview', async (req, res) => {
  try {
    const channel = String(req.query.channel || '').trim();
    if (channel !== 'messenger' && channel !== 'instagram') {
      return res.status(400).json({ error: 'channel must be messenger or instagram' });
    }
    const eligible = await getEligibleRecentContacts(channel);
    res.json({ channel, eligibleCount: eligible.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/blast/messenger-recent { channel: 'messenger'|'instagram', message }
// Meta only allows a standard (non-tagged) message to someone who messaged
// within the last 24 hours, so — unlike the WhatsApp blast above — this
// intentionally only targets contacts still inside that window right now.
router.post('/messenger-recent', async (req, res) => {
  try {
    const { channel, message } = req.body || {};
    if (channel !== 'messenger' && channel !== 'instagram') {
      return res.status(400).json({ error: 'channel must be messenger or instagram' });
    }
    if (!message || !String(message).trim()) {
      return res.status(400).json({ error: 'message is required' });
    }

    const outcome = await bulkSendToRecentContacts(channel, message);
    res.json({ success: true, channel, ...outcome });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
