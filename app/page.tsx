'use client';

/**
 * app/page.tsx
 *
 * Mobile-first single-page UI for AI Print Art MVP 1.
 * Multi-step flow: text_setup → text_review → Iterate → Preview → Done | Error
 * Gear icon (top-right, all screens) opens the Prompt Settings modal.
 *
 * Requirements: 3, 4, 7, 9.9, 12.3
 * Tasks: 7.1–7.8
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import imageCompression from 'browser-image-compression';
import { mmToPx } from '@/lib/units';
import SettingsModal from './components/SettingsModal';

// ---------------------------------------------------------------------------
// State machine types (Task 7.1)
// ---------------------------------------------------------------------------

type EditableTextItem = { id: string; label: string; value: string };

type AppState =
  | { step: 'text_setup' }
  | { step: 'text_review'; jobId: string; widthMm: number; heightMm: number; warning?: 'vision_unavailable' }
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
  warning: {
    background: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: 7,
    padding: '10px 14px',
    marginBottom: 14,
    color: '#92400e',
    fontSize: 14,
  },
  hint: {
    background: '#f0f9ff',
    border: '1px solid #bae6fd',
    borderRadius: 7,
    padding: '8px 12px',
    marginTop: 8,
    color: '#0369a1',
    fontSize: 13,
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
// Image model selector
// ---------------------------------------------------------------------------

type ImageModel = 'gpt-image-1' | 'gpt-image-2';

const IMAGE_MODEL_OPTIONS: { value: ImageModel; label: string; badge?: string }[] = [
  { value: 'gpt-image-1', label: 'GPT Image 1' },
  { value: 'gpt-image-2', label: 'GPT Image 2', badge: 'NEW' },
];

// ---------------------------------------------------------------------------
// TopBar — shared across all steps
// ---------------------------------------------------------------------------

function TopBar({
  onSettings,
  imageModel,
  onImageModelChange,
}: {
  onSettings: () => void;
  imageModel: ImageModel;
  onImageModelChange: (m: ImageModel) => void;
}) {
  return (
    <div style={S.topBar}>
      <h1 style={S.topBarTitle}>🎨 AI Print Art</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <select
          value={imageModel}
          onChange={(e) => onImageModelChange(e.target.value as ImageModel)}
          style={{
            padding: '5px 8px',
            border: '1px solid #d1d5db',
            borderRadius: 6,
            fontSize: 13,
            background: '#fff',
            color: '#374151',
            cursor: 'pointer',
          }}
          title="Modelo de geração de imagem"
        >
          {IMAGE_MODEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}{opt.badge ? ` ✨` : ''}
            </option>
          ))}
        </select>
        <button
          style={S.gearBtn}
          onClick={onSettings}
          aria-label="Open prompt settings"
          title="Prompt Settings"
        >
          ⚙️
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Home() {
  const [state, setState] = useState<AppState>({ step: 'text_setup' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [imageModel, setImageModel] = useState<ImageModel>('gpt-image-1');

  // Shared form state (Task 7.1 — hoisted to top-level)
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [widthMm, setWidthMm] = useState('');
  const [heightMm, setHeightMm] = useState('');
  const [prompt, setPrompt] = useState('');
  const [textItems, setTextItems] = useState<EditableTextItem[]>([]);

  // Iterate state
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
  // Task 7.7 — Reset on file change
  // ---------------------------------------------------------------------------

  const onImageFileChange = (file: File | null) => {
    setImageFile(file);
    if (state.step === 'text_review') {
      setTextItems([]);
      setState({ step: 'text_setup' });
    }
  };

  // ---------------------------------------------------------------------------
  // Task 7.2 — handleAnalyzeReference
  // ---------------------------------------------------------------------------

  const handleAnalyzeReference = async () => {
    if (!imageFile) return;
    const wMm = parseInt(widthMm, 10);
    const hMm = parseInt(heightMm, 10);
    if (!wMm || !hMm || wMm <= 0 || hMm <= 0) { setError('Width and height must be positive integers'); return; }
    setLoading(true); setError(null);
    try {
      const compressed = await imageCompression(imageFile, COMPRESSION_OPTIONS);
      const fd = new FormData();
      fd.append('image', compressed, 'image.jpg');
      fd.append('widthMm', String(wMm));
      fd.append('heightMm', String(hMm));
      if (prompt) fd.append('prompt', prompt);
      const res = await fetch('/api/jobs/analyze-reference', { method: 'POST', body: fd });
      const data = (await res.json()) as { jobId?: string; status?: string; textItems?: EditableTextItem[]; warning?: string; error?: string };
      if (!res.ok || !data.jobId) { setError(data.error ?? 'Analysis failed'); return; }
      setTextItems(data.textItems ?? []);
      setState({ step: 'text_review', jobId: data.jobId, widthMm: wMm, heightMm: hMm, warning: data.warning as 'vision_unavailable' | undefined });
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  // ---------------------------------------------------------------------------
  // Task 7.3 — handleSubmitInitial (branches on jobId)
  // ---------------------------------------------------------------------------

  const handleSubmitInitial = async (e: React.FormEvent) => {
    e.preventDefault();
    const wMm = parseInt(widthMm, 10);
    const hMm = parseInt(heightMm, 10);
    if (!wMm || !hMm || wMm <= 0 || hMm <= 0) { setError('Width and height must be positive integers'); return; }
    if (!prompt.trim()) { setError('Prompt is required'); return; }
    // Client-side validation: no image and no non-empty textItem → block (Req 12.3)
    const hasImage = !!imageFile;
    const hasNonEmpty = textItems.some(t => t.value.trim().length > 0);
    if (!hasImage && !hasNonEmpty && state.step !== 'text_review') {
      setError('Adicione ao menos um texto ou envie uma imagem de referência');
      return;
    }
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('widthMm', String(wMm));
      fd.append('heightMm', String(hMm));
      fd.append('prompt', prompt);
      fd.append('textItems', JSON.stringify(textItems));
      fd.append('imageModel', imageModel);
      if (state.step === 'text_review') fd.append('jobId', state.jobId);
      if (imageFile) {
        const compressed = await imageCompression(imageFile, COMPRESSION_OPTIONS);
        fd.append('image', compressed, 'image.jpg');
      }
      const res = await fetch('/api/jobs', { method: 'POST', body: fd });
      const data = (await res.json()) as { jobId?: string; iteration?: number; error?: string };
      if (!res.ok || !data.jobId) { setError(data.error ?? 'Failed to create job'); return; }
      setState({ step: 'iterating', jobId: data.jobId, currentIteration: data.iteration!, widthMm: wMm, heightMm: hMm });
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  // ---------------------------------------------------------------------------
  // Task 7.4 — handleIterate (includes textItems)
  // ---------------------------------------------------------------------------

  const handleIterate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.step !== 'iterating') return;
    if (!iteratePrompt.trim()) { setError('Prompt is required'); return; }
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.append('prompt', iteratePrompt);
      fd.append('textItems', JSON.stringify(textItems));
      fd.append('imageModel', imageModel);
      if (iterateImage) {
        const compressed = await imageCompression(iterateImage, COMPRESSION_OPTIONS);
        fd.append('image', compressed, 'image.jpg');
      }
      const res = await fetch(`/api/jobs/${state.jobId}/iterate`, { method: 'POST', body: fd });
      const data = (await res.json()) as { iteration?: number; error?: string };
      if (!res.ok || data.iteration == null) { setError(data.error ?? 'Iteration failed'); return; }
      setState(prev => prev.step !== 'iterating' ? prev : { ...prev, currentIteration: data.iteration! });
      setIteratePrompt(''); setIterateImage(null);
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  };

  // ---------------------------------------------------------------------------
  // Existing handlers (unchanged)
  // ---------------------------------------------------------------------------

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
  // Task 7.5 — renderTextBriefEditor
  // ---------------------------------------------------------------------------

  const renderTextBriefEditor = () => (
    <div style={S.fieldGroup}>
      <label style={S.label}>Textos da arte</label>
      {textItems.map((item) => (
        <div key={item.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
          <input
            placeholder="label (ex: titulo)"
            value={item.label}
            maxLength={64}
            style={{ ...S.input, flex: '0 0 120px', fontSize: 13 }}
            onChange={(e) => setTextItems(prev => prev.map(t => t.id === item.id ? { ...t, label: e.target.value } : t))}
          />
          <input
            placeholder="texto"
            value={item.value}
            maxLength={500}
            style={{ ...S.input, flex: 1, fontSize: 13 }}
            onChange={(e) => setTextItems(prev => prev.map(t => t.id === item.id ? { ...t, value: e.target.value } : t))}
          />
          {item.value.trim().length === 0 && (
            <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 6px', borderRadius: 4, fontSize: 11, whiteSpace: 'nowrap' }}>
              será ignorado
            </span>
          )}
          <button
            type="button"
            onClick={() => setTextItems(prev => prev.filter(t => t.id !== item.id))}
            style={{ background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', padding: '4px 8px', fontSize: 13, color: '#6b7280' }}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setTextItems(prev => [...prev, { id: crypto.randomUUID(), label: '', value: '' }])}
        style={{ background: 'none', border: '1px dashed #d1d5db', borderRadius: 6, cursor: 'pointer', padding: '6px 12px', fontSize: 13, color: '#6b7280', marginTop: 4 }}
      >
        + Adicionar texto
      </button>
    </div>
  );

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const renderError = () => error ? <div style={S.error}>{error}</div> : null;

  // ---------------------------------------------------------------------------
  // Task 7.6 — Disabled-button rules (computed before rendering)
  // ---------------------------------------------------------------------------

  const wMmInt = parseInt(widthMm, 10);
  const hMmInt = parseInt(heightMm, 10);
  const dimsValid = wMmInt > 0 && hMmInt > 0;
  const hasImage = !!imageFile;
  const hasNonEmpty = textItems.some(t => t.value.trim().length > 0);
  const showAnalyzeBtn = (state.step === 'text_setup') && hasImage;
  const analyzeDisabled = loading || !dimsValid;
  const generateDisabled = loading || !dimsValid || !prompt.trim() || (state.step === 'text_setup' && !hasImage && !hasNonEmpty);
  const generateHint = (!hasImage && !hasNonEmpty && state.step === 'text_setup') ? 'Adicione ao menos um texto ou envie uma imagem de referência' : null;

  // ---------------------------------------------------------------------------
  // Steps
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    // text_setup (replaces idle)
    if (state.step === 'text_setup') return (
      <div style={S.container}>
        <h2 style={S.title}>Nova Arte</h2>
        {renderError()}
        <form onSubmit={(e) => { void handleSubmitInitial(e); }}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Foto / Imagem de referência</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={S.input}
              onChange={(e) => onImageFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
          <div style={{ ...S.fieldGroup, ...S.row }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Largura (mm)</label>
              <input type="number" min="1" style={S.input} value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)} placeholder="ex: 300" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Altura (mm)</label>
              <input type="number" min="1" style={S.input} value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)} placeholder="ex: 500" />
            </div>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Prompt</label>
            <textarea style={S.textarea} value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Descreva a arte que você quer criar…" />
          </div>
          {renderTextBriefEditor()}
          {generateHint && (
            <div style={S.hint}>{generateHint}</div>
          )}
          {showAnalyzeBtn && (
            <button
              type="button"
              style={{ ...S.btnSecondary, opacity: analyzeDisabled ? 0.5 : 1, cursor: analyzeDisabled ? 'not-allowed' : 'pointer' }}
              disabled={analyzeDisabled}
              onClick={() => { void handleAnalyzeReference(); }}
            >
              {loading ? 'Analisando…' : 'Analisar imagem'}
            </button>
          )}
          <button
            type="submit"
            style={{ ...S.btn, opacity: generateDisabled ? 0.5 : 1, cursor: generateDisabled ? 'not-allowed' : 'pointer' }}
            disabled={generateDisabled}
          >
            {loading ? 'Gerando…' : 'Gerar arte'}
          </button>
        </form>
      </div>
    );

    // text_review (new screen)
    if (state.step === 'text_review') return (
      <div style={S.container}>
        <h2 style={S.title}>Revisar Textos</h2>
        {renderError()}
        {state.warning === 'vision_unavailable' && (
          <div style={S.warning}>
            Não conseguimos detectar textos automaticamente, você pode adicioná-los manualmente.
          </div>
        )}
        <form onSubmit={(e) => { void handleSubmitInitial(e); }}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Foto / Imagem de referência</label>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={S.input}
              onChange={(e) => onImageFileChange(e.target.files?.[0] ?? null)}
            />
          </div>
          <div style={{ ...S.fieldGroup, ...S.row }}>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Largura (mm)</label>
              <input type="number" min="1" style={S.input} value={widthMm}
                onChange={(e) => setWidthMm(e.target.value)} placeholder="ex: 300" />
            </div>
            <div style={{ flex: 1 }}>
              <label style={S.label}>Altura (mm)</label>
              <input type="number" min="1" style={S.input} value={heightMm}
                onChange={(e) => setHeightMm(e.target.value)} placeholder="ex: 500" />
            </div>
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Prompt</label>
            <textarea style={S.textarea} value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Descreva a arte que você quer criar…" />
          </div>
          {renderTextBriefEditor()}
          {/* "Analisar imagem" is HIDDEN in text_review (Req 4.5) */}
          <button
            type="submit"
            style={{ ...S.btn, opacity: (loading || !dimsValid || !prompt.trim()) ? 0.5 : 1, cursor: (loading || !dimsValid || !prompt.trim()) ? 'not-allowed' : 'pointer' }}
            disabled={loading || !dimsValid || !prompt.trim()}
          >
            {loading ? 'Gerando…' : 'Gerar arte'}
          </button>
        </form>
      </div>
    );

    // iterating (updated with text brief editor)
    if (state.step === 'iterating') return (
      <div style={S.container}>
        <h2 style={S.title}>Refinar Arte</h2>
        <p style={S.iterMeta}>Iteração {state.currentIteration}</p>
        {renderError()}
        <img src={`/api/jobs/${state.jobId}/iterations/${state.currentIteration}`}
          alt={`Iteração ${state.currentIteration}`} style={S.image} />
        {renderTextBriefEditor()}
        <form onSubmit={(e) => { void handleIterate(e); }}>
          <div style={S.fieldGroup}>
            <label style={S.label}>Prompt de refinamento</label>
            <textarea style={S.textarea} value={iteratePrompt}
              onChange={(e) => setIteratePrompt(e.target.value)} placeholder="Descreva as alterações…" />
          </div>
          <div style={S.fieldGroup}>
            <label style={S.label}>Nova imagem de referência (opcional)</label>
            <input type="file" accept="image/*" capture="environment" style={S.input}
              onChange={(e) => setIterateImage(e.target.files?.[0] ?? null)} />
          </div>
          <button type="submit" style={S.btn} disabled={loading}>
            {loading ? 'Refinando…' : 'Refinar'}
          </button>
        </form>
        <button style={S.btnSecondary} onClick={() => { void handleApprove(); }} disabled={loading}>
          {loading ? 'Processando…' : 'Aprovar Arte →'}
        </button>
      </div>
    );

    // awaiting_preview
    if (state.step === 'awaiting_preview') return (
      <div style={S.container}>
        <div style={S.spinner}>
          <div style={S.spinnerDot}>⏳</div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Processando…</p>
          <p style={{ fontSize: 14 }}>Extraindo layout e removendo texto da imagem.</p>
          <p style={{ fontSize: 14 }}>Isso pode levar um minuto.</p>
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
            {loading ? 'Gerando PDF…' : 'Aprovar & Gerar PDF'}
          </button>
        </div>
      );
    }

    // rendering_pdf
    if (state.step === 'rendering_pdf') return (
      <div style={S.container}>
        <div style={S.spinner}>
          <div style={S.spinnerDot}>📄</div>
          <p style={{ fontWeight: 600, marginBottom: 8 }}>Gerando PDF…</p>
          <p style={{ fontSize: 14 }}>Renderizando seu arquivo para impressão.</p>
        </div>
      </div>
    );

    // done
    if (state.step === 'done') return (
      <div style={S.container}>
        <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h2 style={{ ...S.title, textAlign: 'center' }}>Pronto!</h2>
          <p style={{ color: '#6b7280', marginBottom: 24 }}>Seu PDF para impressão está pronto.</p>
        </div>
        <a href={`/api/jobs/${state.jobId}/pdf`} download
          style={{ ...S.btn, display: 'block', textAlign: 'center', textDecoration: 'none' }}>
          ⬇️ Baixar PDF
        </a>
        <button style={S.btnSecondary} onClick={() => {
          // Reset to text_setup (not idle) — Task 7.1 / IMPORTANT note
          setState({ step: 'text_setup' });
          setImageFile(null);
          setWidthMm('');
          setHeightMm('');
          setPrompt('');
          setTextItems([]);
        }}>
          Nova Arte
        </button>
      </div>
    );

    // error
    if (state.step === 'error') return (
      <div style={S.container}>
        <div style={{ textAlign: 'center', padding: '32px 0 16px' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>❌</div>
          <h2 style={{ ...S.title, textAlign: 'center' }}>Algo deu errado</h2>
        </div>
        <div style={S.error}>{state.errorMessage}</div>
        <button style={S.btnDanger} onClick={() => setState({ step: 'text_setup' })}>
          Recomeçar
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
      <TopBar
        onSettings={() => setShowSettings(true)}
        imageModel={imageModel}
        onImageModelChange={setImageModel}
      />
      {renderStep()}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  );
}
