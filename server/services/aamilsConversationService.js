/**
 * Aamils (aamils.com) WhatsApp assistant.
 *
 * +91 75995 10170 (Phone Number ID 782096074998071) is the Aamils business
 * number: website, app and WhatsApp-automation sales. It must never run the
 * Gulf Career recruitment flow or the AR Studios casting flow, so it gets its
 * own short pipeline: its own chat history, its own AI prompt, its own leads.
 *
 * Helpers that live in candidateConversationService (sending, recording,
 * dedupe bookkeeping) are passed in as `deps` to avoid a circular require.
 */
const { rtdbGet, rtdbSet, rtdbUpdate } = require('./firebaseService');
const { callGeminiJson } = require('./aiAgentService');
const { notifyAdmins } = require('./adminControlService');
const { publishDashboardMessageEvent } = require('./dashboardRealtimeService');

const AAMILS_PHONE_ID = '782096074998071';
const AAMILS_PHONE = '917599510170';
const GCG_JOBS_WHATSAPP = '+91 94110 55707';
const ARS_CASTING_WHATSAPP = '+91 80773 45658';
const HISTORY_TURNS = 20;

function isAamilsNumber({ recipientPhoneId = '', recipientPhone = '', botType = '' } = {}) {
  if (String(botType).toUpperCase() === 'AAMILS') return true;
  if (String(recipientPhoneId) === AAMILS_PHONE_ID) return true;
  return String(recipientPhone).replace(/\D/g, '').endsWith('7599510170');
}

const AAMILS_KNOWLEDGE = `
BUSINESS: Aamil (website: https://aamils.com) — builds websites, mobile & web apps,
WhatsApp CRM/automation, online stores, custom software and SEO for businesses worldwide
(India, UAE, Saudi Arabia, Gulf, UK, USA, Europe, Africa). Remote delivery on the client's timezone.

PACKAGES (fixed prices):
1. Starter Website — up to 5 pages, mobile friendly, WhatsApp & contact button, basic SEO, ready in ~7 days.
   ₹24,999 | $299 | AED 1,099 | SAR 1,099 | £239 | €279
2. Business + Automation (most popular) — everything in Starter + WhatsApp auto-reply & lead capture,
   admin dashboard, up to 10 pages, advanced SEO + analytics.
   ₹64,999 | $799 | AED 2,999 | SAR 2,999 | £639 | €739
3. Custom App / Platform — Android / iOS / web app, custom backend & APIs, database & admin panel,
   payments & integrations, ongoing support. From ₹1,59,999 | $1,999 | AED 7,499 | SAR 7,499 | £1,599 | €1,849
Bigger or unusual projects get a custom quote.

PROCESS: 1) client tells what they need (WhatsApp/form) 2) fixed quote + plan, no hidden costs
3) we build, client reviews progress 4) launch + support on WhatsApp.
TIMELINE: business website ~7 days; automation and bigger apps 2–5 weeks.
PAYMENT: UPI, bank transfer, card, Wise, local methods. Usually 50% to start, 50% on delivery.
OWNERSHIP: domain, code and content belong 100% to the client.
SUPPORT: WhatsApp support after launch; optional monthly maintenance plans.
LANGUAGES: websites in any language incl. Hindi/Hinglish, Arabic (right-to-left), Urdu and 20+ others;
aamils.com itself opens in the visitor's language automatically.
PORTFOLIO: Caspian Starline Warehouse (multi-language logistics site, Azerbaijan); Gulf Career WhatsApp
Dashboard (WhatsApp automation + CRM for thousands of candidates); Smart Sales CRM; Offer Letter Generator (passport OCR).
USEFUL LINKS: pricing https://aamils.com/#pricing · Hinglish https://aamils.com/hi/ · Arabic https://aamils.com/ar/
`.trim();

function buildPrompt({ contactName, history, latestMessage, lead }) {
  return `You are the WhatsApp assistant of Aamil (aamils.com), replying on the Aamils business number.

${AAMILS_KNOWLEDGE}

HOW TO REPLY:
- Reply in the SAME language AND script the customer used in their latest message. Roman Hindi/Urdu
  ("mujhe website chahiye") → reply in Roman Hinglish. Devanagari → Hindi. Arabic script → Arabic
  (Urdu script → Urdu). English → English. Any other language → that language.
- WhatsApp style: short, warm, 2–5 short lines, no markdown headings, at most one or two emojis.
- Only talk about Aamil's services. Never invent services, prices, discounts or deadlines not listed above.
- Understand the need, then qualify one question at a time (never several questions at once), in this order,
  skipping anything already known: name → type of business → what they need (website/app/automation/store)
  → city/country → budget → when they need it.
- When they ask the price, give the matching package price in their likely currency (India ₹, UAE AED,
  Saudi SAR, UK £, Europe €, otherwise $) and mention the next step.
- If they want to talk to a person or are ready to start, say the Aamils team will contact them shortly on this WhatsApp.
- This number used to belong to other businesses. If someone asks about a JOB / visa / Gulf work, politely say this
  number is now Aamils (websites & apps) and they should WhatsApp Gulf Career Gateway on ${GCG_JOBS_WHATSAPP}.
  If someone asks about an AUDITION / acting / casting / film, say they should WhatsApp AR Studios on ${ARS_CASTING_WHATSAPP}.
  Do not collect their details for those.
- Never ask for passwords, OTPs or card numbers.

Customer WhatsApp name: ${contactName || 'unknown'}
Lead details known so far: ${JSON.stringify(lead || {})}
Recent conversation (oldest first, "me" = Aamil):
${history.map(m => `${m.direction === 'outbound' ? 'me' : 'customer'}: ${m.body}`).join('\n') || '(new conversation)'}
Customer's latest message: ${latestMessage}

Return ONLY JSON:
{
  "replyText": "the WhatsApp reply",
  "topic": "aamils|job|casting|other",
  "lead": { "name": "", "business": "", "need": "", "city": "", "country": "", "budget": "", "timeline": "", "language": "" },
  "leadReady": false,
  "wantsHuman": false
}
"leadReady" = true once name AND need AND (city or country) are known. Keep lead values short; leave unknown ones "".`;
}

function fallbackReply(latestMessage = '') {
  const text = String(latestMessage);
  // People who still reach this number for the businesses it used to serve.
  if (/\b(job|naukri|nokri|vacanc|visa|driver|helper|salary|gulf|dubai job|saudi job)\b|नौकरी|وظيفة|عمل/i.test(text)) {
    return `Yeh number ab Aamils (websites & apps) ka hai. Gulf job ke liye Gulf Career Gateway ko WhatsApp karein: ${GCG_JOBS_WHATSAPP} 🙏\nThis number now belongs to Aamils. For Gulf jobs please WhatsApp Gulf Career Gateway on ${GCG_JOBS_WHATSAPP}.`;
  }
  if (/\b(audition|casting|actor|actress|acting|film|movie|singer|model|shoot)\b|ऑडिशन/i.test(text)) {
    return `Yeh number ab Aamils (websites & apps) ka hai. Audition/casting ke liye AR Studios ko WhatsApp karein: ${ARS_CASTING_WHATSAPP} 🙏\nThis number now belongs to Aamils. For auditions please WhatsApp AR Studios on ${ARS_CASTING_WHATSAPP}.`;
  }
  if (/[؀-ۿ]/.test(text)) {
    return 'شكرًا لتواصلك مع Aamil 🙏 نصمّم المواقع والتطبيقات وأتمتة واتساب. أخبرنا ماذا تحتاج وسيرد عليك فريقنا قريبًا.\nhttps://aamils.com/ar/';
  }
  if (/[ऀ-ॿ]/.test(text)) {
    return 'Aamil से संपर्क करने के लिए धन्यवाद 🙏 हम वेबसाइट, ऐप और WhatsApp ऑटोमेशन बनाते हैं। बताइए आपको क्या चाहिए — हमारी टीम जल्द जवाब देगी।\nhttps://aamils.com/hi/';
  }
  if (/\b(hai|kya|mujhe|chahiye|karna|banwana|kitna|aap)\b/i.test(text)) {
    return 'Aamil se contact karne ka shukriya 🙏 Hum website, app aur WhatsApp automation banate hain. Bataiye aapko kya chahiye — hamari team jaldi reply karegi.\nhttps://aamils.com/hi/';
  }
  return "Thanks for contacting Aamil 🙏 We build websites, apps and WhatsApp automation. Tell us what you need and our team will reply shortly.\nhttps://aamils.com";
}

function cleanReply(text = '') {
  return String(text).replace(/\*\*/g, '*').replace(/^#+\s*/gm, '').trim().slice(0, 1500);
}

async function appendHistory(phone, entry) {
  const key = `aamils_conversations/${phone}`;
  const existing = (await rtdbGet(key)) || {};
  const turns = Array.isArray(existing.turns) ? existing.turns : [];
  turns.push({ ...entry, at: new Date().toISOString() });
  await rtdbUpdate(key, { turns: turns.slice(-HISTORY_TURNS), updatedAt: new Date().toISOString() });
  return turns.slice(-HISTORY_TURNS);
}

async function handleAamilsConversation({
  phone, name = '', body = '', type = 'text', messageId = '',
  recipientPhoneId = '', recipientPhone = '', channel = 'whatsapp',
  deps,
}) {
  const { sendChannelMessage, recordOutboundMessage, markInboundProcessed } = deps;
  const latest = type === 'text' || !type ? String(body || '') : `[${type}] ${body || ''}`.trim();

  await publishDashboardMessageEvent({ phone, kind: 'inbound', status: 'received', body, messageId: messageId || '' });
  const history = await appendHistory(phone, { direction: 'inbound', body: latest });

  const control = (await rtdbGet(`conversation_control/${phone}`)) || {};
  if (control.autoReplyPaused) {
    await markInboundProcessed(messageId, phone, body);
    return { success: true, replied: false, skipped: 'admin_paused', bot: 'AAMILS' };
  }

  const leadKey = `aamils_leads/${phone}`;
  const lead = (await rtdbGet(leadKey)) || {};

  // Gemini regularly answers 503 "high demand" for a few seconds; callGemini
  // doesn't retry those, so give it two more chances before the canned reply.
  let plan = null;
  const prompt = buildPrompt({ contactName: name, history: history.slice(0, -1), latestMessage: latest, lead: lead.details || {} });
  for (const waitMs of [0, 2500, 6000]) {
    if (waitMs) await new Promise(r => setTimeout(r, waitMs));
    try {
      plan = await callGeminiJson([{ text: prompt }], { temperature: 0.3 });
      break;
    } catch (err) {
      console.error(`[Aamils] AI reply failed for ${phone}:`, err.message);
    }
  }

  const replyText = cleanReply(plan?.replyText) || fallbackReply(latest);
  const sendResult = await sendChannelMessage(channel, phone, replyText, recipientPhoneId || recipientPhone || AAMILS_PHONE_ID);
  await recordOutboundMessage(phone, replyText, sendResult, channel);
  await appendHistory(phone, { direction: 'outbound', body: replyText });
  await markInboundProcessed(messageId, phone, body);

  // Keep the lead up to date; tell the owner the first time it's complete.
  if (plan && plan.topic !== 'job' && plan.topic !== 'casting') {
    const merged = { ...(lead.details || {}) };
    for (const [k, v] of Object.entries(plan.lead || {})) {
      if (v && String(v).trim()) merged[k] = String(v).trim().slice(0, 200);
    }
    const update = {
      phone, whatsappName: name || lead.whatsappName || '', details: merged,
      updatedAt: new Date().toISOString(), createdAt: lead.createdAt || new Date().toISOString(),
      source: 'whatsapp:+91 75995 10170', lastMessage: latest.slice(0, 300),
    };
    const shouldNotify = (plan.leadReady || plan.wantsHuman) && !lead.notifiedAt;
    if (shouldNotify) update.notifiedAt = new Date().toISOString();
    await rtdbSet(leadKey, { ...lead, ...update });

    if (shouldNotify) {
      const summary = [
        plan.wantsHuman ? '[AAMILS] Customer wants to talk to you' : '[AAMILS] New website/app lead',
        `Name: ${merged.name || name || 'Unknown'}`,
        merged.business ? `Business: ${merged.business}` : '',
        merged.need ? `Needs: ${merged.need}` : '',
        [merged.city, merged.country].filter(Boolean).length ? `Location: ${[merged.city, merged.country].filter(Boolean).join(', ')}` : '',
        merged.budget ? `Budget: ${merged.budget}` : '',
        merged.timeline ? `When: ${merged.timeline}` : '',
        merged.language ? `Language: ${merged.language}` : '',
        `Chat: https://wa.me/${phone}`,
      ].filter(Boolean).join('\n');
      notifyAdmins(summary).catch(err => console.error(`[Aamils] notify failed for ${phone}:`, err.message));
    }
  }

  return { success: sendResult.success, replied: sendResult.success, replyText, bot: 'AAMILS', error: sendResult.error || null };
}

module.exports = {
  AAMILS_PHONE_ID,
  AAMILS_PHONE,
  isAamilsNumber,
  handleAamilsConversation,
  buildPrompt,
  fallbackReply,
};
