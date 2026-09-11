/**
 * Database Seed Script
 * Loads sample agencies, vacancies, and candidates into Firebase RTDB.
 * Run: node data/seedData.js
 */

require('dotenv').config({ path: '.env.local' });

const { initFirebase, rtdbSet, rtdbPush } = require('../server/services/firebaseService');

const SKILLS = [
  'Carpenter', 'Plumber', 'Electrician', 'AC Technician', 'Mason',
  'Welder', 'Painter', 'Driver', 'Security Guard', 'Cook',
  'Cleaner', 'Fabricator', 'Mechanic', 'Helper', 'Tiler',
];

const COUNTRIES = ['Saudi', 'UAE', 'Qatar', 'Kuwait', 'Oman', 'Bahrain'];
const FIRST_NAMES = ['Mohammad', 'Ahmed', 'Ali', 'Usman', 'Farhan', 'Bilal', 'Zain', 'Hamza', 'Hassan', 'Imran', 'Jahangir', 'Kamran', 'Liaqat', 'Majid', 'Naeem', 'Owais', 'Pervez', 'Qasim', 'Rashid', 'Salman'];
const LAST_NAMES = ['Khan', 'Malik', 'Shah', 'Butt', 'Chaudhry', 'Akhtar', 'Hussain', 'Iqbal', 'Raza', 'Baig', 'Siddiqui', 'Ansari', 'Rizvi', 'Qureshi', 'Mirza'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomPhone() {
  return `92${randomInt(3000000000, 3499999999)}`;
}
function randomName() {
  return `${randomItem(FIRST_NAMES)} ${randomItem(LAST_NAMES)}`;
}

const AGENCIES = [
  { name: 'Al Noor Manpower', contact: '+966501234567', country: 'Saudi', agencyCharge: 45000 },
  { name: 'Gulf Pro Recruiters', contact: '+971521234567', country: 'UAE', agencyCharge: 52000 },
  { name: 'Doha Labour Solutions', contact: '+97444123456', country: 'Qatar', agencyCharge: 60000 },
  { name: 'Kuwait Excel HR', contact: '+96522123456', country: 'Kuwait', agencyCharge: 55000 },
  { name: 'Muscat Manpower Co.', contact: '+96891234567', country: 'Oman', agencyCharge: 40000 },
];

async function seed() {
  console.log('🌱 Gulf Career Super Dashboard — Seed Data Loader');
  console.log('===================================================');

  initFirebase();

  // ── Clear existing data ──────────────────────────────────────────────────────
  console.log('🗑️  Clearing existing data...');
  await rtdbSet('agencies', null);
  await rtdbSet('vacancies', null);
  await rtdbSet('candidates', null);

  // ── Seed Agencies ────────────────────────────────────────────────────────────
  console.log('🏢 Seeding 5 agencies...');
  const agencyIds = [];
  for (const agency of AGENCIES) {
    const id = await rtdbPush('agencies', { ...agency, createdAt: new Date().toISOString() });
    agencyIds.push(id);
  }

  // ── Seed Vacancies ───────────────────────────────────────────────────────────
  console.log('📋 Seeding 30 vacancies...');
  for (let i = 0; i < 30; i++) {
    const agency = AGENCIES[i % AGENCIES.length];
    const skill = randomItem(SKILLS);
    const serviceCharge = agency.agencyCharge;
    const margin = 20000;
    await rtdbPush('vacancies', {
      skill,
      country: agency.country,
      agencyId: agencyIds[i % agencyIds.length],
      originalCharge: serviceCharge,
      ourMargin: margin,
      candidatePrice: serviceCharge + margin,
      companyName: 'Gulf Career Gateway',
      contactPhone: '+92-300-GULF-CAR',
      contactEmail: 'info@gulfcareergateway.com',
      processedBy: 'A.R. Khan IT Solution',
      status: 'active',
      createdAt: new Date().toISOString(),
    });
  }

  // ── Seed Candidates ──────────────────────────────────────────────────────────
  const CANDIDATE_COUNT = 200;
  console.log(`👥 Seeding ${CANDIDATE_COUNT} candidates...`);

  // Distribute skills to match realistic counts
  const skillDistribution = {
    'Carpenter': 28,
    'Plumber': 22,
    'Electrician': 18,
    'AC Technician': 16,
    'Mason': 14,
    'Welder': 14,
    'Painter': 12,
    'Driver': 20,
    'Security Guard': 15,
    'Cook': 12,
    'Cleaner': 10,
    'Fabricator': 8,
    'Mechanic': 5,
    'Helper': 3,
    'Tiler': 3,
  };

  let candidateNum = 0;
  for (const [skill, count] of Object.entries(skillDistribution)) {
    for (let i = 0; i < count && candidateNum < CANDIDATE_COUNT; i++) {
      await rtdbPush('candidates', {
        name: randomName(),
        phone: randomPhone(),
        skill,
        country: randomItem(COUNTRIES),
        experience: randomInt(1, 15),
        status: randomItem(['clean', 'pending_update', 'clean', 'clean']),
        availability: `${randomInt(1, 4)} weeks`,
        createdAt: new Date().toISOString(),
      });
      candidateNum++;
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('✅ Seed data loaded successfully!');
  console.log(`   Agencies:    ${AGENCIES.length}`);
  console.log(`   Vacancies:   30`);
  console.log(`   Candidates:  ${CANDIDATE_COUNT}`);
  console.log('═══════════════════════════════════════════');
  console.log('\n💡 Now run: npm run dev (frontend) & npm run server (backend)\n');

  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
