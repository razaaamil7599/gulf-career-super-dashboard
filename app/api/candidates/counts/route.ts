import { NextResponse } from 'next/server';
import { getFirebaseAdminDb } from '@/lib/firebase-admin';

/**
 * Native Next.js API for Candidate Counts
 */

const ALL_SKILLS = [
  'Carpenter', 'Plumber', 'Electrician', 'AC Technician', 'Mason',
  'Welder', 'Painter', 'Driver', 'Security Guard', 'Cook',
  'Cleaner', 'Fabricator', 'Mechanic', 'Helper', 'Tiler',
];

const ALL_COUNTRIES = ['Saudi', 'UAE', 'Qatar', 'Kuwait', 'Oman', 'Bahrain'];

function getInferredCountry(c: any) {
  const cCountry = c.country?.toString().toLowerCase() || 'unspecified';
  const cSkill = c.skill?.toString().toLowerCase() || '';

  if (cCountry === 'unspecified' || cCountry === 'unknown') {
    if (cSkill.includes('hajj') || cSkill.includes('makkah') || cSkill.includes('madina') || cSkill.includes('haram')) {
      return 'saudi';
    } else if (cSkill.includes('dubai') || cSkill.includes('abudhabi') || cSkill.includes('uae')) {
      return 'uae';
    } else if (cSkill.includes('qatar') || cSkill.includes('doha')) {
      return 'qatar';
    } else if (cSkill.includes('kuwait')) {
      return 'kuwait';
    } else if (cSkill.includes('oman') || cSkill.includes('muscat')) {
      return 'oman';
    } else if (cSkill.includes('bahrain')) {
      return 'bahrain';
    }
  }
  return cCountry;
}

export async function GET() {
  try {
    const db = getFirebaseAdminDb();
    const snapshot = await db.ref('candidates').once('value');
    const candidatesMap = snapshot.val() || {};
    const candidates = Object.values(candidatesMap);
    
    // Calculate Skill Counts
    const skills: any = {};
    ALL_SKILLS.forEach(s => skills[s] = 0);
    skills['Others'] = 0;
    
    // Calculate Country Counts
    const countries: any = {};
    ALL_COUNTRIES.forEach(c => countries[c] = 0);
    countries['Unspecified'] = 0;

    candidates.forEach((c: any) => {
      // Skill Breakdown
      const cSkill = c.skill?.toString().toLowerCase() || '';
      let skillMatched = false;
      ALL_SKILLS.forEach(s => {
        if (cSkill.includes(s.toLowerCase())) {
          skills[s]++;
          skillMatched = true;
        }
      });
      if (!skillMatched) skills['Others']++;

      // Country Breakdown
      const cCountry = getInferredCountry(c);
      let countryMatched = false;
      ALL_COUNTRIES.forEach(country => {
        if (cCountry.includes(country.toLowerCase())) {
          countries[country]++;
          countryMatched = true;
        }
      });
      if (!countryMatched) countries['Unspecified']++;
    });

    return NextResponse.json({ 
        total: candidates.length, 
        skills, 
        countries, 
        success: true 
    });
  } catch (err: any) {
    console.error('[Candidate Counts Error]', err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
