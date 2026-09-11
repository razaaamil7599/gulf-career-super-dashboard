'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { submitAgencyTemplate, updateAgencyTemplateDraft } from '@/lib/api';

type QueueItem = {
  id: string;
  agencyName?: string;
  rawText?: string;
  inquiryText?: string;
  assignedTemplateName?: string;
  metaTemplateName?: string;
  metaTemplateStatus?: string;
  metaTemplateError?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
  submittedTemplateBody?: string;
  draftNeedsSubmission?: boolean;
  extractedDetails?: {
    skill?: string;
    country?: string;
    salary?: string;
  };
  extracted?: {
    skill?: string;
    country?: string;
    salary?: string;
  };
  status?: string;
  imageMediaId?: string;
  sourceImageMediaId?: string;
  generatedImageMediaId?: string;
  imageSource?: string;
};

type DraftState = {
  candidateFacingText: string;
  templateDraftBody: string;
};

function getExtracted(item: QueueItem) {
  return item.extractedDetails || item.extracted || {};
}

function getSourceText(item: QueueItem) {
  return item.rawText || item.inquiryText || 'Original vacancy text available nahi hai.';
}

function getMetaStatusLabel(item: QueueItem) {
  if (item.draftNeedsSubmission) return 'Draft ready - admin review pending';
  if (item.metaTemplateStatus === 'create_failed' || item.metaTemplateStatus === 'CREATE_FAILED') {
    return `Meta submit failed${item.metaTemplateError ? `: ${item.metaTemplateError}` : ''}`;
  }
  if (item.metaTemplateStatus === 'rejected' || item.metaTemplateStatus === 'REJECTED') {
    return 'Meta rejected - edit and resubmit';
  }
  if (item.metaTemplateStatus === 'pending' || item.metaTemplateStatus === 'PENDING') {
    return 'Submitted to Meta review';
  }
  if (item.metaTemplateStatus === 'approved' || item.metaTemplateStatus === 'APPROVED') {
    return 'Meta approved';
  }
  if (item.metaTemplateName) return item.metaTemplateStatus || 'Meta submitted';
  return 'Draft ready for admin review';
}

function getQueuePreviewSrc(item: QueueItem) {
  const mediaId = String(
    item.generatedImageMediaId
    || (item.imageSource === 'generated_vacancy_card' ? item.imageMediaId : '')
    || ''
  ).trim();
  if (!mediaId) return '';
  return `/api/messages/media/${encodeURIComponent(mediaId)}`;
}

function buildInitialDraft(item: QueueItem): DraftState {
  return {
    candidateFacingText: String(item.candidateFacingText || '').trim(),
    templateDraftBody: String(item.templateDraftBody || item.submittedTemplateBody || '').trim(),
  };
}

function getWorkflowStatusTone(item: QueueItem) {
  if (item.draftNeedsSubmission) {
    return { background: 'rgba(250,204,21,0.14)', color: '#fde68a' };
  }
  if (item.metaTemplateStatus === 'APPROVED') {
    return { background: 'rgba(34,197,94,0.14)', color: '#86efac' };
  }
  if (item.metaTemplateStatus === 'PENDING') {
    return { background: 'rgba(56,189,248,0.14)', color: '#7dd3fc' };
  }
  return { background: 'rgba(248,113,113,0.16)', color: '#fecaca' };
}

export default function VacancyApprovalQueue() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

  useEffect(() => {
    fetchQueue();

    const handleTemplatesUpdated = () => {
      fetchQueue();
    };

    window.addEventListener('dashboard:templates-updated', handleTemplatesUpdated);

    return () => {
      window.removeEventListener('dashboard:templates-updated', handleTemplatesUpdated);
    };
  }, []);

  useEffect(() => {
    setDrafts((current) => {
      const next = { ...current };
      queue.forEach((item) => {
        if (!next[item.id]) {
          next[item.id] = buildInitialDraft(item);
        }
      });
      return next;
    });
  }, [queue]);

  const reviewQueue = useMemo(
    () => queue.filter((item) => (
      item.draftNeedsSubmission
      || item.status === 'pending_approval'
      || item.status === 'template_retry_required'
      || item.status === 'meta_rejected'
      || item.metaTemplateStatus === 'CREATE_FAILED'
      || item.metaTemplateStatus === 'REJECTED'
    )),
    [queue],
  );

  async function fetchQueue() {
    try {
      const resp = await axios.get('/api/agency/queue');
      const payload = resp.data.queue || [];
      const data = Array.isArray(payload)
        ? payload
        : Object.entries(payload).map(([id, val]: [string, any]) => ({ id, ...val }));
      setQueue(data);
    } catch {
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }

  function updateDraftField(id: string, field: keyof DraftState, value: string) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || { candidateFacingText: '', templateDraftBody: '' }),
        [field]: value,
      },
    }));
  }

  async function handleSaveDraft(item: QueueItem) {
    const draft = drafts[item.id] || buildInitialDraft(item);
    setSavingId(item.id);
    try {
      await updateAgencyTemplateDraft({
        queueId: item.id,
        candidateFacingText: draft.candidateFacingText,
        templateDraftBody: draft.templateDraftBody,
      });
      window.dispatchEvent(new CustomEvent('dashboard:templates-updated'));
      await fetchQueue();
    } catch (err: any) {
      alert(`Draft save failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSavingId(null);
    }
  }

  async function handleSubmitDraft(item: QueueItem) {
    const draft = drafts[item.id] || buildInitialDraft(item);
    setSubmittingId(item.id);
    try {
      await updateAgencyTemplateDraft({
        queueId: item.id,
        candidateFacingText: draft.candidateFacingText,
        templateDraftBody: draft.templateDraftBody,
      });

      const submission = await submitAgencyTemplate({ queueId: item.id });
      const status = submission?.metaTemplate?.status || submission?.workflowStatus || 'submitted';
      const message = submission?.metaTemplate?.success
        ? `Meta review ke liye submit ho gaya. Status: ${status}`
        : `Meta submit failed: ${submission?.metaTemplate?.error || 'Unknown error'}`;

      alert(message);
      window.dispatchEvent(new CustomEvent('dashboard:templates-updated'));
      await fetchQueue();
    } catch (err: any) {
      alert(`Template submit failed: ${err.response?.data?.error || err.message}`);
    } finally {
      setSubmittingId(null);
    }
  }

  if (loading) return null;

  if (reviewQueue.length === 0) {
    return (
      <div
        style={{
          marginTop: 24,
          padding: 40,
          background: 'rgba(56,189,248,0.05)',
          borderRadius: 12,
          border: '1px dashed rgba(56,189,248,0.2)',
          textAlign: 'center',
          color: '#64748b',
        }}
      >
        No draft waiting for admin review. Nayi vacancies pehle local draft me save hongi aur edit ke baad hi Meta ko bheji jayengi.
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h3
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: 'white',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <span style={{ marginRight: 8 }}>AI Approval Queue</span>
        <span style={{ color: '#38bdf8' }}>({reviewQueue.length})</span>
      </h3>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {reviewQueue.map((item) => {
          const extracted = getExtracted(item);
          const previewSrc = getQueuePreviewSrc(item);
          const draft = drafts[item.id] || buildInitialDraft(item);
          const statusTone = getWorkflowStatusTone(item);

          return (
            <div key={item.id} className="glass-card" style={{ padding: 20 }}>
              <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 30,
                    border: '1px solid rgba(56,189,248,0.2)',
                    flexShrink: 0,
                    overflow: 'hidden',
                    position: 'relative',
                  }}
                >
                  {previewSrc ? (
                    <Image
                      src={previewSrc}
                      alt={`${extracted.skill || 'Vacancy'} GCC preview`}
                      fill
                      unoptimized
                      style={{ objectFit: 'cover' }}
                    />
                  ) : (
                    'DOC'
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                      <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Admin Review Draft
                      </div>
                      <div style={{ fontSize: 22, fontWeight: 800, color: 'white', marginTop: 4, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                        {extracted.skill || 'General'}
                      </div>
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
                        <span style={{ color: '#94a3b8', fontSize: 13 }}>Country: {extracted.country || 'Gulf'}</span>
                        <span style={{ color: '#94a3b8', fontSize: 13 }}>Offer: {extracted.salary || 'Pending'}</span>
                        <span style={{ color: '#94a3b8', fontSize: 13, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>Source: {item.agencyName || 'Manual upload'}</span>
                      </div>
                    </div>

                    <div style={{ flex: '0 1 260px', minWidth: 0, maxWidth: '100%', textAlign: 'right' }}>
                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>
                        Recommended Blast Template
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: '#10b981',
                          fontWeight: 700,
                          background: 'rgba(16,185,129,0.1)',
                          padding: '3px 8px',
                          borderRadius: 6,
                          marginTop: 4,
                          display: 'inline-flex',
                          justifyContent: 'flex-end',
                          maxWidth: '100%',
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {item.assignedTemplateName || 'Not assigned yet'}
                      </div>

                      <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginTop: 10 }}>
                        Meta Review State
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: statusTone.color,
                          fontWeight: 700,
                          background: statusTone.background,
                          padding: '3px 8px',
                          borderRadius: 6,
                          marginTop: 4,
                          display: 'inline-flex',
                          justifyContent: 'flex-end',
                          maxWidth: '100%',
                          whiteSpace: 'normal',
                          overflowWrap: 'anywhere',
                          wordBreak: 'break-word',
                        }}
                      >
                        {getMetaStatusLabel(item)}
                      </div>

                      {item.metaTemplateName && (
                        <div style={{ fontSize: 11, color: '#7dd3fc', marginTop: 6, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
                          {item.metaTemplateName}
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      padding: 12,
                      borderRadius: 10,
                      background: 'rgba(15,23,42,0.45)',
                      border: '1px solid rgba(56,189,248,0.08)',
                      color: '#cbd5e1',
                      fontSize: 12,
                      lineHeight: 1.6,
                      overflowWrap: 'anywhere',
                      wordBreak: 'break-word',
                    }}
                  >
                    {getSourceText(item)}
                  </div>

                  <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>
                        Candidate-facing message
                      </div>
                      <textarea
                        value={draft.candidateFacingText}
                        onChange={(event) => updateDraftField(item.id, 'candidateFacingText', event.target.value)}
                        rows={6}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          background: 'rgba(15,23,42,0.82)',
                          border: '1px solid rgba(56,189,248,0.16)',
                          borderRadius: 10,
                          padding: 12,
                          color: 'white',
                          fontSize: 13,
                          lineHeight: 1.6,
                        }}
                      />
                    </div>

                    <div>
                      <div style={{ fontSize: 11, color: '#38bdf8', fontWeight: 700, marginBottom: 6 }}>
                        Meta approval body
                      </div>
                      <textarea
                        value={draft.templateDraftBody}
                        onChange={(event) => updateDraftField(item.id, 'templateDraftBody', event.target.value)}
                        rows={6}
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          background: 'rgba(15,23,42,0.82)',
                          border: '1px solid rgba(56,189,248,0.16)',
                          borderRadius: 10,
                          padding: 12,
                          color: 'white',
                          fontSize: 13,
                          lineHeight: 1.6,
                        }}
                      />
                    </div>
                  </div>

                  {item.metaTemplateError && (
                    <div
                      style={{
                        marginTop: 12,
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
                      {item.metaTemplateError}
                    </div>
                  )}

                  <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      className="btn-secondary"
                      disabled={savingId === item.id}
                      onClick={() => handleSaveDraft(item)}
                      style={{ flex: '1 1 220px', padding: '10px', fontSize: 13, fontWeight: 700, minWidth: 0 }}
                    >
                      {savingId === item.id ? 'Saving draft...' : 'Save Draft'}
                    </button>
                    <button
                      className="btn-primary"
                      disabled={submittingId === item.id}
                      onClick={() => handleSubmitDraft(item)}
                      style={{ flex: '1 1 260px', padding: '10px', fontSize: 13, fontWeight: 700, minWidth: 0 }}
                    >
                      {submittingId === item.id ? 'Submitting...' : 'Submit to Meta Approval'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
