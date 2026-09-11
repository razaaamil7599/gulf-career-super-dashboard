/**
 * Legacy Sync Service
 * Bridges real-time messages from the old Firebase RTDB to the new Super Dashboard.
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let sourceApp = null;
let targetApp = null;

function initSync() {
  console.log('🔄 Initializing Legacy Sync Bridge...');

  try {
    // 1. Initialize Source App (Old DB)
    const saPath = path.join(__dirname, '../..', 'tmp', 'old_service_account.json');
    if (!process.env.OLD_FIREBASE_DATABASE_URL) {
      console.log('Legacy Sync Bridge skipped: OLD_FIREBASE_DATABASE_URL not configured.');
      return;
    }

    if (!fs.existsSync(saPath)) {
      console.log('Legacy Sync Bridge skipped: old service account file not found.');
      return;
    }

    const sourceAccount = require(saPath);
    // Handle PEM formatting
    sourceAccount.private_key = sourceAccount.private_key.replace(/\\n/g, '\n');

    sourceApp = admin.initializeApp({
      credential: admin.credential.cert(sourceAccount),
      databaseURL: process.env.OLD_FIREBASE_DATABASE_URL,
    }, 'sync_source');

    // 2. Target App (Super Dashboard)
    const targetApp = admin.initializeApp({
      credential: admin.credential.cert(sourceAccount),
      databaseURL: process.env.OLD_FIREBASE_DATABASE_URL, // Syncing to same DB
    }, 'sync_target');

    const sourceDb = sourceApp.database();
    const targetDb = targetApp.database();

    // 3. Listen for changes in legacy "users" node
    // We use .on('child_changed') to catch new messages added to existing users
    sourceDb.ref('users').on('child_changed', async (snapshot) => {
      const user = snapshot.val();
      const userId = snapshot.key;
      
      if (user && user.messages) {
        // Sync the entire messages object for this user to the target
        // Format in target: messages/{phone}/{msgId}
        const phone = (user.sender || userId || '').replace(/\D/g, '');
        if (phone) {
          const updateData = Array.isArray(user.messages) ? Object.assign({}, user.messages) : user.messages;
          await targetDb.ref(`messages/${phone}`).update(updateData);
          console.log(`📡 Synced messages for ${phone}`);
        }
      }
    });

    // Also listen for NEW users (child_added)
    sourceDb.ref('users').on('child_added', async (snapshot) => {
        const user = snapshot.val();
        const userId = snapshot.key;
        if (user && user.messages) {
            const phone = (user.sender || userId || '').replace(/\D/g, '');
            if (phone) {
                const updateData = Array.isArray(user.messages) ? Object.assign({}, user.messages) : user.messages;
                await targetDb.ref(`messages/${phone}`).update(updateData);
                console.log(`📡 Synced new user messages for ${phone}`);
            }
        }
    });

    console.log('✅ Legacy Sync Bridge Active.');
  } catch (err) {
    console.error('❌ Legacy Sync Bridge failed to start:', err.message);
  }
}

module.exports = { initSync };
