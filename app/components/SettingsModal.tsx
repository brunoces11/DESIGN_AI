'use client';

/**
 * SettingsModal — Prompt configuration panel
 *
 * Shows all three system prompts with their variables documented.
 * Allows editing and saving prompts permanently.
 */

import { useState, useEffect, useCallback } from 'react';
import type { PromptDefinition } from '@/lib/prompts';

// ---------------------------------------------------------------------------
// Types (client-safe subset — no fs imports)
// ---------------------------------------------------------------------------

interface PromptsConfig {
  imageGeneration: string;
  removeText: string;
  visionLayout: string;
}

interface PromptsResponse {
  config: PromptsConfig;
  definitions: PromptDefinition[];
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.55)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    padding: '16px',
    overflowY: 'auto' as const,
  },
  modal: {
    background: '#fff',
    borderRadius: 12,
    width: '100%',
    maxWidth: 680,
    marginTop: 16,
    marginBottom: 32,
    boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid #e5e7eb',
    background: '#f9fafb',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: 700,
    color: '#111',
    margin: 0,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    color: '#6b7280',
    lineHeight: 1,
    padding: '2px 6px',
    borderRadius: 4,
  },
  body: {
    padding: '20px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 28,
  },
  promptCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    overflow: 'hidden',
  },
  promptCardHeader: {
    padding: '12px 16px',
    background: '#f3f4f6',
    borderBottom: '1px solid #e5e7eb',
  },
  promptLabel: {
    fontSize: 14,
    fontWeight: 700,
    color: '#111',
    margin: '0 0 4px 0',
  },
  promptDesc: {
    fontSize: 12,
    color: '#6b7280',
    margin: 0,
    lineHeight: 1.5,
  },
  varsSection: {
    padding: '10px 16px',
    background: '#fafafa',
    borderBottom: '1px solid #e5e7eb',
  },
  varsTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    marginBottom: 8,
  },
  varRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    marginBottom: 6,
    fontSize: 12,
  },
  varBadge: {
    background: '#dbeafe',
    color: '#1d4ed8',
    borderRadius: 4,
    padding: '1px 6px',
    fontFamily: 'monospace',
    fontWeight: 600,
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
  },
  varDesc: {
    color: '#374151',
    lineHeight: 1.4,
  },
  varExample: {
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  noVars: {
    fontSize: 12,
    color: '#9ca3af',
    fontStyle: 'italic',
  },
  textareaWrap: {
    padding: '12px 16px',
  },
  textarea: {
    width: '100%',
    minHeight: 140,
    padding: '10px 12px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 1.6,
    resize: 'vertical' as const,
    boxSizing: 'border-box' as const,
    color: '#111',
    background: '#fff',
    outline: 'none',
  },
  footer: {
    padding: '14px 20px',
    borderTop: '1px solid #e5e7eb',
    display: 'flex',
    gap: 10,
    justifyContent: 'flex-end',
    background: '#f9fafb',
  },
  btnSave: {
    padding: '9px 22px',
    background: '#0070f3',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  },
  btnReset: {
    padding: '9px 18px',
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  btnCancel: {
    padding: '9px 18px',
    background: '#fff',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  statusMsg: {
    fontSize: 13,
    padding: '6px 12px',
    borderRadius: 6,
    alignSelf: 'center',
  },
  statusOk: { color: '#15803d', background: '#dcfce7' },
  statusErr: { color: '#b91c1c', background: '#fee2e2' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  onClose: () => void;
}

export default function SettingsModal({ onClose }: Props) {
  const [definitions, setDefinitions] = useState<PromptDefinition[]>([]);
  const [drafts, setDrafts] = useState<PromptsConfig | null>(null);
  const [originals, setOriginals] = useState<PromptsConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Load prompts on mount
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/prompts');
        const data = (await res.json()) as PromptsResponse;
        setDefinitions(data.definitions);
        setDrafts({ ...data.config });
        setOriginals({ ...data.config });
      } catch (err) {
        setStatus({ type: 'err', msg: `Failed to load: ${String(err)}` });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = useCallback((id: keyof PromptsConfig, value: string) => {
    setDrafts((prev) => prev ? { ...prev, [id]: value } : prev);
    setStatus(null);
  }, []);

  const handleSave = async () => {
    if (!drafts) return;
    setSaving(true);
    setStatus(null);
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(drafts),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? 'Save failed');
      }
      setOriginals({ ...drafts });
      setStatus({ type: 'ok', msg: 'Prompts saved successfully.' });
    } catch (err) {
      setStatus({ type: 'err', msg: String(err) });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originals) {
      setDrafts({ ...originals });
      setStatus(null);
    }
  };

  // Close on overlay click
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div style={S.overlay} onClick={handleOverlayClick}>
      <div style={S.modal} role="dialog" aria-modal="true" aria-label="Prompt Settings">
        {/* Header */}
        <div style={S.header}>
          <h2 style={S.headerTitle}>⚙️ Prompt Settings</h2>
          <button style={S.closeBtn} onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        {/* Body */}
        <div style={S.body}>
          {loading && (
            <p style={{ color: '#6b7280', textAlign: 'center', padding: 24 }}>Loading prompts…</p>
          )}

          {!loading && drafts && definitions.map((def) => (
            <div key={def.id} style={S.promptCard}>
              {/* Card header */}
              <div style={S.promptCardHeader}>
                <p style={S.promptLabel}>{def.label}</p>
                <p style={S.promptDesc}>{def.description}</p>
              </div>

              {/* Variables */}
              <div style={S.varsSection}>
                <div style={S.varsTitle}>Available variables</div>
                {def.variables.length === 0 ? (
                  <p style={S.noVars}>No dynamic variables — static prompt.</p>
                ) : (
                  def.variables.map((v) => (
                    <div key={v.name} style={S.varRow}>
                      <span style={S.varBadge}>{`{{${v.name}}}`}</span>
                      <span style={S.varDesc}>
                        {v.description}
                        {v.example && (
                          <span style={S.varExample}> — e.g. &ldquo;{v.example}&rdquo;</span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </div>

              {/* Textarea */}
              <div style={S.textareaWrap}>
                <textarea
                  style={S.textarea}
                  value={drafts[def.id]}
                  onChange={(e) => handleChange(def.id, e.target.value)}
                  spellCheck={false}
                  aria-label={`${def.label} prompt`}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          {status && (
            <span style={{ ...S.statusMsg, ...(status.type === 'ok' ? S.statusOk : S.statusErr) }}>
              {status.msg}
            </span>
          )}
          <button style={S.btnReset} onClick={handleReset} disabled={saving}>
            Reset changes
          </button>
          <button style={S.btnCancel} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button style={S.btnSave} onClick={() => { void handleSave(); }} disabled={saving || loading}>
            {saving ? 'Saving…' : 'Save prompts'}
          </button>
        </div>
      </div>
    </div>
  );
}
