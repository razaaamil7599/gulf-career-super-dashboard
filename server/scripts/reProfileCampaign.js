/**
 * Re-Profiling Campaign Script
 * Sends WhatsApp messages to all 2480+ users asking to update their profile.
 * Run: node server/scripts/reProfileCampaign.js
 */

require('dotenv').config({ path: '.env.local' });

const { initFirebase, rtdbGetAll, rtdbUpdate } = require('../services/firebaseService');
const { sendReProfilingMessage } = require('../services/whatsappService');

const BATCH_SIZE = 50;   // Process 50 at a time
const BATCH_DELAY = 5000; // 5 seconds between batches

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runReProfilingCampaign() {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Gulf Career — Re-Profiling Campaign         ║');
  console.log('║  A.R. Khan IT Solution                       ║');
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  initFirebase();

  const candidates = await rtdbGetAll('candidates');
  const total = candidates.length;
  console.log(`📊 Total candidates found: ${total}`);

  if (total === 0) {
    console.log('⚠️  No candidates in DB. Load seed data first.');
    process.exit(0);
  }

  // Filter: only send to those NOT already updated, and strictly exclude AR Studios candidates
  const pending = candidates.filter(
    (c) => c.status !== 'clean' && 
           c.status !== 'updated' && 
           String(c.phone_number_id || c.lastRecipientPhoneId || '') !== '1231432513384580' &&
           String(c.phone_number_id || c.lastRecipientPhoneId || '') !== '782096074998071' &&
           !String(c.bot_name || '').toLowerCase().includes('ar studios')
  );
  console.log(`📤 Pending re-profiling: ${pending.length}`);
  console.log('');

  let sent = 0, failed = 0;
  const batches = Math.ceil(pending.length / BATCH_SIZE);

  for (let i = 0; i < batches; i++) {
    const batch = pending.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
    console.log(`\n📦 Batch ${i + 1}/${batches} — ${batch.length} candidates`);

    for (const candidate of batch) {
      try {
        const result = await sendReProfilingMessage(candidate);
        if (result.success || result.mock) {
          await rtdbUpdate(`candidates/${candidate.id}`, {
            status: 'pending_update',
            reProfilingMessageSentAt: new Date().toISOString(),
          });
          sent++;
          process.stdout.write(`✅ ${candidate.name} | `);
        } else {
          failed++;
          process.stdout.write(`❌ ${candidate.name} | `);
        }
      } catch (err) {
        failed++;
        console.error(`\n[Error] ${candidate.name}: ${err.message}`);
      }
    }

    if (i < batches - 1) {
      console.log(`\n⏳ Waiting ${BATCH_DELAY / 1000}s before next batch...`);
      await sleep(BATCH_DELAY);
    }
  }

  console.log('\n\n═══════════════════════════════════');
  console.log('✅ Re-Profiling Campaign Complete!');
  console.log(`   Sent:   ${sent}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Total:  ${pending.length}`);
  console.log('═══════════════════════════════════\n');

  process.exit(0);
}

runReProfilingCampaign().catch((err) => {
  console.error('Campaign failed:', err);
  process.exit(1);
});
