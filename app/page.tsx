'use client';

/**
 * app/page.tsx
 *
 * Mobile-first single-page UI for AI Print Art MVP 1.
 * Multi-step flow: Capture → Iterate → Preview → Done | Error
 *
 * Requirements: 20.1–20.7, 1.1–1.3, 3.1, 4.1, 10.1–10.7, 11.15, 14.6
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { mmToPx } from '@/lib/units';

// ---------------------------------------------------------------------------
// State machine types
// ---------------------------------------------------------------------------

type AppState =
  | { step: 'idle' }
  | {
      step: 'iterating';
      jobId: string;
      currentIteration: number;
      widthMm: number;
      heightMm: number;
    }
  | {
      step: 'awaiting_preview';
      jobId: string;
      currentIteration: number;
      widthMm: number;
      heightMm: number;
    }
  | {
      step: 'preview';
      jobId: string;
      widthMm: number;
      heightMm: number;
    }
  | {
      step: 'rendering_pdf';
      jobId: string;
      widthMm: number;
      heightMm: number;
    }
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
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AppState>({ step: 'idle' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  // Polling (Req 20.4)
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
      } catch {
        // ignore transient errors
      }
    };

    const interval = setInterval(() => { void poll(); }, 1500);
    void poll();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [state.step, 'jobId' in state ? state.jobId : '']);

  // ---------------------------------------------------------------------------
  // Preview scale computation (Req 20.5)
  // ---------------------------------------------------------------------------

  const computeScale = useCallback(() => {
    if (state.step !== 'preview' && state.step !== 'rendering_pdf') return;
    const container = previewContainerRef.current;
    if (!container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    const iframeWidth = mmToPx(state.widthMm);
    const iframeHeight = mmToPx(state.heightMm);

    const s = Math.min(containerWidth / iframeWidth, containerHeight / iframeHeight);
    setPreviewScale(s);
  }, [state]);

  useEffect(() => {
    computeScale();
    window.addEventListener('resize', computeScale);
    return () => window.removeEventListener('resize', computeScale);
  }, [computeScale]);

  // ---------------------------------------------------------------------------
  // Stage 1: Submit initial form (Req 20.2)
  // ---------------------------------------------------------------------------

  const handleSubmitInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageFile) { setError('Please select an image'); return; }

    const wMm = parseInt(widthMm, 10);
    const hMm = parseInt(heightMm, 10);
    if (!wMm || !hMm || wMm <= 0 || hMm <= 0) { setError('Width and height must be positive integers'); return; }
    if (!prompt.trim()) { setError('Prompt is required'); return; }

    setLoading(true);
    setError(null);

    try {
      // Compress image client-side (Req 1.2)
      const compressed = await imageCompression(imageFile, COMPRESSION_OPTIONS);

      const formData = new FormData();
      formData.append('image', compressed, 'image.jpg');
      formData.append('widthMm', String(wMm));
      formData.append('heightMm', String(hMm));
      formData.append('prompt', prompt);

      const res = await fetch('/api/jobs', { method: 'POST', body: formData });
      const data = (await res.json()) as { jobId?: string; iteration?: number; error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Failed to create job');
        return;
      }

      setState({
        step: 'iterating',
        jobId: data.jobId!,
        currentIteration: data.iteration!,
        widthMm: wMm,
        heightMm: hMm,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 3: Refine (Req 20.3)
  // ---------------------------------------------------------------------------

  const handleIterate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== 'iterating') return;
    if (!iteratePrompt.trim()) { setError('Prompt is required'); return; }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('prompt', iteratePrompt);
      if (iterateImage) {
        const compressed = await imageCompression(iterateImage, COMPRESSION_OPTIONS);
        formData.append('image', compressed, 'image.jpg');
      }

      const res = await fetch(`/api/jobs/${state.jobId}/iterate`, { method: 'POST', body: formData });
      const data = (await res.json()) as { iteration?: number; error?: string };

      if (!res.ok) {
        setError(data.error ?? 'Iteration failed');
        return;
      }

      setState((prev) => {
        if (prev.step !== 'iterating') return prev;
        return { ...prev, currentIteration: data.iteration! };
      });
      setIteratePrompt('');
      setIterateImage(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 3 → 4: Approve art (Req 20.3)
  // ---------------------------------------------------------------------------

  const handleApprove = async () => {
    if (state.step !== 'iterating') return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/jobs/${state.jobId}/approve`, { method: 'POST' });
      const data = (await res.json()) as { status?: string; error?: string };

      if (!res.ok && res.status !== 202) {
        setError(data.error ?? 'Approval failed');
        return;
      }

      setState((prev) => {
        if (prev.step !== 'iterating') return prev;
        return {
          step: 'awaiting_preview',
          jobId: prev.jobId,
          currentIteration: prev.currentIteration,
          widthMm: prev.widthMm,
          heightMm: prev.heightMm,
        };
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Stage 6 → 7: Approve preview / render PDF (Req 20.5)
  // ---------------------------------------------------------------------------

  const handleRenderPdf = async () => {
    if (state.step !== 'preview') return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/jobs/${state.jobId}/render-pdf`, { method: 'POST' });
      const data = (await res.json()) as { pdfPath?: string; status?: string; error?: string };

      if (!res.ok && res.status !== 202) {
        setError(data.error ?? 'PDF rendering failed');
        return;
      }

      if (data.pdfPath) {
        setState({ step: 'done', jobId: state.jobId });
      } else {
        setState((prev) => {
          if (prev.step !== 'preview') return prev;
          return { step: 'rendering_pdf', jobId: prev.jobId, widthMm: prev.widthMm, heightMm: prev.heightMm };
        });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const styles: Record<string, React.CSSProperties> = {
    container: { maxWidth: 480, margin: '0 auto', padding: '16px', fontFamily: 'system-ui, sans-serif' },
    title: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
    label: { display: 'block', marginBottom: 4, fontWeight: 600, fontSize: 14 },
    input: { width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 16, boxSizing: 'border-box' },
    textarea: { width: '100%', padding: '8px 12px', border: '1px solid #ccc', borderRadius: 6, fontSize: 16, minHeight: 80, boxSizing: 'border-box' },
    button: { width: '100%', padding: '12px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
    buttonSecondary: { width: '100%', padding: '12px', background: '#666', color: '#fff', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
    buttonDanger: { width: '100%', padding: '12px', background: '#e00', color: '#fff', border: 'none', borderRadius: 6, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
    fieldGroup: { marginBottom: 16 },
    row: { display: 'flex', gap: 12 },
    error: { background: '#fee', border: '1px solid #f00', borderRadius: 6, padding: '8px 12px', marginBottom: 12, color: '#c00', fontSize: 14 },
    spinner: { textAlign: 'center', padding: 24, color: '#666' },
    previewContainer: { width: '100%', height: '60vh', overflow: 'hidden', position: 'relative', background: '#f0f0f0', borderRadius: 8, marginBottom: 16 },
    image: { width: '100%', borderRadius: 8, marginBottom: 16 },
  };

  // Step: idle — capture form
  if (state.step === 'idle') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>AI Print Art</h1>
        {error && <div style={styles.error}>{error}</div>}
        <form onSubmit={(e) => { void handleSubmitInitial(e); }}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Photo / Image</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={styles.input}
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div style={{ ...styles.fieldGroup, ...styles.row }}>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Width (mm)</label>
              <input
                type="number"
                min="1"
                style={styles.input}
                value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)}
                placeholder="e.g. 300"
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={styles.label}>Height (mm)</label>
              <input
                type="number"
                min="1"
                style={styles.input}
                value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)}
                placeholder="e.g. 500"
              />
            </div>
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Prompt</label>
            <textarea
              style={styles.textarea}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the art you want to create..."
            />
          </div>
          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Generating...' : 'Generate Art'}
          </button>
        </form>
      </main>
    );
  }

  // Step: iterating — show current iteration + refine form
  if (state.step === 'iterating') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Refine Your Art</h1>
        <p style={{ color: '#666', fontSize: 14, marginBottom: 12 }}>Iteration {state.currentIteration}</p>
        {error && <div style={styles.error}>{error}</div>}

        <img
          src={`/api/jobs/${state.jobId}/iterations/${state.currentIteration}`}
          alt={`Iteration ${state.currentIteration}`}
          style={styles.image}
        />

        <form onSubmit={(e) => { void handleIterate(e); }}>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>Refine prompt</label>
            <textarea
              style={styles.textarea}
              value={iteratePrompt}
              onChange={(e) => setIteratePrompt(e.target.value)}
              placeholder="Describe changes..."
            />
          </div>
          <div style={styles.fieldGroup}>
            <label style={styles.label}>New reference image (optional)</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={styles.input}
              onChange={(e) => setIterateImage(e.target.files?.[0] ?? null)}
            />
          </div>
          <button type="submit" style={styles.button} disabled={loading}>
            {loading ? 'Refining...' : 'Refine'}
          </button>
        </form>

        <button
          style={styles.buttonSecondary}
          onClick={() => { void handleApprove(); }}
          disabled={loading}
        >
          {loading ? 'Processing...' : 'Approve Art →'}
        </button>
      </main>
    );
  }

  // Step: awaiting_preview — polling
  if (state.step === 'awaiting_preview') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Processing...</h1>
        <div style={styles.spinner}>
          <p>Extracting layout and removing text from image.</p>
          <p>This may take a minute...</p>
        </div>
      </main>
    );
  }

  // Step: preview — show iframe with scale-to-fit
  if (state.step === 'preview') {
    const iframeWidth = mmToPx(state.widthMm);
    const iframeHeight = mmToPx(state.heightMm);

    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Preview</h1>
        {error && <div style={styles.error}>{error}</div>}

        <div ref={previewContainerRef} style={styles.previewContainer}>
          <div
            style={{
              transformOrigin: 'top left',
              transform: `scale(${previewScale})`,
              width: iframeWidth,
              height: iframeHeight,
            }}
          >
            <iframe
              src={`/api/jobs/${state.jobId}/preview-html`}
              width={iframeWidth}
              height={iframeHeight}
              style={{ border: 'none', display: 'block' }}
              onLoad={computeScale}
              title="Layout Preview"
            />
          </div>
        </div>

        <button
          style={styles.button}
          onClick={() => { void handleRenderPdf(); }}
          disabled={loading}
        >
          {loading ? 'Generating PDF...' : 'Approve & Generate PDF'}
        </button>
      </main>
    );
  }

  // Step: rendering_pdf — polling
  if (state.step === 'rendering_pdf') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Generating PDF...</h1>
        <div style={styles.spinner}>
          <p>Rendering your print-ready PDF.</p>
          <p>This may take a moment...</p>
        </div>
      </main>
    );
  }

  // Step: done — download
  if (state.step === 'done') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Done!</h1>
        <p style={{ marginBottom: 16 }}>Your print-ready PDF is ready.</p>
        <a
          href={`/api/jobs/${state.jobId}/pdf`}
          download
          style={{ ...styles.button, display: 'block', textAlign: 'center', textDecoration: 'none' }}
        >
          Download PDF
        </a>
        <button
          style={styles.buttonSecondary}
          onClick={() => setState({ step: 'idle' })}
        >
          New Job
        </button>
      </main>
    );
  }

  // Step: error
  if (state.step === 'error') {
    return (
      <main style={styles.container}>
        <h1 style={styles.title}>Error</h1>
        <div style={styles.error}>{state.errorMessage}</div>
        <button
          style={styles.buttonDanger}
          onClick={() => setState({ step: 'idle' })}
        >
          Start Over
        </button>
      </main>
    );
  }

  return null;
}
