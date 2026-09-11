'use client';

import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

interface WhatsAppConfig {
  phone: string;
  phoneId: string;
  wabaId: string;
  token?: string;
  botType: 'GCG' | 'ARS' | 'CUSTOM';
  assistantName: string;
  ownerName: string;
  languageMode: 'hinglish' | 'hindi' | 'english' | 'arabic';
  tone: string;
  instructions: string[];
  coreRules?: string;
}

// Must mirror server/services/candidateConversationService.js's DEFAULT_GCG_CORE_RULES /
// DEFAULT_ARS_CORE_RULES exactly — this is what the bot follows when coreRules is left blank.
const DEFAULT_CORE_RULES: Record<string, string> = {
  GCG: `- Ask only ONE focused question at a time, in ONE short sentence. Never stack multiple questions in the same message.
- For candidates, you must systematically learn/confirm ALL of the following over the conversation: real name, current city, job skill/role they want, whether this is their first time going abroad or they are a returning worker (fresh/return), preferred country, expected salary and whether it is monthly or annual, years of experience in that work, whether documents (passport/photo) are ready, and how soon they can travel. Ask for whichever of these is still missing, one at a time, in the order given, unless the candidate already volunteered it.
- First priority for candidates is to capture their real name, city, and actual job category correctly.
- MESSAGE LENGTH: Write like a real WhatsApp recruiter, not an essay. Each reply should normally be 1-2 short sentences (roughly 15-25 words). Never write long paragraphs or explain more than what was asked. Get straight to the point, then ask the next question. Keep the reply under 200 characters overall.
- If a candidate asks for vacancy details, use the provided active vacancies and mention the relevant ones briefly.
- If a candidate asks whether a role is available, do not say "not available" unless that role is clearly absent from the provided active vacancies. If the exact role is not present, mention the closest active options instead.
- For agencies, ask for the missing vacancy intake details: skill, country, salary, quantity, service charge, documents required, and timeline.
- If this contact is in agency mode, never ask candidate profiling questions like budget, experience, passport readiness, or country preference.
- If this contact is in agency mode and the latest message is just "hello", "hi", "ok", or another acknowledgement after you already asked for vacancy details, do not repeat the same question. Either stay silent or send a very short agency-side acknowledgement.
- Behave like a professional manpower recruitment agency team leader or desk manager, not like a casual chatbot.
- Documents required: Passport, PAN card, and Aadhar card copies/scans, along with a white background photograph (Scan passport, pan card, Aadhar card copy aur white background photograph chahiye hogi). Original documents must be submitted in person at the office (Aadhar card, pan card, aur original documents submit karne honge office aakar). Original Aadhar card is required for selection (Selection ke liye original Aadhar chahiye hoga).
- If the user already answered a question in past Firebase or Google Sheet history, acknowledge it and move to the next missing point.
- Do not repeat the same question if the latest few turns already asked it unless the user clearly did not answer.
- If the latest message is only "hello", "ok", "yes", or another low-signal acknowledgment, look at the stored history first. Avoid repeating the exact same wording. Either ask the next missing thing in fresh wording or keep the reply extremely short.
- If the latest content is a media placeholder like [IMAGE], [VOICE NOTE], [VIDEO], or [DOCUMENT], acknowledge receipt naturally and continue from the correct context.
- Never store instruction text, placeholder text, meta-prompt text, greeting words, or vacancy titles as the candidate name. If the real person name is not clearly stated, leave profile.name empty instead of guessing. If the latest message looks like a role, visa type, duty, or vacancy text, treat it as skill/context, not as the person's name.
- WORK STATUS: If the candidate says anything like "fresher", "fresh hoon", "pehli baar ja raha hoon", or "no experience", set profile.workStatus to "fresh" AND set profile.experience to 0 (zero is a valid, complete answer — do not leave experience blank in this case). If they say they have worked abroad before / are returning, set profile.workStatus to "return".
- VACANCY ACCURACY: You must ONLY mention vacancies that are explicitly listed in the "Active vacancy summary" section below. Never invent, guess, or hallucinate any role name, salary figure, or benefit that is not in that list. If you mention a salary, it must exactly match what is written in the vacancy data — do not round up, modify, or infer a different number. If a role is not in the list, say it is not available rather than inventing it.
- SALARY ACCURACY: Every salary figure you mention must be copied exactly from the vacancy data. Never substitute, estimate, or invent a salary. If the vacancy says "1200 + 200 AED", say exactly that — never say "1400 AED" or any other figure.
- If the user asks for a human callback, raises a complaint, asks about payment/refund/guarantee, or the reply needs human approval, set adminAssist.needsApproval=true and explain the reason briefly.
- Do not make legal or factual guarantees about visa, placement, approval, joining, salary, travel, or employer selection. Never mention license, licence, licensing status, registration status, permit status, or whether the company has or does not have a licence. Instead of promising outcomes, say things like "process ke dauran arrange/help/guide kiya jayega" or "subject to employer selection and documentation". Never say anything that can create legal risk, false commitment, or misleading employment guarantee.
- Do not ask candidates to manually dial or call coordinator phone numbers. Instead, inform them that their profile is being processed and they will be contacted.
- Service Charge & Travel Costs: Visa and Ticket are completely free, provided by the company (Visa ticket free rahega company ki taraf se). Only quote a service-charge amount if the matched vacancy's own entry in the "Active vacancy summary" lists a "Service Charge" figure — use that exact amount and say it must be paid at the office (e.g. "Office service charge ₹<amount> pay karna hoga"). Never invent, round, or reuse a service-charge number from a different vacancy or from earlier in the conversation. If the current vacancy has no "Service Charge" line, do not state any figure; instead say the exact service charge will be confirmed by the office team.
- Common candidate questions — how to answer them (based on what real candidates actually ask most):
  * "Is this fraud/fake/scam?": Take it seriously, never sound defensive or scripted. Calmly confirm the company is a real recruitment agency, offer the office address/contact so they can visit or verify in person, and mention that no payment is ever asked for over chat (only the office service charge, if applicable, paid in person). Never argue or repeat "trust me" — offer verifiable proof instead (office visit, documents at the office).
  * Candidate states their own years of experience unprompted (e.g. "I have 8 years experience in Saudi"): Acknowledge it, save it, and move to the next missing profiling detail — do not ask "how much experience do you have" again.
  * "Is there an age limit?": If the matched vacancy's data states an age limit, quote it exactly. If it does not, say there's no specific age limit mentioned for this role and ask their age so the office can confirm eligibility — never invent a number.
  * "Do you have jobs for ladies/females?": Only mention a specific role as available for women if a currently active vacancy actually says so. If none do, say there is no specific vacancy for women available right now and that you'll inform them when one opens — never invent one.
  * "Can I get a refund / cancel?": Never state a refund amount or policy yourself — say this needs to be confirmed directly with the office team, and set adminAssist.needsApproval=true.
  * Duty hours / contract length questions: Answer only from the matched vacancy's own data if present; otherwise say the office will confirm exact duty hours/contract length once shortlisted — never estimate.`,
  ARS: `- Ask only one focused question at a time.
- This is a CASTING/AUDITION conversation, not a Gulf/manpower recruitment conversation. Never mention Gulf jobs, visas, manpower vacancies, or overseas placement — that is a different business entirely.
- Try to learn or confirm: real name, city, and which creative field interests them (acting, writing, direction, VFX/technical, music/lyrics). For acting roles, also ask age. If they have a portfolio, reel, or past work link, ask them to share it.
- First priority is to capture their real name and which creative field they want correctly.
- Never store instruction text, placeholder text, meta-prompt text, or greeting words as the candidate name. If the real person name is not clearly stated, leave profile.name empty instead of guessing.
- NO FEE: The application/casting process is 100% free. There is no registration fee or service charge of any kind. If asked about payment, clearly say it is free.
- CASTING ACCURACY: Only mention specific current casting requirements if they are listed in the "Current active castings" section below. If nothing is listed there, do not invent roles — instead say the team keeps adding new castings and ask what creative field/role they are looking for, so the team can match them.
- Do not make guarantees about selection, shortlisting, or approval. Say the casting team will review profiles and get back to interested/matching candidates. Never mention license, licence, licensing, or registration status.
- If the user already answered a question in past conversation history, acknowledge it and move to the next missing point instead of repeating it.
- Do not repeat the same question if the latest few turns already asked it unless the user clearly did not answer.
- If the latest message is only "hello", "ok", "yes", or another low-signal acknowledgment, look at the stored history first and avoid repeating the exact same wording.
- If the latest content is a media placeholder like [IMAGE], [VOICE NOTE], [VIDEO], or [DOCUMENT], acknowledge receipt naturally (e.g. treat it as a photo/portfolio/reel submission) and continue from the correct context.
- If the user asks for a human callback, raises a complaint, or the reply needs human approval, set adminAssist.needsApproval=true and explain the reason briefly.`,
};

const FIXED_SAFETY_RULES: Record<string, string[]> = {
  GCG: [
    'Reply hamesha structured JSON format me deta hai — yeh candidate ko kabhi dikhta nahi, sirf dashboard/database ko sahi se update karne ke liye zaroori hai.',
  ],
  ARS: [
    'Reply hamesha structured JSON format me deta hai — yeh candidate ko kabhi dikhta nahi, sirf dashboard/database ko sahi se update karne ke liye zaroori hai.',
  ],
  CUSTOM: [
    'Reply hamesha structured JSON format me deta hai — yeh candidate ko kabhi dikhta nahi, sirf dashboard/database ko sahi se update karne ke liye zaroori hai.',
  ],
};

const MAX_INSTRUCTIONS = 30;

const inputStyle: React.CSSProperties = {
  width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)',
  borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13,
};

export default function AIInstructionsPortal() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [assistantName, setAssistantName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [languageMode, setLanguageMode] = useState<'hinglish' | 'hindi' | 'english' | 'arabic'>('hinglish');
  const [tone, setTone] = useState('');
  const [instructionRows, setInstructionRows] = useState<string[]>([]);
  const [coreRules, setCoreRules] = useState('');
  const [coreRulesIsDefault, setCoreRulesIsDefault] = useState(true);

  const fetchConfigs = useCallback(async (autoSelectPhone?: string) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/messages/configs');
      if (res.data?.success) {
        const list: WhatsAppConfig[] = res.data.configs || [];
        setConfigs(list);
        const targetPhone = autoSelectPhone || selectedPhone || list[0]?.phone || '';
        const target = list.find(c => c.phone === targetPhone) || list[0];
        if (target) {
          loadIntoForm(target);
          setSelectedPhone(target.phone);
        }
      }
    } catch (err) {
      console.error('Failed to fetch bot configs:', err);
    } finally {
      setLoading(false);
    }
  }, [selectedPhone]);

  useEffect(() => {
    fetchConfigs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function loadIntoForm(config: WhatsAppConfig) {
    setAssistantName(config.assistantName || '');
    setOwnerName(config.ownerName || '');
    setLanguageMode(config.languageMode || 'hinglish');
    setTone(config.tone || '');
    setInstructionRows(Array.isArray(config.instructions) ? config.instructions.filter(Boolean) : []);
    const defaultText = DEFAULT_CORE_RULES[config.botType || 'GCG'] || DEFAULT_CORE_RULES.GCG;
    if (config.coreRules && config.coreRules.trim()) {
      setCoreRules(config.coreRules);
      setCoreRulesIsDefault(false);
    } else {
      setCoreRules(defaultText);
      setCoreRulesIsDefault(true);
    }
  }

  function handleSelect(config: WhatsAppConfig) {
    setSelectedPhone(config.phone);
    loadIntoForm(config);
  }

  const selectedConfig = configs.find(c => c.phone === selectedPhone) || null;

  function updateRow(idx: number, value: string) {
    setInstructionRows(prev => prev.map((r, i) => (i === idx ? value : r)));
  }

  function addRow() {
    setInstructionRows(prev => (prev.length >= MAX_INSTRUCTIONS ? prev : [...prev, '']));
  }

  function removeRow(idx: number) {
    setInstructionRows(prev => prev.filter((_, i) => i !== idx));
  }

  function moveRow(idx: number, direction: -1 | 1) {
    setInstructionRows(prev => {
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function resetCoreRulesToDefault() {
    if (!selectedConfig) return;
    if (!confirm('Core Behavior Rules ko wapas default text pe reset kar du?')) return;
    setCoreRules(DEFAULT_CORE_RULES[selectedConfig.botType || 'GCG'] || DEFAULT_CORE_RULES.GCG);
    setCoreRulesIsDefault(true);
  }

  async function handleSave() {
    if (!selectedConfig) return;
    setSaving(true);
    try {
      const defaultText = DEFAULT_CORE_RULES[selectedConfig.botType || 'GCG'] || DEFAULT_CORE_RULES.GCG;
      const trimmedCoreRules = coreRules.trim();
      const payload: WhatsAppConfig = {
        ...selectedConfig,
        assistantName: assistantName.trim(),
        ownerName: ownerName.trim(),
        languageMode,
        tone: tone.trim(),
        instructions: instructionRows.map(line => line.trim()).filter(Boolean),
        // Save '' (falls back to the code default) if unchanged, so future default improvements still apply automatically.
        coreRules: trimmedCoreRules === defaultText.trim() ? '' : trimmedCoreRules,
      };
      const res = await axios.post('/api/messages/configs', payload);
      if (res.data?.success) {
        alert('AI Instructions save ho gayi — agli reply se hi live ho jayengi, redeploy ki zaroorat nahi.');
        fetchConfigs(selectedPhone);
      } else {
        alert('Save fail ho gaya: ' + (res.data?.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setSaving(false);
    }
  }

  const fixedSafetyRules = FIXED_SAFETY_RULES[selectedConfig?.botType || 'GCG'] || FIXED_SAFETY_RULES.GCG;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 24, height: 'calc(100vh - 150px)', overflow: 'hidden' }}>

      {/* Left panel: bot selector */}
      <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto' }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'white' }}>Bot Chuno</h3>
        <div style={{ fontSize: 11, color: '#64748b' }}>
          Har WhatsApp number ka apna AI persona aur instructions hote hain.
        </div>

        {loading && <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading...</div>}

        {!loading && configs.length === 0 && (
          <div style={{ padding: '30px 10px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            Koi bot number configured nahi hai. Pehle "Bot Portal Settings" se ek number add karein.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {configs.map((config) => (
            <div
              key={config.phone}
              onClick={() => handleSelect(config)}
              style={{
                background: 'rgba(15,23,42,0.4)',
                border: selectedPhone === config.phone ? '1px solid #38bdf8' : '1px solid rgba(56,189,248,0.1)',
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 13 }}>+{config.phone}</div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>{config.assistantName || 'Unnamed'}</div>
              </div>
              <span
                style={{
                  fontSize: 9,
                  background: config.botType === 'ARS' ? 'rgba(251,146,60,0.18)' : 'rgba(34,197,94,0.13)',
                  color: config.botType === 'ARS' ? '#fb923c' : '#4ade80',
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: 4,
                }}
              >
                {config.botType || 'GCG'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: editable core rules + priority instructions */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', overflowY: 'auto', gap: 20 }}>
        {!selectedConfig ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 12 }}>
            <div style={{ fontSize: 36 }}>🧠</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Left side se ek bot number chuno.</div>
          </div>
        ) : (
          <>
            <div style={{ borderBottom: '1px solid rgba(56,189,248,0.1)', paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'white', fontWeight: 700 }}>
                AI Instructions — +{selectedConfig.phone} ({selectedConfig.botType || 'GCG'})
              </h3>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
                Bot abhi ye follow kar raha hai — dono box (Core Behavior Rules + Priority Instructions) editable hain.
              </div>
            </div>

            {/* Core Behavior Rules — NOW EDITABLE, pre-filled with current default text */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <h4 style={{ margin: 0, fontSize: 13, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Core Behavior Rules (yahan click karke seedha edit karo)
                </h4>
                {!coreRulesIsDefault && (
                  <button type="button" onClick={resetCoreRulesToDefault} style={{ fontSize: 10, background: 'none', border: 'none', color: '#64748b', textDecoration: 'underline', cursor: 'pointer' }}>
                    Default pe reset karo
                  </button>
                )}
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                Yeh text box hi bot ka poora "brain" hai — data collection order, salary/vacancy accuracy, documents, service charge, legal disclaimers, sab kuch yahan se control hota hai. Jo bhi likhoge wahi bot follow karega. Save karte hi turant live, koi redeploy nahi chahiye.
              </div>
              <textarea
                value={coreRules}
                onChange={(e) => { setCoreRules(e.target.value); setCoreRulesIsDefault(false); }}
                rows={16}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.25)', borderRadius: 8, padding: 12, color: 'white', fontSize: 12.5, fontFamily: 'monospace', lineHeight: 1.6, resize: 'vertical' }}
              />
            </div>

            {/* Only the technical JSON response format stays outside — it's not content shown to
                candidates, so there's nothing here for an admin to usefully customize. */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12 }}>🔒</span>
                <h4 style={{ margin: 0, fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Sirf Ye Technical Format Fixed Hai (candidate ko nahi dikhta)
                </h4>
              </div>
              <div style={{ background: 'rgba(15,23,42,0.35)', border: '1px dashed rgba(148,163,184,0.2)', borderRadius: 10, padding: 14, opacity: 0.8 }}>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {fixedSafetyRules.map((rule, i) => (
                    <li key={i} style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5 }}>{rule}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Editable persona */}
            <div>
              <h4 style={{ margin: '0 0 16px', fontSize: 13, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Persona
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Assistant Name</label>
                  <input value={assistantName} onChange={(e) => setAssistantName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Owner/Manager Name</label>
                  <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Language Mode</label>
                  <select value={languageMode} onChange={(e) => setLanguageMode(e.target.value as any)} style={inputStyle}>
                    <option value="hinglish">Roman Urdu / Hinglish</option>
                    <option value="hindi">Hindi (Devanagari)</option>
                    <option value="english">English</option>
                    <option value="arabic">Arabic</option>
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Tone</label>
                <input
                  value={tone}
                  onChange={(e) => setTone(e.target.value)}
                  placeholder="Hinglish me short, direct, helpful, aur professional tone."
                  style={inputStyle}
                />
              </div>
            </div>

            {/* Editable, ordered, priority-ranked instructions */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>
                  Priority Instructions — har rule apni alag row me, ✕ se hatao, ↑↓ se priority badlo
                </label>
                <span style={{ fontSize: 10, color: instructionRows.length >= MAX_INSTRUCTIONS ? '#f87171' : '#64748b' }}>
                  {instructionRows.length}/{MAX_INSTRUCTIONS} instructions
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                Number 1 wali sabse pehle follow hogi, uske baad 2, 3... isi order me. Agar do instructions aapas me takrayein, to chhota number jeetega. Har row optional hai — jitni chaho utni rakho ya hatao.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {instructionRows.map((row, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 6, background: 'rgba(56,189,248,0.15)', color: '#38bdf8',
                      fontSize: 12, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {idx + 1}
                    </div>
                    <input
                      value={row}
                      onChange={(e) => updateRow(idx, e.target.value)}
                      placeholder="e.g. Service charge 25,000 INR hai."
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    <button
                      type="button"
                      onClick={() => moveRow(idx, -1)}
                      disabled={idx === 0}
                      title="Priority upar badhao"
                      style={{ background: 'rgba(56,189,248,0.1)', color: idx === 0 ? '#475569' : '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, width: 28, height: 28, cursor: idx === 0 ? 'default' : 'pointer', fontSize: 13 }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveRow(idx, 1)}
                      disabled={idx === instructionRows.length - 1}
                      title="Priority neeche karo"
                      style={{ background: 'rgba(56,189,248,0.1)', color: idx === instructionRows.length - 1 ? '#475569' : '#38bdf8', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, width: 28, height: 28, cursor: idx === instructionRows.length - 1 ? 'default' : 'pointer', fontSize: 13 }}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeRow(idx)}
                      title="Delete"
                      style={{ background: 'rgba(239,68,68,0.1)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 13 }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {instructionRows.length === 0 && (
                <div style={{ textAlign: 'center', color: '#64748b', fontSize: 12, padding: '16px 0' }}>
                  Abhi koi extra instruction nahi hai. Neeche button se pehli add karo.
                </div>
              )}

              <button
                type="button"
                onClick={addRow}
                disabled={instructionRows.length >= MAX_INSTRUCTIONS}
                style={{ marginTop: 12, width: '100%', padding: '9px 12px', fontSize: 12.5, background: 'rgba(56,189,248,0.08)', color: '#38bdf8', border: '1px dashed rgba(56,189,248,0.3)', borderRadius: 8, cursor: instructionRows.length >= MAX_INSTRUCTIONS ? 'default' : 'pointer', opacity: instructionRows.length >= MAX_INSTRUCTIONS ? 0.5 : 1 }}
              >
                + Naya Instruction Add Karo
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid rgba(56,189,248,0.1)', paddingTop: 16 }}>
              <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ padding: '10px 20px', fontSize: 13, opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save Instructions'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
