// lib/api.ts — Axios API client
import axios from 'axios';

const isProd = process.env.NODE_ENV === 'production';
const API_BASE = (isProd || !process.env.NEXT_PUBLIC_API_BASE_URL) 
  ? '' 
  : process.env.NEXT_PUBLIC_API_BASE_URL;

const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
  timeout: 120000, 
});

// ── Candidates ──────────────────────────────────────────────────────────────
export const getCandidates = (skill?: string, country?: string, search?: string) =>
  api.get('/api/candidates', { params: { skill, country, search, _t: Date.now() } }).then((r) => r.data);

export const getCandidateCounts = () =>
  api.get('/api/candidates/counts').then((r) => r.data);

export const getCandidateById = (id: string) =>
  api.get(`/api/candidates/${id}`).then((r) => r.data);

export const updateCandidate = (id: string, data: object) =>
  api.patch(`/api/candidates/${id}`, data).then((r) => r.data);

export const markAsAgency = (id: string, isAgency: boolean) =>
  updateCandidate(id, { isAgency });

// ── Vacancies ───────────────────────────────────────────────────────────────
export const getVacancies = () =>
  api.get('/api/webhook/vacancies').then((r) => r.data);

export const createVacancy = (data: object) =>
  api.post('/api/webhook/vacancy', data).then((r) => r.data);

export const getAgencyDemands = () =>
  api.get('/api/agency/demands').then((r) => r.data);

export const updateAgencyTemplateDraft = (payload: {
  queueId?: string;
  vacancyId?: string;
  candidateFacingText?: string;
  templateDraftBody?: string;
}) => api.patch('/api/agency/template-draft', payload).then((r) => r.data);

export const submitAgencyTemplate = (payload: {
  queueId?: string;
  vacancyId?: string;
}) => api.post('/api/agency/submit-template', payload).then((r) => r.data);

export const updateVacancyPriority = (payload: {
  vacancyId: string;
  priority: number | null;
}) => api.patch('/api/agency/vacancy-priority', payload).then((r) => r.data);

// ── WhatsApp Blast ──────────────────────────────────────────────────────────
export const blastWhatsApp = (payload: {
  skill?: string;
  country?: string;
  messageTemplate: string;
  templateName?: string;
  templateVariables?: string[];
  candidateIds?: string[];
  manualNumbers?: string[];
}) => api.post('/api/blast/whatsapp', payload).then((r) => r.data);

export const getLatestBlastReport = (lookbackHours: number = 168, minTargets: number = 20) =>
  api.get('/api/blast/latest-report', { params: { lookbackHours, minTargets } }).then((r) => r.data);

// ── Messenger / Instagram recent-contact broadcast ─────────────────────────
// Meta only allows a standard message to someone who messaged within the
// last 24 hours, so this targets exactly (and only) those contacts — not a
// WhatsApp-style unrestricted broadcast, which Messenger/Instagram don't
// support without paid Sponsored Messages.
export const previewMessengerRecentBroadcast = (channel: 'messenger' | 'instagram') =>
  api.get('/api/blast/messenger-recent/preview', { params: { channel } }).then((r) => r.data as { channel: string; eligibleCount: number });

export const sendMessengerRecentBroadcast = (channel: 'messenger' | 'instagram', message: string) =>
  api.post('/api/blast/messenger-recent', { channel, message }).then((r) => r.data as {
    success: boolean;
    channel: string;
    targeted: number;
    sent: number;
    failed: number;
    results: { id: string; name: string; phone: string; success: boolean; error: string | null }[];
  });

// ── Messages ────────────────────────────────────────────────────────────────
export const sendDirectMessage = (phone: string, message: string, templateName?: string, candidateData?: any, languageCode?: string, templateVariables?: string[]) =>
  api.post('/api/messages/send', { phone, message, templateName, candidateData, languageCode, templateVariables }).then((r) => r.data);

export const getTemplates = (refresh: boolean = false) =>
  api.get('/api/messages/templates', { params: { refresh } }).then((r) => r.data);

export const deleteTemplate = (name: string, metaId?: string) =>
  api.delete('/api/messages/templates', { data: { name, metaId } }).then((r) => r.data);

export const getMetaStatus = () =>
  api.get('/api/messages/status').then((r) => r.data);

// ── Documents ───────────────────────────────────────────────────────────────
export const processDocument = (formData: FormData) =>
  api.post('/api/document/process', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);

export const requestNewPhoto = (candidateName: string) =>
  api.post('/api/messages/request-repost', { candidateName }).then((r) => r.data);

export const getMessageHistory = (phone: string) =>
  api.get(`/api/messages/history/${phone}`).then((r) => r.data);

export const shareMediaMessage = (payload: {
  to: string;
  type: 'text' | 'document' | 'image' | 'audio' | 'video';
  mediaId?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  text?: string | null;
  senderPhoneId?: string | null;
}) => api.post('/api/messages/share', payload).then((r) => r.data);

export default api;
