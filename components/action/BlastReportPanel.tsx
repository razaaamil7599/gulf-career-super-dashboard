'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getLatestBlastReport, getMessageHistory } from '@/lib/api';

interface BlastReportTarget {
  candidateId: string;
  name: string;
  phone: string;
  skill: string;
  country: string;
  candidateStatus: string;
  unreadCount: number;
  outboundAt: string;
  status: string;
  deliveryBucket: string;
  replied: boolean;
  replyCount: number;
  firstReplyAt: string;
  replyPreview: string;
  lastInboundAt: string;
}

interface BlastReportData {
  label: string;
  body: string;
  startedAt: string;
  finishedAt: string;
  summary: {
    targeted: number;
    received: number;
    delivered: number;
    read: number;
    replied: number;
    sentOnly: number;
    failed: number;
  };
  allTargets: BlastReportTarget[];
  receivedTargets: BlastReportTarget[];
  repliedTargets: BlastReportTarget[];
  sentOnlyTargets: BlastReportTarget[];
  failedTargets: BlastReportTarget[];
}

interface BlastHistoryMessage {
  id: string;
  body: string;
  direction: string;
  status: string;
  error: string;
  timestamp: string;
  type: string;
}

type ReportBucketKey = 'targeted' | 'received' | 'replied' | 'pending' | 'failed';

function formatTime(value = '') {
  if (!value) {
    return 'Unknown time';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Unknown time';
  }

  return date.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatStatusLabel(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (!normalized) {
    return 'unknown';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function getStatusBadgeColor(status = '') {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'read') {
    return { background: 'rgba(56,189,248,0.14)', color: '#7dd3fc' };
  }
  if (normalized === 'delivered') {
    return { background: 'rgba(34,197,94,0.14)', color: '#86efac' };
  }
  if (normalized === 'sent') {
    return { background: 'rgba(250,204,21,0.14)', color: '#fde68a' };
  }
  if (normalized === 'failed') {
    return { background: 'rgba(248,113,113,0.14)', color: '#fecaca' };
  }
  return { background: 'rgba(148,163,184,0.14)', color: '#cbd5e1' };
}

function getTargetKey(target: BlastReportTarget | null) {
  if (!target) {
    return '';
  }
  return `${target.phone}-${target.outboundAt}`;
}

function parseHistoryMessages(data: any): BlastHistoryMessage[] {
  if (!data || typeof data !== 'object') {
    return [];
  }

  return Object.entries(data)
    .map(([id, value]: [string, any]) => ({
      id,
      body: String(value?.body || value?.text || '').trim(),
      direction: String(value?.direction || ''),
      status: String(value?.status || ''),
      error: String(value?.error || ''),
      timestamp: String(value?.timestamp || value?.status_at || ''),
      type: String(value?.type || 'text'),
    }))
    .sort((left, right) => new Date(left.timestamp || 0).getTime() - new Date(right.timestamp || 0).getTime());
}

function buildFallbackBody(message: BlastHistoryMessage) {
  if (message.body) {
    return message.body;
  }
  if (message.type && message.type !== 'text') {
    return `[${message.type.toUpperCase()}]`;
  }
  return '[Empty message]';
}

function findBlastIndex(messages: BlastHistoryMessage[], target: BlastReportTarget) {
  const outboundMs = new Date(target.outboundAt || '').getTime();
  if (!Number.isFinite(outboundMs)) {
    return -1;
  }

  const exactIndex = messages.findIndex((message) => (
    message.direction === 'outbound'
    && new Date(message.timestamp || '').getTime() === outboundMs
  ));

  if (exactIndex >= 0) {
    return exactIndex;
  }

  let bestIndex = -1;
  let bestGap = Number.POSITIVE_INFINITY;

  messages.forEach((message, index) => {
    if (message.direction !== 'outbound') {
      return;
    }

    const messageMs = new Date(message.timestamp || '').getTime();
    const gap = Math.abs(messageMs - outboundMs);
    if (gap < bestGap) {
      bestGap = gap;
      bestIndex = index;
    }
  });

  return bestGap <= 5 * 60 * 1000 ? bestIndex : -1;
}

function buildIssueText(target: BlastReportTarget, blastMessage: BlastHistoryMessage | null) {
  if (target.status === 'failed') {
    return blastMessage?.error || 'Meta ne is broadcast ko deliver nahin kiya.';
  }
  if (target.status === 'sent') {
    return 'Message send ho chuka hai, lekin delivered ya read ka final webhook abhi nahin aaya.';
  }
  if (target.replied) {
    return `${target.replyCount} reply mila. Neeche actual conversation dekh sakte ho.`;
  }
  if (target.status === 'read') {
    return 'Candidate ne message read kar liya hai.';
  }
  if (target.status === 'delivered') {
    return 'Message candidate tak pahunch gaya hai.';
  }
  return 'Latest status available hai, neeche detail dekh sakte ho.';
}

function getBucketConfig(report: BlastReportData | null) {
  if (!report) {
    return null;
  }

  return {
    targeted: {
      label: 'Targeted',
      value: report.summary.targeted,
      color: '#38bdf8',
      targets: report.allTargets,
      subtitle: 'Sab numbers jinko blast target kiya gaya',
      emptyText: 'Target list available nahin hai.',
    },
    received: {
      label: 'Received',
      value: report.summary.received,
      color: '#86efac',
      targets: report.receivedTargets,
      subtitle: `${report.summary.read} read`,
      emptyText: 'Delivered ya read confirmation abhi available nahin hai.',
    },
    replied: {
      label: 'Replied',
      value: report.summary.replied,
      color: '#facc15',
      targets: report.repliedTargets,
      subtitle: 'Blast ke baad inbound reply aaya',
      emptyText: 'Abhi kisi target ka reply detect nahin hua.',
    },
    pending: {
      label: 'Pending',
      value: report.summary.sentOnly,
      color: '#cbd5e1',
      targets: report.sentOnlyTargets,
      subtitle: 'Sent hai, final delivery webhook pending hai',
      emptyText: 'Pending delivery wala number abhi nahin hai.',
    },
    failed: {
      label: 'Failed',
      value: report.summary.failed,
      color: '#fca5a5',
      targets: report.failedTargets,
      subtitle: 'Delivery fail hui ya Meta ne रोक दिया',
      emptyText: 'Failed target abhi nahin hai.',
    },
  } as const;
}

export default function BlastReportPanel() {
  const [report, setReport] = useState<BlastReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeBucket, setActiveBucket] = useState<ReportBucketKey>('targeted');
  const [selectedTargetKey, setSelectedTargetKey] = useState('');
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailMessages, setDetailMessages] = useState<BlastHistoryMessage[]>([]);
  const [detailIssue, setDetailIssue] = useState('');

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await getLatestBlastReport(168, 20);
      setReport(response?.report || null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Blast report load nahin ho paya.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();

    const handleRefresh = () => {
      loadReport();
    };

    window.addEventListener('dashboard:blast-updated', handleRefresh);
    const interval = window.setInterval(loadReport, 60000);

    return () => {
      window.removeEventListener('dashboard:blast-updated', handleRefresh);
      window.clearInterval(interval);
    };
  }, [loadReport]);

  const bucketConfig = useMemo(() => getBucketConfig(report), [report]);

  const summaryCards = useMemo(() => {
    if (!bucketConfig) {
      return [];
    }

    return (Object.keys(bucketConfig) as ReportBucketKey[]).map((key) => ({
      key,
      ...bucketConfig[key],
    }));
  }, [bucketConfig]);

  const activeTargets = useMemo(() => {
    if (!bucketConfig) {
      return [];
    }
    return bucketConfig[activeBucket].targets;
  }, [bucketConfig, activeBucket]);

  useEffect(() => {
    if (!activeTargets.length) {
      setSelectedTargetKey('');
      return;
    }

    const hasCurrent = activeTargets.some((target) => getTargetKey(target) === selectedTargetKey);
    if (!hasCurrent) {
      setSelectedTargetKey(getTargetKey(activeTargets[0]));
    }
  }, [activeTargets, selectedTargetKey]);

  const selectedTarget = useMemo(
    () => activeTargets.find((target) => getTargetKey(target) === selectedTargetKey) || null,
    [activeTargets, selectedTargetKey],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadTargetHistory() {
      if (!selectedTarget) {
        setDetailMessages([]);
        setDetailIssue('');
        setDetailError('');
        return;
      }

      try {
        setDetailLoading(true);
        setDetailError('');

        const response = await getMessageHistory(selectedTarget.phone);
        const parsedMessages = parseHistoryMessages(response?.messages || {});
        const blastIndex = findBlastIndex(parsedMessages, selectedTarget);
        const blastMessage = blastIndex >= 0 ? parsedMessages[blastIndex] : null;
        const startIndex = blastIndex >= 0 ? Math.max(0, blastIndex - 4) : Math.max(0, parsedMessages.length - 12);
        const endIndex = blastIndex >= 0
          ? Math.min(parsedMessages.length, blastIndex + 12)
          : parsedMessages.length;
        const windowMessages = parsedMessages.slice(startIndex, endIndex);

        if (!cancelled) {
          setDetailMessages(windowMessages);
          setDetailIssue(buildIssueText(selectedTarget, blastMessage));
        }
      } catch (loadDetailError) {
        if (!cancelled) {
          setDetailMessages([]);
          setDetailIssue('');
          setDetailError(loadDetailError instanceof Error ? loadDetailError.message : 'Conversation detail load nahin ho paya.');
        }
      } finally {
        if (!cancelled) {
          setDetailLoading(false);
        }
      }
    }

    loadTargetHistory();

    return () => {
      cancelled = true;
    };
  }, [selectedTarget]);

  return (
    <section
      style={{
        border: '1px solid rgba(56,189,248,0.16)',
        borderRadius: 16,
        padding: 18,
        background: 'rgba(15,23,42,0.72)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ color: '#f8fafc', fontSize: 18, fontWeight: 800 }}>Latest Bulk Report</div>
          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>
            Card par click karke us bucket ki number list aur chat detail dekho.
          </div>
        </div>
        <button
          onClick={loadReport}
          style={{
            border: '1px solid rgba(56,189,248,0.22)',
            background: 'rgba(15,23,42,0.88)',
            color: '#7dd3fc',
            borderRadius: 10,
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Refresh
        </button>
      </div>

      {loading && !report ? (
        <div style={{ color: '#64748b', fontSize: 12 }}>Blast report load ho raha hai...</div>
      ) : error ? (
        <div style={{ color: '#fecaca', fontSize: 12 }}>{error}</div>
      ) : !report || !bucketConfig ? (
        <div style={{ color: '#64748b', fontSize: 12 }}>Recent bulk broadcast nahin mila.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ color: '#e2e8f0', fontSize: 13, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{report.label}</div>
            <div style={{ color: '#64748b', marginTop: 4 }}>
              {formatTime(report.startedAt)} to {formatTime(report.finishedAt)}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', gap: 10 }}>
            {summaryCards.map((card) => {
              const isActive = activeBucket === card.key;

              return (
                <button
                  key={card.key}
                  type="button"
                  onClick={() => setActiveBucket(card.key)}
                  style={{
                    borderRadius: 12,
                    padding: 12,
                    background: isActive ? 'rgba(8,47,73,0.92)' : 'rgba(2,6,23,0.56)',
                    border: isActive ? `1px solid ${card.color}` : '1px solid rgba(56,189,248,0.08)',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ color: '#64748b', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {card.label}
                  </div>
                  <div style={{ color: card.color, fontSize: 28, fontWeight: 800, marginTop: 6 }}>
                    {card.value}
                  </div>
                </button>
              );
            })}
          </div>

          <div
            style={{
              border: '1px solid rgba(56,189,248,0.12)',
              borderRadius: 14,
              background: 'rgba(15,23,42,0.72)',
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
              <div>
                <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 800 }}>
                  {bucketConfig[activeBucket].label} List ({activeTargets.length})
                </div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                  {bucketConfig[activeBucket].subtitle}
                </div>
              </div>
              <div style={{ color: '#64748b', fontSize: 11 }}>
                Click number to open detail
              </div>
            </div>

            {activeTargets.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12, padding: '8px 0' }}>
                {bucketConfig[activeBucket].emptyText}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto', paddingRight: 4 }}>
                {activeTargets.map((target) => {
                  const badgeColors = getStatusBadgeColor(target.status);
                  const isSelected = getTargetKey(target) === selectedTargetKey;

                  return (
                    <button
                      key={getTargetKey(target)}
                      type="button"
                      onClick={() => setSelectedTargetKey(getTargetKey(target))}
                      style={{
                        borderRadius: 12,
                        padding: 12,
                        background: isSelected ? 'rgba(8,47,73,0.78)' : 'rgba(2,6,23,0.56)',
                        border: isSelected ? '1px solid rgba(56,189,248,0.42)' : '1px solid rgba(56,189,248,0.08)',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700, overflowWrap: 'anywhere' }}>
                            {target.name || target.phone}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 11 }}>{target.phone}</div>
                        </div>
                        <div
                          style={{
                            padding: '4px 9px',
                            borderRadius: 999,
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            textTransform: 'uppercase',
                            background: badgeColors.background,
                            color: badgeColors.color,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {formatStatusLabel(target.status)}
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                        <span style={{ fontSize: 10, color: '#38bdf8', background: 'rgba(56,189,248,0.08)', borderRadius: 999, padding: '3px 8px' }}>
                          {target.skill || 'Unspecified'}
                        </span>
                        <span style={{ fontSize: 10, color: '#cbd5e1', background: 'rgba(148,163,184,0.08)', borderRadius: 999, padding: '3px 8px' }}>
                          {target.country || 'Unspecified'}
                        </span>
                        {target.replied && (
                          <span style={{ fontSize: 10, color: '#86efac', background: 'rgba(34,197,94,0.12)', borderRadius: 999, padding: '3px 8px' }}>
                            {target.replyCount} reply
                          </span>
                        )}
                        {!!target.unreadCount && (
                          <span style={{ fontSize: 10, color: '#facc15', background: 'rgba(250,204,21,0.12)', borderRadius: 999, padding: '3px 8px' }}>
                            {target.unreadCount} unread
                          </span>
                        )}
                      </div>

                      <div style={{ color: '#64748b', fontSize: 10, marginTop: 10 }}>
                        Sent {formatTime(target.outboundAt)}
                        {target.firstReplyAt ? ` - First reply ${formatTime(target.firstReplyAt)}` : ''}
                      </div>

                      {target.replyPreview && (
                        <div
                          style={{
                            marginTop: 8,
                            color: '#cbd5e1',
                            fontSize: 12,
                            lineHeight: 1.5,
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {target.replyPreview}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div
            style={{
              border: '1px solid rgba(56,189,248,0.12)',
              borderRadius: 14,
              background: 'rgba(15,23,42,0.72)',
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
              <div>
                <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 800 }}>
                  {selectedTarget ? `${selectedTarget.name || selectedTarget.phone} Detail` : 'Target Detail'}
                </div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                  {selectedTarget ? selectedTarget.phone : 'List se number select karo'}
                </div>
              </div>
              {selectedTarget && (
                <div style={{ color: '#64748b', fontSize: 11 }}>
                  {formatStatusLabel(selectedTarget.status)}
                </div>
              )}
            </div>

            {!selectedTarget ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>Number select karoge to yahin uski detail aur chat dikhegi.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: '#38bdf8', background: 'rgba(56,189,248,0.08)', borderRadius: 999, padding: '4px 8px' }}>
                    Skill: {selectedTarget.skill || 'Unspecified'}
                  </span>
                  <span style={{ fontSize: 10, color: '#cbd5e1', background: 'rgba(148,163,184,0.08)', borderRadius: 999, padding: '4px 8px' }}>
                    Country: {selectedTarget.country || 'Unspecified'}
                  </span>
                  {selectedTarget.candidateStatus && (
                    <span style={{ fontSize: 10, color: '#f8fafc', background: 'rgba(71,85,105,0.28)', borderRadius: 999, padding: '4px 8px' }}>
                      Candidate: {selectedTarget.candidateStatus}
                    </span>
                  )}
                </div>

                <div
                  style={{
                    borderRadius: 12,
                    padding: 12,
                    background: selectedTarget.status === 'failed' ? 'rgba(127,29,29,0.24)' : 'rgba(2,6,23,0.56)',
                    border: selectedTarget.status === 'failed'
                      ? '1px solid rgba(248,113,113,0.28)'
                      : '1px solid rgba(56,189,248,0.08)',
                  }}
                >
                  <div style={{ color: '#f8fafc', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                    Status Update
                  </div>
                  <div style={{ color: selectedTarget.status === 'failed' ? '#fecaca' : '#cbd5e1', fontSize: 12, lineHeight: 1.6 }}>
                    {detailIssue || 'Latest update load ho rahi hai...'}
                  </div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 8 }}>
                    Blast sent {formatTime(selectedTarget.outboundAt)}
                    {selectedTarget.firstReplyAt ? ` - First reply ${formatTime(selectedTarget.firstReplyAt)}` : ''}
                    {selectedTarget.lastInboundAt ? ` - Last inbound ${formatTime(selectedTarget.lastInboundAt)}` : ''}
                  </div>
                </div>

                {detailLoading ? (
                  <div style={{ color: '#64748b', fontSize: 12 }}>Conversation detail load ho rahi hai...</div>
                ) : detailError ? (
                  <div style={{ color: '#fecaca', fontSize: 12 }}>{detailError}</div>
                ) : detailMessages.length === 0 ? (
                  <div style={{ color: '#64748b', fontSize: 12 }}>Is number ki chat history abhi available nahin hai.</div>
                ) : (
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 10,
                      maxHeight: 360,
                      overflowY: 'auto',
                      paddingRight: 4,
                    }}
                  >
                    {detailMessages.map((message) => {
                      const outgoing = message.direction === 'outbound';
                      const badgeColors = getStatusBadgeColor(message.status);

                      return (
                        <div
                          key={message.id}
                          style={{
                            display: 'flex',
                            justifyContent: outgoing ? 'flex-end' : 'flex-start',
                          }}
                        >
                          <div
                            style={{
                              width: 'min(100%, 320px)',
                              borderRadius: 14,
                              padding: 12,
                              background: outgoing ? 'rgba(8,47,73,0.88)' : 'rgba(30,41,59,0.78)',
                              border: '1px solid rgba(56,189,248,0.12)',
                            }}
                          >
                            <div style={{ color: '#f8fafc', fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere' }}>
                              {buildFallbackBody(message)}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginTop: 8 }}>
                              <div style={{ color: '#64748b', fontSize: 10 }}>
                                {outgoing ? 'Sent' : 'Reply'} {formatTime(message.timestamp)}
                              </div>
                              {outgoing && (
                                <div
                                  style={{
                                    padding: '3px 8px',
                                    borderRadius: 999,
                                    fontSize: 10,
                                    fontWeight: 700,
                                    background: badgeColors.background,
                                    color: badgeColors.color,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {formatStatusLabel(message.status)}
                                </div>
                              )}
                            </div>

                            {message.error && (
                              <div style={{ color: '#fecaca', fontSize: 11, marginTop: 8, lineHeight: 1.5 }}>
                                {message.error}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
