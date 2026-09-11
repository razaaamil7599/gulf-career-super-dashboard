'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { blastWhatsApp, deleteTemplate, getTemplates } from '@/lib/api';
import BlastReportPanel from './BlastReportPanel';
import {
  BLAST_PRESETS,
  REPROFILE_BLAST_MESSAGE,
  REPROFILE_OFFICIAL_TEMPLATE,
  VACANCY_BLAST_MESSAGE,
} from '@/lib/blastPresets';
import type { BlastPresetId } from '@/lib/blastPresets';

type CandidateStatus = 'clean' | 'pending_update' | 'pending_re-profiling';
type ComposerMode = 'custom' | 'official';

interface CandidateSummary {
  id: string;
  name: string;
  phone: string;
  skill: string;
  country: string;
  status: CandidateStatus;
  leadStatus?: string;
  unreadCount?: number;
  excludeFromBlast?: boolean;
  notes?: string;
}

interface MetaTemplateSummary {
  id: string;
  metaId?: string;
  name: string;
  language: string;
  status: string;
  category: string;
  paramCount: number;
  text: string;
  paramLabels: string[];
}

interface BlastFailureTarget {
  name: string;
  phone: string;
  reason: string;
}

interface BlastResult {
  success?: boolean;
  targeted: number;
  sent: number;
  failed: number;
  duplicatesSkipped?: number;
  failureReasons?: Record<string, number>;
  failedTargets?: BlastFailureTarget[];
}

interface ActionCenterProps {
  selectedCount: number;
  selectedIds: string[];
  selectedCandidates: CandidateSummary[];
  visibleCandidateIds: string[];
  activeSkill: string;
  activeCountry: string;
  onClearSelection: () => void;
  onReplaceSelection: (ids: string[]) => void;
}

function parseManualNumbers(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  );
}

function isApproved(status = '') {
  return String(status).toUpperCase() === 'APPROVED';
}

function getPresetMessage(presetId: BlastPresetId) {
  return presetId === 'reprofile' ? REPROFILE_BLAST_MESSAGE : VACANCY_BLAST_MESSAGE;
}

function createVariableDraft(template: MetaTemplateSummary | null) {
  const count = template?.paramCount || template?.paramLabels?.length || 0;
  return Array.from({ length: count }, () => '');
}

function getRequestErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { error?: string } } }).response;
    if (response?.data?.error) {
      return response.data.error;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

function normalizeTemplateList(value: unknown): MetaTemplateSummary[] {
  const nextTemplates: unknown[] = Array.isArray((value as { templates?: unknown[] })?.templates)
    ? (value as { templates: unknown[] }).templates
    : Array.isArray(value)
      ? value
      : [];

  return nextTemplates
    .filter((template): template is MetaTemplateSummary => {
      if (!template || typeof template !== 'object') {
        return false;
      }

      const candidate = template as Partial<MetaTemplateSummary>;
      return typeof candidate.name === 'string' && candidate.name.length > 0;
    })
    .sort((left, right) => Number(isApproved(right.status)) - Number(isApproved(left.status)));
}

export default function ActionCenter({
  selectedCount,
  selectedIds,
  selectedCandidates,
  visibleCandidateIds,
  activeSkill,
  activeCountry,
  onClearSelection,
  onReplaceSelection,
}: ActionCenterProps) {
  const [composerMode, setComposerMode] = useState<ComposerMode>('custom');
  const [selectedPreset, setSelectedPreset] = useState<BlastPresetId>('vacancy');
  const [customTemplate, setCustomTemplate] = useState(VACANCY_BLAST_MESSAGE);
  const [manualNumbersText, setManualNumbersText] = useState('');
  const [quickPickCount, setQuickPickCount] = useState('25');
  const [availableTemplates, setAvailableTemplates] = useState<MetaTemplateSummary[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [templateManagerSelection, setTemplateManagerSelection] = useState('');
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState(false);
  const [blasting, setBlasting] = useState(false);
  const [result, setResult] = useState<BlastResult | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selectedTemplateRef = useRef(selectedTemplate);
  const templateManagerSelectionRef = useRef(templateManagerSelection);
  const autoPresetAppliedRef = useRef(false);

  const manualNumbers = useMemo(() => parseManualNumbers(manualNumbersText), [manualNumbersText]);
  const activeTemplate = useMemo(
    () => availableTemplates.find((template) => template.name === selectedTemplate) ?? null,
    [availableTemplates, selectedTemplate]
  );
  const managedTemplate = useMemo(
    () => availableTemplates.find((template) => template.name === templateManagerSelection) ?? null,
    [availableTemplates, templateManagerSelection]
  );
  const recommendedReprofileTemplate = useMemo(
    () => availableTemplates.find((template) => template.name === REPROFILE_OFFICIAL_TEMPLATE) ?? null,
    [availableTemplates]
  );
  const reprofileCount = selectedCandidates.filter(
    (candidate) => candidate.status === 'pending_re-profiling'
  ).length;

  const excludedCandidatesCount = useMemo(() => {
    if (manualNumbers.length > 0) return 0;
    return selectedCandidates.filter(c => {
      return c.leadStatus === 'blocked' || Boolean(c.excludeFromBlast) || c.status === 'pending_update' || (c.unreadCount && Number(c.unreadCount) > 0);
    }).length;
  }, [selectedCandidates, manualNumbers.length]);

  const effectiveCandidateIds = manualNumbers.length > 0
    ? []
    : selectedIds.length > 0
      ? selectedIds
      : visibleCandidateIds;

  const loadTemplates = useCallback(async (refresh = false) => {
    setLoadingTemplates(true);
    setError('');
    setNotice('');

    try {
      const response = await getTemplates(refresh);
      const normalizedTemplates = normalizeTemplateList(response);

      setAvailableTemplates(normalizedTemplates);

      if (!selectedTemplateRef.current && normalizedTemplates.length > 0) {
        const fallbackTemplate =
          normalizedTemplates.find((template) => template.name === REPROFILE_OFFICIAL_TEMPLATE)
          ?? normalizedTemplates.find((template) => isApproved(template.status))
          ?? normalizedTemplates[0];

        setSelectedTemplate(fallbackTemplate.name);
        setTemplateVariables(createVariableDraft(fallbackTemplate));
      }

      if (!templateManagerSelectionRef.current && normalizedTemplates.length > 0) {
        setTemplateManagerSelection(normalizedTemplates[0].name);
      }
    } catch (loadError) {
      const message = getRequestErrorMessage(loadError, 'Templates load nahin ho paye.');
      setError(message);
    } finally {
      setLoadingTemplates(false);
    }
  }, []);

  const applyPreset = useCallback((presetId: BlastPresetId) => {
    setSelectedPreset(presetId);
    setCustomTemplate(getPresetMessage(presetId));

    if (presetId === 'reprofile' && recommendedReprofileTemplate && isApproved(recommendedReprofileTemplate.status)) {
      setComposerMode('official');
      setSelectedTemplate(recommendedReprofileTemplate.name);
      setTemplateVariables(createVariableDraft(recommendedReprofileTemplate));
    }
  }, [recommendedReprofileTemplate]);

  function handleTemplateChange(templateName: string) {
    setSelectedTemplate(templateName);
    const template = availableTemplates.find((entry) => entry.name === templateName) ?? null;
    setTemplateVariables(createVariableDraft(template));
  }

  function handleQuickPick(count: number | 'all') {
    const nextSelection = count === 'all' ? visibleCandidateIds : visibleCandidateIds.slice(0, count);
    onReplaceSelection(nextSelection);
  }

  async function handleDeleteTemplate() {
    if (!managedTemplate) {
      setError('Delete karne ke liye template select karein.');
      return;
    }

    if (typeof window !== 'undefined' && !window.confirm(`${managedTemplate.name} ko Meta se delete karna hai?`)) {
      return;
    }

    setDeletingTemplate(true);
    setError('');
    setNotice('');

    try {
      const response = await deleteTemplate(managedTemplate.name, managedTemplate.metaId);
      const normalizedTemplates = normalizeTemplateList(response);
      const fallbackApprovedTemplate = normalizedTemplates.find((template) => isApproved(template.status)) ?? null;
      const nextManagedTemplate = normalizedTemplates[0] ?? null;

      setAvailableTemplates(normalizedTemplates);
      setTemplateManagerSelection(nextManagedTemplate?.name || '');

      if (managedTemplate.name === selectedTemplateRef.current) {
        setSelectedTemplate(fallbackApprovedTemplate?.name || '');
        setTemplateVariables(createVariableDraft(fallbackApprovedTemplate));
      }

      setNotice(
        typeof response?.warning === 'string' && response.warning
          ? `${managedTemplate.name}: ${response.warning}`
          : `${managedTemplate.name} dashboard se hata diya gaya hai.`
      );

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dashboard:templates-updated', { detail: { templateName: managedTemplate.name } }));
      }
    } catch (deleteError) {
      const message = getRequestErrorMessage(deleteError, 'Template delete nahin ho paya.');
      setError(message);
    } finally {
      setDeletingTemplate(false);
    }
  }

  async function handleBlast() {
    setError('');
    setResult(null);

    if (manualNumbers.length === 0 && effectiveCandidateIds.length === 0) {
      setError('Blast ke liye candidates ya numbers select karein.');
      return;
    }

    if (composerMode === 'official') {
      if (!selectedTemplate) {
        setError('Official template select karna zaroori hai.');
        return;
      }

      if (activeTemplate && !isApproved(activeTemplate.status)) {
        setError('Approved Meta template hi bulk blast mein bheja ja sakta hai.');
        return;
      }
    } else if (!customTemplate.trim()) {
      setError('Custom message khaali nahin ho sakta.');
      return;
    }

    setBlasting(true);
    try {
      const response = await blastWhatsApp({
        skill: activeSkill || undefined,
        country: activeCountry || undefined,
        messageTemplate: composerMode === 'custom' ? customTemplate : '',
        templateName: composerMode === 'official' ? selectedTemplate : undefined,
        templateVariables: composerMode === 'official' ? templateVariables : undefined,
        candidateIds: manualNumbers.length > 0 ? undefined : effectiveCandidateIds,
        manualNumbers: manualNumbers.length > 0 ? manualNumbers : undefined,
      });

      setResult(response as BlastResult);

      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('dashboard:blast-updated'));
      }
    } catch (blastError) {
      const message = getRequestErrorMessage(blastError, 'Blast fail ho gaya.');
      setError(message);
    } finally {
      setBlasting(false);
    }
  }

  useEffect(() => {
    selectedTemplateRef.current = selectedTemplate;
  }, [selectedTemplate]);

  useEffect(() => {
    templateManagerSelectionRef.current = templateManagerSelection;
  }, [templateManagerSelection]);

  useEffect(() => {
    loadTemplates(false);
  }, [loadTemplates]);

  useEffect(() => {
    if (!activeTemplate) {
      return;
    }

    const nextCount = activeTemplate.paramCount || activeTemplate.paramLabels?.length || 0;
    if (templateVariables.length !== nextCount) {
      setTemplateVariables((current) => {
        const next = createVariableDraft(activeTemplate);
        current.forEach((value, index) => {
          if (index < next.length) {
            next[index] = value;
          }
        });
        return next;
      });
    }
  }, [activeTemplate, templateVariables.length]);

  useEffect(() => {
    const allSelectedNeedReprofile =
      selectedIds.length > 0
      && selectedCandidates.length > 0
      && reprofileCount === selectedCandidates.length;

    if (allSelectedNeedReprofile && !autoPresetAppliedRef.current) {
      applyPreset('reprofile');
      autoPresetAppliedRef.current = true;
      return;
    }

    if (!allSelectedNeedReprofile) {
      autoPresetAppliedRef.current = false;
    }
  }, [applyPreset, reprofileCount, selectedCandidates.length, selectedIds.length]);

  const visibleCount = visibleCandidateIds.length;
  const approvedTemplates = availableTemplates.filter((template) => isApproved(template.status));
  const nonApprovedTemplates = availableTemplates.filter((template) => !isApproved(template.status));
  const nonApprovedTemplateCount = availableTemplates.length - approvedTemplates.length;
  const activeTemplateApproved = activeTemplate ? isApproved(activeTemplate.status) : false;
  const variableLabels = activeTemplate?.paramLabels?.length
    ? activeTemplate.paramLabels
    : templateVariables.map((_, index) => `Value ${index + 1}`);
  const nonApprovedTemplateSummary = nonApprovedTemplates
    .slice(0, 3)
    .map((template) => `${template.name} [${template.status}]`)
    .join(', ');
  const hiddenNonApprovedTemplateCount = Math.max(nonApprovedTemplates.length - 3, 0);

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    if (!activeTemplateApproved && approvedTemplates.length > 0) {
      const fallbackTemplate =
        approvedTemplates.find((template) => template.name === REPROFILE_OFFICIAL_TEMPLATE)
        ?? approvedTemplates[0];

      if (fallbackTemplate && fallbackTemplate.name !== selectedTemplate) {
        setSelectedTemplate(fallbackTemplate.name);
        setTemplateVariables(createVariableDraft(fallbackTemplate));
      }
    }
  }, [activeTemplateApproved, approvedTemplates, selectedTemplate]);

  useEffect(() => {
    if (availableTemplates.length === 0) {
      if (templateManagerSelection) {
        setTemplateManagerSelection('');
      }
      return;
    }

    const exists = availableTemplates.some((template) => template.name === templateManagerSelection);
    if (!exists) {
      setTemplateManagerSelection(availableTemplates[0].name);
    }
  }, [availableTemplates, templateManagerSelection]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 16 }}>
      <section
        style={{
          border: '1px solid rgba(56,189,248,0.16)',
          borderRadius: 16,
          padding: 18,
          background: 'rgba(15,23,42,0.72)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}>
              SELECTION SUMMARY
            </div>
            <div style={{ color: '#38bdf8', fontSize: 42, fontWeight: 800, lineHeight: 1, marginTop: 8 }}>
              {selectedCount || manualNumbers.length || visibleCount}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 16, marginTop: 6 }}>
              {manualNumbers.length > 0 ? 'Manual numbers parsed' : 'Candidates ready for blast'}
            </div>
            {excludedCandidatesCount > 0 && (
              <div style={{ color: '#f59e0b', fontSize: 12, fontWeight: 700, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                ⚠️ {excludedCandidatesCount} blocked, active, or muted candidates will be skipped during broadcast.
              </div>
            )}
          </div>

          {selectedCount > 0 && (
            <button
              onClick={onClearSelection}
              style={{
                border: 'none',
                background: 'none',
                color: '#f87171',
                fontSize: 14,
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Clear
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.12)', color: '#7dd3fc', fontSize: 13 }}>
            Visible: {visibleCount}
          </span>
          <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: '#cbd5e1', fontSize: 13 }}>
            Selected: {selectedCount}
          </span>
          <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: '#86efac', fontSize: 13 }}>
            Approved templates: {approvedTemplates.length}
          </span>
        </div>
      </section>

      <section
        style={{
          border: '1px solid rgba(56,189,248,0.14)',
          borderRadius: 18,
          padding: 18,
          background: 'rgba(15,23,42,0.82)',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: '#22c55e', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 22, fontWeight: 800 }}>
              W
            </div>
            <div>
              <div style={{ color: '#f8fafc', fontSize: 18, fontWeight: 800 }}>WhatsApp Blast</div>
              <div style={{ color: '#94a3b8', fontSize: 13 }}>
                Bulk broadcast ke liye official template ya custom text mode choose karein.
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button
              onClick={() => setComposerMode('custom')}
              style={{
                border: composerMode === 'custom' ? '1px solid rgba(56,189,248,0.9)' : '1px solid rgba(148,163,184,0.18)',
                background: composerMode === 'custom' ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.7)',
                color: composerMode === 'custom' ? '#e0f2fe' : '#cbd5e1',
                borderRadius: 12,
                padding: '10px 14px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Custom Text
            </button>
            <button
              onClick={() => setComposerMode('official')}
              style={{
                border: composerMode === 'official' ? '1px solid rgba(34,197,94,0.85)' : '1px solid rgba(148,163,184,0.18)',
                background: composerMode === 'official' ? 'rgba(34,197,94,0.12)' : 'rgba(15,23,42,0.7)',
                color: composerMode === 'official' ? '#dcfce7' : '#cbd5e1',
                borderRadius: 12,
                padding: '10px 14px',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              Official Meta Template
            </button>
          </div>
        </div>

        <div
          style={{
            border: '1px solid rgba(56,189,248,0.12)',
            borderRadius: 14,
            padding: 14,
            background: 'rgba(30,41,59,0.45)',
          }}
        >
          <div style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
            Category / Location / Number Filter
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#e0f2fe', fontSize: 13 }}>
              Category: {activeSkill || 'All'}
            </span>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#e0f2fe', fontSize: 13 }}>
              Location: {activeCountry || 'All'}
            </span>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#e0f2fe', fontSize: 13 }}>
              Selected: {selectedCount}
            </span>
            <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#e0f2fe', fontSize: 13 }}>
              Visible: {visibleCount}
            </span>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => handleQuickPick(10)} style={{ border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontWeight: 700 }}>
              Pick 10
            </button>
            <button onClick={() => handleQuickPick(50)} style={{ border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontWeight: 700 }}>
              Pick 50
            </button>
            <button onClick={() => handleQuickPick(100)} style={{ border: '1px solid rgba(56,189,248,0.35)', background: 'rgba(56,189,248,0.08)', color: '#38bdf8', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontWeight: 700 }}>
              Pick 100
            </button>
            <button onClick={() => handleQuickPick('all')} style={{ border: '1px solid rgba(250,204,21,0.4)', background: 'rgba(250,204,21,0.08)', color: '#fde68a', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontWeight: 700 }}>
              Pick Visible All
            </button>
            <input
              value={quickPickCount}
              onChange={(event) => setQuickPickCount(event.target.value.replace(/\D/g, ''))}
              placeholder="25"
              style={{
                width: 78,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(148,163,184,0.2)',
                background: 'rgba(15,23,42,0.7)',
                color: '#f8fafc',
                outline: 'none',
              }}
            />
            <button
              onClick={() => handleQuickPick(Math.max(1, Number(quickPickCount || '0')))}
              style={{ border: '1px solid rgba(148,163,184,0.25)', background: 'rgba(15,23,42,0.9)', color: '#e2e8f0', borderRadius: 12, padding: '10px 16px', cursor: 'pointer', fontWeight: 700 }}
            >
              Pick Count
            </button>
          </div>
        </div>

        <div>
          <div style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
            Number-wise blast: comma ya new line se numbers paste karein
          </div>
          <textarea
            value={manualNumbersText}
            onChange={(event) => setManualNumbersText(event.target.value)}
            placeholder="919876543210, 919999999999"
            rows={3}
            style={{
              width: '100%',
              resize: 'vertical',
              background: 'rgba(15,23,42,0.84)',
              border: '1px solid rgba(56,189,248,0.16)',
              borderRadius: 14,
              padding: 14,
              color: '#f8fafc',
              outline: 'none',
              fontSize: 14,
            }}
          />
          {manualNumbers.length > 0 && (
            <div style={{ color: '#86efac', fontSize: 13, marginTop: 8 }}>
              {manualNumbers.length} unique manual numbers ready.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {BLAST_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => applyPreset(preset.id)}
              style={{
                flex: '1 1 180px',
                textAlign: 'left',
                border: selectedPreset === preset.id ? '1px solid rgba(56,189,248,0.75)' : '1px solid rgba(148,163,184,0.15)',
                background: selectedPreset === preset.id ? 'rgba(56,189,248,0.12)' : 'rgba(15,23,42,0.68)',
                borderRadius: 14,
                padding: 14,
                cursor: 'pointer',
              }}
            >
              <div style={{ color: '#f8fafc', fontWeight: 800 }}>{preset.label}</div>
              <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>{preset.description}</div>
            </button>
          ))}
        </div>

        {selectedPreset === 'reprofile' && recommendedReprofileTemplate && (
          <div
            style={{
              border: '1px solid rgba(34,197,94,0.2)',
              borderRadius: 14,
              padding: 14,
              background: 'rgba(20,83,45,0.2)',
              color: '#dcfce7',
            }}
          >
            Re-profile ke liye approved official template ready hai:
            {' '}
            <strong>{recommendedReprofileTemplate.name}</strong>
            . Isi mode se bhejna safest rahega.
          </div>
        )}

        {composerMode === 'official' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                value={selectedTemplate}
                onChange={(event) => handleTemplateChange(event.target.value)}
                style={{
                  flex: 1,
                  minWidth: 240,
                  padding: '12px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(34,197,94,0.28)',
                  background: 'rgba(15,23,42,0.92)',
                  color: '#f8fafc',
                  outline: 'none',
                }}
              >
                <option value="">Select official template</option>
                {approvedTemplates.map((template) => (
                  <option key={template.name} value={template.name}>
                    {template.name} [{template.status}]
                  </option>
                ))}
              </select>

              <button
                onClick={() => loadTemplates(true)}
                disabled={loadingTemplates}
                style={{
                  border: '1px solid rgba(148,163,184,0.2)',
                  background: 'rgba(15,23,42,0.9)',
                  color: '#e2e8f0',
                  borderRadius: 12,
                  padding: '12px 16px',
                  cursor: loadingTemplates ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                  opacity: loadingTemplates ? 0.65 : 1,
                }}
              >
                {loadingTemplates ? 'Refreshing...' : 'Refresh Templates'}
              </button>
            </div>

            {activeTemplate && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(148,163,184,0.12)', color: '#e2e8f0', fontSize: 13 }}>
                  Current template: {activeTemplate.name}
                </span>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: activeTemplateApproved ? 'rgba(34,197,94,0.14)' : 'rgba(250,204,21,0.14)', color: activeTemplateApproved ? '#86efac' : '#fde68a', fontSize: 13 }}>
                  Status: {activeTemplate.status}
                </span>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', fontSize: 13 }}>
                  Category: {activeTemplate.category}
                </span>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', fontSize: 13 }}>
                  Language: {activeTemplate.language}
                </span>
              </div>
            )}

            {nonApprovedTemplateCount > 0 && (
              <div style={{ color: '#fbbf24', fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  {nonApprovedTemplateCount} templates abhi bhi review ya error state mein hain. Bulk picker mein sirf live Meta-approved templates dikh rahe hain.
                </div>
                <div style={{ color: '#fde68a' }}>
                  Non-approved templates: {nonApprovedTemplateSummary}
                  {hiddenNonApprovedTemplateCount > 0 ? ` +${hiddenNonApprovedTemplateCount} aur` : ''}
                </div>
              </div>
            )}

            <div>
              <div style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                Official template body preview
              </div>
              <div style={{ whiteSpace: 'pre-wrap', borderRadius: 14, border: '1px solid rgba(56,189,248,0.16)', background: 'rgba(15,23,42,0.85)', padding: 14, color: '#e2e8f0', minHeight: 110 }}>
                {activeTemplate?.text || 'Approved template choose karte hi body preview yahan dikhega.'}
              </div>
            </div>

            {templateVariables.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {templateVariables.map((value, index) => (
                  <label key={`${selectedTemplate}-${index}`} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <span style={{ color: '#cbd5e1', fontSize: 13, fontWeight: 700 }}>
                      {variableLabels[index] || `Value ${index + 1}`}
                    </span>
                    <input
                      value={value}
                      onChange={(event) => {
                        const next = [...templateVariables];
                        next[index] = event.target.value;
                        setTemplateVariables(next);
                      }}
                      placeholder={`Enter ${variableLabels[index] || `value ${index + 1}`}`}
                      style={{
                        padding: '12px 14px',
                        borderRadius: 12,
                        border: '1px solid rgba(56,189,248,0.16)',
                        background: 'rgba(15,23,42,0.92)',
                        color: '#f8fafc',
                        outline: 'none',
                      }}
                    />
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ color: '#cbd5e1', fontSize: 14, fontWeight: 700 }}>Custom Message Body</div>
            <textarea
              value={customTemplate}
              onChange={(event) => setCustomTemplate(event.target.value)}
              rows={9}
              style={{
                width: '100%',
                resize: 'vertical',
                background: 'rgba(15,23,42,0.84)',
                border: '1px solid rgba(56,189,248,0.16)',
                borderRadius: 14,
                padding: 14,
                color: '#f8fafc',
                outline: 'none',
                fontSize: 14,
                lineHeight: 1.5,
              }}
            />

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {['{name}', '{skill}', '{country}'].map((token) => (
                <span key={token} style={{ padding: '6px 12px', borderRadius: 10, background: 'rgba(30,41,59,0.9)', color: '#cbd5e1', fontSize: 13 }}>
                  {token}
                </span>
              ))}
            </div>

            {selectedPreset === 'reprofile' && recommendedReprofileTemplate && isApproved(recommendedReprofileTemplate.status) && (
              <button
                onClick={() => applyPreset('reprofile')}
                style={{
                  alignSelf: 'flex-start',
                  border: '1px solid rgba(34,197,94,0.3)',
                  background: 'rgba(34,197,94,0.12)',
                  color: '#dcfce7',
                  borderRadius: 12,
                  padding: '10px 14px',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
              >
                Use approved re-profile template
              </button>
            )}
          </div>
        )}

        <div
          style={{
            border: '1px solid rgba(248,113,113,0.18)',
            borderRadius: 16,
            padding: 16,
            background: 'rgba(30,41,59,0.38)',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div>
            <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 800 }}>Template Manager</div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 4 }}>
              Yahan se bekaar approved ya pending Meta templates delete kiye ja sakte hain.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={templateManagerSelection}
              onChange={(event) => setTemplateManagerSelection(event.target.value)}
              style={{
                flex: 1,
                minWidth: 260,
                padding: '12px 14px',
                borderRadius: 12,
                border: '1px solid rgba(248,113,113,0.2)',
                background: 'rgba(15,23,42,0.92)',
                color: '#f8fafc',
                outline: 'none',
              }}
            >
              <option value="">Select template to manage</option>
              {availableTemplates.map((template) => (
                <option key={`${template.name}-${template.metaId || template.id}`} value={template.name}>
                  {template.name} [{template.status}]
                </option>
              ))}
            </select>

            <button
              onClick={handleDeleteTemplate}
              disabled={!managedTemplate || deletingTemplate}
              style={{
                border: '1px solid rgba(248,113,113,0.35)',
                background: deletingTemplate ? 'rgba(248,113,113,0.18)' : 'rgba(127,29,29,0.3)',
                color: '#fecaca',
                borderRadius: 12,
                padding: '12px 16px',
                cursor: !managedTemplate || deletingTemplate ? 'not-allowed' : 'pointer',
                fontWeight: 700,
                opacity: !managedTemplate || deletingTemplate ? 0.65 : 1,
              }}
            >
              {deletingTemplate ? 'Deleting...' : 'Delete Template'}
            </button>
          </div>

          {managedTemplate && (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: isApproved(managedTemplate.status) ? 'rgba(34,197,94,0.14)' : 'rgba(250,204,21,0.14)', color: isApproved(managedTemplate.status) ? '#86efac' : '#fde68a', fontSize: 13 }}>
                  Status: {managedTemplate.status}
                </span>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', fontSize: 13 }}>
                  Category: {managedTemplate.category}
                </span>
                <span style={{ padding: '6px 12px', borderRadius: 999, background: 'rgba(56,189,248,0.1)', color: '#7dd3fc', fontSize: 13 }}>
                  Language: {managedTemplate.language}
                </span>
              </div>

              <div style={{ whiteSpace: 'pre-wrap', borderRadius: 14, border: '1px solid rgba(248,113,113,0.14)', background: 'rgba(15,23,42,0.82)', padding: 14, color: '#e2e8f0', minHeight: 88 }}>
                {managedTemplate.text || 'Template body unavailable.'}
              </div>
            </>
          )}
        </div>

        {error && (
          <div style={{ borderRadius: 14, padding: 14, background: 'rgba(127,29,29,0.4)', border: '1px solid rgba(248,113,113,0.25)', color: '#fecaca' }}>
            {error}
          </div>
        )}

        {notice && (
          <div style={{ borderRadius: 14, padding: 14, background: 'rgba(20,83,45,0.35)', border: '1px solid rgba(34,197,94,0.25)', color: '#dcfce7' }}>
            {notice}
          </div>
        )}

        {result && (
          <div style={{ borderRadius: 14, padding: 16, background: 'rgba(2,132,199,0.14)', border: '1px solid rgba(56,189,248,0.2)' }}>
            <div style={{ color: '#67e8f9', fontSize: 22, fontWeight: 800, marginBottom: 8 }}>Blast Complete</div>
            <div style={{ color: '#e2e8f0', fontSize: 15 }}>
              Targeted: {result.targeted} | Sent: {result.sent} | Failed: {result.failed}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 6 }}>
              Duplicate numbers skipped: {result.duplicatesSkipped || 0}
            </div>
            {result.failedTargets && result.failedTargets.length > 0 && (
              <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 13 }}>
                {result.failedTargets.slice(0, 5).map((target) => (
                  <div key={`${target.phone}-${target.reason}`}>
                    {target.phone}: {target.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleBlast}
          disabled={blasting || (composerMode === 'official' && !activeTemplateApproved)}
          style={{
            border: 'none',
            borderRadius: 14,
            padding: '16px 20px',
            background: blasting || (composerMode === 'official' && !activeTemplateApproved)
              ? 'rgba(56,189,248,0.4)'
              : 'linear-gradient(135deg, #0ea5e9, #38bdf8)',
            color: '#fff',
            fontSize: 16,
            fontWeight: 800,
            cursor: blasting || (composerMode === 'official' && !activeTemplateApproved) ? 'not-allowed' : 'pointer',
            opacity: blasting || (composerMode === 'official' && !activeTemplateApproved) ? 0.7 : 1,
          }}
        >
          {blasting
            ? 'Sending Blast...'
            : composerMode === 'official'
              ? 'Send Official Template Blast'
              : 'Execute Blast'}
        </button>

        <BlastReportPanel />
      </section>
    </div>
  );
}
