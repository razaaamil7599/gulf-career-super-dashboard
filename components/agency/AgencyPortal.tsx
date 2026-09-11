'use client';

import Image from 'next/image';
import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import {
  createVacancy,
  getAgencyDemands,
  submitAgencyTemplate,
  updateAgencyTemplateDraft,
  updateVacancyPriority,
} from '@/lib/api';
import VacancyApprovalQueue from './VacancyApprovalQueue';

interface SourceQueue {
  id?: string;
  agencyName?: string;
  agencyPhone?: string;
  rawText?: string;
  extractedDetails?: {
    skill?: string;
    country?: string;
    salary?: string;
    serviceCharge?: string;
  };
  assignedTemplateName?: string;
  metaTemplateName?: string;
  metaTemplateStatus?: string;
  metaTemplateError?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
  submittedTemplateBody?: string;
  draftNeedsSubmission?: boolean;
  generatedImageMediaId?: string;
  imageMediaId?: string;
  imageSource?: string;
}

interface Vacancy {
  id: string;
  skill: string;
  country: string;
  originalCharge: number;
  candidatePrice: number;
  ourMargin: number;
  companyName: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
  submittedTemplateBody?: string;
  draftNeedsSubmission?: boolean;
  approvalState?: string;
  imageUrl?: string;
  imageMediaId?: string;
  imageMimeType?: string;
  imageSource?: string;
  sourceImageUrl?: string;
  sourceImageMediaId?: string;
  sourceImageMimeType?: string;
  generatedImageMediaId?: string;
  generatedImageMimeType?: string;
  metaTemplateName?: string;
  metaTemplateStatus?: string;
  metaTemplateError?: string;
  sourceQueue?: SourceQueue | null;
  priority?: number | null;
}

type DraftState = {
  candidateFacingText: string;
  templateDraftBody: string;
};

const COUNTRY_FLAGS: Record<string, string> = {
  Saudi: 'SA',
  'Saudi Arabia': 'SA',
  UAE: 'UAE',
  Qatar: 'QA',
  Kuwait: 'KW',
  Oman: 'OM',
  Bahrain: 'BH',
};

const GCC_CONTACT_PHONE = '+91 8920624361';
const GCC_CONTACT_EMAIL = 'gulfcareergateway@gmail.com';
const GCC_CONTACT_ADDRESS = 'RZ-244, 4th Floor, Behind Croma, Pillar No. 658, Uttam Nagar East, New Delhi';

function formatPkrValue(value?: number) {
  if (!value || Number(value) <= 0) {
    return 'Not shared yet';
  }

  return `PKR ${Number(value).toLocaleString()}`;
}

function normalizeTemplateStatus(value = '') {
  return String(value || '').trim().toUpperCase();
}

function buildMediaProxySrc(mediaId = '') {
  const normalizedMediaId = String(mediaId || '').trim();
  if (!normalizedMediaId) return '';
  return `/api/messages/media/${encodeURIComponent(normalizedMediaId)}`;
}

function getApprovedTemplatePreviewSrc(vacancy: Vacancy) {
  const mediaId = String(
    vacancy.generatedImageMediaId
      || vacancy.sourceQueue?.generatedImageMediaId
      || (vacancy.imageSource === 'generated_vacancy_card' ? vacancy.imageMediaId : '')
      || (vacancy.sourceQueue?.imageSource === 'generated_vacancy_card' ? vacancy.sourceQueue?.imageMediaId : '')
      || ''
  ).trim();
  return buildMediaProxySrc(mediaId);
}

function getGeneratedCardPreviewSrc(vacancy: Vacancy) {
  const generatedMediaId = String(
    vacancy.generatedImageMediaId
      || vacancy.sourceQueue?.generatedImageMediaId
      || (vacancy.imageSource === 'generated_vacancy_card' ? vacancy.imageMediaId : '')
      || (vacancy.sourceQueue?.imageSource === 'generated_vacancy_card' ? vacancy.sourceQueue?.imageMediaId : '')
      || ''
  ).trim();
  return buildMediaProxySrc(generatedMediaId);
}

function buildInitialDraft(vacancy: Vacancy): DraftState {
  return {
    candidateFacingText: String(
      vacancy.candidateFacingText
      || vacancy.sourceQueue?.candidateFacingText
      || ''
    ).trim(),
    templateDraftBody: String(
      vacancy.templateDraftBody
      || vacancy.sourceQueue?.templateDraftBody
      || vacancy.submittedTemplateBody
      || vacancy.sourceQueue?.submittedTemplateBody
      || ''
    ).trim(),
  };
}

function getDraftIdentity(vacancy: Vacancy) {
  return {
    queueId: String(vacancy.sourceQueue?.id || '').trim(),
    vacancyId: String(vacancy.id || '').trim(),
  };
}

function getTemplateStatusMeta(vacancy: Vacancy) {
  if (vacancy.draftNeedsSubmission) {
    return {
      label: 'Draft ready - admin review pending',
      background: 'rgba(250,204,21,0.14)',
      color: '#fde68a',
    };
  }

  const status = normalizeTemplateStatus(vacancy.metaTemplateStatus);

  if (status === 'APPROVED') {
    return { label: 'Meta template approved', background: 'rgba(34,197,94,0.14)', color: '#86efac' };
  }

  if (status === 'PENDING') {
    return { label: 'Meta review pending', background: 'rgba(56,189,248,0.14)', color: '#7dd3fc' };
  }

  if (status === 'CREATE_FAILED' || status === 'SUBMIT_FAILED') {
    return { label: 'Meta template submit failed', background: 'rgba(248,113,113,0.16)', color: '#fecaca' };
  }

  if (status === 'REJECTED') {
    return { label: 'Meta template rejected', background: 'rgba(248,113,113,0.16)', color: '#fecaca' };
  }

  if (vacancy.metaTemplateName) {
    return {
      label: `Meta status: ${status || 'SUBMITTED'}`,
      background: 'rgba(56,189,248,0.12)',
      color: '#7dd3fc',
    };
  }

  return {
    label: 'Meta template not submitted',
    background: 'rgba(148,163,184,0.12)',
    color: '#cbd5e1',
  };
}

function sortByPriority(list: Vacancy[]) {
  return [...list].sort((a, b) => {
    const pa = Number.isFinite(Number(a.priority)) ? Number(a.priority) : Infinity;
    const pb = Number.isFinite(Number(b.priority)) ? Number(b.priority) : Infinity;
    if (pa !== pb) return pa - pb;
    return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
  });
}

export default function AgencyPortal() {
  const [vacancies, setVacancies] = useState<Vacancy[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ agencyName: '', skill: 'Plumber', country: 'Saudi', serviceCharge: '', assignedPhone: '', priority: '', salary: '', candidateFacingText: '' });
  const [submitting, setSubmitting] = useState(false);
  const [configs, setConfigs] = useState<any[]>([]);

  const fetchConfigs = useCallback(async () => {
    try {
      const res = await axios.get('/api/messages/configs');
      if (res.data?.success) {
        setConfigs(res.data.configs || []);
      }
    } catch (err) {
      console.error('[AgencyPortal] Failed to fetch configs:', err);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);
  const [scanning, setScanning] = useState(false);
  const [preview, setPreviewId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});
  const [savingDraftKey, setSavingDraftKey] = useState<string | null>(null);
  const [submittingDraftKey, setSubmittingDraftKey] = useState<string | null>(null);
  const [priorityDrafts, setPriorityDrafts] = useState<Record<string, string>>({});
  const [savingPriorityId, setSavingPriorityId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchVacancies = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAgencyDemands();
      setVacancies(sortByPriority(data.officialVacancies || []));
    } catch {
      setVacancies([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVacancies();

    const handleTemplatesUpdated = () => {
      fetchVacancies();
    };

    window.addEventListener('dashboard:templates-updated', handleTemplatesUpdated);

    return () => {
      window.removeEventListener('dashboard:templates-updated', handleTemplatesUpdated);
    };
  }, [fetchVacancies]);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      vacancies.forEach((vacancy) => {
        if (!next[vacancy.id]) {
          next[vacancy.id] = buildInitialDraft(vacancy);
        }
      });
      return next;
    });
    setPriorityDrafts((current) => {
      const next = { ...current };
      vacancies.forEach((vacancy) => {
        if (next[vacancy.id] === undefined) {
          next[vacancy.id] = Number.isFinite(Number(vacancy.priority)) ? String(vacancy.priority) : '';
        }
      });
      return next;
    });
  }, [vacancies]);

  async function handleSavePriority(vacancyId: string) {
    const raw = priorityDrafts[vacancyId] ?? '';
    const priority = raw.trim() === '' ? null : Number(raw);

    if (priority !== null && !Number.isFinite(priority)) {
      alert('Priority ek number honi chahiye.');
      return;
    }

    setSavingPriorityId(vacancyId);
    try {
      await updateVacancyPriority({ vacancyId, priority });
      setVacancies((current) => sortByPriority(
        current.map((v) => (v.id === vacancyId ? { ...v, priority } : v))
      ));
    } catch (err: any) {
      alert(`Priority save failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingPriorityId(null);
    }
  }

  async function handleScanPoster(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      await axios.post('/api/agency/upload-poster', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      alert('Poster scan ho gaya. Vacancy draft ke roop mein save hui hai. Admin review aur edit ke baad hi Meta approval ke liye submit hogi.');
      window.dispatchEvent(new CustomEvent('dashboard:templates-updated'));
      await fetchVacancies();
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message;
      console.error('[Agency Portal] Scan Error:', errorMsg);

      let friendlyMessage = 'Poster scan failed. ';
      if (errorMsg.includes('CORRUPT_OR_EMPTY_IMAGE')) {
        friendlyMessage += 'No readable text found in the image.';
      } else {
        friendlyMessage += 'Please check Gemini OCR configuration or try a clearer poster image.';
      }

      alert(friendlyMessage);
    } finally {
      setScanning(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await createVacancy({ ...form, priority: form.priority.trim() === '' ? null : Number(form.priority) });
      setShowForm(false);
      setForm({ agencyName: '', skill: 'Plumber', country: 'Saudi', serviceCharge: '', assignedPhone: '', priority: '', salary: '', candidateFacingText: '' });
      await fetchVacancies();
    } catch {
      alert('Error creating vacancy. Is the backend server running?');
    } finally {
      setSubmitting(false);
    }
  }

  function updateDraftField(vacancyId: string, field: keyof DraftState, value: string) {
    setDrafts((current) => ({
      ...current,
      [vacancyId]: {
        ...(current[vacancyId] || { candidateFacingText: '', templateDraftBody: '' }),
        [field]: value,
      },
    }));
  }

  async function handleSaveDraft(vacancy: Vacancy) {
    const draft = drafts[vacancy.id] || buildInitialDraft(vacancy);
    const { queueId, vacancyId } = getDraftIdentity(vacancy);
    const requestKey = queueId || vacancyId;

    setSavingDraftKey(requestKey);
    try {
      await updateAgencyTemplateDraft({
        queueId,
        vacancyId,
        candidateFacingText: draft.candidateFacingText,
        templateDraftBody: draft.templateDraftBody,
      });
      window.dispatchEvent(new CustomEvent('dashboard:templates-updated'));
      await fetchVacancies();
    } catch (err: any) {
      alert(`Draft save failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingDraftKey(null);
    }
  }

  async function handleSubmitDraft(vacancy: Vacancy) {
    const draft = drafts[vacancy.id] || buildInitialDraft(vacancy);
    const { queueId, vacancyId } = getDraftIdentity(vacancy);
    const requestKey = queueId || vacancyId;

    setSubmittingDraftKey(requestKey);
    try {
      await updateAgencyTemplateDraft({
        queueId,
        vacancyId,
        candidateFacingText: draft.candidateFacingText,
        templateDraftBody: draft.templateDraftBody,
      });

      const submission = await submitAgencyTemplate({ queueId, vacancyId });
      const status = submission?.metaTemplate?.status || submission?.workflowStatus || 'submitted';
      const message = submission?.metaTemplate?.success
        ? `Meta review ke liye submit ho gaya. Status: ${status}`
        : `Meta submit failed: ${submission?.metaTemplate?.error || 'Unknown error'}`;

      alert(message);
      window.dispatchEvent(new CustomEvent('dashboard:templates-updated'));
      await fetchVacancies();
    } catch (err: any) {
      alert(`Template submit failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSubmittingDraftKey(null);
    }
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 300 }}>
        <div className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    );
  }

  return (
    <div style={{ padding: '0 4px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>Agency Inbound Vacancies</h2>
          <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
            {vacancies.length} vacancies - Admin review first, Meta submission after approval
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleScanPoster}
            style={{ display: 'none' }}
            accept="image/*"
          />
          <button
            className="btn-secondary"
            onClick={() => fileInputRef.current?.click()}
            disabled={scanning}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px' }}
          >
            {scanning ? <div className="spinner" style={{ width: 14, height: 14 }} /> : 'Vacancy Scanning'}
          </button>
          <button className="btn-primary" onClick={() => setShowForm(!showForm)}>
            + New Vacancy
          </button>
        </div>
      </div>

      <VacancyApprovalQueue />

      {showForm && (
        <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 16px', fontSize: 15, color: 'white' }}>Add Vacancy Manually</h3>
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, alignItems: 'end' }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Agency Name</label>
              <input
                value={form.agencyName}
                onChange={(e) => setForm({ ...form, agencyName: e.target.value })}
                placeholder="Al Noor Manpower"
                required
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Skill</label>
              <select
                value={form.skill}
                onChange={(e) => setForm({ ...form, skill: e.target.value })}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              >
                {['Plumber', 'Carpenter', 'Electrician', 'AC Technician', 'Mason', 'Welder', 'Painter', 'Driver', 'Cook'].map((skill) => (
                  <option key={skill}>{skill}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Country</label>
              <select
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              >
                {['Saudi', 'UAE', 'Qatar', 'Kuwait', 'Oman', 'Bahrain'].map((country) => (
                  <option key={country}>{country}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Assigned Bot / Number</label>
              <select
                value={form.assignedPhone}
                onChange={(e) => setForm({ ...form, assignedPhone: e.target.value })}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              >
                <option value="">All Numbers</option>
                {configs.map((c) => (
                  <option key={c.phone} value={c.phone}>
                    {c.assistantName || 'Bot'} (+{c.phone})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Agency Charge (PKR, optional)</label>
              <input
                type="number"
                value={form.serviceCharge}
                onChange={(e) => setForm({ ...form, serviceCharge: e.target.value })}
                placeholder="50000"
                min={1}
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Bot order (optional)</label>
              <input
                type="number"
                min={1}
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                placeholder="1 = pehle"
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Salary / Offer</label>
              <input
                value={form.salary}
                onChange={(e) => setForm({ ...form, salary: e.target.value })}
                placeholder="1100 AED + OT/Month"
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>
                Full details for candidates (optional — bot will quote this text when asked about this vacancy)
              </label>
              <textarea
                value={form.candidateFacingText}
                onChange={(e) => setForm({ ...form, candidateFacingText: e.target.value })}
                placeholder="Company: Accommodation + Transport + Medical Insurance FREE. Duty: 10 Hours. Age Limit: 18-54. Contract: 2 Years Renewable. Visa: Employment Visa (6-7 Working Days)."
                rows={3}
                style={{ width: '100%', resize: 'vertical', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13, fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
              <button className="btn-primary" type="submit" disabled={submitting} style={{ padding: '10px 28px' }}>
                {submitting ? <div className="spinner" /> : 'Send'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {vacancies.length === 0 ? (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 60, color: '#64748b' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>LIST</div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>No Vacancies Yet</div>
            <div style={{ fontSize: 12 }}>Click &quot;+ New Vacancy&quot; to simulate an agency webhook</div>
          </div>
        ) : vacancies.map((vacancy) => {
          const templateStatus = getTemplateStatusMeta(vacancy);
          const approvedHeaderSrc = getApprovedTemplatePreviewSrc(vacancy);
          const generatedCardSrc = getGeneratedCardPreviewSrc(vacancy);
          const showGeneratedCard = Boolean(generatedCardSrc && generatedCardSrc !== approvedHeaderSrc);
          const showAnyImage = Boolean(approvedHeaderSrc || generatedCardSrc);
          const draft = drafts[vacancy.id] || buildInitialDraft(vacancy);
          const { queueId, vacancyId } = getDraftIdentity(vacancy);
          const requestKey = queueId || vacancyId;
          const actionLabel = vacancy.metaTemplateName ? 'Save Draft Changes' : 'Save Draft';
          const submitLabel = vacancy.metaTemplateName ? 'Submit Updated Draft to Meta' : 'Submit to Meta Approval';

          return (
            <div key={vacancy.id} className="vacancy-card animate-fade-in">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'white' }}>{vacancy.skill}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {COUNTRY_FLAGS[vacancy.country] || 'GLB'} {vacancy.country} - {new Date(vacancy.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <span className="badge badge-active">{vacancy.status}</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <label style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                  Bot order (1 = pehle batayega)
                </label>
                <input
                  type="number"
                  min={1}
                  value={priorityDrafts[vacancy.id] ?? ''}
                  placeholder="—"
                  onChange={(e) => setPriorityDrafts((current) => ({ ...current, [vacancy.id]: e.target.value }))}
                  onBlur={() => handleSavePriority(vacancy.id)}
                  style={{
                    width: 56,
                    background: 'rgba(15,23,42,0.8)',
                    border: '1px solid rgba(56,189,248,0.25)',
                    borderRadius: 6,
                    padding: '4px 6px',
                    color: 'white',
                    fontSize: 12,
                    textAlign: 'center',
                  }}
                />
                {savingPriorityId === vacancy.id && <div className="spinner" style={{ width: 12, height: 12 }} />}
              </div>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <span
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    background: templateStatus.background,
                    color: templateStatus.color,
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {templateStatus.label}
                </span>
                {vacancy.metaTemplateName && (
                  <span
                    style={{
                      padding: '6px 10px',
                      borderRadius: 999,
                      background: 'rgba(56,189,248,0.1)',
                      color: '#7dd3fc',
                      fontSize: 12,
                      fontWeight: 700,
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    {vacancy.metaTemplateName}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={{ background: 'rgba(15,23,42,0.5)', borderRadius: 8, padding: 10 }}>
                  <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 3 }}>AGENCY CHARGE</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
                    {formatPkrValue(vacancy.originalCharge)}
                  </div>
                </div>
                <div style={{ background: 'rgba(14,165,233,0.1)', borderRadius: 8, padding: 10, border: '1px solid rgba(56,189,248,0.2)' }}>
                  <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600, marginBottom: 3 }}>OUR PRICE</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#38bdf8' }}>
                    {formatPkrValue(vacancy.candidatePrice)}
                  </div>
                </div>
              </div>

              {vacancy.metaTemplateError && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(127,29,29,0.24)',
                    border: '1px solid rgba(248,113,113,0.16)',
                    color: '#fecaca',
                    fontSize: 11,
                    lineHeight: 1.5,
                    overflowWrap: 'anywhere',
                    wordBreak: 'break-word',
                  }}
                >
                  {vacancy.metaTemplateError}
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 11, color: '#34d399', fontWeight: 600 }}>
                  GCC-branded candidate communication
                </div>
                <button
                  onClick={() => setPreviewId(preview === vacancy.id ? null : vacancy.id)}
                  style={{ fontSize: 11, color: '#38bdf8', background: 'none', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 5, padding: '3px 8px', cursor: 'pointer' }}
                >
                  {preview === vacancy.id ? 'Hide' : 'Review / Edit'}
                </button>
              </div>

              {preview === vacancy.id && (
                <div style={{ marginTop: 10, background: 'rgba(56,189,248,0.05)', borderRadius: 12, padding: 12, border: '1px solid rgba(56,189,248,0.15)', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 10, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    Admin Review Preview
                  </div>

                  {approvedHeaderSrc && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        Approved Template Header Image
                      </div>
                      <div style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(15,23,42,0.75)', border: '1px solid rgba(56,189,248,0.12)' }}>
                        <Image
                          src={approvedHeaderSrc}
                          alt={`${vacancy.skill} approved template header`}
                          width={1080}
                          height={1350}
                          unoptimized
                          style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                      </div>
                    </div>
                  )}

                  {showGeneratedCard && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        GCC Candidate Card
                      </div>
                      <div style={{ borderRadius: 12, overflow: 'hidden', background: 'rgba(15,23,42,0.75)', border: '1px solid rgba(56,189,248,0.12)' }}>
                        <Image
                          src={generatedCardSrc}
                          alt={`${vacancy.skill} GCC candidate card`}
                          width={1080}
                          height={1350}
                          unoptimized
                          style={{ width: '100%', height: 'auto', display: 'block' }}
                        />
                      </div>
                    </div>
                  )}

                  <div
                    style={{
                      borderRadius: 12,
                      background: 'rgba(15,23,42,0.45)',
                      border: '1px dashed rgba(56,189,248,0.18)',
                      padding: 12,
                      color: '#94a3b8',
                      fontSize: 12,
                      lineHeight: 1.6,
                    }}
                  >
                    Admin yahin draft edit karega. Save hone ke baad template Meta ko automatically nahi jayega. Sirf &quot;Submit to Meta Approval&quot; par hi review request bheji jayegi.
                  </div>

                  {!showAnyImage && (
                    <div style={{ borderRadius: 12, background: 'rgba(15,23,42,0.45)', border: '1px dashed rgba(56,189,248,0.18)', padding: 14, color: '#94a3b8', fontSize: 12 }}>
                      Is vacancy ke saath abhi koi image preview available nahi hai.
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>
                      Candidate-facing message
                    </div>
                    <textarea
                      value={draft.candidateFacingText}
                      onChange={(event) => updateDraftField(vacancy.id, 'candidateFacingText', event.target.value)}
                      rows={7}
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        background: 'linear-gradient(135deg, rgba(14,165,233,0.96), rgba(99,102,241,0.96))',
                        border: '1px solid rgba(255,255,255,0.18)',
                        borderRadius: 14,
                        padding: 14,
                        color: 'white',
                        fontSize: 13,
                        lineHeight: 1.7,
                        boxShadow: '0 16px 30px rgba(14,165,233,0.18)',
                      }}
                    />
                  </div>

                  <div>
                    <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>
                      Meta approval body
                    </div>
                    <textarea
                      value={draft.templateDraftBody}
                      onChange={(event) => updateDraftField(vacancy.id, 'templateDraftBody', event.target.value)}
                      rows={7}
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        background: 'rgba(15,23,42,0.82)',
                        border: '1px solid rgba(56,189,248,0.16)',
                        borderRadius: 12,
                        padding: 12,
                        color: 'white',
                        fontSize: 13,
                        lineHeight: 1.6,
                      }}
                    />
                  </div>

                  <div style={{ background: 'rgba(15,23,42,0.38)', borderRadius: 12, padding: 12, border: '1px solid rgba(56,189,248,0.12)' }}>
                    <div style={{ fontWeight: 700, color: 'white', marginBottom: 4 }}>Gulf Career Gateway</div>
                    <div style={{ color: '#94a3b8' }}>Phone: {GCC_CONTACT_PHONE}</div>
                    <div style={{ color: '#94a3b8' }}>Email: {GCC_CONTACT_EMAIL}</div>
                    <div style={{ color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>{GCC_CONTACT_ADDRESS}</div>
                    <div style={{ color: '#64748b', marginTop: 6, fontStyle: 'italic' }}>Agency identity hidden</div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      className="btn-secondary"
                      disabled={savingDraftKey === requestKey}
                      onClick={() => handleSaveDraft(vacancy)}
                      style={{ flex: '1 1 220px', padding: '10px', fontSize: 13, fontWeight: 700, minWidth: 0 }}
                    >
                      {savingDraftKey === requestKey ? 'Saving draft...' : actionLabel}
                    </button>
                    <button
                      className="btn-primary"
                      disabled={submittingDraftKey === requestKey}
                      onClick={() => handleSubmitDraft(vacancy)}
                      style={{ flex: '1 1 260px', padding: '10px', fontSize: 13, fontWeight: 700, minWidth: 0 }}
                    >
                      {submittingDraftKey === requestKey ? 'Submitting...' : submitLabel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
