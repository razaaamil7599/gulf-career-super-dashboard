'use client';

import Image from 'next/image';
import { useState, useRef } from 'react';
import { processDocument, requestNewPhoto } from '@/lib/api';

export default function DocumentUploader() {
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [candidateName, setCandidateName] = useState('');
  const [processing, setProcessing] = useState(false);
  const [progressText, setProgressText] = useState("AI is scanning...");
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState<{ message: string; status?: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(newFiles: FileList | null) {
    if (!newFiles) return;
    const arr = Array.from(newFiles).filter((f) => f.type.startsWith('image/'));
    setFiles((prev) => [...prev, ...arr]);
    arr.forEach((f) => {
      const reader = new FileReader();
      reader.onload = (e) => setPreviews((prev) => [...prev, e.target?.result as string]);
      reader.readAsDataURL(f);
    });
    setResult(null);
  }

  function removeFile(i: number) {
    setFiles((f) => f.filter((_, idx) => idx !== i));
    setPreviews((p) => p.filter((_, idx) => idx !== i));
  }

  async function handleProcess() {
    if (files.length === 0) return;
    setProcessing(true);
    setProgressText("AI is scanning...");
    setResult(null);
    setError(null);
    
    // Simulated Progress
    const statuses = ["AI is scanning...", "Restoring document...", "Finalizing PDF..."];
    let step = 0;
    const progressInterval = setInterval(() => {
      step = (step + 1) % statuses.length;
      setProgressText(statuses[step]);
    }, 2500);

    try {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('candidateName', candidateName || 'Candidate');
      fd.append('candidateId', 'Default_Upload');
      const res = await processDocument(fd);
      setResult(res);
    } catch (err: any) {
      console.warn('[DocumentUploader] Caught API Rejection:', err.message);
      const msg = err.response?.data?.error || err.response?.data?.rejectionReason || 'Connection to backend failed.';
      const status = err.response?.data?.status;
      setError({ message: msg, status });
    } finally { 
      clearInterval(progressInterval);
      setProcessing(false); 
    }
  }

  async function handleWhatsAppRequest() {
    if (!candidateName) {
      alert("Please enter candidate name first to find their phone record.");
      return;
    }
    setProcessing(true);
    setProgressText("Sending WhatsApp Request...");
    try {
      await requestNewPhoto(candidateName);
      alert("✅ WhatsApp Request Sent Successfully!");
      setFiles([]);
      setPreviews([]);
      setError(null);
    } catch (err: any) {
      const msg = err.response?.data?.error || "Failed to send WhatsApp request.";
      alert("❌ Error: " + msg);
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'white' }}>AI Document Vision</h2>
        <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748b' }}>
          Upload candidate document photos — auto-correct, compile to PDF, and save.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20 }}>
        {/* Upload Zone */}
        <div>
          <div
            className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          >
            <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', marginBottom: 6 }}>
              Drop document photos here
            </div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              Passport, Visa, IQAMA, Certificates — JPG/PNG/HEIC
            </div>
            <div style={{ marginTop: 14, fontSize: 12, color: '#38bdf8', fontWeight: 600 }}>
              Click to browse files
            </div>
            <input ref={inputRef} type="file" multiple accept="image/*" style={{ display: 'none' }}
              onChange={(e) => handleFiles(e.target.files)} />
          </div>

          {/* Image Previews */}
          {previews.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8, marginTop: 14 }}>
              {previews.map((src, i) => (
                <div key={i} style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', aspectRatio: '3/4', background: '#0f172a' }}>
                  <Image
                    src={src}
                    alt={`Page ${i + 1}`}
                    fill
                    unoptimized
                    style={{ objectFit: 'cover' }}
                  />
                  <button onClick={() => removeFile(i)} style={{
                    position: 'absolute', top: 4, right: 4,
                    background: 'rgba(251,113,133,0.9)', border: 'none',
                    borderRadius: '50%', width: 20, height: 20,
                    color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 700,
                  }}>✕</button>
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: 'rgba(0,0,0,0.6)', fontSize: 10, color: 'white', textAlign: 'center', padding: '3px 0' }}>
                    Page {i + 1}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Controls & Result Panel */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="glass-card" style={{ padding: 18 }}>
            <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Processing Options</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 5, fontWeight: 600 }}>Candidate Name</label>
              <input
                value={candidateName}
                onChange={(e) => setCandidateName(e.target.value)}
                placeholder="e.g. Mohammad Ali"
                style={{ width: '100%', background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 6, padding: '8px 12px', color: 'white', fontSize: 13 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {['✅ Auto perspective correction', '✅ A4 page normalization', '✅ Professional PDF compilation', '✅ GCS upload (or local save)'].map((f) => (
                <div key={f} style={{ fontSize: 12, color: '#64748b' }}>{f}</div>
              ))}
            </div>
            {/* Error Banner */}
            {error && (
              <div className="animate-fade-in" style={{ 
                marginBottom: 14, 
                padding: '12px 14px', 
                background: 'rgba(239, 68, 68, 0.15)', 
                border: '1px solid rgba(239, 68, 68, 0.3)', 
                borderRadius: 8,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f87171' }}>AI Audit Failed</div>
                    <div style={{ fontSize: 11, color: '#fca5a5' }}>{error.message}</div>
                  </div>
                </div>
                {error.status === 'NEED_MANUAL_REPOST' ? (
                  <button 
                    onClick={handleWhatsAppRequest}
                    disabled={processing}
                    style={{
                      background: '#16a34a', // WhatsApp Green
                      border: 'none',
                      color: '#ffffff',
                      padding: '8px',
                      borderRadius: '6px',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                      marginTop: '4px',
                      opacity: processing ? 0.5 : 1
                    }}
                  >
                    💬 Send WhatsApp Request
                  </button>
                ) : (
                  <button 
                    onClick={() => { setFiles([]); setPreviews([]); setError(null); }}
                    disabled={processing}
                    style={{
                      background: 'rgba(239, 68, 68, 0.2)',
                      border: '1px solid rgba(239, 68, 68, 0.4)',
                      color: '#f87171',
                      padding: '8px',
                      borderRadius: '6px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      marginTop: '4px'
                    }}
                  >
                    📸 Request New Photo
                  </button>
                )}
              </div>
            )}

            <button className="btn-primary" onClick={handleProcess}
              disabled={files.length === 0 || processing}
              style={{ width: '100%', justifyContent: 'center' }}>
              {processing ? <><div className="spinner" /> {progressText}</> : `⚡ Process ${files.length} Image${files.length !== 1 ? 's' : ''}`}
            </button>
          </div>

          {/* Result */}
          {result && !result.isAiFailed && (
            <div className="glass-card animate-fade-in" style={{ padding: 18, borderColor: 'rgba(52,211,153,0.3)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#34d399', marginBottom: 12 }}>✅ PDF Generated!</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
                <div>📄 Pages: {result.pageCount}</div>
                <div>📦 Size: {(result.pdfSizeBytes / 1024).toFixed(1)} KB</div>
                <div>💾 {result.isLocal ? 'Saved locally (emulator)' : 'Uploaded to GCS'}</div>
              </div>
              {(!result.pdfSizeBytes || result.pdfSizeBytes === 0) ? (
                 <button className="btn-primary" disabled style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none', fontSize: 13, opacity: 0.5 }}>
                   ⚠️ Validation Error: File Empty (0 KB)
                 </button>
              ) : (
                <a href={result.pdfUrl} target="_blank" rel="noreferrer"
                  className="btn-primary" style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none', fontSize: 13 }}>
                  📥 Download PDF
                </a>
              )}
            </div>
          )}

          {result && result.isAiFailed && (
            <div className="glass-card animate-fade-in" style={{ padding: 18, borderColor: 'rgba(239, 68, 68, 0.3)', background: 'rgba(239, 68, 68, 0.05)' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#f87171', marginBottom: 12 }}>⚠️ Safe Mode: AI Reconstruction Failed</div>
              <div style={{ fontSize: 12, color: '#fca5a5', marginBottom: 14 }}>
                 Error: Document is unreadable or heavily obstructed by finger. A raw fallback PDF has been generated instead.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: '#94a3b8', marginBottom: 14 }}>
                <div>📄 Pages: {result.pageCount}</div>
                <div>📦 Size: {(result.pdfSizeBytes / 1024).toFixed(1)} KB</div>
                <div>💾 {result.isLocal ? 'Saved locally (emulator)' : 'Uploaded to GCS'}</div>
              </div>
              {(!result.pdfSizeBytes || result.pdfSizeBytes === 0) ? (
                 <button className="btn-primary" disabled style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none', fontSize: 13, opacity: 0.5 }}>
                   ⚠️ File Empty (0 KB)
                 </button>
              ) : (
                <a href={result.pdfUrl} target="_blank" rel="noreferrer"
                  className="btn-primary" style={{ display: 'flex', justifyContent: 'center', textDecoration: 'none', fontSize: 13, background: '#ef4444', borderColor: '#b91c1c' }}>
                  📥 Download Fallback PDF
                </a>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
