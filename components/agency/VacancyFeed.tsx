'use client';

import { startTransition, useCallback, useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { getAgencyDemands } from '@/lib/api';
import { db, hasFirebaseConfig } from '@/lib/firebase';

interface AgencyInboxItem {
  id: string;
  agencyName?: string;
  phone?: string;
  inquiryText?: string;
  skill?: string;
  country?: string;
  salary?: string;
  serviceCharge?: string;
  quantity?: string;
  timeline?: string;
  updatedAt?: string;
  createdAt?: string;
}

interface QueueItem {
  id: string;
  agencyName?: string;
  agencyPhone?: string;
  rawText?: string;
  rawOcr?: string;
  inquiryText?: string;
  assignedTemplateName?: string;
  metaTemplateName?: string;
  metaTemplateStatus?: string;
  metaTemplateError?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
  submittedTemplateBody?: string;
  draftNeedsSubmission?: boolean;
  status?: string;
  matchedCandidates?: number;
  imageMediaId?: string;
  imageSource?: string;
  blastResult?: {
    targeted?: number;
    sent?: number;
    failed?: number;
    posterSent?: number;
    posterFailed?: number;
    posterMediaAttached?: boolean;
    pendingTemplateApproval?: boolean;
  };
  createdAt?: string;
  updatedAt?: string;
  timestamp?: string;
  approvedVacancyId?: string;
  extractedDetails?: {
    skill?: string;
    country?: string;
    salary?: string;
    serviceCharge?: string;
  };
  extracted?: {
    skill?: string;
    country?: string;
    salary?: string;
    serviceCharge?: string;
  };
}

interface OfficialVacancy {
  id: string;
  skill?: string;
  country?: string;
  salary?: string;
  serviceCharge?: string;
  candidatePrice?: number;
  originalCharge?: number;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  assignedTemplateName?: string;
  metaTemplateName?: string;
  metaTemplateStatus?: string;
  metaTemplateError?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
  submittedTemplateBody?: string;
  draftNeedsSubmission?: boolean;
  matchedCandidates?: number;
  imageMediaId?: string;
  imageSource?: string;
  blastResult?: {
    targeted?: number;
    sent?: number;
    failed?: number;
    posterSent?: number;
    posterFailed?: number;
    posterMediaAttached?: boolean;
    pendingTemplateApproval?: boolean;
  };
  approvalState?: string;
  agencyName?: string;
  sourceQueue?: QueueItem | null;
}

const COUNTRY_FLAGS: Record<string, string> = {
  Saudi: 'SA',
  UAE: 'UAE',
  Qatar: 'QA',
  Kuwait: 'KW',
  Oman: 'OM',
  Bahrain: 'BH',
};

function formatTime(value?: string) {
  if (!value) return 'Just now';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Just now';
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function renderOriginalText(item?: QueueItem | null) {
  return item?.rawText || item?.rawOcr || item?.inquiryText || 'Original vacancy text abhi available nahi hai.';
}

function getExtracted(item?: QueueItem | null) {
  return item?.extractedDetails || item?.extracted || {};
}

function getMetaTemplateLabel(item?: { metaTemplateName?: string; metaTemplateStatus?: string; metaTemplateError?: string } | null) {
  if (!item) return 'Not created yet';
  if ((item as QueueItem).draftNeedsSubmission) {
    return 'Draft ready - admin review pending';
  }
  const normalizedStatus = String(item.metaTemplateStatus || '').trim().toUpperCase();
  if (item.metaTemplateName) {
    return `${item.metaTemplateName}${normalizedStatus ? ` (${normalizedStatus})` : ''}`;
  }
  if (normalizedStatus === 'CREATE_FAILED') {
    return `Create failed${item.metaTemplateError ? `: ${item.metaTemplateError}` : ''}`;
  }
  if (normalizedStatus === 'REJECTED') {
    return `Rejected${item.metaTemplateError ? `: ${item.metaTemplateError}` : ''}`;
  }
  if (normalizedStatus === 'PENDING') {
    return 'Meta review pending';
  }
  if (normalizedStatus === 'APPROVED') {
    return 'Meta approved';
  }
  return 'Not created yet';
}

function formatBlastLabel(blast?: { targeted?: number; sent?: number; failed?: number; posterSent?: number; posterFailed?: number; posterMediaAttached?: boolean; pendingTemplateApproval?: boolean } | null) {
  const targeted = Number(blast?.targeted || 0);
  const sent = Number(blast?.sent || 0);
  const failed = Number(blast?.failed || 0);
  const posterSent = Number(blast?.posterSent || 0);
  const posterFailed = Number(blast?.posterFailed || 0);

  if (!targeted) {
    if (blast?.posterMediaAttached) {
      return 'Vacancy card ready for outgoing updates';
    }
    return blast?.pendingTemplateApproval ? 'Candidate update waiting on Meta review' : 'Candidate update not triggered yet';
  }

  const parts = [`${sent}/${targeted} sent`];
  if (failed) parts.push(`${failed} failed`);
  if (posterSent) parts.push(`${posterSent} cards`);
  if (posterFailed) parts.push(`${posterFailed} card failed`);
  if (blast?.pendingTemplateApproval) parts.push('Meta review pending');
  return parts.join(' · ');
}

function mapRealtimeCollection<T>(raw: Record<string, any> | null | undefined): T[] {
  return Object.entries(raw || {}).map(([id, value]) => ({
    id,
    ...(value || {}),
  })) as T[];
}

function sortByNewest<T extends { updatedAt?: string; createdAt?: string; timestamp?: string }>(items: T[]) {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.updatedAt || a.createdAt || a.timestamp || 0).getTime();
    const bTime = new Date(b.updatedAt || b.createdAt || b.timestamp || 0).getTime();
    return bTime - aTime;
  });
}

function buildOfficialVacancies(vacancies: OfficialVacancy[], queue: QueueItem[]) {
  const queueByApprovedVacancyId = new Map(
    queue.filter((item) => item.approvedVacancyId).map((item) => [item.approvedVacancyId, item]),
  );

  return sortByNewest(vacancies).map((vacancy) => ({
    ...vacancy,
    sourceQueue: queueByApprovedVacancyId.get(vacancy.id) || vacancy.sourceQueue || null,
  }));
}

export default function VacancyFeed() {
  const [agencyInbox, setAgencyInbox] = useState<AgencyInboxItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [officialVacancies, setOfficialVacancies] = useState<OfficialVacancy[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDemands = useCallback(async (withLoader = false) => {
    if (withLoader) setLoading(true);

    try {
      const data = await getAgencyDemands();
      startTransition(() => {
        setAgencyInbox(sortByNewest(data.agencyInbox || []));
        setQueue(sortByNewest(data.queue || []));
        setOfficialVacancies(buildOfficialVacancies(data.officialVacancies || [], data.queue || []));
        setLoading(false);
      });
    } catch {
      startTransition(() => {
        setAgencyInbox([]);
        setQueue([]);
        setOfficialVacancies([]);
        setLoading(false);
      });
    }
  }, []);

  useEffect(() => {
    if (!hasFirebaseConfig || !db) {
      fetchDemands(true);
      return;
    }

    setLoading(true);

    let inboxItems: AgencyInboxItem[] = [];
    let queueItems: QueueItem[] = [];
    let vacancyItems: OfficialVacancy[] = [];

    const syncState = () => {
      startTransition(() => {
        setAgencyInbox(sortByNewest(inboxItems));
        setQueue(sortByNewest(queueItems));
        setOfficialVacancies(buildOfficialVacancies(vacancyItems, queueItems));
        setLoading(false);
      });
    };

    const inboxUnsubscribe = onValue(ref(db, 'agency_inbox'), (snapshot) => {
      inboxItems = mapRealtimeCollection<AgencyInboxItem>(snapshot.val());
      syncState();
    }, () => fetchDemands(true));

    const queueUnsubscribe = onValue(ref(db, 'agency_queue'), (snapshot) => {
      queueItems = mapRealtimeCollection<QueueItem>(snapshot.val());
      syncState();
    }, () => fetchDemands(true));

    const vacanciesUnsubscribe = onValue(ref(db, 'vacancies'), (snapshot) => {
      vacancyItems = mapRealtimeCollection<OfficialVacancy>(snapshot.val());
      syncState();
    }, () => fetchDemands(true));

    return () => {
      inboxUnsubscribe();
      queueUnsubscribe();
      vacanciesUnsubscribe();
    };
  }, [fetchDemands]);

  const reviewQueue = queue.filter((item) => {
    const normalizedTemplateStatus = String(item.metaTemplateStatus || '').trim().toUpperCase();
    return (
      !item.approvedVacancyId
      || Boolean(item.draftNeedsSubmission)
      || item.status === 'pending_approval'
      || item.status === 'processing'
      || item.status === 'template_retry_required'
      || item.status === 'meta_rejected'
      || normalizedTemplateStatus === 'REJECTED'
      || normalizedTemplateStatus === 'CREATE_FAILED'
    );
  });
  const isInitialLoading = loading && agencyInbox.length === 0 && queue.length === 0 && officialVacancies.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '16px', borderBottom: '1px solid rgba(56,189,248,0.1)', background: 'rgba(11,17,32,0.45)' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'white', display: 'flex', justifyContent: 'space-between' }}>
          <span>Agency Demands</span>
          <span style={{ color: '#38bdf8', fontSize: 11 }}>{agencyInbox.length} inbox · {officialVacancies.length} live</span>
        </h3>
        <p style={{ margin: '6px 0 0', color: '#64748b', fontSize: 11 }}>
          Raw agency message, local review queue, blast template recommendation, aur live vacancy status sab yahin visible rahenge.
        </p>
        <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: 10 }}>
          Meta Manager mein wahi template dikhega jo actual Meta create request se submit hua ho. Dashboard ab uska real status alag dikhata hai.
        </p>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isInitialLoading ? (
          <div style={{ textAlign: 'center', padding: 20 }}>
            <div className="spinner-small" />
          </div>
        ) : (
          <>
            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#86efac', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Live Agency Inbox
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{agencyInbox.length} open</div>
              </div>

              {agencyInbox.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '1px dashed rgba(56,189,248,0.12)', color: '#64748b', fontSize: 12 }}>
                  Agency-marked numbers se aane wali latest raw vacancy yahan dikh rahi hogi.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {agencyInbox.map((item) => (
                    <div key={item.id} className="glass-card animate-fade-in" style={{ padding: 12, border: '1px solid rgba(34,197,94,0.14)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                        <div>
                          <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{item.agencyName || item.phone || 'Agency Contact'}</div>
                          <div style={{ color: '#64748b', fontSize: 10 }}>{item.phone || 'No number'}</div>
                        </div>
                        <div style={{ color: '#86efac', fontSize: 10, fontWeight: 700 }}>LIVE</div>
                      </div>
                      <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 10 }}>
                        {item.inquiryText || 'No raw text yet.'}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                        {item.skill && <span style={{ fontSize: 10, color: '#38bdf8', background: 'rgba(56,189,248,0.08)', borderRadius: 999, padding: '3px 8px' }}>{item.skill}</span>}
                        {item.country && <span style={{ fontSize: 10, color: '#cbd5e1', background: 'rgba(148,163,184,0.08)', borderRadius: 999, padding: '3px 8px' }}>{item.country}</span>}
                        {item.salary && <span style={{ fontSize: 10, color: '#f8fafc', background: 'rgba(15,23,42,0.65)', borderRadius: 999, padding: '3px 8px' }}>{item.salary}</span>}
                        {item.serviceCharge && <span style={{ fontSize: 10, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', borderRadius: 999, padding: '3px 8px' }}>SC {item.serviceCharge}</span>}
                      </div>
                      <div style={{ fontSize: 10, color: '#64748b' }}>Updated {formatTime(item.updatedAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#fbbf24', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Local Review Queue
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{reviewQueue.length} pending</div>
              </div>

              {reviewQueue.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '1px dashed rgba(56,189,248,0.12)', color: '#64748b', fontSize: 12 }}>
                  Local review queue abhi empty hai.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {reviewQueue.map((item) => {
                    const extracted = getExtracted(item);
                    return (
                      <div key={item.id} className="glass-card animate-fade-in" style={{ padding: 12, border: '1px solid rgba(251,191,36,0.16)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                          <div>
                            <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{item.agencyName || 'Manual upload'}</div>
                            <div style={{ color: '#64748b', fontSize: 10 }}>{formatTime(item.createdAt || item.timestamp)}</div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>
                              Blast: {item.assignedTemplateName || 'Not assigned'}
                            </div>
                            <div style={{ fontSize: 10, color: '#fbbf24', marginTop: 2 }}>
                              Meta: {getMetaTemplateLabel(item)}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                              Reach: {formatBlastLabel(item.blastResult)}
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>
                          {extracted.skill || 'General'} · {extracted.country || 'Gulf'} · {extracted.salary || 'Salary pending'}
                        </div>
                        <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                          {renderOriginalText(item)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#38bdf8', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Live Vacancies
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>{officialVacancies.length} active</div>
              </div>

              {officialVacancies.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 18, borderRadius: 12, border: '1px dashed rgba(56,189,248,0.12)', color: '#64748b', fontSize: 12 }}>
                  Live vacancies abhi available nahi hain.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {officialVacancies.map((vacancy) => {
                    const original = vacancy.sourceQueue;
                    const extracted = getExtracted(original);
                    return (
                      <div key={vacancy.id} className="glass-card animate-fade-in" style={{ padding: 12, border: '1px solid rgba(56,189,248,0.12)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                          <div>
                            <div style={{ color: 'white', fontSize: 13, fontWeight: 700 }}>{vacancy.skill || 'General'}</div>
                            <div style={{ color: '#94a3b8', fontSize: 11 }}>
                              {COUNTRY_FLAGS[vacancy.country || ''] || 'GLF'} {vacancy.country || 'Gulf'} · {formatTime(vacancy.createdAt)}
                            </div>
                          </div>
                          <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: 10, color: '#10b981', fontWeight: 700 }}>
                              Blast: {vacancy.assignedTemplateName || original?.assignedTemplateName || 'Not assigned'}
                            </div>
                            <div style={{ fontSize: 10, color: '#38bdf8', fontWeight: 700, marginTop: 2 }}>
                              Meta: {getMetaTemplateLabel(vacancy)}
                            </div>
                            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                              Reach: {formatBlastLabel(vacancy.blastResult || original?.blastResult)}
                            </div>
                            <div style={{ fontSize: 10, color: '#10b981', marginTop: 2 }}>{vacancy.status || 'active'}</div>
                          </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                          <div style={{ background: 'rgba(15,23,42,0.55)', borderRadius: 8, padding: 8 }}>
                            <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>Service Charge</div>
                            <div style={{ fontSize: 12, color: '#e2e8f0' }}>
                              {vacancy.serviceCharge || extracted.serviceCharge || (vacancy.originalCharge ? `PKR ${Number(vacancy.originalCharge || 0).toLocaleString()}` : 'Pending')}
                            </div>
                          </div>
                          <div style={{ background: 'rgba(56,189,248,0.08)', borderRadius: 8, padding: 8 }}>
                            <div style={{ fontSize: 10, color: '#38bdf8', marginBottom: 3 }}>Offer / Salary</div>
                            <div style={{ fontSize: 12, color: '#38bdf8', fontWeight: 700 }}>
                              {vacancy.salary || extracted.salary || (vacancy.candidatePrice ? `PKR ${Number(vacancy.candidatePrice || 0).toLocaleString()}` : 'Pending')}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          <div style={{ background: 'rgba(15,23,42,0.45)', borderRadius: 8, padding: 10 }}>
                            <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                              Raw Agency Form
                            </div>
                            <div style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.5 }}>
                              {renderOriginalText(original)}
                            </div>
                          </div>

                          <div style={{ background: 'rgba(56,189,248,0.06)', borderRadius: 8, padding: 10, border: '1px solid rgba(56,189,248,0.1)' }}>
                            <div style={{ fontSize: 10, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
                              Recruiter Summary
                            </div>
                            <div style={{ fontSize: 11, color: '#cbd5e1', lineHeight: 1.6 }}>
                              Skill: {vacancy.skill || extracted.skill || 'General'}
                              <br />
                              Country: {vacancy.country || extracted.country || 'Gulf'}
                              <br />
                              Salary / Offer: {vacancy.salary || extracted.salary || (vacancy.candidatePrice ? `PKR ${Number(vacancy.candidatePrice).toLocaleString()}` : 'Pending')}
                              <br />
                              Recommended Blast Template: {vacancy.assignedTemplateName || original?.assignedTemplateName || 'Not selected'}
                              <br />
                              Actual Meta Review Template: {getMetaTemplateLabel(vacancy)}
                              <br />
                              Candidate Updates: {formatBlastLabel(vacancy.blastResult || original?.blastResult)}
                              <br />
                              Vacancy Card: {vacancy.imageMediaId || original?.imageMediaId ? 'Generated and attached with outgoing updates' : 'Not generated yet'}
                            </div>
                          </div>

                          <div style={{ fontSize: 10, color: '#64748b' }}>
                            Dashboard conversion aur Meta template review alag workflows hain. Meta Manager mein wahi item dikhega jo actual Meta template create request se gaya ho.
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}
