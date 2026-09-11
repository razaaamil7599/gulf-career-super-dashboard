'use client';

interface Counts {
  skills: Record<string, number>;
  countries: Record<string, number>;
}

interface SidebarProps {
  counts: Counts;
  activeSkill: string;
  activeCountry: string;
  onSkillChange: (skill: string) => void;
  onCountryChange: (country: string) => void;
  totalCandidates: number;
}

const COUNTRY_FLAGS: Record<string, string> = {
  'Saudi Arabia': 'SA',
  UAE: 'UAE',
  Qatar: 'QA',
  Kuwait: 'KW',
  Oman: 'OM',
  Bahrain: 'BH',
  Germany: 'DE',
  Poland: 'PL',
  India: 'IN',
  Unspecified: '--',
};

function sortEntries(entries: Array<[string, number]>) {
  return [...entries].sort((left, right) => {
    if (right[1] !== left[1]) return right[1] - left[1];
    return left[0].localeCompare(right[0]);
  });
}

function buildDisplayEntries(source: Record<string, number> = {}, activeValue = '', fallbackLabel = 'Unspecified') {
  const entries = Object.entries(source || {}).filter(([label]) => label && label !== 'All');

  if (activeValue && !entries.some(([label]) => label === activeValue)) {
    entries.push([activeValue, 0]);
  }

  if (!entries.length) {
    entries.push([fallbackLabel, 0]);
  }

  return sortEntries(entries);
}

export default function Sidebar({
  counts,
  activeSkill,
  activeCountry,
  onSkillChange,
  onCountryChange,
  totalCandidates,
}: SidebarProps) {
  const skillEntries = buildDisplayEntries(counts.skills, activeSkill, 'Uncategorized');
  const countryEntries = buildDisplayEntries(counts.countries, activeCountry, 'Unspecified');

  return (
    <aside style={{
      width: 186,
      minWidth: 186,
      background: 'rgba(11,17,32,0.88)',
      borderRight: '1px solid rgba(56,189,248,0.08)',
      padding: '12px 10px',
      overflowY: 'auto',
      height: 'calc(100vh - 56px)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{
        background: 'linear-gradient(135deg, rgba(14,165,233,0.12), rgba(99,102,241,0.08))',
        border: '1px solid rgba(56,189,248,0.18)',
        borderRadius: 10,
        padding: '10px 8px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#38bdf8', lineHeight: 1 }}>
          {totalCandidates.toLocaleString()}
        </div>
        <div style={{ fontSize: 9, color: '#64748b', fontWeight: 700, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Total Candidates
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 6px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Trades</span>
          {activeSkill && (
            <button
              onClick={() => onSkillChange('')}
              style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 10, cursor: 'pointer', padding: 0 }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {skillEntries.map(([skill, count]) => {
            const isActive = activeSkill === skill;
            return (
              <button
                key={skill}
                onClick={() => onSkillChange(isActive ? '' : skill)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 10,
                  border: isActive ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(56,189,248,0.06)',
                  background: isActive ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.5)',
                  color: isActive ? '#f8fafc' : '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'left',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill}</span>
                <span style={{
                  minWidth: 22,
                  height: 22,
                  borderRadius: 999,
                  background: isActive ? 'rgba(56,189,248,0.22)' : 'rgba(30,41,59,0.95)',
                  color: isActive ? '#38bdf8' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 800,
                  flexShrink: 0,
                }}>
                  {count ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(56,189,248,0.08)', margin: '4px 0' }} />

      <div>
        <div style={{ fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '2px 6px 6px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>Countries</span>
          {activeCountry && (
            <button
              onClick={() => onCountryChange('')}
              style={{ background: 'none', border: 'none', color: '#38bdf8', fontSize: 10, cursor: 'pointer', padding: 0 }}
            >
              Clear
            </button>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {countryEntries.map(([country, count]) => {
            const isActive = activeCountry === country;
            const countryPrefix = COUNTRY_FLAGS[country] || 'GLB';
            return (
              <button
                key={country}
                onClick={() => onCountryChange(isActive ? '' : country)}
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 10px',
                  borderRadius: 10,
                  border: isActive ? '1px solid rgba(56,189,248,0.3)' : '1px solid rgba(56,189,248,0.06)',
                  background: isActive ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.5)',
                  color: isActive ? '#f8fafc' : '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  textAlign: 'left',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{countryPrefix} {country}</span>
                <span style={{
                  minWidth: 22,
                  height: 22,
                  borderRadius: 999,
                  background: isActive ? 'rgba(56,189,248,0.22)' : 'rgba(30,41,59,0.95)',
                  color: isActive ? '#38bdf8' : '#94a3b8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 10,
                  fontWeight: 800,
                  flexShrink: 0,
                }}>
                  {count ?? 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
