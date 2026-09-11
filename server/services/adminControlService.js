const {
  rtdbGet,
  rtdbGetAll,
  rtdbPush,
  rtdbSet,
  safeFirebaseKey,
} = require('./firebaseService');
const { appendChatLog, appendAgentOutputLog } = require('./googleSheetsService');
const { publishDashboardMessageEvent } = require('./dashboardRealtimeService');
const { sendMessage, bulkBlast, createMetaTemplate, downloadMedia } = require('./whatsappService');
const { getAvailableTemplates } = require('./templateService');
const { matchCandidates, getSkillCounts, getCountryCounts } = require('./matchingService');
const { transcribeAudio } = require('./aiAgentService');

const ADMIN_AI_PROFILE_PATH = 'system_controls/admin_ai_profile';

function normalizePhone(phone = '') {
  return String(phone || '').replace(/\D/g, '');
}

function getAdminPhones() {
  const raw = [
    process.env.ADMIN_PHONE_1,
    process.env.ADMIN_PHONE_2,
    process.env.ADMIN_PHONE,
  ];

  const values = [];
  raw.forEach(r => {
    if (!r) return;
    const parts = r.split(',').map(p => normalizePhone(p)).filter(Boolean);
    values.push(...parts);
  });

  return Array.from(new Set(values));
}

function isAdminPhone(phone = '') {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return getAdminPhones().some((item) => item === normalized || item.endsWith(normalized) || normalized.endsWith(item));
}

function normalizeWhitespace(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeInstructionList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(item => normalizeWhitespace(item))
    .filter(Boolean)
    .slice(-12);
}

function getDefaultAdminAiProfile() {
  return {
    assistantName: 'Raza',
    ownerName: 'A R Khan',
    languageMode: 'hinglish',
    tone: 'Hinglish me short, direct, helpful, aur admin-instruction-following.',
    instructions: [],
    lastInstruction: '',
    updatedAt: '',
    updatedBy: '',
  };
}

async function getAdminAiProfile() {
  const stored = (await rtdbGet(ADMIN_AI_PROFILE_PATH)) || {};
  return {
    ...getDefaultAdminAiProfile(),
    ...stored,
    assistantName: normalizeWhitespace(stored.assistantName || ''),
    ownerName: normalizeWhitespace(stored.ownerName || 'A R Khan') || 'A R Khan',
    languageMode: normalizeWhitespace(stored.languageMode || 'hinglish').toLowerCase() || 'hinglish',
    tone: normalizeWhitespace(stored.tone || ''),
    instructions: normalizeInstructionList(stored.instructions),
    lastInstruction: normalizeWhitespace(stored.lastInstruction || ''),
    updatedAt: String(stored.updatedAt || ''),
    updatedBy: normalizePhone(stored.updatedBy || ''),
  };
}

async function getAdminAiProfileForNumber(phoneOrId) {
  const defaults = await getAdminAiProfile();
  if (!phoneOrId) return defaults;
  
  try {
    const normalized = String(phoneOrId).replace(/\D/g, '');
    const numberConfigs = await rtdbGet('settings/whatsapp_numbers');
    if (!numberConfigs) return defaults;
    
    const config = Object.values(numberConfigs).find(c => 
      c.phoneId === phoneOrId || 
      String(c.phone || '').replace(/\D/g, '') === normalized
    );
    
    if (!config) return defaults;
    
    // Convert instructions from list of strings or string
    let instructions = [];
    if (Array.isArray(config.instructions)) {
      instructions = config.instructions;
    } else if (typeof config.instructions === 'string') {
      instructions = config.instructions.split('\n').map(l => l.trim()).filter(Boolean);
    }
    
    return {
      ...defaults,
      assistantName: config.assistantName || (config.botType === 'ARS' ? 'AR Studios' : defaults.assistantName),
      ownerName: config.ownerName || defaults.ownerName,
      languageMode: config.languageMode || defaults.languageMode,
      tone: config.tone || defaults.tone,
      instructions: instructions.length > 0 ? instructions : defaults.instructions,
      coreRules: String(config.coreRules || '').trim(),
      botType: config.botType || 'GCG',
      phone: config.phone || '',
      phoneId: config.phoneId || ''
    };
  } catch (err) {
    console.error('[AdminControlService] getAdminAiProfileForNumber error:', err.message);
    return defaults;
  }
}

async function saveAdminAiProfile(updates = {}, { by = '' } = {}) {
  const existing = await getAdminAiProfile();
  const merged = {
    ...existing,
    ...updates,
    assistantName: normalizeWhitespace(updates.assistantName ?? existing.assistantName),
    ownerName: normalizeWhitespace(updates.ownerName ?? existing.ownerName) || 'A R Khan',
    languageMode: normalizeWhitespace(updates.languageMode ?? existing.languageMode).toLowerCase() || 'hinglish',
    tone: normalizeWhitespace(updates.tone ?? existing.tone),
    instructions: normalizeInstructionList(updates.instructions ?? existing.instructions),
    lastInstruction: normalizeWhitespace(updates.lastInstruction ?? existing.lastInstruction),
    updatedAt: new Date().toISOString(),
    updatedBy: normalizePhone(by) || existing.updatedBy || '',
  };
  await rtdbSet(ADMIN_AI_PROFILE_PATH, merged);
  return merged;
}

async function clearAdminAiProfile({ by = '' } = {}) {
  const cleared = {
    ...getDefaultAdminAiProfile(),
    updatedAt: new Date().toISOString(),
    updatedBy: normalizePhone(by),
  };
  await rtdbSet(ADMIN_AI_PROFILE_PATH, cleared);
  return cleared;
}

function parseLanguageMode(text = '') {
  const normalized = String(text || '').toLowerCase();
  if (/(roman|hinglish|roman urdu|roman hindi)/i.test(normalized)) return 'hinglish';
  if (/(devanagari|hindi)/i.test(normalized)) return 'hindi';
  if (/(english|eng)/i.test(normalized)) return 'english';
  if (/(arabic|urdu script)/i.test(normalized)) return 'arabic';
  return '';
}

function extractAssistantNameInstruction(text = '') {
  const normalized = normalizeWhitespace(text);
  const patterns = [
    /^(?:name|assistant name)\s+(.+)$/i,
    /(?:apka|aapka|tumhara|tera|your)\s+(?:name|naam)\s+(.+?)(?:\s+hai|\s+rahega|\s+rakhna|\s+rakho|\s+ok|$)/i,
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;
    const candidate = normalizeWhitespace(match[1] || '')
      .replace(/^(is|will be|should be)\s+/i, '')
      .replace(/\s+(hai|rahega|rakho|ok)$/i, '')
      .trim();
    if (candidate && candidate.length <= 60) {
      return candidate;
    }
  }
  return '';
}

function extractOwnerNameInstruction(text = '') {
  const normalized = normalizeWhitespace(text);
  const match = normalized.match(/(?:mera|my)\s+(?:name|naam)\s+(.+?)(?:\s+hai|$)/i);
  const candidate = normalizeWhitespace(match?.[1] || '');
  return candidate && candidate.length <= 80 ? candidate : '';
}

function isGreetingOnly(text = '') {
  return /^(hi|hii|hello|hey|hy|ok|okay|haan|han|yes|yo)$/i.test(normalizeWhitespace(text));
}

function normalizeFilterValue(value = '') {
  const normalized = normalizeWhitespace(value);
  if (!normalized || ['*', 'all', 'any', 'na', 'none', '-'].includes(normalized.toLowerCase())) {
    return '';
  }
  return normalized;
}

function buildAdminAiProfileSummary(profile = {}) {
  const instructions = normalizeInstructionList(profile.instructions);
  return [
    'AI control profile:',
    `Assistant name: ${profile.assistantName || '[default]'}`,
    `Owner name: ${profile.ownerName || '[unset]'}`,
    `Language mode: ${profile.languageMode || 'hinglish'}`,
    `Tone: ${profile.tone || '[default]'}`,
    instructions.length ? `Instructions: ${instructions.join(' | ')}` : 'Instructions: [none]',
    profile.updatedAt ? `Updated: ${profile.updatedAt}` : '',
  ].filter(Boolean).join('\n');
}

function formatCountsAsLines(counts = {}, { title = '', limit = 12 } = {}) {
  const entries = Object.entries(counts || {});
  if (!entries.length) {
    return title ? `${title}: 0` : 'No data.';
  }

  const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0);
  const top = entries.slice(0, limit).map(([label, count]) => `- ${label}: ${count}`);
  return [
    title ? `${title} (total ${total})` : `Total ${total}`,
    ...top,
    entries.length > limit ? `- ... +${entries.length - limit} more` : '',
  ].filter(Boolean).join('\n');
}

function textLooksLikeCountsQuery(text = '') {
  const normalized = normalizeWhitespace(text).toLowerCase();
  return /(kitne candidate|count|counts|category|categories|breakdown|dashboard|summary|total candidates|kitne log)/i.test(normalized);
}

async function saveFreeformAdminInstruction(text = '', { by = '' } = {}) {
  const existing = await getAdminAiProfile();
  const normalizedText = normalizeWhitespace(text);
  const assistantName = extractAssistantNameInstruction(normalizedText);
  const ownerName = extractOwnerNameInstruction(normalizedText);
  const languageMode = parseLanguageMode(normalizedText);
  const nextInstructions = normalizeInstructionList([
    ...existing.instructions,
    normalizedText,
  ]);

  return saveAdminAiProfile({
    assistantName: assistantName || existing.assistantName,
    ownerName: ownerName || existing.ownerName,
    languageMode: languageMode || existing.languageMode,
    instructions: nextInstructions,
    lastInstruction: normalizedText,
  }, { by });
}

async function getConversationControl(phone = '') {
  const normalized = normalizePhone(phone);
  if (!normalized) return {};
  return (await rtdbGet(`candidate_controls/${normalized}`)) || {};
}

async function saveConversationControl(phone = '', updates = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const existing = await getConversationControl(normalized);
  const payload = {
    ...existing,
    ...updates,
    phone: normalized,
    updatedAt: new Date().toISOString(),
  };
  await rtdbSet(`candidate_controls/${normalized}`, payload);
  return payload;
}

async function pauseConversation(phone = '', { by = '', reason = '' } = {}) {
  return saveConversationControl(phone, {
    autoReplyPaused: true,
    pausedAt: new Date().toISOString(),
    pausedBy: normalizePhone(by),
    pauseReason: String(reason || 'manual pause').trim(),
  });
}

async function resumeConversation(phone = '', { by = '' } = {}) {
  const existing = await getConversationControl(phone);
  return saveConversationControl(phone, {
    ...existing,
    autoReplyPaused: false,
    resumedAt: new Date().toISOString(),
    resumedBy: normalizePhone(by),
    pauseReason: '',
    pendingApproval: existing.pendingApproval || { active: false },
  });
}

async function clearPendingApproval(phone = '', { by = '' } = {}) {
  const existing = await getConversationControl(phone);
  return saveConversationControl(phone, {
    ...existing,
    pendingApproval: {
      ...(existing.pendingApproval || {}),
      active: false,
      resolvedAt: new Date().toISOString(),
      resolvedBy: normalizePhone(by),
    },
  });
}

function shouldEscalateToAdminApproval({
  latestMessage = '',
  replyText = '',
  isAgencyConversation = false,
  adminAssist = {},
} = {}) {
  if (isAgencyConversation) {
    return { needsApproval: false, reason: '', questionForAdmin: '', suggestedReply: '' };
  }

  if (adminAssist && adminAssist.needsApproval === true) {
    return {
      needsApproval: true,
      reason: String(adminAssist.reason || 'OpenClaw requested admin approval.').trim(),
      questionForAdmin: String(adminAssist.questionForAdmin || '').trim(),
      suggestedReply: String(adminAssist.suggestedReply || replyText || '').trim(),
    };
  }

  // Rare/serious words: escalate on their own. Common domain vocabulary (visa, ticket, payment,
  // contract, medical, manager, owner...) used to be in this same always-escalate list, which meant
  // routine questions like "visa kitne saal ka hai" or "contract kitne year ka" silently froze the
  // bot for that candidate (no reply sent, only an admin ping) until a human manually approved —
  // real chat history showed ~40% of these went unanswered for 30+ minutes. Those common words now
  // only escalate when paired with an actual concern/demand signal below.
  const text = String(latestMessage || '');
  const alwaysRisky = /(guarantee|guaranteed|refund|complaint|fraud|scam|legal action|police|advance payment)/i;
  const wantsHuman = /(call me|call kar|baat kar|human se|manager se baat|owner se baat|talk to (owner|manager))/i;
  const domainTerm = /(visa|ticket|payment|contract|offer letter|joining date|interview date|salary confirm|medical|manager|owner)/i;
  const concernSignal = /(problem|issue|shikayat|nahi mila|nahi de rahe|nahi mil raha|cancel|fail|reject|pakka|confirm karo|sure hai|guarantee|galat|wrong|jhooth|deny)/i;
  const isRisky = alwaysRisky.test(text) || wantsHuman.test(text) || /\burgent\b/i.test(text) || (domainTerm.test(text) && concernSignal.test(text));

  if (!isRisky) {
    return { needsApproval: false, reason: '', questionForAdmin: '', suggestedReply: '' };
  }

  return {
    needsApproval: true,
    reason: 'Candidate message looks sensitive and needs human approval.',
    questionForAdmin: 'Kya is candidate ko suggested reply bhejna hai, custom reply dena hai, ya conversation pause rakhni hai?',
    suggestedReply: String(replyText || '').trim(),
  };
}

async function recordOutboundAdminAction(phone = '', body = '', sendResult = {}, source = 'ADMIN_CONTROL') {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const timestamp = new Date().toISOString();
  const firebaseKey = await rtdbPush(`messages/${normalized}`, {
    from: source,
    to: normalized,
    body,
    wamId: sendResult.messageId || null,
    direction: 'outbound',
    timestamp,
    status: sendResult.success ? 'sent' : 'failed',
    error: sendResult.error || null,
  });

  await appendChatLog({
    phone: normalized,
    message: body,
    direction: 'OUTBOUND',
    timestamp,
  });

  await publishDashboardMessageEvent({
    phone: normalized,
    kind: 'outbound',
    status: sendResult.success ? 'sent' : 'failed',
    body,
    messageId: sendResult.messageId || '',
  });

  if (sendResult.success && sendResult.messageId) {
    await rtdbSet(`message_map/${safeFirebaseKey(sendResult.messageId)}`, {
      phone: normalized,
      firebaseKey,
    });
  }

  return firebaseKey;
}

async function notifyAdmins(text = '') {
  const admins = getAdminPhones();
  if (!admins.length || !String(text || '').trim()) {
    return [];
  }

  const results = [];
  for (const adminPhone of admins) {
    const result = await sendMessage(adminPhone, text);
    results.push({ phone: adminPhone, ...result });
  }
  return results;
}

async function queueAdminApprovalRequest({
  phone = '',
  candidateName = '',
  latestMessage = '',
  suggestedReply = '',
  reason = '',
  questionForAdmin = '',
  identityTag = 'CANDIDATE',
} = {}) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const approval = {
    active: true,
    requestedAt: new Date().toISOString(),
    candidatePhone: normalized,
    candidateName: String(candidateName || '').trim(),
    latestMessage: String(latestMessage || '').trim(),
    suggestedReply: String(suggestedReply || '').trim(),
    reason: String(reason || '').trim(),
    questionForAdmin: String(questionForAdmin || '').trim(),
    identityTag: String(identityTag || 'CANDIDATE').trim(),
  };

  await saveConversationControl(normalized, {
    pendingApproval: approval,
  });

  const summaryText = [
    `OpenClaw ko admin approval chahiye.`,
    `Phone: ${normalized}`,
    candidateName ? `Name: ${candidateName}` : '',
    `Type: ${approval.identityTag}`,
    approval.reason ? `Reason: ${approval.reason}` : '',
    `Last message: ${approval.latestMessage || '[empty]'}`,
    approval.suggestedReply ? `Suggested reply: ${approval.suggestedReply}` : '',
    approval.questionForAdmin ? `Question: ${approval.questionForAdmin}` : '',
    'Commands:',
    `approve ${normalized}`,
    `reply ${normalized} <message>`,
    `pause ${normalized}`,
    `resume ${normalized}`,
    `summary ${normalized}`,
  ]
    .filter(Boolean)
    .join('\n');

  await notifyAdmins(summaryText);
  return approval;
}

async function findCandidateByPhone(phone = '') {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const candidates = await rtdbGetAll('candidates');
  return (candidates || []).find((candidate) => normalizePhone(candidate.phone) === normalized) || null;
}

async function getRecentMessages(phone = '', limit = 8) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const messages = await rtdbGetAll(`messages/${normalized}`);
  return (messages || [])
    .sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime())
    .slice(-limit);
}

function buildConversationSummary(candidate = {}, control = {}, messages = []) {
  const lines = [
    `Phone: ${normalizePhone(candidate.phone || control.phone || '')}`,
    candidate.name ? `Name: ${candidate.name}` : '',
    candidate.skill ? `Skill: ${candidate.skill}` : '',
    candidate.preferredCountry ? `Preferred country: ${candidate.preferredCountry}` : '',
    candidate.status ? `Status: ${candidate.status}` : '',
    candidate.stage ? `Stage: ${candidate.stage}` : '',
    control.autoReplyPaused ? 'Auto reply: paused' : 'Auto reply: active',
    control.pendingApproval?.active ? 'Pending admin approval: yes' : 'Pending admin approval: no',
    candidate.conversationSummary ? `Summary: ${candidate.conversationSummary}` : '',
    'Recent messages:',
    ...messages.map((message) => {
      const speaker = message.direction === 'outbound' ? 'BOT' : 'USER';
      return `- ${speaker}: ${String(message.body || '').slice(0, 160)}`;
    }),
  ].filter(Boolean);

  return lines.join('\n');
}

function buildAdminHelpText() {
  return [
    'Admin commands:',
    'counts',
    'categories',
    'countries',
    'dashboard',
    'summary <phone>',
    'pause <phone>',
    'resume <phone>',
    'approve <phone>',
    'reply <phone> <message>',
    'send <phone> <message>',
    'status <phone>',
    'name <assistant-name>',
    'owner <owner-name>',
    'language <hinglish|hindi|english|arabic>',
    'tone <instruction>',
    'instruction <free text>',
    'ai show',
    'ai clear',
    'templates',
    'broadcast <skill>|<country>|<message>',
    'broadcast-numbers <num1,num2,...>|<message>',
    'broadcast-template <template>|<skill>|<country>|<var1>|<var2>...',
    'template-create <name>|<body>',
  ].join('\n');
}

async function handleAdminCommand({ from = '', body = '', mediaId = '', mimeType = '' } = {}) {
  const adminPhones = getAdminPhones();
  const normalizedFrom = normalizePhone(from);
  const adminPhone = adminPhones.find((p) => p === normalizedFrom) || normalizedFrom;

  let text = String(body || '').trim();

  // Handle Voice Note Transcription for Admin
  if (mediaId && (mimeType || '').includes('audio')) {
    try {
      console.log(`[Admin] Downloading voice note ${mediaId} from ${adminPhone}...`);
      const audioBuffer = await downloadMedia(mediaId);
      if (audioBuffer) {
        const transcript = await transcribeAudio(audioBuffer, mimeType);
        if (transcript) {
          console.log(`[Admin] Transcribed Voice Note: "${transcript}"`);
          text = transcript; // Replace placeholder with actual words
        }
      }
    } catch (err) {
      console.error('[Admin] Voice note processing failed:', err.message);
    }
  }

  const lower = text.toLowerCase();

  if (!text || lower === 'help' || lower === '/help' || lower === 'menu') {
    return { handled: true, replyText: buildAdminHelpText() };
  }

  if (lower === 'ai show' || lower === 'show ai' || lower === 'show-ai') {
    const profile = await getAdminAiProfile();
    return { handled: true, replyText: buildAdminAiProfileSummary(profile) };
  }

  if (lower === 'ai clear' || lower === 'clear ai' || lower === 'clear-ai') {
    const profile = await clearAdminAiProfile({ by: adminPhone });
    return {
      handled: true,
      replyText: `AI control reset kar diya gaya.\n\n${buildAdminAiProfileSummary(profile)}`,
    };
  }

  const nameMatch = text.match(/^name\s+(.+)$/i);
  if (nameMatch) {
    const profile = await saveAdminAiProfile({
      assistantName: normalizeWhitespace(nameMatch[1]),
      lastInstruction: `Assistant name set to ${normalizeWhitespace(nameMatch[1])}`,
    }, { by: adminPhone });
    return {
      handled: true,
      replyText: `Theek hai. Assistant name ab "${profile.assistantName}" follow karega.`,
    };
  }

  const ownerMatch = text.match(/^owner\s+(.+)$/i);
  if (ownerMatch) {
    const profile = await saveAdminAiProfile({
      ownerName: normalizeWhitespace(ownerMatch[1]),
      lastInstruction: `Owner/admin name set to ${normalizeWhitespace(ownerMatch[1])}`,
    }, { by: adminPhone });
    return {
      handled: true,
      replyText: `Theek hai. Admin/owner name ab "${profile.ownerName}" note kar liya gaya hai.`,
    };
  }

  const languageMatch = text.match(/^language\s+(.+)$/i);
  if (languageMatch) {
    const languageMode = parseLanguageMode(languageMatch[1]);
    if (!languageMode) {
      return { handled: true, replyText: 'Format: language <hinglish|hindi|english|arabic>' };
    }
    const profile = await saveAdminAiProfile({
      languageMode,
      lastInstruction: `Preferred admin language mode set to ${languageMode}`,
    }, { by: adminPhone });
    return {
      handled: true,
      replyText: `Theek hai. Preferred language mode ab ${profile.languageMode} set ho gaya hai.`,
    };
  }

  const toneMatch = text.match(/^tone\s+([\s\S]+)$/i);
  if (toneMatch) {
    const tone = normalizeWhitespace(toneMatch[1]);
    const profile = await saveAdminAiProfile({
      tone,
      instructions: normalizeInstructionList([
        ...(await getAdminAiProfile()).instructions,
        `Tone instruction: ${tone}`,
      ]),
      lastInstruction: tone,
    }, { by: adminPhone });
    return {
      handled: true,
      replyText: `Theek hai. Tone update save kar diya gaya.\n\n${buildAdminAiProfileSummary(profile)}`,
    };
  }

  const instructionMatch = text.match(/^instruction\s+([\s\S]+)$/i);
  if (instructionMatch) {
    const profile = await saveFreeformAdminInstruction(instructionMatch[1], { by: adminPhone });
    return {
      handled: true,
      replyText: `Admin instruction save kar di gayi.\n\n${buildAdminAiProfileSummary(profile)}`,
    };
  }

  if (lower === 'templates' || lower === 'template list') {
    const templates = await getAvailableTemplates(true);
    if (!templates.length) {
      return { handled: true, replyText: 'Koi active Meta templates nahi mile.' };
    }
    const lines = templates.slice(0, 20).map((template, index) => (
      `${index + 1}. ${template.name} | ${template.language} | ${template.status}`
    ));
    const footer = templates.length > 20 ? `\nAur ${templates.length - 20} templates bhi hain.` : '';
    return { handled: true, replyText: `Available templates:\n${lines.join('\n')}${footer}` };
  }

  const templateCreateMatch = text.match(/^template-create\s+([^|]+)\|([\s\S]+)$/i);
  if (templateCreateMatch) {
    const name = normalizeWhitespace(templateCreateMatch[1]);
    const bodyText = normalizeWhitespace(templateCreateMatch[2]);
    if (!name || !bodyText) {
      return { handled: true, replyText: 'Format: template-create <name>|<body>' };
    }
    const result = await createMetaTemplate({ name, bodyText });
    return {
      handled: true,
      replyText: result.success
        ? `Template create request bhej di gayi.\nName: ${result.name}\nStatus: ${result.status || 'PENDING'}`
        : `Template create nahi hui: ${result.error || 'unknown error'}`,
    };
  }

  const broadcastTemplateMatch = text.match(/^broadcast-template\s+([^|]+)\|([^|]*)\|([^|]*)(?:\|([\s\S]+))?$/i);
  if (broadcastTemplateMatch) {
    const templateName = normalizeWhitespace(broadcastTemplateMatch[1]);
    const skill = normalizeFilterValue(broadcastTemplateMatch[2]);
    const country = normalizeFilterValue(broadcastTemplateMatch[3]);
    const templateVariables = String(broadcastTemplateMatch[4] || '')
      .split('|')
      .map(item => normalizeWhitespace(item))
      .filter(Boolean);

    const { candidates } = await matchCandidates({ skill, country });
    if (!candidates.length) {
      return { handled: true, replyText: 'Broadcast-template ke liye koi matching candidates nahi mile.' };
    }

    const result = await bulkBlast(candidates, '', templateName, templateVariables);
    return {
      handled: true,
      replyText: [
        `Template blast complete.`,
        `Template: ${templateName}`,
        `Targets: ${candidates.length}`,
        `Sent: ${result.sent || 0}`,
        `Failed: ${result.failed || 0}`,
      ].join('\n'),
    };
  }

  const broadcastMatch = text.match(/^broadcast\s+([^|]*)\|([^|]*)\|([\s\S]+)$/i);
  if (broadcastMatch) {
    const skill = normalizeFilterValue(broadcastMatch[1]);
    const country = normalizeFilterValue(broadcastMatch[2]);
    const messageTemplate = String(broadcastMatch[3] || '').trim();
    if (!messageTemplate) {
      return { handled: true, replyText: 'Format: broadcast <skill>|<country>|<message>' };
    }

    const { candidates } = await matchCandidates({ skill, country });
    if (!candidates.length) {
      return { handled: true, replyText: 'Broadcast ke liye koi matching candidates nahi mile.' };
    }

    const result = await bulkBlast(candidates, messageTemplate, '');
    return {
      handled: true,
      replyText: [
        'Broadcast complete.',
        `Targets: ${candidates.length}`,
        `Sent: ${result.sent || 0}`,
        `Failed: ${result.failed || 0}`,
      ].join('\n'),
    };
  }

  const replyMatch = text.match(/^reply\s+([+\d][\d\s-]{7,})\s+([\s\S]+)$/i);
  if (replyMatch) {
    const candidatePhone = normalizePhone(replyMatch[1]);
    const customReply = String(replyMatch[2] || '').trim();
    if (!candidatePhone || !customReply) {
      return { handled: true, replyText: 'Format: reply <phone> <message>' };
    }

    const sendResult = await sendMessage(candidatePhone, customReply);
    await recordOutboundAdminAction(candidatePhone, customReply, sendResult, 'ADMIN_REPLY');
    await clearPendingApproval(candidatePhone, { by: adminPhone });
    return {
      handled: true,
      replyText: sendResult.success
        ? `Custom reply ${candidatePhone} ko bhej diya gaya.`
        : `Reply send nahi hui: ${sendResult.error || 'unknown error'}`,
    };
  }

  const sendMatch = text.match(/^send\s+([+\d][\d\s-]{7,})\s+([\s\S]+)$/i);
  if (sendMatch) {
    const targetPhone = normalizePhone(sendMatch[1]);
    const messageText = String(sendMatch[2] || '').trim();
    if (!targetPhone || !messageText) {
      return { handled: true, replyText: 'Format: send <phone> <message>' };
    }

    const sendResult = await sendMessage(targetPhone, messageText);
    await recordOutboundAdminAction(targetPhone, messageText, sendResult, 'ADMIN_SEND');
    await appendAgentOutputLog({
      phone: targetPhone,
      task: 'send',
      title: 'Manual send',
      content: messageText,
      source: 'admin',
    });

    return {
      handled: true,
      replyText: sendResult.success
        ? `Message ${targetPhone} ko bhej diya gaya.`
        : `Message send nahi hua: ${sendResult.error || 'unknown error'}`,
    };
  }

  const broadcastNumbersMatch = text.match(/^broadcast-numbers\s+([^|]+)\|([\s\S]+)$/i);
  if (broadcastNumbersMatch) {
    const numberList = String(broadcastNumbersMatch[1] || '')
      .split(/[,;\s]+/)
      .map((item) => normalizePhone(item))
      .filter(Boolean);
    const messageText = String(broadcastNumbersMatch[2] || '').trim();
    if (!numberList.length || !messageText) {
      return { handled: true, replyText: 'Format: broadcast-numbers <num1,num2,...>|<message>' };
    }

    const candidates = numberList.map((phone) => ({ phone }));
    const result = await bulkBlast(candidates, messageText, '');
    await appendAgentOutputLog({
      phone: numberList.join(','),
      task: 'broadcast-numbers',
      title: 'Manual number blast',
      content: messageText,
      source: 'admin',
      metadata: `targets=${numberList.length}, sent=${result.sent || 0}, failed=${result.failed || 0}`,
    });

    return {
      handled: true,
      replyText: [
        'Broadcast complete.',
        `Targets: ${numberList.length}`,
        `Sent: ${result.sent || 0}`,
        `Failed: ${result.failed || 0}`,
      ].join('\n'),
    };
  }

  if (lower === 'counts' || lower === 'categories' || textLooksLikeCountsQuery(text)) {
    const [skillCounts, countryCounts] = await Promise.all([
      getSkillCounts(),
      getCountryCounts(),
    ]);

    const replyText = [
      formatCountsAsLines(skillCounts, { title: 'Skill categories' }),
      '',
      formatCountsAsLines(countryCounts, { title: 'Country breakdown' }),
    ].join('\n');

    await appendAgentOutputLog({
      phone: adminPhone,
      task: 'dashboard_counts',
      title: 'Counts',
      content: replyText,
      source: 'admin',
    });

    return { handled: true, replyText };
  }

  if (lower === 'countries') {
    const countryCounts = await getCountryCounts();
    const replyText = formatCountsAsLines(countryCounts, { title: 'Country breakdown' });
    await appendAgentOutputLog({
      phone: adminPhone,
      task: 'country_counts',
      title: 'Country counts',
      content: replyText,
      source: 'admin',
    });
    return { handled: true, replyText };
  }

  const commandMatch = text.match(/^(summary|pause|resume|approve|status)\s+([+\d][\d\s-]{7,})$/i);
  if (!commandMatch) {

    const extractedName = extractAssistantNameInstruction(text);
    if (extractedName) {
      const profile = await saveAdminAiProfile({
        assistantName: extractedName,
        lastInstruction: `Assistant name set to ${extractedName}`,
      }, { by: adminPhone });
      return {
        handled: true,
        replyText: `Theek hai. Assistant name ab "${profile.assistantName}" follow karega.`,
      };
    }

      // --- NEW: DIRECT OPENCLAW AGENT INTEGRATION ---
      try {
        console.log('[Admin] Calling OpenClaw /agent pipeline...');
        const response = await fetch('http://34.93.56.200:18792/agent', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer 057dc7b2d0dfdee195ac8c8adcb54c0cb9e54ee0146554a2' // OpenClaw Token
            },
            body: JSON.stringify({
                message: text,
                to: from,
                sessionKey: "agent:main:main" // Main agent session
            })
        });

        if (response.ok) {
           const data = await response.json();
           if (data && data.output) {
             console.log('[Admin] OpenClaw Agent Reply: ' + String(data.output).slice(0, 200));
             return { handled: true, replyText: String(data.output).trim() };
           }
        } else {
           console.error('[Admin] OpenClaw returned HTTP ' + response.status);
        }
      } catch (agentErr) {
        console.error('[Admin] failed to reach OpenClaw /agent endpoint:', agentErr.message);
      }

      // Final fallback: acknowledge receipt if AI service is dead
      return {
        handled: true,
        replyText: 'Message mil gaya: "' + text.slice(0, 100) + '"\n\nAbhi AI (OpenClaw) disconnected hai. "help" bhejein for commands.',
      };
    }


  const command = String(commandMatch[1] || '').toLowerCase();
  const candidatePhone = normalizePhone(commandMatch[2]);
  const [candidate, control, messages] = await Promise.all([
    findCandidateByPhone(candidatePhone),
    getConversationControl(candidatePhone),
    getRecentMessages(candidatePhone),
  ]);

  if (command === 'summary' || command === 'status') {
    const replyText = buildConversationSummary(candidate || { phone: candidatePhone }, control || {}, messages);
    await appendAgentOutputLog({
      phone: candidatePhone,
      task: 'summary',
      title: 'Conversation summary',
      content: replyText,
      source: 'admin',
    });
    return { handled: true, replyText };
  }

  if (command === 'pause') {
    await pauseConversation(candidatePhone, { by: adminPhone, reason: 'manual admin pause' });
    return { handled: true, replyText: `${candidatePhone} ka auto reply pause kar diya gaya.` };
  }

  if (command === 'resume') {
    await resumeConversation(candidatePhone, { by: adminPhone });
    await clearPendingApproval(candidatePhone, { by: adminPhone });
    return { handled: true, replyText: `${candidatePhone} ka auto reply resume kar diya gaya.` };
  }

  if (command === 'approve') {
    const approval = control?.pendingApproval;
    if (!approval?.active || !approval?.suggestedReply) {
      return { handled: true, replyText: `${candidatePhone} ke liye koi pending approval nahi mila.` };
    }

    const sendResult = await sendMessage(candidatePhone, approval.suggestedReply);
    await recordOutboundAdminAction(candidatePhone, approval.suggestedReply, sendResult, 'ADMIN_APPROVED_REPLY');
    await clearPendingApproval(candidatePhone, { by: adminPhone });
    return {
      handled: true,
      replyText: sendResult.success
        ? `${candidatePhone} ko approved reply bhej diya gaya.`
        : `Approved reply send nahi hui: ${sendResult.error || 'unknown error'}`,
    };
  }

  return { handled: true, replyText: buildAdminHelpText() };
}

module.exports = {
  getAdminPhones,
  isAdminPhone,
  getAdminAiProfile,
  getAdminAiProfileForNumber,
  saveAdminAiProfile,
  clearAdminAiProfile,
  getConversationControl,
  pauseConversation,
  resumeConversation,
  clearPendingApproval,
  shouldEscalateToAdminApproval,
  queueAdminApprovalRequest,
  handleAdminCommand,
};

