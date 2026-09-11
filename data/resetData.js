/**
 * Database Reset Script
 * Clears agencies, vacancies, and candidates from Firebase RTDB.
 * Run: node data/resetData.js
 */

require('dotenv').config({ path: '.env.local' });
const { initFirebase, rtdbSet } = require('../server/services/firebaseService');

async function reset() {
  console.log('🗑️  Gulf Career Super Dashboard — Data Reset');
  console.log('=========================================');

  try {
    initFirebase();

    console.log('🧹 Clearing agencies...');
    await rtdbSet('agencies', null);

    console.log('🧹 Clearing vacancies...');
    await rtdbSet('vacancies', null);

    console.log('🧹 Clearing candidates...');
    await rtdbSet('candidates', null);
    
    console.log('🧹 Clearing messages...');
    await rtdbSet('messages', null);

    console.log('\n✅ Data reset successful! Real-time integration ready.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Reset failed:', err);
    process.exit(1);
  }
}

reset();
