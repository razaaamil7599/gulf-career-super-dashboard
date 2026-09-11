/**
 * DB Inspector
 * Lists top-level nodes in RTDB to find 'users/' node.
 */
require('dotenv').config({ path: '.env.local' });
const { initFirebase, getDb } = require('../server/services/firebaseService');

async function inspect() {
  initFirebase();
  const db = getDb();
  const snap = await db.ref('/').once('value');
  const val = snap.val();
  if (val) {
    console.log('Top-level nodes:', Object.keys(val));
    if (val.users) {
      console.log('Found "users" node with', Object.keys(val.users).length, 'records.');
    } else {
      console.log('"users" node not found in root.');
    }
  } else {
    console.log('Database is empty.');
  }
  process.exit(0);
}

inspect().catch(err => {
  console.error(err);
  process.exit(1);
});
