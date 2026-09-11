'use client';

import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { sendDirectMessage, updateCandidate, getMessageHistory, getTemplates, getCandidates, shareMediaMessage } from '@/lib/api';
import { ref, onValue, off } from 'firebase/database';
import { db, hasFirebaseConfig } from '@/lib/firebase';
import { resolveMetaAccountInfo } from '@/lib/metaAccounts';

interface Message {
  id?: string;
  from: string;
  body?: string;
  text?: string;
  type?: 'text' | 'image' | 'audio' | 'document' | 'video';
  mediaType?: string;   // legacy field from meta_webhook.py (older Firebase entries)
  mediaId?: string | null;
  mediaUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  timestamp: string | number;
  direction: 'inbound' | 'outbound';
  tag?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
  error?: string;
}

interface ChatPanelProps {
  candidate: {
    id: string;
    name: string;
    phone: string;
    skill: string;
    country: string;
    isAgency?: boolean;
    cvLink?: string | null;
    photoLink?: string | null;
    salary?: string;
    leadStatus?: string;
    leadReason?: string;
    notes?: string;
    excludeFromBlast?: boolean;
    phoneNumberId?: string;
    wabaId?: string;
    lastRecipientPhoneId?: string;
    lastRecipientPhone?: string;
    businessAccountName?: string;
    botType?: string;
    bot_name?: string;
  } | null;
  onClose: () => void;
  onUpdate: () => void;
  onCandidateUpdate?: (updates: any) => void;
  refreshKey?: number;
}

function parseMessages(data: any): Message[] {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .map(([id, val]: [string, any]) => ({
      id,
      ...val,
    }))
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
}

function cleanPhone(phone: string) {
  return phone.replace(/\D/g, '');
}

function isMediaPlaceholder(text: string = '') {
  return /^\[(IMAGE|VOICE NOTE|VIDEO|DOCUMENT|MEDIA)\]/i.test(String(text).trim());
}

function getMediaSource(message: Message) {
  if (message.mediaId) return `/api/messages/media/${encodeURIComponent(message.mediaId)}`;
  return message.mediaUrl || null;
}

function getVisibleText(message: Message) {
  const text = String(message.text || message.body || '').trim();
  if (isMediaPlaceholder(text)) return '';
  return text;
}

function isPdfMessage(message: Message) {
  const mimeType = String(message.mimeType || '').toLowerCase();
  const fileName = String(message.fileName || '').toLowerCase();
  return mimeType.includes('pdf') || fileName.endsWith('.pdf');
}

function getStatusLabel(status: Message['status']) {
  const normalizedStatus = String(status || 'sent').toLowerCase();

  if (normalizedStatus === 'read') return 'READ';
  if (normalizedStatus === 'delivered') return 'DELIVERED';
  if (normalizedStatus === 'failed') return 'FAILED';
  return 'SENT';
}

export default function ChatPanel({ candidate, onClose, onUpdate, onCandidateUpdate, refreshKey = 0 }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [editing, setEditing] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'details' | 'templates' | 'share' | 'category'>('none');
  const [editData, setEditData] = useState({ skill: '', country: '', salary: '', notes: '' });
  const [availableTemplates, setAvailableTemplates] = useState<{ id: string; name: string; language: string; status?: string }[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isAutoScrolling = useRef(false);
  const userHasScrolledUp = useRef(false);

  // Category & Follow-up Manager State
  const [categoryData, setCategoryData] = useState({
    leadStatus: '',
    leadReason: '',
    notes: '',
    excludeFromBlast: false,
  });
  const [savingCategory, setSavingCategory] = useState(false);
  const [categorySaveMsg, setCategorySaveMsg] = useState('');

  // Share Drawer States
  const [shareRecipient, setShareRecipient] = useState('');
  const [shareContactSearch, setShareContactSearch] = useState('');
  const [allCandidatesForShare, setAllCandidatesForShare] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [shareCheckedItems, setShareCheckedItems] = useState({
    profile: true,
    cv: false,
    photo: false,
    voice: '',
  });
  const [sharingAssets, setSharingAssets] = useState(false);
  const [shareStatus, setShareStatus] = useState('');

  // In-Feed Item Forwarding Modal State
  const [forwardModalItem, setForwardModalItem] = useState<{
    type: 'image' | 'audio' | 'document' | 'video' | 'text';
    mediaId?: string | null;
    mediaSrc?: string | null;
    fileName?: string;
    text?: string;
  } | null>(null);
  const [forwardRecipient, setForwardRecipient] = useState('');
  const [forwardContactSearch, setForwardContactSearch] = useState('');
  const [forwardCustomCaption, setForwardCustomCaption] = useState('');
  const [forwarding, setForwarding] = useState(false);
  const [forwardStatus, setForwardStatus] = useState('');

  useEffect(() => {
    if (!candidate) return;

    updateCandidate(candidate.id, {
      unreadCount: 0,
      lastViewedAt: new Date().toISOString(),
    }).catch((err) => console.warn('[Chat] Failed to reset unread state:', err));

    setEditData({
      skill: candidate.skill,
      country: candidate.country,
      salary: candidate.salary || '',
      notes: candidate.notes || '',
    });
    setCategoryData({
      leadStatus: candidate.leadStatus || '',
      leadReason: candidate.leadReason || '',
      notes: candidate.notes || '',
      excludeFromBlast: Boolean(candidate.excludeFromBlast),
    });
    setCategorySaveMsg('');
    setSendError('');
    setEditing(false);
    setActiveDrawer('none');
    setShareRecipient('');
    setShareContactSearch('');
    setShareStatus('');
    setShareCheckedItems({
      profile: true,
      cv: false,
      photo: false,
      voice: '',
    });
    setMessages([]);

    const cleanedPhone = cleanPhone(candidate.phone);
    const listeners: { ref: ReturnType<typeof ref>; listener: Parameters<typeof off>[2] }[] = [];

    if (db && hasFirebaseConfig) {
      const realtimeDb = db;
      const paths = [cleanedPhone];
      if (cleanedPhone.length === 10) {
        paths.push(`91${cleanedPhone}`);
        paths.push(`92${cleanedPhone}`);
      }

      listeners.push(
        ...paths.map((path) => {
          const messagesRef = ref(realtimeDb, `messages/${path}`);
          const listener = onValue(messagesRef, (snapshot) => {
            const parsed = parseMessages(snapshot.val());
            setMessages((prev) => {
              const combined = [...prev, ...parsed];
              return Array.from(new Map(combined.map((item) => [item.id, item])).values())
                .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
            });
          });
          return { ref: messagesRef, listener };
        })
      );
    }

    fetchMessagesFallback(cleanedPhone);
    const refreshVisibleChat = () => {
      if (document.hidden) return;
      fetchMessagesFallback(cleanedPhone);
    };

    window.addEventListener('focus', refreshVisibleChat);
    document.addEventListener('visibilitychange', refreshVisibleChat);

    return () => {
      listeners.forEach((entry) => off(entry.ref, 'value', entry.listener));
      window.removeEventListener('focus', refreshVisibleChat);
      document.removeEventListener('visibilitychange', refreshVisibleChat);
    };
    // Deliberately keyed on candidate.id, not the candidate object: the
    // parent's candidate list gets a fresh array/object on every realtime
    // push (unrelated candidates' messages, unread counts, etc.), and
    // depending on the whole object here tore down the message listeners
    // and wiped setMessages([]) on every one of those — the "chat keeps
    // refreshing while I'm reading it" symptom. Same open conversation
    // should never reset just because some other candidate's row changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  useEffect(() => {
    if (!candidate || !refreshKey) return;
    fetchMessagesFallback(cleanPhone(candidate.phone));
    // Same reasoning as the setup effect above: key on the id, not the
    // object, or this re-fetches on every unrelated candidate update too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id, refreshKey]);

  useEffect(() => {
    getTemplates()
      .then((res) => {
        if (res.success) {
          setAvailableTemplates((res.templates || []).filter((template: { status?: string }) => String(template.status || '').toUpperCase() === 'APPROVED'));
        }
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (!scrollRef.current || userHasScrolledUp.current || messages.length === 0) return;
    isAutoScrolling.current = true;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    setTimeout(() => {
      isAutoScrolling.current = false;
    }, 100);
  }, [messages]);

  // Polling fallback: guarantees new messages appear even when Firebase onValue
  // listener is inactive (NEXT_PUBLIC vars unavailable at Cloud Run build time)
  // or SSE stream drops. Polls every 15 seconds while a chat is open.
  useEffect(() => {
    if (!candidate) return;
    const phone = cleanPhone(candidate.phone);
    const interval = setInterval(() => {
      fetchMessagesFallback(phone);
    }, 15000);
    return () => clearInterval(interval);
  }, [candidate]);

  const handleScroll = () => {
    if (!scrollRef.current || isAutoScrolling.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
    userHasScrolledUp.current = !isAtBottom;
  };

  async function fetchMessagesFallback(phone: string) {
    try {
      const data = await getMessageHistory(phone);
      if (data.success && data.messages) {
        setMessages((prev) => {
          const parsed = parseMessages(data.messages);
          const combined = [...prev, ...parsed];
          return Array.from(new Map(combined.map((item) => [item.id, item])).values())
            .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
        });
      }
    } catch (err) {
      console.warn('[Chat] REST fallback failed:', err);
    }
  }

  async function handleSendMessage(overrideText?: string, templateName?: string) {
    const textToSend = overrideText || newMessage;
    if (!candidate || (!textToSend.trim() && !templateName) || sending) return;

    setSending(true);
    setSendError('');
    try {
      let candidateData: any = undefined;
      if (templateName) {
        candidateData = {
          name: candidate.name || 'Candidate',
          skill: candidate.skill || '-',
          country: candidate.country || '-',
          salary: candidate.salary || editData.salary || undefined,
        };
      }

      const template = availableTemplates.find((item) => item.id === templateName);
      const languageCode = template?.language || 'hi';

      const result = await sendDirectMessage(candidate.phone, textToSend, templateName, candidateData, languageCode);
      if (result.success) {
        if (!overrideText) setNewMessage('');
        userHasScrolledUp.current = false;
        await fetchMessagesFallback(cleanPhone(candidate.phone));
        window.setTimeout(() => fetchMessagesFallback(cleanPhone(candidate.phone)), 1500);
        window.setTimeout(() => fetchMessagesFallback(cleanPhone(candidate.phone)), 5000);
      } else {
        setSendError(result.error || 'Message send failed.');
      }
    } catch (err: any) {
      console.error('Send failed:', err);
      setSendError(err?.response?.data?.error || err?.message || 'Message send failed.');
    } finally {
      setTimeout(() => setSending(false), 300);
    }
  }

  async function handleSaveProfile() {
    if (!candidate) return;
    try {
      await updateCandidate(candidate.id, editData);
      setEditing(false);
      onUpdate();
      if (onCandidateUpdate) onCandidateUpdate(editData);
    } catch (err) {
      console.error('Update failed:', err);
      alert('Failed to update profile');
    }
  }

  async function toggleAgencyStatus() {
    if (!candidate) return;
    const newStatus = !candidate.isAgency;
    try {
      await updateCandidate(candidate.id, { isAgency: newStatus });
      if (onCandidateUpdate) onCandidateUpdate({ isAgency: newStatus });
      onUpdate();
    } catch (err) {
      console.error('Agency toggle failed:', err);
    }
  }

  async function handleLeadStatusChange(newStatus: string) {
    if (!candidate) return;
    setCategoryData(prev => ({ ...prev, leadStatus: newStatus }));
    setActiveDrawer('category');
  }

  async function handleToggleExcludeFromBlast(exclude: boolean) {
    if (!candidate) return;
    setCategoryData(prev => ({ ...prev, excludeFromBlast: exclude }));
    try {
      await updateCandidate(candidate.id, { excludeFromBlast: exclude });
      if (onCandidateUpdate) onCandidateUpdate({ excludeFromBlast: exclude });
      onUpdate();
    } catch (err) {
      console.error('Exclude from blast update failed:', err);
    }
  }

  async function handleSaveCategory(updates?: Partial<typeof categoryData>) {
    if (!candidate) return;
    setSavingCategory(true);
    setCategorySaveMsg('');
    const finalData = { ...categoryData, ...(updates || {}) };
    try {
      await updateCandidate(candidate.id, {
        leadStatus: finalData.leadStatus,
        leadReason: finalData.leadReason,
        notes: finalData.notes,
        excludeFromBlast: finalData.excludeFromBlast,
      });
      if (onCandidateUpdate) {
        onCandidateUpdate({
          leadStatus: finalData.leadStatus,
          leadReason: finalData.leadReason,
          notes: finalData.notes,
          excludeFromBlast: finalData.excludeFromBlast,
        });
      }
      setCategoryData(finalData);
      setEditData(prev => ({ ...prev, notes: finalData.notes }));
      onUpdate();
      setCategorySaveMsg('Category & Notes Saved! ✅');
      setTimeout(() => {
        setCategorySaveMsg('');
        setActiveDrawer('none');
      }, 900);
    } catch (err: any) {
      console.error('Category update failed:', err);
      setCategorySaveMsg('Failed to save category');
    } finally {
      setSavingCategory(false);
    }
  }

  useEffect(() => {
    if (activeDrawer === 'share' && allCandidatesForShare.length === 0) {
      getCandidates()
        .then((res) => {
          if (res.success && res.candidates) {
            setAllCandidatesForShare(res.candidates.map((c: any) => ({
              id: c.id,
              name: c.name || 'Candidate',
              phone: c.phone || '',
            })));
          }
        })
        .catch(console.error);
    }
  }, [activeDrawer, forwardModalItem, allCandidatesForShare.length]);

  async function handleShareAssets() {
    if (!candidate || !shareRecipient) {
      setShareStatus('Please select or enter a recipient number.');
      return;
    }
    setSharingAssets(true);
    setShareStatus('Sharing message(s)...');
    try {
      const cleanRecipient = shareRecipient.replace(/\D/g, '');
      
      // 1. Share Profile Summary if checked
      if (shareCheckedItems.profile) {
        const profileText = `*Gulf Career Gateway — Candidate Profile Summary*\n\n` +
          `• *Name*: ${candidate.name}\n` +
          `• *Phone*: ${candidate.phone}\n` +
          `• *Trade*: ${candidate.skill}\n` +
          `• *Country*: ${candidate.country}\n` +
          (candidate.salary ? `• *Salary*: ${candidate.salary}\n` : '') +
          (editData.notes ? `• *Notes*: ${editData.notes}\n` : '');
        await shareMediaMessage({
          to: cleanRecipient,
          type: 'text',
          text: profileText,
        });
      }

      // 2. Share CV if checked and available
      if (shareCheckedItems.cv && candidate.cvLink) {
        await shareMediaMessage({
          to: cleanRecipient,
          type: 'document',
          mediaUrl: candidate.cvLink,
          filename: `${candidate.name.replace(/\s+/g, '_')}_CV.pdf`,
        });
      }

      // 3. Share Photo if checked and available
      if (shareCheckedItems.photo && candidate.photoLink) {
        await shareMediaMessage({
          to: cleanRecipient,
          type: 'image',
          mediaUrl: candidate.photoLink,
          filename: `${candidate.name} Photo`,
        });
      }

      // 4. Share selected voice note if checked
      if (shareCheckedItems.voice) {
        const selectedVoice = messages.find(m => m.id === shareCheckedItems.voice || m.mediaId === shareCheckedItems.voice);
        if (selectedVoice?.mediaId) {
          await shareMediaMessage({
            to: cleanRecipient,
            type: 'audio',
            mediaId: selectedVoice.mediaId,
          });
        }
      }

      setShareStatus('Successfully shared! ✅');
      setTimeout(() => {
        setShareStatus('');
      }, 3000);
    } catch (err: any) {
      console.error('Error sharing:', err);
      setShareStatus(`Failed to share: ${err.message || 'Server error'}`);
    } finally {
      setSharingAssets(false);
    }
  }

  async function handleForwardItem() {
    if (!forwardModalItem || !forwardRecipient) return;
    setForwarding(true);
    setForwardStatus('Sending on WhatsApp...');
    try {
      const cleanTo = forwardRecipient.replace(/\D/g, '');
      const fullMediaUrl = forwardModalItem.mediaSrc && typeof window !== 'undefined'
        ? (forwardModalItem.mediaSrc.startsWith('http') ? forwardModalItem.mediaSrc : `${window.location.origin}${forwardModalItem.mediaSrc}`)
        : undefined;

      const res = await shareMediaMessage({
        to: cleanTo,
        type: forwardModalItem.type === 'text' ? 'text' : forwardModalItem.type,
        mediaId: forwardModalItem.mediaId || undefined,
        mediaUrl: fullMediaUrl,
        filename: forwardCustomCaption || forwardModalItem.fileName || (candidate ? `From ${candidate.name}` : undefined),
        text: forwardModalItem.type === 'text' ? (forwardCustomCaption ? `${forwardCustomCaption}\n\n${forwardModalItem.text}` : forwardModalItem.text) : (forwardCustomCaption || undefined),
      });

      if (res.success) {
        setForwardStatus(`✅ Successfully shared with ${cleanTo}!`);
        setTimeout(() => {
          setForwardModalItem(null);
          setForwardStatus('');
          setForwardRecipient('');
          setForwardContactSearch('');
          setForwardCustomCaption('');
        }, 1200);
      } else {
        setForwardStatus(`Failed: ${res.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      console.error('Direct forward error:', err);
      setForwardStatus(`Error: ${err.message || 'Share failed'}`);
    } finally {
      setForwarding(false);
    }
  }

  function getWhatsAppWebShareUrl() {
    if (!forwardModalItem) return '';
    const cleanTo = forwardRecipient.replace(/\D/g, '');
    let textBody = '';
    if (candidate) {
      textBody += `*Candidate:* ${candidate.name} (${candidate.phone})\n*Trade:* ${candidate.skill || 'N/A'}\n\n`;
    }
    if (forwardCustomCaption) {
      textBody += `${forwardCustomCaption}\n\n`;
    }
    if (forwardModalItem.type === 'text' && forwardModalItem.text) {
      textBody += forwardModalItem.text;
    } else if (forwardModalItem.mediaSrc && typeof window !== 'undefined') {
      const absoluteMediaUrl = forwardModalItem.mediaSrc.startsWith('http') 
        ? forwardModalItem.mediaSrc 
        : `${window.location.origin}${forwardModalItem.mediaSrc}`;
      textBody += `*File / Media Link:* ${absoluteMediaUrl}`;
    }
    return `https://api.whatsapp.com/send?phone=${cleanTo}&text=${encodeURIComponent(textBody)}`;
  }

  async function startRecording() {
    if (isRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!candidate) return;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        await sendVoiceBlob(blob, mimeType);
      };
      recorder.start(250);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    } catch (err) {
      setSendError('Microphone access denied');
    }
  }

  function stopRecording() {
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  }

  async function sendVoiceBlob(blob: Blob, mimeType: string) {
    if (!candidate) return;
    setSending(true);
    setSendError('');
    try {
      const formData = new FormData();
      const ext = mimeType.includes('ogg') ? 'ogg' : 'webm';
      formData.append('phone', candidate.phone);
      formData.append('audio', blob, `voice_${Date.now()}.${ext}`);
      const res = await fetch('/api/messages/send-voice', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Voice send failed');
      await fetchMessagesFallback(cleanPhone(candidate.phone));
    } catch (err: any) {
      setSendError(err.message || 'Voice send failed');
    } finally {
      setSending(false);
    }
  }

  if (!candidate) return null;

  const metaAcc = resolveMetaAccountInfo(candidate);

  return (
    <div className="chat-panel-container">
      <div className="chat-header">
        <div className="header-info">
          <div className="chat-avatar">{candidate.isAgency ? 'AG' : (candidate.name?.charAt(0) || '?')}</div>
          <div>
            <div className="candidate-name-row">
              <span className="candidate-name">{candidate.name}</span>
              {candidate.isAgency && <span className="agency-badge">AGENCY</span>}
            </div>
            <div className="candidate-phone" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <span>{candidate.phone}</span>
              <span
                title={`Received on Meta WhatsApp Business Account: ${metaAcc.accountName} (${metaAcc.displayPhoneNumber || 'N/A'})\nPhone Number ID: ${metaAcc.phoneNumberId || 'N/A'}\nWhatsApp Business Account ID: ${metaAcc.wabaId || 'N/A'}`}
                style={{
                  fontSize: '9.5px',
                  fontWeight: 700,
                  color: metaAcc.tagColor,
                  background: 'rgba(255,255,255,0.06)',
                  border: `1px solid ${metaAcc.tagColor}40`,
                  padding: '1px 5px',
                  borderRadius: '4px',
                  cursor: 'help'
                }}
              >
                📱 To: {metaAcc.shortLabel}
                {metaAcc.phoneNumberId && ` • ID: ${metaAcc.phoneNumberId}`}
              </span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          {/* Category & Status Manager Trigger Button */}
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'category' ? 'none' : 'category')}
            className={`utility-toggle ${activeDrawer === 'category' ? 'active' : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              height: '32px',
              padding: '0 10px',
              borderRadius: '8px',
              border: candidate.leadStatus === 'hot_lead' 
                ? '1px solid rgba(239,68,68,0.5)' 
                : candidate.leadStatus === 'talk_later' 
                ? '1px solid rgba(245,158,11,0.5)' 
                : candidate.leadStatus === 'blocked' 
                ? '1px solid rgba(148,163,184,0.4)' 
                : '1px solid rgba(56,189,248,0.25)',
              background: candidate.leadStatus === 'hot_lead' 
                ? 'rgba(239,68,68,0.18)' 
                : candidate.leadStatus === 'talk_later' 
                ? 'rgba(245,158,11,0.18)' 
                : candidate.leadStatus === 'blocked' 
                ? 'rgba(148,163,184,0.18)' 
                : 'rgba(30,41,59,0.7)',
              color: candidate.leadStatus === 'hot_lead' 
                ? '#f87171' 
                : candidate.leadStatus === 'talk_later' 
                ? '#fbbf24' 
                : candidate.leadStatus === 'blocked' 
                ? '#94a3b8' 
                : '#38bdf8',
              fontWeight: 800,
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <span>
              {candidate.leadStatus === 'hot_lead' && '🔥 Hot Lead'}
              {candidate.leadStatus === 'talk_later' && '⏳ Talk Later'}
              {candidate.leadStatus === 'blocked' && '🚫 Blocked'}
              {!candidate.leadStatus && '🟢 Normal Lead'}
            </span>
            {candidate.leadReason && (
              <span style={{ fontSize: 9, opacity: 0.85, background: 'rgba(0,0,0,0.25)', padding: '1px 5px', borderRadius: 4, maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {candidate.leadReason}
              </span>
            )}
            <span style={{ fontSize: 9, opacity: 0.7 }}>✏️</span>
          </button>

          {/* Quick Block Broadcast Checkbox */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 11, fontWeight: 700, color: '#f87171', background: 'rgba(244, 63, 94, 0.08)', padding: '0 8px', borderRadius: '8px', border: '1px solid rgba(244, 63, 94, 0.16)', height: '32px' }}>
            <input
              type="checkbox"
              checked={Boolean(candidate.excludeFromBlast)}
              onChange={(e) => handleToggleExcludeFromBlast(e.target.checked)}
              style={{ cursor: 'pointer', margin: 0 }}
            />
            {candidate.excludeFromBlast ? '🔇 Muted' : 'Block Broadcast'}
          </label>
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'share' ? 'none' : 'share')}
            className={`utility-toggle ${activeDrawer === 'share' ? 'active' : ''}`}
          >
            Share ↗
          </button>
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'details' ? 'none' : 'details')}
            className={`utility-toggle ${activeDrawer === 'details' ? 'active' : ''}`}
          >
            Details
          </button>
          <button
            onClick={() => setActiveDrawer(activeDrawer === 'templates' ? 'none' : 'templates')}
            className={`utility-toggle ${activeDrawer === 'templates' ? 'active' : ''}`}
          >
            Templates
          </button>
          <button onClick={toggleAgencyStatus} className={`agency-toggle ${candidate.isAgency ? 'active' : ''}`}>
            {candidate.isAgency ? 'ON' : 'OFF'}
          </button>
          <button onClick={onClose} className="close-btn">X</button>
        </div>
      </div>

      {activeDrawer === 'category' && (
        <div className="utility-drawer" style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '16px', background: 'rgba(15, 23, 42, 0.96)', borderLeft: '1px solid rgba(56, 189, 248, 0.18)', maxHeight: '100%', overflowY: 'auto' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="section-title" style={{ fontSize: '14px', fontWeight: 800, color: '#38bdf8' }}>Category & Follow-up Manager</span>
              <button onClick={() => setActiveDrawer('none')} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕</button>
            </div>
            <p style={{ margin: '3px 0 0', fontSize: '11px', color: '#94a3b8' }}>Categorize lead, set specific discussion reason, notes, and broadcast settings.</p>
          </div>

          {/* 1. Main Category Selector */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 6 }}>1. Select Lead Category:</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {[
                { key: '', label: '🟢 Normal Lead', color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
                { key: 'hot_lead', label: '🔥 Hot Lead', color: '#f87171', bg: 'rgba(239,68,68,0.15)' },
                { key: 'talk_later', label: '⏳ Talk Later', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)' },
                { key: 'blocked', label: '🚫 Blocked', color: '#94a3b8', bg: 'rgba(148,163,184,0.15)' },
              ].map(cat => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategoryData(prev => ({ ...prev, leadStatus: cat.key }))}
                  style={{
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: categoryData.leadStatus === cat.key ? `2px solid ${cat.color}` : '1px solid rgba(255,255,255,0.08)',
                    background: categoryData.leadStatus === cat.key ? cat.bg : 'rgba(30,41,59,0.5)',
                    color: categoryData.leadStatus === cat.key ? cat.color : '#cbd5e1',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textAlign: 'center',
                    transition: 'all 0.15s'
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Specific Reason / Topic Presets */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 6 }}>2. Specific Reason / Discussion Status:</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
              {(categoryData.leadStatus === 'hot_lead' ? [
                'Ready for Interview / Test',
                'Deal Finalized / Selected',
                'Advance / Charges Agreed',
                'Passport Ready / Medical Done'
              ] : categoryData.leadStatus === 'talk_later' ? [
                'कुछ दिन बाद बात करेगा (Follow up)',
                '1 हफ़्ते बाद कॉल करेगा (Call in 1 week)',
                'Next Month (अगले महीने बात करेगा)',
                'Family se discuss karke batayega',
                'Salary / Charges discussion'
              ] : categoryData.leadStatus === 'blocked' ? [
                'काम कराने से मना कर दिया (Declined)',
                'Not Interested in Gulf jobs',
                'Wrong Number / Rude behavior',
                'Fraud / Blacklisted'
              ] : [
                'General Inquiry',
                'Documents / CV Pending',
                'Trade / Skill Mismatch',
                'Other Discussion'
              ]).map(preset => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCategoryData(prev => ({ ...prev, leadReason: preset }))}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '6px',
                    border: categoryData.leadReason === preset ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.06)',
                    background: categoryData.leadReason === preset ? 'rgba(56,189,248,0.2)' : 'rgba(30,41,59,0.7)',
                    color: categoryData.leadReason === preset ? '#38bdf8' : '#94a3b8',
                    fontSize: '10px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {preset}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={categoryData.leadReason}
              onChange={(e) => setCategoryData(prev => ({ ...prev, leadReason: e.target.value }))}
              placeholder="Or type custom reason / status tag..."
              className="form-input"
              style={{ width: '100%', padding: '7px 10px', fontSize: '11px', borderRadius: '6px', background: 'rgba(30,41,59,0.8)', color: 'white', border: '1px solid rgba(56,189,248,0.2)' }}
            />
          </div>

          {/* 3. Conversation Notes ("क्या बात हो रखी है") */}
          <div>
            <label style={{ fontSize: '11px', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: 4 }}>3. Conversation Notes ("क्या बात हुई है"):</label>
            <textarea
              value={categoryData.notes}
              onChange={(e) => setCategoryData(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="e.g. 5 din baad call karega, Passport ready hai, Saudi me driver job chahiye, 1500 SAR salary deal hui hai..."
              className="form-input"
              style={{ width: '100%', height: '70px', padding: '8px', fontSize: '11px', borderRadius: '6px', background: 'rgba(30,41,59,0.8)', color: 'white', border: '1px solid rgba(56,189,248,0.2)', resize: 'vertical', fontFamily: 'inherit' }}
            />
          </div>

          {/* 4. Bulk Broadcast Exclusion Setting */}
          <div style={{ padding: '10px 12px', background: categoryData.excludeFromBlast ? 'rgba(244,63,94,0.12)' : 'rgba(30,41,59,0.4)', borderRadius: '8px', border: categoryData.excludeFromBlast ? '1px solid rgba(244,63,94,0.3)' : '1px solid rgba(255,255,255,0.06)' }}>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={categoryData.excludeFromBlast}
                onChange={(e) => setCategoryData(prev => ({ ...prev, excludeFromBlast: e.target.checked }))}
                style={{ cursor: 'pointer', marginTop: 2 }}
              />
              <div>
                <div style={{ fontSize: '11px', fontWeight: 700, color: categoryData.excludeFromBlast ? '#f87171' : '#e2e8f0' }}>
                  {categoryData.excludeFromBlast ? '🔇 Muted: Excluded from Bulk Broadcast' : 'Allow in Bulk Broadcast'}
                </div>
                <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: 2 }}>
                  Agar checked hai toh bulk blast campaign ke time is candidate ke paas koi message nahi jayega.
                </div>
              </div>
            </label>
          </div>

          {/* Save Status & Action */}
          {categorySaveMsg && (
            <div style={{ fontSize: '11px', color: categorySaveMsg.includes('✅') ? '#4ade80' : '#f87171', fontWeight: 700, textAlign: 'center' }}>
              {categorySaveMsg}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 'auto' }}>
            <button
              onClick={() => handleSaveCategory()}
              disabled={savingCategory}
              style={{
                flex: 1,
                padding: '10px',
                background: '#0ea5e9',
                border: 'none',
                borderRadius: '8px',
                color: 'white',
                fontSize: '12px',
                fontWeight: 800,
                cursor: savingCategory ? 'not-allowed' : 'pointer',
                opacity: savingCategory ? 0.7 : 1
              }}
            >
              {savingCategory ? 'Saving...' : 'Save Category & Notes'}
            </button>
            <button
              onClick={() => setActiveDrawer('none')}
              style={{
                padding: '10px 14px',
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px',
                color: '#cbd5e1',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {activeDrawer === 'details' && (
        <div className="utility-drawer">
          {!editing ? (
            <div className="profile-summary" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="tags-container">
                <span className="tag">Skill {candidate.skill}</span>
                <span className="tag">Country {candidate.country}</span>
                {editData.salary && <span className="tag salary">Salary {editData.salary}</span>}
              </div>
              
              {candidate.notes ? (
                <div style={{ padding: '8px 12px', background: 'rgba(15, 23, 42, 0.4)', borderRadius: '8px', borderLeft: '3px solid #38bdf8', fontSize: '12px' }}>
                  <div style={{ color: '#94a3b8', fontWeight: 600, fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Comments / Notes</div>
                  <div style={{ marginTop: '4px', color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{candidate.notes}</div>
                </div>
              ) : (
                <div style={{ color: '#64748b', fontSize: '11px', fontStyle: 'italic' }}>No comments or notes yet. Click Edit profile to add.</div>
              )}

              {/* Meta Account Routing & IDs card */}
              <div style={{ padding: '10px 12px', background: 'rgba(15, 23, 42, 0.55)', borderRadius: '8px', border: '1px solid rgba(56, 189, 248, 0.15)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span>📱 Meta WhatsApp Routing Account</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span style={{ color: '#94a3b8' }}>Business Name:</span>
                  <span style={{ fontWeight: 700, color: metaAcc.tagColor }}>{metaAcc.accountName}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span style={{ color: '#94a3b8' }}>Received On:</span>
                  <span style={{ fontWeight: 600 }}>{metaAcc.displayPhoneNumber || 'Primary Number'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span style={{ color: '#94a3b8' }}>Phone Number ID:</span>
                  <span style={{ fontFamily: 'monospace', color: '#38bdf8' }}>{metaAcc.phoneNumberId || 'N/A'}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                  <span style={{ color: '#94a3b8' }}>WABA Account ID:</span>
                  <span style={{ fontFamily: 'monospace', color: '#94a3b8' }}>{metaAcc.wabaId || 'N/A'}</span>
                </div>
              </div>

              <div className="asset-links">
                {candidate.cvLink && (
                  <a href={candidate.cvLink} target="_blank" rel="noopener noreferrer" className="asset-btn">
                    CV
                  </a>
                )}
                {candidate.photoLink && (
                  <a href={candidate.photoLink} target="_blank" rel="noopener noreferrer" className="asset-btn">
                    Photo
                  </a>
                )}
                <button onClick={() => setEditing(true)} className="edit-trigger">Edit profile</button>
              </div>
            </div>
          ) : (
            <div className="profile-edit-form">
              <input
                value={editData.skill}
                onChange={(e) => setEditData({ ...editData, skill: e.target.value })}
                placeholder="Skill"
                className="form-input"
              />
              <input
                value={editData.country}
                onChange={(e) => setEditData({ ...editData, country: e.target.value })}
                placeholder="Country"
                className="form-input"
              />
              <input
                value={editData.salary}
                onChange={(e) => setEditData({ ...editData, salary: e.target.value })}
                placeholder="Salary"
                className="form-input"
              />
              <textarea
                value={editData.notes}
                onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                placeholder="Write notes / comments here... (What deal was made? When to speak again?)"
                className="form-input"
                style={{ height: '75px', resize: 'vertical', fontFamily: 'inherit', padding: '8px' }}
              />
              <div className="edit-actions">
                <button onClick={handleSaveProfile} className="save-btn">Save</button>
                <button onClick={() => setEditing(false)} className="cancel-btn">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeDrawer === 'templates' && (
        <div className="utility-drawer">
          <div className="templates-header">
            <span className="section-title">Official Templates ({availableTemplates.length})</span>
            <button
              onClick={() => getTemplates(true).then((res) => res.success && setAvailableTemplates((res.templates || []).filter((template: { status?: string }) => String(template.status || '').toUpperCase() === 'APPROVED'))).catch(console.error)}
              className="sync-tiny-btn"
            >
              Sync
            </button>
          </div>
          <div className="templates-scroll">
            {availableTemplates.map((template) => (
              <button
                key={template.id}
                onClick={() => handleSendMessage('', template.id)}
                disabled={sending}
                className="template-chip"
                title={template.name}
              >
                {template.name.split('_').join(' ').length > 24
                  ? `${template.name.split('_').join(' ').substring(0, 21)}...`
                  : template.name.split('_').join(' ')}
              </button>
            ))}
            {availableTemplates.length === 0 && <span className="no-templates-hint">No approved templates found.</span>}
            <button
              onClick={() => setNewMessage('Assalam-o-Alaikum, Gulf Career Gateway se baat kar rahe hain.')}
              className="template-chip quick"
            >
              Quick Intro
            </button>
          </div>
        </div>
      )}

      {activeDrawer === 'share' && (
        <div className="utility-drawer" style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px', background: 'rgba(15, 23, 42, 0.95)', borderLeft: '1px solid rgba(56, 189, 248, 0.16)', height: '100%' }}>
          <div>
            <span className="section-title" style={{ fontSize: '14px', fontWeight: 700, color: '#38bdf8' }}>Forward / Share Candidate</span>
            <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>Send candidate profile or documents to another number via WhatsApp.</p>
          </div>

          {/* Recipient Search & Input */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0' }}>Recipient Phone Number:</label>
            <input
              type="text"
              value={shareRecipient}
              onChange={(e) => setShareRecipient(e.target.value)}
              placeholder="e.g. 918920624361"
              className="form-input"
              style={{ padding: '8px', borderRadius: '6px', background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', width: '100%', fontSize: '12px' }}
            />
            
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0', marginTop: '4px' }}>Search Contact (Auto-fill):</label>
            <input
              type="text"
              value={shareContactSearch}
              onChange={(e) => setShareContactSearch(e.target.value)}
              placeholder="Search by name or phone..."
              className="form-input"
              style={{ padding: '8px', borderRadius: '6px', background: 'rgba(30, 41, 59, 0.8)', border: '1px solid rgba(56, 189, 248, 0.2)', color: 'white', width: '100%', fontSize: '12px' }}
            />

            {shareContactSearch.trim().length > 0 && (
              <div style={{ maxHeight: '110px', overflowY: 'auto', background: 'rgba(15, 23, 42, 0.8)', border: '1px solid rgba(56, 189, 248, 0.1)', borderRadius: '6px', marginTop: '4px', display: 'flex', flexDirection: 'column' }}>
                {allCandidatesForShare
                  .filter(c => 
                    c.name.toLowerCase().includes(shareContactSearch.toLowerCase()) || 
                    c.phone.includes(shareContactSearch)
                  )
                  .slice(0, 15)
                  .map(c => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setShareRecipient(c.phone);
                        setShareContactSearch('');
                      }}
                      style={{
                        padding: '6px 10px',
                        background: 'none',
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.05)',
                        color: '#f1f5f9',
                        fontSize: '11px',
                        textAlign: 'left',
                        cursor: 'pointer',
                        display: 'flex',
                        justifyContent: 'space-between',
                        width: '100%'
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(56, 189, 248, 0.08)'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                    >
                      <span>{c.name}</span>
                      <span style={{ color: '#94a3b8' }}>{c.phone}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Checklist of what to share */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: '#e2e8f0' }}>Select Content to Share:</label>
            
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: '#cbd5e1', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={shareCheckedItems.profile}
                onChange={(e) => setShareCheckedItems({ ...shareCheckedItems, profile: e.target.checked })}
              />
              Candidate Profile Summary (Text)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: candidate.cvLink ? '#cbd5e1' : '#475569', cursor: candidate.cvLink ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={shareCheckedItems.cv}
                disabled={!candidate.cvLink}
                onChange={(e) => setShareCheckedItems({ ...shareCheckedItems, cv: e.target.checked })}
              />
              Candidate CV Document {!candidate.cvLink && <span style={{ fontSize: '10px', color: '#ef4444' }}>(Not Uploaded)</span>}
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '12px', color: candidate.photoLink ? '#cbd5e1' : '#475569', cursor: candidate.photoLink ? 'pointer' : 'not-allowed' }}>
              <input
                type="checkbox"
                checked={shareCheckedItems.photo}
                disabled={!candidate.photoLink}
                onChange={(e) => setShareCheckedItems({ ...shareCheckedItems, photo: e.target.checked })}
              />
              Candidate Photo {!candidate.photoLink && <span style={{ fontSize: '10px', color: '#ef4444' }}>(Not Uploaded)</span>}
            </label>

            {/* Voice Notes list */}
            {messages.some(m => m.type === 'audio' && m.mediaId) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>Include Voice Note:</span>
                <select
                  value={shareCheckedItems.voice}
                  onChange={(e) => setShareCheckedItems({ ...shareCheckedItems, voice: e.target.value })}
                  style={{
                    background: 'rgba(30, 41, 59, 0.8)',
                    border: '1px solid rgba(56, 189, 248, 0.2)',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '11px',
                    padding: '6px',
                    outline: 'none',
                    width: '100%'
                  }}
                >
                  <option value="">-- Don't include voice note --</option>
                  {messages
                    .filter(m => m.type === 'audio' && m.mediaId)
                    .map((m, idx) => (
                      <option key={m.id || idx} value={(m.id || m.mediaId) ?? ''}>
                        Voice Note #{idx + 1} ({m.timestamp ? new Date(m.timestamp).toLocaleDateString() : 'Recent'})
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>

          {/* Action Status and Button */}
          {shareStatus && (
            <div style={{ 
              fontSize: '11px', 
              color: shareStatus.includes('✅') ? '#4ade80' : shareStatus.includes('Failed') ? '#f87171' : '#f59e0b',
              fontWeight: 600,
              padding: '6px 8px',
              background: 'rgba(30, 41, 59, 0.5)',
              borderRadius: '6px'
            }}>
              {shareStatus}
            </div>
          )}

          <button
            onClick={handleShareAssets}
            disabled={sharingAssets || !shareRecipient}
            style={{
              padding: '10px 14px',
              background: '#22c55e',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              fontSize: '13px',
              fontWeight: 700,
              cursor: (!shareRecipient || sharingAssets) ? 'not-allowed' : 'pointer',
              opacity: (!shareRecipient || sharingAssets) ? 0.6 : 1,
              marginTop: 'auto',
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8
            }}
          >
            {sharingAssets ? 'Sharing...' : 'Share on WhatsApp'}
          </button>
        </div>
      )}

      <div className="message-feed" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">Chat</div>
            <div>No messages yet. Start a conversation.</div>
          </div>
        )}

        {messages.map((message) => {
          const type = message.type || message.mediaType || ((message.mediaId || message.mediaUrl) ? 'image' : 'text');
          const mediaSrc = getMediaSource(message);
          const visibleText = getVisibleText(message);
          const documentName = message.fileName || 'Attachment';
          const showPdfPreview = type === 'document' && mediaSrc && isPdfMessage(message);
          const statusLabel = getStatusLabel(message.status);
          return (
            <div key={message.id} className={`message-row ${message.direction}`}>
              <div className={`message-bubble ${message.direction} ${type} ${message.status === 'failed' ? 'failed' : ''}`}>
                {message.tag && <div className="message-tag">{message.tag}</div>}

                {type === 'image' && mediaSrc ? (
                  <div className="media-stack">
                    <a href={mediaSrc} target="_blank" rel="noopener noreferrer" className="media-link">
                      <Image
                        src={mediaSrc}
                        className="message-media"
                        alt={documentName}
                        width={720}
                        height={960}
                        unoptimized
                      />
                    </a>
                    {visibleText && <div className="message-caption">{visibleText}</div>}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, gap: 8, padding: '4px 2px' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForwardModalItem({
                            type: 'image',
                            mediaId: message.mediaId,
                            mediaSrc,
                            fileName: documentName !== 'Attachment' ? documentName : `${candidate.name} Image`
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.35)',
                          color: '#4ade80',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ↗ Share Image / Document
                      </button>
                      <a href={mediaSrc} target="_blank" rel="noopener noreferrer" style={{ fontSize: '11px', color: '#38bdf8', textDecoration: 'none' }}>
                        View Full ↗
                      </a>
                    </div>
                  </div>
                ) : type === 'audio' && mediaSrc ? (
                  <div className="audio-block">
                    <div className="audio-label">Voice message</div>
                    <audio controls src={mediaSrc} className="message-audio" preload="metadata" />
                    {visibleText && <div className="message-caption">{visibleText}</div>}
                    <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForwardModalItem({
                            type: 'audio',
                            mediaId: message.mediaId,
                            mediaSrc,
                            fileName: 'Voice Note'
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.35)',
                          color: '#4ade80',
                          padding: '4px 10px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ↗ Share Voice Note
                      </button>
                    </div>
                  </div>
                ) : type === 'video' && mediaSrc ? (
                  <div className="media-stack">
                    <video controls className="message-video" preload="metadata">
                      <source src={mediaSrc} type={message.mimeType || 'video/mp4'} />
                    </video>
                    <div className="document-actions" style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
                      <a href={mediaSrc} target="_blank" rel="noopener noreferrer" className="media-action-link">
                        Open video
                      </a>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForwardModalItem({
                            type: 'video',
                            mediaId: message.mediaId,
                            mediaSrc,
                            fileName: 'Video'
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.35)',
                          color: '#4ade80',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ↗ Share Video
                      </button>
                    </div>
                    {visibleText && <div className="message-caption">{visibleText}</div>}
                  </div>
                ) : type === 'document' && mediaSrc ? (
                  <div className="document-block">
                    {showPdfPreview ? (
                      <iframe
                        title={documentName}
                        src={`${mediaSrc}#toolbar=0&navpanes=0&scrollbar=1`}
                        className="message-pdf"
                      />
                    ) : (
                      <div className="document-meta">
                        <div className="document-name">{documentName}</div>
                        <div className="document-type">{message.mimeType || 'Document'}</div>
                      </div>
                    )}
                    <div className="document-actions" style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
                      <a href={mediaSrc} target="_blank" rel="noopener noreferrer" className="media-action-link">
                        Open
                      </a>
                      <a href={mediaSrc} target="_blank" rel="noopener noreferrer" download={documentName} className="media-action-link">
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setForwardModalItem({
                            type: 'document',
                            mediaId: message.mediaId,
                            mediaSrc,
                            fileName: documentName
                          });
                        }}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          background: 'rgba(34, 197, 94, 0.15)',
                          border: '1px solid rgba(34, 197, 94, 0.35)',
                          color: '#4ade80',
                          padding: '3px 8px',
                          borderRadius: '5px',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        ↗ Share Document
                      </button>
                    </div>
                    {visibleText && <div className="message-caption">{visibleText}</div>}
                  </div>
                ) : (type === 'image' || type === 'audio' || type === 'document' || type === 'video') && !mediaSrc ? (
                  <div className="media-unavailable">
                    <span className="media-unavailable-icon">
                      {type === 'image' ? '🖼️' : type === 'audio' ? '🎵' : type === 'video' ? '🎬' : '📄'}
                    </span>
                    <span className="media-unavailable-label">
                      {documentName !== 'Attachment' ? documentName : `${type.charAt(0).toUpperCase() + type.slice(1)} message`}
                    </span>
                    {visibleText && <div className="message-caption">{visibleText}</div>}
                  </div>
                ) : (
                  <div className="message-text">{visibleText || message.text || message.body}</div>
                )}

                {message.direction === 'outbound' && message.status === 'failed' && message.error && (
                  <div className="message-error">{message.error}</div>
                )}

                <div className="message-meta" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setForwardModalItem({
                        type: type === 'image' || type === 'audio' || type === 'document' || type === 'video' ? type : 'text',
                        mediaId: message.mediaId,
                        mediaSrc,
                        fileName: documentName !== 'Attachment' ? documentName : undefined,
                        text: visibleText || message.text || message.body || ''
                      });
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      color: '#94a3b8',
                      fontSize: '10px',
                      padding: '1px 5px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 2
                    }}
                    title="Forward this message"
                  >
                    ↗ Share
                  </button>
                  <span>{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  {message.direction === 'outbound' && (
                    <span className={`status-icon ${message.status || 'sent'}`}>
                      {statusLabel}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="input-composer">
        {sendError && <div className="composer-error">{sendError}</div>}
        {isRecording && (
          <div className="recording-bar">
            <span className="recording-dot" />
            <span className="recording-label">Recording… {recordingSeconds}s</span>
            <button onClick={stopRecording} className="recording-stop-btn">Send</button>
            <button onClick={() => {
              if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
              if (mediaRecorderRef.current) {
                mediaRecorderRef.current.onstop = null;
                if (mediaRecorderRef.current.state !== 'inactive') mediaRecorderRef.current.stop();
              }
              setIsRecording(false);
              audioChunksRef.current = [];
            }} className="recording-cancel-btn">Cancel</button>
          </div>
        )}
        {!isRecording && (
          <div className="composer-wrapper">
            <input
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
              placeholder={sending ? 'Sending...' : 'Type a message...'}
              disabled={sending}
            />
            <button
              onClick={startRecording}
              disabled={sending}
              className="mic-button"
              title="Record voice message"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
              </svg>
            </button>
            <button onClick={() => handleSendMessage()} disabled={sending || !newMessage.trim()} className="send-button">
              {sending ? '...' : (
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>

      {forwardModalItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 16
        }}>
          <div style={{
            background: '#0f172a',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            borderRadius: 14,
            width: '100%',
            maxWidth: 460,
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}>
            {/* Modal Header */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(56, 189, 248, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(30, 41, 59, 0.5)' }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#38bdf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>↗ Forward / Share on WhatsApp</span>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  From: {candidate.name} ({candidate.phone})
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setForwardModalItem(null); setForwardStatus(''); }}
                style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 18, cursor: 'pointer', padding: 4 }}
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              
              {/* Item Preview */}
              <div style={{ padding: 10, background: 'rgba(30, 41, 59, 0.6)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.06)', display: 'flex', gap: 10, alignItems: 'center' }}>
                {forwardModalItem.type === 'image' && forwardModalItem.mediaSrc && (
                  <img src={forwardModalItem.mediaSrc} alt="Preview" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} />
                )}
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
                    {forwardModalItem.type === 'image' ? '🖼️ Image / Photo Document' : forwardModalItem.type === 'audio' ? '🎵 Voice Note / Audio' : forwardModalItem.type === 'document' ? '📄 Document File (PDF)' : forwardModalItem.type === 'video' ? '🎬 Video Clip' : '💬 Text Message'}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {forwardModalItem.fileName || forwardModalItem.text?.slice(0, 50) || 'Attachment ready to share'}
                  </div>
                </div>
              </div>

              {/* Recipient Input & Candidate Autocomplete */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#cbd5e1', display: 'block', marginBottom: 4 }}>
                  Recipient WhatsApp Number:
                </label>
                <input
                  type="text"
                  placeholder="Type number e.g. 919876543210..."
                  value={forwardRecipient}
                  onChange={(e) => setForwardRecipient(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', background: '#1e293b', border: '1px solid rgba(56, 189, 248, 0.3)', borderRadius: 8, color: 'white', fontSize: 13, outline: 'none' }}
                />
              </div>

              {/* Contact Search Helper */}
              <div>
                <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Or Search Existing Candidate / Contact:
                </label>
                <input
                  type="text"
                  placeholder="🔍 Type contact name or trade..."
                  value={forwardContactSearch}
                  onChange={(e) => setForwardContactSearch(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 6, color: '#cbd5e1', fontSize: 11, outline: 'none' }}
                />

                {forwardContactSearch && (
                  <div style={{ maxHeight: 110, overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(56, 189, 248, 0.2)', borderRadius: 6, marginTop: 4 }}>
                    {allCandidatesForShare
                      .filter(c => c.name.toLowerCase().includes(forwardContactSearch.toLowerCase()) || c.phone.includes(forwardContactSearch))
                      .slice(0, 6)
                      .map(c => (
                        <div
                          key={c.id}
                          onClick={() => {
                            setForwardRecipient(c.phone);
                            setForwardContactSearch('');
                          }}
                          style={{ padding: '6px 10px', borderBottom: '1px solid rgba(255,255,255,0.05)', cursor: 'pointer', fontSize: 11, display: 'flex', justifyContent: 'space-between', color: '#e2e8f0' }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(56, 189, 248, 0.1)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                          <span style={{ color: '#38bdf8' }}>{c.phone}</span>
                        </div>
                      ))}
                  </div>
                )}
              </div>

              {/* Optional Custom Caption */}
              <div>
                <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 4 }}>
                  Optional Note / Caption:
                </label>
                <input
                  type="text"
                  placeholder={`Candidate ${candidate.name} CV/Photo document`}
                  value={forwardCustomCaption}
                  onChange={(e) => setForwardCustomCaption(e.target.value)}
                  style={{ width: '100%', padding: '6px 10px', background: 'rgba(30, 41, 59, 0.5)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: 6, color: '#cbd5e1', fontSize: 11, outline: 'none' }}
                />
              </div>

              {/* Status Message */}
              {forwardStatus && (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: 700,
                  textAlign: 'center',
                  background: forwardStatus.includes('✅') ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                  color: forwardStatus.includes('✅') ? '#4ade80' : '#f87171'
                }}>
                  {forwardStatus}
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={handleForwardItem}
                  disabled={forwarding || !forwardRecipient}
                  style={{
                    width: '100%',
                    padding: '10px',
                    borderRadius: 8,
                    border: 'none',
                    background: '#22c55e',
                    color: 'white',
                    fontWeight: 800,
                    fontSize: 12,
                    cursor: forwarding || !forwardRecipient ? 'not-allowed' : 'pointer',
                    opacity: forwarding || !forwardRecipient ? 0.6 : 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  <span>{forwarding ? 'Sending...' : '🚀 Send on WhatsApp (Cloud API)'}</span>
                </button>

                <a
                  href={getWhatsAppWebShareUrl()}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    width: '100%',
                    padding: '8px',
                    borderRadius: 8,
                    border: '1px solid rgba(34, 197, 94, 0.35)',
                    background: 'rgba(34, 197, 94, 0.08)',
                    color: '#4ade80',
                    fontWeight: 700,
                    fontSize: 11,
                    textAlign: 'center',
                    textDecoration: 'none',
                    display: 'block'
                  }}
                >
                  💬 Open & Share via WhatsApp Web / App ↗
                </a>
              </div>

            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .chat-panel-container {
          height: 100%;
          background: #0f172a;
          display: flex;
          flex-direction: column;
          overflow: hidden;
        }

        .chat-header {
          padding: 12px 16px;
          border-bottom: 1px solid rgba(56, 189, 248, 0.1);
          background: rgba(15, 23, 42, 0.84);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }

        .header-info {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
        }

        .chat-avatar {
          width: 40px;
          height: 40px;
          border-radius: 10px;
          background: linear-gradient(135deg, #0ea5e9, #6366f1);
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 800;
          font-size: 16px;
          color: white;
          flex-shrink: 0;
        }

        .candidate-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .candidate-name {
          font-weight: 700;
          color: white;
          font-size: 15px;
        }

        .agency-badge {
          background: #fca311;
          color: #111827;
          font-size: 9px;
          font-weight: 900;
          padding: 2px 6px;
          border-radius: 999px;
          letter-spacing: 0.05em;
        }

        .candidate-phone {
          font-size: 12px;
          color: #38bdf8;
          opacity: 0.9;
        }

        .header-actions {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .close-btn,
        .agency-toggle,
        .utility-toggle {
          background: rgba(30, 41, 59, 0.5);
          border: 1px solid rgba(56, 189, 248, 0.12);
          color: #94a3b8;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .close-btn,
        .agency-toggle {
          width: 32px;
          height: 32px;
          font-size: 10px;
          font-weight: 700;
        }

        .utility-toggle {
          height: 32px;
          padding: 0 10px;
          font-size: 11px;
          font-weight: 700;
        }

        .utility-toggle.active {
          color: #38bdf8;
          border-color: rgba(56, 189, 248, 0.35);
          background: rgba(56, 189, 248, 0.08);
        }

        .agency-toggle.active {
          color: #fca311;
          border-color: rgba(252, 163, 17, 0.35);
          background: rgba(252, 163, 17, 0.08);
        }

        .close-btn:hover {
          color: #f87171;
          border-color: rgba(248, 113, 113, 0.35);
        }

        .utility-drawer {
          padding: 10px 16px;
          background: rgba(11, 17, 32, 0.5);
          border-bottom: 1px solid rgba(56, 189, 248, 0.08);
        }

        .profile-summary {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .tags-container {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .tag {
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 999px;
          background: rgba(30, 41, 59, 0.75);
          color: #e2e8f0;
          border: 1px solid rgba(56, 189, 248, 0.08);
        }

        .tag.salary {
          color: #10b981;
          border-color: rgba(16, 185, 129, 0.15);
        }

        .asset-links {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .asset-btn {
          font-size: 11px;
          color: #38bdf8;
          text-decoration: none;
          padding: 4px 10px;
          border-radius: 8px;
          background: rgba(56, 189, 248, 0.05);
          border: 1px solid rgba(56, 189, 248, 0.15);
        }

        .edit-trigger {
          background: none;
          border: none;
          color: #94a3b8;
          font-size: 11px;
          cursor: pointer;
          padding: 0;
        }

        .profile-edit-form {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .form-input {
          background: #1e293b;
          border: 1px solid rgba(56, 189, 248, 0.2);
          color: white;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 12px;
          width: 100%;
        }

        .edit-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }

        .save-btn,
        .cancel-btn {
          border: none;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          cursor: pointer;
          font-weight: 700;
        }

        .save-btn {
          background: #0ea5e9;
          color: white;
        }

        .cancel-btn {
          background: rgba(239, 68, 68, 0.12);
          color: #fca5a5;
        }

        .templates-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 8px;
        }

        .section-title {
          font-size: 10px;
          font-weight: 800;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }

        .sync-tiny-btn {
          background: none;
          border: none;
          color: #38bdf8;
          font-size: 10px;
          cursor: pointer;
          font-weight: 700;
        }

        .templates-scroll {
          display: flex;
          gap: 8px;
          overflow-x: auto;
          padding-bottom: 4px;
          scrollbar-width: none;
        }

        .templates-scroll::-webkit-scrollbar {
          display: none;
        }

        .template-chip {
          white-space: nowrap;
          background: rgba(30, 41, 59, 0.8);
          border: 1px solid rgba(56, 189, 248, 0.15);
          color: #e2e8f0;
          padding: 7px 12px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
        }

        .template-chip.quick {
          color: #10b981;
          border-color: rgba(16, 185, 129, 0.16);
        }

        .no-templates-hint {
          color: #64748b;
          font-size: 11px;
          padding: 6px 0;
        }

        .message-feed {
          flex: 1;
          padding: 14px 16px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-height: 0;
        }

        .empty-state {
          text-align: center;
          color: #64748b;
          margin-top: 60px;
        }

        .empty-icon {
          font-size: 24px;
          margin-bottom: 10px;
          opacity: 0.5;
          font-weight: 700;
        }

        .message-row {
          display: flex;
          width: 100%;
        }

        .message-row.inbound {
          justify-content: flex-start;
        }

        .message-row.outbound {
          justify-content: flex-end;
        }

        .message-bubble {
          max-width: 86%;
          padding: 10px 12px;
          border-radius: 14px;
          font-size: 14px;
          line-height: 1.5;
          word-break: break-word;
        }

        .message-bubble.inbound {
          background: #1e293b;
          color: #f1f5f9;
          border-bottom-left-radius: 4px;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .message-bubble.outbound {
          background: linear-gradient(135deg, #0ea5e9, #6366f1);
          color: white;
          border-bottom-right-radius: 4px;
        }

        .message-bubble.outbound.failed {
          background: linear-gradient(135deg, #7f1d1d, #991b1b);
        }

        .message-tag {
          font-size: 10px;
          font-weight: 800;
          opacity: 0.65;
          text-transform: uppercase;
          margin-bottom: 4px;
        }

        .message-media {
          max-width: 100%;
          border-radius: 10px;
          margin-top: 4px;
          display: block;
        }

        .media-stack {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .media-link {
          display: block;
        }

        .message-video {
          width: 100%;
          max-height: 280px;
          border-radius: 12px;
          background: rgba(2, 6, 23, 0.65);
        }

        .document-block {
          display: flex;
          flex-direction: column;
          gap: 10px;
          background: rgba(2, 6, 23, 0.2);
          border-radius: 12px;
          padding: 10px;
        }

        .message-pdf {
          width: 100%;
          min-height: 280px;
          border: 0;
          border-radius: 10px;
          background: white;
        }

        .document-meta {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .document-name {
          font-weight: 700;
        }

        .document-type {
          font-size: 12px;
          opacity: 0.8;
        }

        .document-actions {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }

        .media-action-link {
          color: inherit;
          font-size: 12px;
          font-weight: 700;
          text-decoration: underline;
          opacity: 0.95;
        }

        .message-caption {
          font-size: 13px;
          line-height: 1.5;
        }

        .audio-block {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .audio-label {
          font-size: 12px;
          opacity: 0.8;
          font-style: italic;
        }

        .message-audio {
          width: 100%;
          height: 36px;
        }

        .message-meta {
          font-size: 10px;
          margin-top: 6px;
          display: flex;
          justify-content: flex-end;
          gap: 6px;
          opacity: 0.75;
        }

        .status-icon.read {
          color: #bfdbfe;
        }

        .status-icon.delivered {
          color: #bbf7d0;
        }

        .status-icon.failed {
          color: #fecaca;
          font-weight: 800;
        }

        .message-error {
          margin-top: 8px;
          padding-top: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.16);
          font-size: 12px;
          color: #fee2e2;
        }

        .input-composer {
          padding: 14px 16px;
          background: #0f172a;
          border-top: 1px solid rgba(56, 189, 248, 0.1);
        }

        .composer-error {
          margin-bottom: 10px;
          padding: 10px 12px;
          border-radius: 12px;
          background: rgba(127, 29, 29, 0.5);
          border: 1px solid rgba(248, 113, 113, 0.24);
          color: #fecaca;
          font-size: 12px;
        }

        .composer-wrapper {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #1e293b;
          padding: 8px 8px 8px 16px;
          border-radius: 28px;
          border: 1px solid rgba(56, 189, 248, 0.12);
        }

        .composer-wrapper input {
          flex: 1;
          background: none;
          border: none;
          color: white;
          outline: none;
          font-size: 14px;
        }

        .send-button {
          width: 40px;
          height: 40px;
          border-radius: 999px;
          background: #0ea5e9;
          color: white;
          border: none;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .send-button:disabled {
          background: #334155;
          cursor: not-allowed;
          opacity: 0.6;
        }

        .media-unavailable {
          display: flex;
          flex-direction: column;
          gap: 6px;
          padding: 10px 12px;
          background: rgba(2, 6, 23, 0.25);
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.07);
        }

        .media-unavailable-icon {
          font-size: 20px;
          line-height: 1;
        }

        .media-unavailable-label {
          font-size: 13px;
          font-weight: 600;
          opacity: 0.85;
        }

        .mic-button {
          flex-shrink: 0;
          width: 34px;
          height: 34px;
          border-radius: 50%;
          border: 1px solid rgba(56,189,248,0.25);
          background: rgba(56,189,248,0.07);
          color: #7dd3fc;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
        }

        .mic-button:hover {
          background: rgba(56,189,248,0.18);
          color: #38bdf8;
        }

        .mic-button:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .recording-bar {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          background: rgba(239,68,68,0.08);
          border-radius: 10px;
          border: 1px solid rgba(239,68,68,0.25);
        }

        .recording-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #ef4444;
          animation: blink 1s step-start infinite;
          flex-shrink: 0;
        }

        @keyframes blink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0; }
        }

        .recording-label {
          flex: 1;
          font-size: 13px;
          color: #fca5a5;
          font-weight: 600;
        }

        .recording-stop-btn {
          padding: 4px 12px;
          border-radius: 6px;
          border: none;
          background: #22c55e;
          color: #052e16;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .recording-cancel-btn {
          padding: 4px 10px;
          border-radius: 6px;
          border: 1px solid rgba(239,68,68,0.4);
          background: none;
          color: #f87171;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
