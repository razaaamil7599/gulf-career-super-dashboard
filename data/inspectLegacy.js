const admin = require('firebase-admin');
require('dotenv').config({ path: '.env.local' });

async function inspect() {
  try {
    const sourceAccount = require('../tmp/old_service_account.json');
    sourceAccount.private_key = sourceAccount.private_key.replace(/\\n/g, '\n');

    const sourceApp = admin.initializeApp({
      credential: admin.credential.cert(sourceAccount),
      databaseURL: process.env.OLD_FIREBASE_DATABASE_URL,
    }, 'source');

    const sourceDb = sourceApp.database();
    const vacanciesSnap = await sourceDb.ref('vacancies').limitToFirst(5).once('value');
    const vacancies = vacanciesSnap.val();
    
    console.log('--- Sample Legacy Vacancies ---');
    console.log(JSON.stringify(vacancies, null, 2));
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

inspect();
