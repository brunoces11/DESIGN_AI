'use client';

/**
 * app/page.tsx
 *
 * Mobile-first single-page UI for AI Print Art MVP 1.
 * Multi-step flow: Capture → Iterate → Preview → Done | Error
 * Gear icon (top-right, all screens) opens the Prompt Settings modal.
 *
 * Requirements: 20.1–20.7, 1.1–1.3, 3.1, 4.1, 10.1–10.7, 11.15, 14.6
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { mmToPx } from '@/lib/units';
import SettingsModal from './components/SettingsModal';

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

type AppState =
  | { step: 'idle' }
  | { step: 'iterating'; jobId: string; currentIteration: number; widthMm: number; heightMm: number }
  | { step: 'awaiting_preview'; jobId: string; currentIteration: number; widthMm: number; heightMm: number }
  | { step: 'preview'; jobId: string; widthMm: number; heightMm: number }
  | { step: 'rendering_pdf'; jobId: string; widthMm: number; heightMm: number }
  | { step: 'done'; jobId: string }
  | { step: 'error'; errorMessage: string };

// ---------------------------------------------------------------------------
// Compression options (Req 1.2)
// ---------------------------------------------------------------------------

const COMPRESSION_OPTIONS = {
  maxSizeMB: 4,
  maxWidthOrHeight: 2048,
  initialQuality: 0.85,
  fileType: 'image/jpeg' as const,
  useWebWorker: true,
};

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const S: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#f8fafc',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  topBar: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
  },
  topBarTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#111',
    margin: 0,
  },
  gearBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 22,
    lineHeight: 1,
    padding: '4px 6px',
    borderRadius: 6,
    color: '#6b7280',
    transition: 'background 0.15s',
  },
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: '20px 16px',
  },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 16, color: '#111' },
  label: { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14, color: '#374151' },
  input: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 16,
    boxSizing: 'border-box' as const,
    background: '#fff',
    color: '#111',
  },
  textarea: {
    width: '100%',
    padding: '9px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 15,
    minHeight: 88,
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    background: '#fff',
    color: '#111',
    lineHeight: 1.5,
  },
  btn: {
    width: '100%',
    padding: '13px',
    background: '#0070f3',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 10,
  },
  btnSecondary: {
    width: '100%',
    padding: '13px',
    background: '#374151',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 10,
  },
  btnDanger: {
    width: '100%',
    padding: '13px',
    background: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: 10,
  },
  fieldGroup: { marginBottom: 16 },
  row: { display: 'flex', gap: 12 },
  error: {
    background: '#fef2f2',
    border: '1px solid #fca5a5',
    borderRadius: 7,
    padding: '10px 14px',
    marginBottom: 14,
    color: '#b91c1c',
    fontSize: 14,
  },
  spinner: { textAlign: 'center' as const, padding: '40px 24px', color: '#6b7280' },
  spinnerDot: { fontSize: 32, marginBottom: 12 },
  previewContainer: {
    width: '100%',
    height: '60vh',
    overflow: 'hidden',
    position: 'relative' as const,
    background: '#e5e7eb',
    borderRadius: 10,
    marginBottom: 16,
  },
  image: { width: '100%', borderRadius: 10, marginBottom: 16, display: 'block' },
  iterMeta: { color: '#6b7280', fontSize: 13, marginBottom: 12 },
};

// ---------------------------------------------------------------------------
// TopBar — shared across all steps
// ---------------------------------------------------------------------------

function TopBar({ onSettings }: { onSettings: () => void }) {
  return (
    <div style={S.topBar}>
      <h1 style={S.topBarTitle}>🎨 AI Print Art</h1>
      <button
        style={S.gearBtn}
        onClick={onSettings}
        aria-label="Open prompt settings"
        title="Prompt Settings"
      >
        ⚙️
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AppState>({ step: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Stage 1 form state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const [prompt, setPrompt] = useState('');

  // Stage 3 iterate state
  const [iteratePrompt, setIteratePrompt] = useState('');
  const [iterateImage, setIterateImage] = useState<File | null>(null);

  // Preview scale
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(1);

  // ---------------------------------------------------------------------------
  // Polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (state.step !== 'awaiting_preview' && state.step !== 'rendering_pdf') return;

    const jobId = state.jobId;
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/status`);
        if (!res.ok) return;
        const data = (await res.json()) as {
          status: string;
          currentIteration: number;
          errorMessage: string | null;
        };
        if (cancelled) return;

        if (data.status === 'preview_ready') {
          setState((prev) => {
            if (prev.step !== 'awaiting_preview') return prev;
            return { step: 'preview', jobId: prev.jobId, widthMm: prev.widthMm, heightMm: prev.heightMm };
          });
        } else if (data.status === 'pdf_ready') {
          setState({ step: 'done', jobId });
        } else if (data.status === 'error') {
          setState({ step: 'error', errorMessage: data.errorMessage ?? 'Unknown error' });
        }
      } catch { /* ignore transient */ }
    };

    const interval = setInterval(() => { void poll(); }, 1500);
    void poll();
    return () => { cancelled = true; clearInterval(interval); };
  }, [state.step, 'jobId' in state ? state.jobId : '']);

  // ---------------------------------------------------------------------------
  // Preview scale
  // ---------------------------------------------------------------------------

  const computeScale = useCallback(() => {
    if (state.step !== 'preview' && state.step !== 'rendering_pdf') return;
    const container = previewContainerRef.current;
    if (!container) return;
    const s = Math.min(
      container.clientWidth / mmToPx(state.widthMm),
      container.clientHeight / mmToPx(state.heightMm),
    );
    setPreviewScale(s);
  }, [state]);

  useEffect(() => {
    computeScale();
    window.addEventListener('resize', computeScale);
    return () => window.removeEventListener('resize', computeScale);
  }, [computeScale]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSubmitInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageFile) { setError('Please select an image'); return; }
    const wMm = parseInt(widthMm, 10);
    const hMm = parseInt(heightMm, 10);
    if (!wMm || !hMm || wMm <= 0 || hMm <= 0) { setError('Width and height must be positive integers'); return; }
    if (!prompt.trim()) { setError('Prompt is required'); return; }

    setLoading(true); setError(null);
    try {
      const compressed = await imageCompression(imageFile, COMPRESSION_OPTIONS);
      const fd = new FormData();
      fd.append('image', compressed, 'image.jpg');
      fd.append('widthMm', String(wMm));
      fd.append('heightMm', String(hMm));
      fd.append('prompt', prompt);

      const res = await fetch('/api/jobs', { method: 'POST', body: fd });
      const data = (await res.json()) as { jobId?: string; iteration?: number; error?: string };
      if (!res.ok) { setError(data.error ?? 'Failed to create job'); return; }

      setState({ step: 'iterating', jobId: data.jobId!, currentIteration: data.iteration!, widthMm: wMm, heightMm: hMm });
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  const handleIterate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== 'iterating') return;
    if (!iteratePrompt.trim()) { setError('Prompt is required'); return; }

    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('prompt', iteratePrompt);
      if (iterateImage) {
        const compressed = await imageCompression(iterateImage, COMPRESSION_OPTIONS);
        fd.append('image', compressed, 'image.jpg');
      }
      const res = await fetch(`/api/jobs/${state.jobId}/iterate`, { method: 'POST', body: fd });
      const data = (await res.json()) as { iteration?: number; error?: string };
      if (!res.ok) { setError(data.error ?? 'Iteration failed'); return; }

      setState((prev) => prev.step !== 'iterating' ? prev : { ...prev, currentIteration: data.iteration! });
      setIteratePrompt(''); setIterateImage(null);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  const handleApprove = async () => {
    if (state.step !== 'iterating') return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/jobs/${state.jobId}/approve`, { method: 'POST' });
      const data = (await res.json()) as { status?: string; error?: string };
      if (!res.ok && res.status !== 202) { setError(data.error ?? 'Approval failed'); return; }
      setState((prev) => prev.step !== 'iterating' ? prev : {
        step: 'awaiting_preview', jobId: prev.jobId,
        currentIteration: prev.currentIteration, widthMm: prev.widthMm, heightMm: prev.heightMm,
      });
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  const handleRenderPdf = async () => {
    if (state.step !== 'preview') return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/jobs/${state.jobId}/render-pdf`, { method: 'POST' });
      const data = (await res.json()) as { pdfPath?: string; status?: string; error?: string };
      if (!res.ok && res.status !== 202) { setError(data.error ?? 'PDF rendering failed'); return; }
      if (data.pdfPath) {
        setState({ step: 'done', jobId: state.jobId });
      } else {
        setState((prev) => prev.step !== 'preview' ? prev : {
          step: 'rendering_pdf', jobId: prev.jobId, widthMm: prev.widthMm, heightMm: prev.heightMm,
        });
      }
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderError = () => error ? <div style={S.error}>{error}</div> : null;

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    // idle
    if (state.step === 'idle') return (
      <div style={S.container}>
        <h2 style={S.title}>New Job</h2>
        {renderError()}
        <form onSubmit={(e) => { void handleSubmitInitial(e); }}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Photo / Image</label>
            <input type="file" accept="image/*" capture="environment" style={S.input}
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
          </div>
          <div style={{ ...S.fieldGroup, ...S.row }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Width (mm)</label>
              <input type="number" min="1" style={S.input} value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)} placeholder="e.g. 300" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Height (mm)</label>
              <input type="number" min="1" style={S.input} value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)} placeholder="e.g. 500" />
            </div>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Prompt</label>
            <textarea style={S.textarea} value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the art you want to create…" />
          </div>
          <button type="submit" style={S.btn} disabled={loading}>
            {loading ? 'Generating…' : 'Generate Art'}
          </button>
        </form>
      </div>
    );

    // iterating
    if (state.step === 'iterating') return (
      <div style={S.container}>
        <h2 style={S.title}>Refine Your Art</h2>
        <p style={S.iterMeta}>Iteration {state.currentIteration}</p>
        {renderError()}
        <img src={`/api/jobs/${state.jobId}/iterations/${state.currentIteration}`}
          alt={`Iteration ${state.currentIteration}`} style={S.image} />
        <form onSubmit={(e) => { void handleIterate(e); }}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Refine prompt</label>
            <textarea style={S.textarea} value={iteratePrompt}
              onChange={(e) => setIteratePrompt(e.target.value)} placeholder="Describe changes…" />
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>New reference image (optional)</label>
            <input type="file" accept="image/*" capture="environment" style={S.input}
              onChange={(e) => setIterateImage(e.target.files?.[0] ?? null)} />
          </div>
          <button type="submit" style={S.btn} disabled={loading}>
            {loading ? 'Refining…' : 'Refine'}
          </button>
        </form>
        <button style={S.btnSecondary} onClick={() => { void handleApprove(); }} disabled={loading}>
          {loading ? 'Processing…' : 'Approve Art →'}
        </button>
      </div>
    );

    // awaiting_preview
    if (state.step === 'awaiting_preview') return (
      <div style={S.container}>
        <div style={S.spinner}>
          <div style={S.spinnerDot}>⏳</div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Processing…</p>
          <p style={{ fontSize: 14 }}>Extracting layout and removing text from image.</p>
          <p style={{ fontSize: 14 }}>This may take a minute.</p>
        </div>
      </div>
    );

    // preview
    if (state.step === 'preview') {
      const iframeW = mmToPx(state.widthMm);
      const iframeH = mmToPx(state.heightMm);
      return (
        <div style={S.container}>
          <h2 style={S.title}>Preview</h2>
          {renderError()}
          <div ref={previewContainerRef} style={S.previewContainer}>
            <div style={{ transformOrigin: 'top left', transform: `scale(${previewScale})`, width: iframeW, height: iframeH }}>
              <iframe src={`/api/jobs/${state.jobId}/preview-html`}
                width={iframeW} height={iframeH}
                style={{ border: 'none', display: 'block' }}
                onLoad={computeScale} title="Layout Preview" />
            </div>
          </div>
          <button style={S.btn} onClick={() => { void handleRenderPdf(); }} disabled={loading}>
            {loading ? 'Generating PDF…' : 'Approve & Generate PDF'}
          </button>
        </div>
      );
    }

    // rendering_pdf
    if (state.step === 'rendering_pdf') return (
      <div style={S.container}>
        <div style={S.spinner}>
          <div style={S.spinnerDot}>📄</div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Generating PDF…</p>
          <p style={{ fontSize: 14 }}>Rendering your print-ready file.</p>
        </div>
      </div>
    );

    // done
    if (state.step === 'done') return (
      <div style={S.container}>
        <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h2 style={{ ...S.title, textAlign: 'center' }}>Done!</h2>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>Your print-ready PDF is ready.</p>
        </div>
        <a href={`/api/jobs/${state.jobId}/pdf`} download
          style={{ ...S.btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          ⬇️ Download PDF
        </a>
        <button style={S.btnSecondary} onClick={() => setState({ step: 'idle' })}>
          New Job
        </button>
      </div>
    );

    // error
    if (state.step === 'error') return (
      <div style={S.container}>
        <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <h2 style={{ ...S.title, textAlign: 'center' }}>Something went wrong</h2>
        </div>
        <div style={S.error}>{state.errorMessage}</div>
        <button style={S.btnDanger} onClick={() => setState({ step: 'idle' })}>
          Start Over
        </button>
      </div>
    );

    return null;
  };

  // ---------------------------------------------------------------------------
  // Root render
  // ---------------------------------------------------------------------------

  return (
    <div style={S.page}>
      <TopBar onSettings={() => setShowSettings(true)} />
      {renderStep()}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
