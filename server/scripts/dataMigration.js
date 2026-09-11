/**
 * Data Migration Script
 * Migrates real data from 'users/' to 'candidates/' and 'agencies/'
 * Classification: Anyone who ever submitted a vacancy is an Agency.
 */

require('dotenv').config({ path: '.env.local' });
const path = require('path');
const admin = require('firebase-admin');

async function migrate() {
  console.log('🚀 Gulf Career Super Dashboard — Data Migration Master');
  console.log('====================================================');

  try {
    // 1. Initialize Source App (Always Production - Default App)
    const saPath = path.join(__dirname, '..', '..', 'tmp', 'old_service_account.json');
    const sourceAccount = require(saPath);
    sourceAccount.private_key = sourceAccount.private_key.replace(/\\n/g, '\n');

    if (admin.apps.length) await Promise.all(admin.apps.map(app => app.delete()));
    
    admin.initializeApp({
      credential: admin.credential.cert(sourceAccount),
      databaseURL: process.env.OLD_FIREBASE_DATABASE_URL,
    });
    const sourceDb = admin.database();

    // 2. Fetch Data from Source
    console.log('📡 Fetching data from PRODUCTION source...');
    
    const candidatesSnap = await sourceDb.ref('candidates').once('value');
    const candidates = candidatesSnap.val() || {};
    const candidateCount = Object.keys(candidates).length;
    console.log(`✅ Loaded ${candidateCount} candidates.`);

    const agenciesSnap = await sourceDb.ref('agencies').once('value');
    const agencies = agenciesSnap.val() || {};
    console.log(`✅ Loaded ${Object.keys(agencies).length} agencies.`);

    const messagesSnap = await sourceDb.ref('messages').once('value');
    const messages = messagesSnap.val() || {};
    console.log(`✅ Loaded ${Object.keys(messages).length} chat histories.`);

    const vacanciesSnap = await sourceDb.ref('vacancies').once('value');
    const vacancies = vacanciesSnap.val() || null;

    const leadsSnap = await sourceDb.ref('leads').once('value');
    const leads = leadsSnap.val() || null;

    // 3. Prepare Target App (Super Dashboard)
    const useEmulator = process.env.FIREBASE_USE_EMULATOR === 'true';
    if (useEmulator) {
      process.env.FIREBASE_DATABASE_EMULATOR_HOST = '127.0.0.1:9000';
      console.log('📡 Switching Target to LOCAL EMULATOR (127.0.0.1:9000)');
    }

    const targetApp = admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || 'gulf-career-dashboard',
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      // No credential needed for emulator
      ...(useEmulator ? {} : { credential: admin.credential.cert(sourceAccount) })
    }, 'target');

    const targetDb = targetApp.database();

    // 4. Flush & Push to Target
    console.log(`🗑️  Flushing existing data in ${useEmulator ? 'LOCAL EMULATOR' : 'Super Dashboard'}...`);
    await targetDb.ref('candidates').set(null);
    await targetDb.ref('agencies').set(null);
    await targetDb.ref('messages').set(null);

    console.log('📤 Pushing data to target...');
    await targetDb.ref('candidates').set(candidates);
    await targetDb.ref('agencies').set(agencies);
    await targetDb.ref('messages').set(messages);
    if (vacancies) await targetDb.ref('vacancies').set(vacancies);
    if (leads) await targetDb.ref('leads').set(leads);

    console.log('\n\n✅ FULL MIGRATION COMPLETE!');
    console.log('═══════════════════════════════════');
    console.log(`Total Candidates: ${candidateCount}`);
    console.log(`Total Agencies:   ${Object.keys(agencies).length}`);
    console.log(`Total Chats:      ${Object.keys(messages).length}`);
    console.log('═══════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err);
    process.exit(1);
  }
}

migrate();
