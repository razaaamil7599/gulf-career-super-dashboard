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
}

export default function BotConfigPortal() {
  const [configs, setConfigs] = useState<WhatsAppConfig[]>([]);
  const [selectedConfig, setSelectedConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  
  // Form State
  const [phone, setPhone] = useState('');
  const [phoneId, setPhoneId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [token, setToken] = useState('');
  const [botType, setBotType] = useState<'GCG' | 'ARS' | 'CUSTOM'>('GCG');
  const [assistantName, setAssistantName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [languageMode, setLanguageMode] = useState<'hinglish' | 'hindi' | 'english' | 'arabic'>('hinglish');
  const [tone, setTone] = useState('');
  const [rawInstructions, setRawInstructions] = useState('');

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get('/api/messages/configs');
      if (res.data?.success) {
        setConfigs(res.data.configs || []);
      }
    } catch (err) {
      console.error('Failed to fetch WhatsApp configs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfigs();
  }, [fetchConfigs]);

  function handleSelectConfig(config: WhatsAppConfig) {
    setSelectedConfig(config);
    setIsEditing(true);
    setPhone(config.phone);
    setPhoneId(config.phoneId);
    setWabaId(config.wabaId);
    setToken(config.token || '');
    setBotType(config.botType || 'GCG');
    setAssistantName(config.assistantName || '');
    setOwnerName(config.ownerName || '');
    setLanguageMode(config.languageMode || 'hinglish');
    setTone(config.tone || '');
    setRawInstructions(Array.isArray(config.instructions) ? config.instructions.join('\n') : '');
  }

  function handleNewConfig() {
    setSelectedConfig(null);
    setIsEditing(true);
    setPhone('');
    setPhoneId('');
    setWabaId('');
    setToken('');
    setBotType('GCG');
    setAssistantName('Raza');
    setOwnerName('A R Khan');
    setLanguageMode('hinglish');
    setTone('Hinglish me short, direct, helpful, aur admin-instruction-following.');
    setRawInstructions('');
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!phone || !phoneId || !wabaId) {
      alert('Phone, Phone ID, and WABA ID are required.');
      return;
    }

    const payload: WhatsAppConfig = {
      phone: phone.replace(/\D/g, ''),
      phoneId: phoneId.trim(),
      wabaId: wabaId.trim(),
      token: token.trim() || undefined,
      botType,
      assistantName: assistantName.trim(),
      ownerName: ownerName.trim(),
      languageMode,
      tone: tone.trim(),
      instructions: rawInstructions.split('\n').map(line => line.trim()).filter(Boolean),
    };

    try {
      const res = await axios.post('/api/messages/configs', payload);
      if (res.data?.success) {
        alert('WhatsApp Bot Configuration saved successfully!');
        setIsEditing(false);
        setSelectedConfig(null);
        fetchConfigs();
      } else {
        alert('Failed to save configuration: ' + (res.data?.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Error saving configuration: ' + (err.response?.data?.error || err.message));
    }
  }

  async function handleDelete(phoneNum: string) {
    if (!confirm('Are you sure you want to delete this configuration?')) return;
    try {
      const res = await axios.delete(`/api/messages/configs/${phoneNum}`);
      if (res.data?.success) {
        alert('WhatsApp Bot Configuration deleted.');
        setIsEditing(false);
        setSelectedConfig(null);
        fetchConfigs();
      } else {
        alert('Failed to delete config.');
      }
    } catch (err: any) {
      alert('Error deleting config: ' + err.message);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 24, height: 'calc(100vh - 150px)', overflow: 'hidden' }}>
      
      {/* Left panel: List of numbers */}
      <div className="glass-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: 'white' }}>WhatsApp Numbers</h3>
          <button className="btn-primary" style={{ padding: '6px 12px', fontSize: 11 }} onClick={handleNewConfig}>
            + Add New
          </button>
        </div>

        {loading && <div style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading numbers...</div>}

        {!loading && configs.length === 0 && (
          <div style={{ padding: '40px 10px', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
            No connected numbers found. Add one to customize its bot instructions.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {configs.map((config) => (
            <div
              key={config.phone}
              onClick={() => handleSelectConfig(config)}
              style={{
                background: 'rgba(15,23,42,0.4)',
                border: selectedConfig?.phone === config.phone ? '1px solid #38bdf8' : '1px solid rgba(56,189,248,0.1)',
                borderRadius: 10,
                padding: 14,
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <div style={{ color: 'white', fontWeight: 600, fontSize: 13 }}>+{config.phone}</div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 3 }}>Bot: {config.assistantName || 'Raza'}</div>
              </div>
              <span
                style={{
                  fontSize: 9,
                  background: config.botType === 'ARS' ? 'rgba(251,146,60,0.18)' : 'rgba(34,197,94,0.13)',
                  color: config.botType === 'ARS' ? '#fb923c' : '#4ade80',
                  fontWeight: 800,
                  padding: '2px 6px',
                  borderRadius: 4
                }}
              >
                {config.botType || 'GCG'}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel: Config Detail Form */}
      <div className="glass-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {isEditing ? (
          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(56,189,248,0.1)', paddingBottom: 12 }}>
              <h3 style={{ margin: 0, fontSize: 16, color: 'white', fontWeight: 700 }}>
                {selectedConfig ? `Edit Bot: +${phone}` : 'Configure New WhatsApp Bot'}
              </h3>
              {selectedConfig && (
                <button
                  type="button"
                  onClick={() => handleDelete(selectedConfig.phone)}
                  style={{
                    background: 'rgba(239,68,68,0.1)',
                    color: '#f87171',
                    border: '1px solid rgba(239,68,68,0.2)',
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: 12,
                    cursor: 'pointer'
                  }}
                >
                  Delete Number
                </button>
              )}
            </div>

            {/* Meta API Settings */}
            <div>
              <h4 style={{ margin: '0 0 16px', fontSize: 13, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Meta API Credentials</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Phone Number</label>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="919411055707"
                    required
                    disabled={!!selectedConfig}
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Phone Number ID</label>
                  <input
                    value={phoneId}
                    onChange={(e) => setPhoneId(e.target.value)}
                    placeholder="1004575229405481"
                    required
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>WABA ID</label>
                  <input
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="1636003747813268"
                    required
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
              </div>
              <div style={{ marginTop: 16 }}>
                <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>
                  <span>Meta Access Token (Optional)</span>
                  <span style={{ color: '#64748b', fontWeight: 400 }}>Inherits global token if left blank</span>
                </label>
                <input
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="EAALopX..."
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                />
              </div>
            </div>

            {/* Persona Settings */}
            <div>
              <h4 style={{ margin: '0 0 16px', fontSize: 13, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bot Persona & Instructions</h4>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Bot Type</label>
                  <select
                    value={botType}
                    onChange={(e) => setBotType(e.target.value as 'GCG' | 'ARS' | 'CUSTOM')}
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  >
                    <option value="GCG">GCG Recruiter (Raza Flow)</option>
                    <option value="ARS">AR Studios (Music/Redirection Flow)</option>
                    <option value="CUSTOM">Custom Bot Flow</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Assistant Name</label>
                  <input
                    value={assistantName}
                    onChange={(e) => setAssistantName(e.target.value)}
                    placeholder="Raza"
                    required
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Owner/Manager Name</label>
                  <input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="A R Khan"
                    required
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Preferred Language Mode</label>
                  <select
                    value={languageMode}
                    onChange={(e) => setLanguageMode(e.target.value as any)}
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  >
                    <option value="hinglish">Roman Urdu / Hinglish</option>
                    <option value="hindi">Hindi (Devanagari)</option>
                    <option value="english">English</option>
                    <option value="arabic">Arabic</option>
                  </select>
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 6, fontWeight: 600 }}>Tone Instructions</label>
                  <input
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    placeholder="Hinglish me short, direct, helpful, aur professional tone."
                    style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5 }}>Custom Instructions (One rule per line - e.g. Visa ticket is free. Service charge 25000 INR.)</label>
                <textarea
                  value={rawInstructions}
                  onChange={(e) => setRawInstructions(e.target.value)}
                  placeholder="Visa ticket is free.&#10;Office service charge of 25,000 INR must be paid."
                  rows={6}
                  style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13, fontFamily: 'monospace' }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', borderTop: '1px solid rgba(56,189,248,0.1)', paddingTop: 16 }}>
              <button
                type="button"
                className="tab-btn"
                onClick={() => {
                  setIsEditing(false);
                  setSelectedConfig(null);
                }}
                style={{ padding: '8px 16px' }}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save Configuration
              </button>
            </div>
          </form>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#64748b', gap: 12 }}>
            <div style={{ fontSize: 36 }}>📱</div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Select a WhatsApp number on the left to configure or click "+ Add New" to add a new bot.</div>
          </div>
        )}
      </div>
    </div>
  );
}
