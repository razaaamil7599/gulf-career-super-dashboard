const sharp = require('sharp');

function escapeXml(value = '') {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value = '', maxLength = 140) {
  const normalized = normalizeText(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function wrapText(value = '', maxChars = 28, maxLines = 3) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }

  const words = normalized.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const nextLine = current ? `${current} ${word}` : word;
    if (nextLine.length <= maxChars) {
      current = nextLine;
      continue;
    }

    if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word.slice(0, maxChars));
      current = word.slice(maxChars);
    }

    if (lines.length >= maxLines) {
      break;
    }
  }

  if (lines.length < maxLines && current) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  if (words.length > 0 && lines.length === maxLines) {
    const consumed = lines.join(' ');
    if (consumed.length < normalized.length) {
      lines[maxLines - 1] = truncateText(lines[maxLines - 1], Math.max(12, maxChars - 1));
    }
  }

  return lines;
}

function renderTextBlock(lines = [], { x = 0, y = 0, fontSize = 32, lineHeight = 1.35, color = '#FFFFFF', weight = 500 } = {}) {
  return lines.map((line, index) => {
    const lineY = y + index * fontSize * lineHeight;
    return `<text x="${x}" y="${lineY}" font-size="${fontSize}" font-weight="${weight}" fill="${color}" font-family="Arial, Helvetica, sans-serif">${escapeXml(line)}</text>`;
  }).join('');
}

function buildMetricCard({ x, y, width, title, value, accent, titleColor = '#93C5FD', valueColor = '#F8FAFC' }) {
  return `
    <g>
      <rect x="${x}" y="${y}" width="${width}" height="138" rx="28" fill="rgba(15,23,42,0.82)" stroke="rgba(148,163,184,0.16)" />
      <text x="${x + 28}" y="${y + 42}" font-size="20" font-weight="700" fill="${titleColor}" font-family="Arial, Helvetica, sans-serif">${escapeXml(title)}</text>
      <text x="${x + 28}" y="${y + 92}" font-size="36" font-weight="800" fill="${valueColor}" font-family="Arial, Helvetica, sans-serif">${escapeXml(value)}</text>
      <rect x="${x + width - 16}" y="${y + 18}" width="8" height="102" rx="4" fill="${accent}" />
    </g>
  `;
}

function getRoleCategory(skill = '') {
  const normalized = normalizeText(skill).toLowerCase();
  if (/driver/.test(normalized)) return 'driver';
  if (/(hvac|ac technician|technician|electrician|plumber|welder|mechanic|fabricator)/.test(normalized)) return 'technical';
  if (/(security)/.test(normalized)) return 'security';
  if (/(cook|kitchen|chef|waiter|housekeeping)/.test(normalized)) return 'hospitality';
  if (/(labou?r|helper|mason|carpenter|painter|tiler|cleaner|worker)/.test(normalized)) return 'workforce';
  return 'general';
}

function getRoleTheme(skill = '') {
  const category = getRoleCategory(skill);
  const themes = {
    driver: {
      badge: 'Driving Workforce',
      subline: 'Road-ready candidate pipeline',
      heroGradientStart: '#0EA5E9',
      heroGradientEnd: '#2563EB',
      glow: 'rgba(56,189,248,0.18)',
      accent: '#38BDF8',
      accentSoft: '#BAE6FD',
    },
    technical: {
      badge: 'Technical Hiring',
      subline: 'Skilled trade hiring poster',
      heroGradientStart: '#F97316',
      heroGradientEnd: '#EA580C',
      glow: 'rgba(249,115,22,0.16)',
      accent: '#FB923C',
      accentSoft: '#FED7AA',
    },
    security: {
      badge: 'Security Workforce',
      subline: 'Trusted protection hiring card',
      heroGradientStart: '#14B8A6',
      heroGradientEnd: '#0F766E',
      glow: 'rgba(20,184,166,0.16)',
      accent: '#2DD4BF',
      accentSoft: '#99F6E4',
    },
    hospitality: {
      badge: 'Hospitality Hiring',
      subline: 'Kitchen and service staff update',
      heroGradientStart: '#EAB308',
      heroGradientEnd: '#CA8A04',
      glow: 'rgba(234,179,8,0.16)',
      accent: '#FACC15',
      accentSoft: '#FEF08A',
    },
    workforce: {
      badge: 'Workforce Hiring',
      subline: 'Field-ready labour hiring card',
      heroGradientStart: '#22C55E',
      heroGradientEnd: '#0F766E',
      glow: 'rgba(34,197,94,0.16)',
      accent: '#4ADE80',
      accentSoft: '#BBF7D0',
    },
    general: {
      badge: 'Recruitment Update',
      subline: 'Professional vacancy update card',
      heroGradientStart: '#0EA5E9',
      heroGradientEnd: '#14B8A6',
      glow: 'rgba(14,165,233,0.16)',
      accent: '#67E8F9',
      accentSoft: '#CCFBF1',
    },
  };

  return {
    category,
    ...(themes[category] || themes.general),
  };
}

function buildHeroScene(theme = {}) {
  switch (theme.category) {
    case 'driver':
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <ellipse cx="830" cy="292" rx="150" ry="26" fill="rgba(15,23,42,0.38)" />
          <rect x="708" y="230" width="214" height="60" rx="24" fill="rgba(15,23,42,0.92)" />
          <rect x="770" y="188" width="98" height="54" rx="20" fill="rgba(15,23,42,0.92)" />
          <circle cx="760" cy="298" r="26" fill="#08111E" />
          <circle cx="870" cy="298" r="26" fill="#08111E" />
          <circle cx="760" cy="298" r="12" fill="${theme.accent}" />
          <circle cx="870" cy="298" r="12" fill="${theme.accent}" />
          <rect x="788" y="200" width="54" height="24" rx="12" fill="rgba(224,242,254,0.35)" />
          <circle cx="820" cy="156" r="24" fill="#F8FAFC" />
          <rect x="792" y="178" width="56" height="72" rx="24" fill="#F8FAFC" opacity="0.95" />
          <rect x="818" y="184" width="34" height="12" rx="6" fill="${theme.accent}" opacity="0.85" />
          <text x="698" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Mobility-ready drivers</text>
        </g>
      `;
    case 'technical':
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <circle cx="820" cy="176" r="28" fill="#F8FAFC" />
          <path d="M786 156h68l-8 18h-52z" fill="${theme.accent}" />
          <rect x="782" y="204" width="76" height="90" rx="28" fill="#F8FAFC" />
          <rect x="754" y="226" width="40" height="16" rx="8" fill="${theme.accent}" transform="rotate(-35 774 234)" />
          <rect x="846" y="236" width="66" height="14" rx="7" fill="#E2E8F0" transform="rotate(35 879 243)" />
          <circle cx="905" cy="268" r="22" fill="none" stroke="${theme.accent}" stroke-width="10" />
          <path d="M905 244v48M881 268h48" stroke="${theme.accent}" stroke-width="8" stroke-linecap="round" />
          <text x="690" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Professional trade hiring</text>
        </g>
      `;
    case 'security':
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <circle cx="820" cy="170" r="26" fill="#F8FAFC" />
          <rect x="782" y="196" width="76" height="96" rx="28" fill="#F8FAFC" />
          <path d="M820 210l52 18v34c0 38-28 64-52 76-24-12-52-38-52-76v-34z" fill="${theme.accent}" opacity="0.92" />
          <path d="M820 228v84" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" />
          <path d="M782 266h76" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" />
          <text x="708" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Security-ready professionals</text>
        </g>
      `;
    case 'hospitality':
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <ellipse cx="820" cy="182" rx="44" ry="28" fill="#F8FAFC" />
          <ellipse cx="786" cy="190" rx="22" ry="20" fill="#F8FAFC" />
          <ellipse cx="854" cy="190" rx="22" ry="20" fill="#F8FAFC" />
          <rect x="784" y="198" width="72" height="18" rx="8" fill="#F8FAFC" />
          <rect x="792" y="220" width="56" height="82" rx="24" fill="#F8FAFC" />
          <path d="M706 286h228" stroke="${theme.accent}" stroke-width="12" stroke-linecap="round" />
          <circle cx="934" cy="286" r="18" fill="${theme.accent}" />
          <text x="698" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Hospitality and kitchen staff</text>
        </g>
      `;
    case 'workforce':
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <circle cx="812" cy="172" r="28" fill="#F8FAFC" />
          <path d="M776 158h72l-9 18h-54z" fill="${theme.accent}" />
          <rect x="780" y="202" width="68" height="98" rx="28" fill="#F8FAFC" />
          <rect x="860" y="228" width="76" height="66" rx="12" fill="${theme.accent}" opacity="0.92" />
          <path d="M848 232l22 10" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" />
          <path d="M846 258l20 12" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" />
          <text x="694" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Labour and field workforce</text>
        </g>
      `;
    default:
      return `
        <g>
          <circle cx="820" cy="208" r="152" fill="${theme.glow}" />
          <rect x="742" y="166" width="166" height="128" rx="26" fill="rgba(15,23,42,0.78)" stroke="rgba(248,250,252,0.2)" />
          <rect x="770" y="194" width="112" height="18" rx="9" fill="${theme.accent}" opacity="0.9" />
          <rect x="770" y="226" width="84" height="12" rx="6" fill="#E2E8F0" opacity="0.75" />
          <rect x="770" y="250" width="98" height="12" rx="6" fill="#E2E8F0" opacity="0.75" />
          <text x="706" y="112" font-size="28" font-weight="800" fill="#F8FAFC" font-family="Arial, Helvetica, sans-serif">Professional vacancy update</text>
        </g>
      `;
  }
}

function getBrandContactPhone() {
  return normalizeText(
    process.env.WHATSAPP_CONTACT_NUMBER
    || process.env.CONTACT_PHONE
    || process.env.ADMIN_PHONE_1
    || process.env.ADMIN_PHONE_2
    || '+91 8920624361'
  );
}

function getBrandEmail() {
  return normalizeText(
    process.env.CONTACT_EMAIL
    || process.env.COMPANY_EMAIL
    || process.env.SUPPORT_EMAIL
    || 'gulfcareergateway@gmail.com'
  );
}

function getBrandAddress() {
  return normalizeText(
    process.env.CONTACT_ADDRESS
    || process.env.COMPANY_ADDRESS
    || process.env.OFFICE_ADDRESS
    || 'RZ-244, 4th Floor, Behind Croma, Pillar No. 658, Uttam Nagar East, New Delhi'
  );
}

function buildVacancyPosterSvg(details = {}) {
  const theme = getRoleTheme(details.skill);
  const skill = truncateText(details.skill || 'General Vacancy', 42);
  const location = truncateText(details.location || details.country || 'Gulf Region', 32);
  const salary = truncateText(details.salary || 'Competitive / Negotiable', 34);
  const contactPhone = getBrandContactPhone();
  const contactEmail = getBrandEmail();
  const contactWeb = 'gulfcareergateway.info';

  const whatWeOffer = [
    '• Pre-screened & verified candidates',
    '• Shortlisting within 48-72 hours',
    '• Full documentation support (Visa, Medical)',
    '• Competitive pricing & volume discounts'
  ];

  const candidatePool = 'Engineers | Skilled Labour | Hospitality | Healthcare | IT | Drivers';

  return `
  <svg width="1080" height="1350" viewBox="0 0 1080 1350" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>
        .title { font-family: 'Liberation Sans', Arial, sans-serif; font-weight: 800; }
        .body { font-family: 'Liberation Sans', Arial, sans-serif; font-weight: 500; }
        .gold { fill: #EAB308; }
        .navy { fill: #06111F; }
        .navy-light { fill: #0B1830; }
      </style>
    </defs>

    <!-- Background -->
    <rect width="1080" height="1350" fill="#FFFFFF" />

    <!-- Top Border (Gold) -->
    <rect width="1080" height="12" fill="#EAB308" />

    <!-- Header Section -->
    <rect y="12" width="1080" height="138" fill="#06111F" />
    <text x="60" y="94" font-size="44" font-weight="800" fill="#FFFFFF" font-family="Liberation Sans, Arial, sans-serif">Gulf Career Gateway</text>

    <!-- Sub-header Section -->
    <rect y="150" width="1080" height="120" fill="#0B1830" />
    <text x="60" y="222" font-size="38" font-weight="700" fill="#EAB308" font-family="Liberation Sans, Arial, sans-serif">${escapeXml(skill)} for ${escapeXml(location)}</text>

    <!-- Body Section -->
    <text x="60" y="340" font-size="28" fill="#475569" font-family="Liberation Sans, Arial, sans-serif">Dear Sir/Madam,</text>
    
    <text x="60" y="410" font-size="28" fill="#1E293B" font-family="Liberation Sans, Arial, sans-serif">Greetings from <tspan font-weight="800">Gulf Career Gateway!</tspan> We specialize in sourcing and</text>
    <text x="60" y="450" font-size="28" fill="#1E293B" font-family="Liberation Sans, Arial, sans-serif">supplying pre-screened, deployment-ready candidates for Gulf placements</text>
    <text x="60" y="490" font-size="28" fill="#1E293B" font-family="Liberation Sans, Arial, sans-serif">across UAE, Saudi Arabia, Kuwait, Qatar, Bahrain and Oman.</text>

    <!-- WHAT WE OFFER -->
    <text x="60" y="580" font-size="30" font-weight="800" fill="#06111F" font-family="Liberation Sans, Arial, sans-serif">WHAT WE OFFER:</text>
    <g transform="translate(60, 630)">
      ${whatWeOffer.map((item, i) => `
        <text y="${i * 50}" font-size="28" fill="#334155" font-family="Liberation Sans, Arial, sans-serif">${escapeXml(item)}</text>
      `).join('')}
    </g>

    <!-- OUR CANDIDATE POOL -->
    <text x="60" y="880" font-size="30" font-weight="800" fill="#06111F" font-family="Liberation Sans, Arial, sans-serif">OUR CANDIDATE POOL:</text>
    <text x="60" y="935" font-size="28" fill="#334155" font-family="Liberation Sans, Arial, sans-serif">${escapeXml(candidatePool)}</text>

    <!-- OFFER DETAILS -->
    <rect x="60" y="1000" width="960" height="120" rx="16" fill="#F1F5F9" stroke="#E2E8F0" />
    <text x="100" y="1055" font-size="28" font-weight="800" fill="#0B1830" font-family="Liberation Sans, Arial, sans-serif">SALARY OFFER: <tspan font-weight="500" fill="#1E293B">${escapeXml(salary)}</tspan></text>

    <text x="60" y="1180" font-size="26" fill="#475569" font-family="Liberation Sans, Arial, sans-serif">We would be glad to share our candidate database and discuss terms at your</text>
    <text x="60" y="1220" font-size="26" fill="#475569" font-family="Liberation Sans, Arial, sans-serif">convenience.</text>

    <!-- Footer -->
    <rect y="1260" width="1080" height="90" fill="#F8FAFC" />
    <line x1="0" y1="1260" x2="1080" y2="1260" stroke="#E2E8F0" stroke-width="1" />
    
    <text x="540" y="1315" font-size="22" font-weight="600" fill="#475569" font-family="Liberation Sans, Arial, sans-serif" text-anchor="middle">
      📧 ${escapeXml(contactEmail)}  |  📱 ${escapeXml(contactPhone)}  |  🌐 ${escapeXml(contactWeb)}
    </text>

    <!-- Bottom Strip -->
    <rect y="1350" width="1080" height="40" fill="#06111F" />
    <text x="60" y="1375" font-size="16" fill="#94A3B8" font-family="Liberation Sans, Arial, sans-serif">© 2026 Gulf Career Gateway</text>
  </svg>
  `;
}

async function generateVacancyPosterBuffer(details = {}) {
  const svg = buildVacancyPosterSvg(details);
  return sharp(Buffer.from(svg)).png().toBuffer();
}

module.exports = {
  generateVacancyPosterBuffer,
};
