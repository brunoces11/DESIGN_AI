/**
 * Integration E2E test (Tasks 8.1, 8.2)
 *
 * Tests the full pipeline by calling the route handlers directly (in-process),
 * mocking ONLY lib/openai.ts. Uses real Playwright for PDF generation.
 *
 * Full flow: POST /api/jobs → iterate → approve → poll → preview-html → render-pdf → pdf
 *
 * Requirements: 1, 5, 6, 8, 11, 14
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// ---------------------------------------------------------------------------
// Mock lib/openai.ts BEFORE importing anything that uses it
// ---------------------------------------------------------------------------

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'fixtures');

vi.mock('@/lib/openai', () => ({
  generateImageToImage: vi.fn(async () => {
    return fs.readFile(path.join(FIXTURES_DIR, 'iter.png'));
  }),
  regenerateWithoutText: vi.fn(async () => {
    return fs.readFile(path.join(FIXTURES_DIR, 'clean.png'));
  }),
  extractLayoutVision: vi.fn(async () => {
    const raw = await fs.readFile(path.join(FIXTURES_DIR, 'vision.json'), 'utf-8');
    return JSON.parse(raw) as unknown;
  }),
}));

// ---------------------------------------------------------------------------
// Setup isolated DB and storage for tests
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'e2e-test-'));
  process.env['SQLITE_PATH'] = path.join(tmpDir, 'test.db');
  process.env['STORAGE_ROOT'] = path.join(tmpDir, 'jobs');
  process.env['OPENAI_API_KEY'] = 'test-key-e2e';
});

afterAll(async () => {
  // Give the DB singleton time to release, then cleanup
  await new Promise((r) => setTimeout(r, 100));
  try {
    await fs.rm(tmpDir, { recursive: true, force: true });
  } catch {
    // On Windows, files may be locked — ignore cleanup errors
  }
});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks and env setup
// ---------------------------------------------------------------------------

// We test the core pipeline functions directly rather than via HTTP
// to avoid the complexity of spinning up a Next.js server in test mode.

import { insertJob, getJob, transitionStatus, updateJob, getTextBrief, setTextBrief } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { generateImageToImage, regenerateWithoutText, extractLayoutVision } from '@/lib/openai';
import { extractLayoutVisionWithRetry } from '@/lib/openai/visionRetry';
import { mergeBriefWithVisionLayout, VisionResponseSchema } from '@/lib/layout/normalize';
import { renderLayoutHTML } from '@/lib/layout/render';
import { renderPdf } from '@/lib/pdf';
import type { LayoutInput } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function runStage4(jobId: string): Promise<void> {
  const job = getJob(jobId);
  if (!job) throw new Error('Job not found');

  const approved = await localStorage.readBytes(jobId, `iterations/${job.current_iteration}.png`);
  await localStorage.saveBytes(jobId, 'approved.png', approved);

  const [rawVision, cleanPng] = await Promise.all([
    extractLayoutVisionWithRetry(approved, 1),
    regenerateWithoutText({ baseImage: approved, originalPrompt: job.initial_prompt }),
  ]);

  await localStorage.saveJson(jobId, 'vision.json', rawVision);
  await localStorage.saveBytes(jobId, 'clean.png', cleanPng);

  const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;

  // Load brief from DB; default to empty if not set (Req 8.3, 8.4)
  const brief = getTextBrief(jobId) ?? { textItems: [] };

  const layoutInput = mergeBriefWithVisionLayout({
    brief,
    visionResponse: rawVision,
    imageWidthPx: rawVision.imageWidthPx,
    imageHeightPx: rawVision.imageHeightPx,
    canvasWidthMm: job.width_mm,
    canvasHeightMm: job.height_mm,
    backgroundDataUrl: cleanDataUrl,
  });

  const persisted = { ...layoutInput, background: { dataUrl: '__deferred__' } };
  await localStorage.saveJson(jobId, 'layout.json', persisted);
  updateJob(jobId, { layout_json: JSON.stringify(persisted) });

  const ok = transitionStatus(jobId, ['processing_step4'], 'preview_ready');
  if (!ok) throw new Error('Failed to transition to preview_ready');
}

// ---------------------------------------------------------------------------
// E2E Test — original full pipeline
// ---------------------------------------------------------------------------

describe('E2E — Full pipeline with mocked OpenAI', () => {
  it('completes the full flow: create → iterate → approve → preview → pdf', async () => {
    const jobId = crypto.randomUUID();
    const widthMm = 300;
    const heightMm = 500;

    // -----------------------------------------------------------------------
    // Stage 1: Insert job and save original image
    // -----------------------------------------------------------------------
    insertJob({ id: jobId, widthMm, heightMm, initialPrompt: 'Create a colorful banner' });

    const originalJpg = await fs.readFile(path.join(FIXTURES_DIR, 'original.jpg'));
    await localStorage.saveBytes(jobId, 'original.jpg', originalJpg);

    // Set a text brief so the merge has something to work with
    await setTextBrief(jobId, {
      textItems: [
        { id: crypto.randomUUID(), label: 'titulo', value: 'PROMOÇÃO' },
      ],
    });

    const t1 = transitionStatus(jobId, ['created'], 'iterating');
    expect(t1).toBe(true);

    // -----------------------------------------------------------------------
    // Stage 2: Generate first iteration
    // -----------------------------------------------------------------------
    const iter1 = await generateImageToImage({ baseImage: originalJpg, prompt: 'Create a colorful banner' });
    await localStorage.saveBytes(jobId, 'iterations/1.png', iter1);
    updateJob(jobId, { current_iteration: 1 });

    let job = getJob(jobId);
    expect(job?.status).toBe('iterating');
    expect(job?.current_iteration).toBe(1);

    // -----------------------------------------------------------------------
    // Stage 3: Iterate once more
    // -----------------------------------------------------------------------
    const baseImage = await localStorage.readBytes(jobId, 'iterations/1.png');
    const iter2 = await generateImageToImage({ baseImage, prompt: 'Make it more vibrant' });
    await localStorage.saveBytes(jobId, 'iterations/2.png', iter2);
    updateJob(jobId, { current_iteration: 2 });

    job = getJob(jobId);
    expect(job?.current_iteration).toBe(2);

    // -----------------------------------------------------------------------
    // Stage 4: Approve → processing_step4 → preview_ready
    // -----------------------------------------------------------------------
    const t4 = transitionStatus(jobId, ['iterating'], 'processing_step4');
    expect(t4).toBe(true);

    await runStage4(jobId);

    job = getJob(jobId);
    expect(job?.status).toBe('preview_ready');
    expect(job?.layout_json).not.toBeNull();

    // -----------------------------------------------------------------------
    // Stage 5: Get preview HTML
    // -----------------------------------------------------------------------
    const cleanPng = await localStorage.readBytes(jobId, 'clean.png');
    const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;

    const layoutInput = JSON.parse(job!.layout_json!) as LayoutInput;
    layoutInput.background = { dataUrl: cleanDataUrl };

    const html = renderLayoutHTML(layoutInput);

    // Assert @page rule with exact dimensions
    expect(html).toContain(`@page { size: ${widthMm}mm ${heightMm}mm; margin: 0 }`);

    // Assert background image is embedded as base64
    expect(html).toContain('<img class="bg" src="data:image/png;base64,');

    // Assert one text element (brief has 1 non-empty item, vision has 2 → min(1,2)=1 matched)
    const textDivMatches = html.match(/<div class="text"/g);
    expect(textDivMatches).not.toBeNull();
    expect(textDivMatches!.length).toBe(1);

    // -----------------------------------------------------------------------
    // P5: Verify background integrity
    // The base64 in the HTML must match the clean.png bytes exactly
    // -----------------------------------------------------------------------
    const expectedBase64 = cleanPng.toString('base64');
    expect(html).toContain(`data:image/png;base64,${expectedBase64}`);

    // -----------------------------------------------------------------------
    // Stage 7: Render PDF
    // -----------------------------------------------------------------------
    const t7 = transitionStatus(jobId, ['preview_ready'], 'rendering_pdf');
    expect(t7).toBe(true);

    const pdfBuffer = await renderPdf({ html, widthMm, heightMm });

    await localStorage.saveBytes(jobId, 'final.pdf', pdfBuffer);

    const tDone = transitionStatus(jobId, ['rendering_pdf'], 'pdf_ready');
    expect(tDone).toBe(true);

    // Assert PDF is valid
    expect(pdfBuffer.length).toBeGreaterThan(1024); // > 1 KB
    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');

    // -----------------------------------------------------------------------
    // Verify final state
    // -----------------------------------------------------------------------
    job = getJob(jobId);
    expect(job?.status).toBe('pdf_ready');

    // Verify final.pdf exists in storage
    const pdfExists = await localStorage.exists(jobId, 'final.pdf');
    expect(pdfExists).toBe(true);

    // Verify all expected files exist
    expect(await localStorage.exists(jobId, 'original.jpg')).toBe(true);
    expect(await localStorage.exists(jobId, 'iterations/1.png')).toBe(true);
    expect(await localStorage.exists(jobId, 'iterations/2.png')).toBe(true);
    expect(await localStorage.exists(jobId, 'approved.png')).toBe(true);
    expect(await localStorage.exists(jobId, 'clean.png')).toBe(true);
    expect(await localStorage.exists(jobId, 'vision.json')).toBe(true);
    expect(await localStorage.exists(jobId, 'layout.json')).toBe(true);
    expect(await localStorage.exists(jobId, 'final.pdf')).toBe(true);
  }, 60000); // 60s timeout for Playwright PDF generation

  // -----------------------------------------------------------------------
  // Additional assertions
  // -----------------------------------------------------------------------

  it('transitionStatus é idempotente — segunda chamada retorna false', () => {
    const jobId = crypto.randomUUID();
    insertJob({ id: jobId, widthMm: 100, heightMm: 100, initialPrompt: 'test' });

    const r1 = transitionStatus(jobId, ['created'], 'iterating');
    const r2 = transitionStatus(jobId, ['created'], 'iterating');

    expect(r1).toBe(true);
    expect(r2).toBe(false);
  });

  it('vision.json fixture é válido contra VisionResponseSchema e tem campos label', async () => {
    const raw = JSON.parse(await fs.readFile(path.join(FIXTURES_DIR, 'vision.json'), 'utf-8'));
    const result = VisionResponseSchema.safeParse(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.textElements.length).toBe(2);
      // Task 2.1 added `label` to the schema — verify the fixture has it
      for (const el of result.data.textElements) {
        expect(typeof el.label).toBe('string');
      }
    }
  });

  it('renderLayoutHTML produz HTML com canvas correto', () => {
    const input: LayoutInput = {
      canvas: { widthMm: 300, heightMm: 500 },
      background: { dataUrl: 'data:image/png;base64,abc' },
      textElements: [],
    };

    const html = renderLayoutHTML(input);
    expect(html).toContain('@page { size: 300mm 500mm; margin: 0 }');
    expect(html).toContain('width: 300mm');
    expect(html).toContain('height: 500mm');
  });

  it('storage rejeita jobId inválido', async () => {
    await expect(
      localStorage.saveBytes('not-a-uuid', 'test.png', Buffer.from('data')),
    ).rejects.toThrow();
  });

  // -----------------------------------------------------------------------
  // Task 8.1 — Path A scenario (with reference image / text_review flow)
  // -----------------------------------------------------------------------

  it('Path A — brief sentinel values appear in layout.json, Vision content is not leaked (P-BRIEF-2)', async () => {
    const jobId = crypto.randomUUID();
    const widthMm = 300;
    const heightMm = 500;

    // Simulate the analyze-reference flow: job starts at text_review
    insertJob({ id: jobId, widthMm, heightMm, initialPrompt: 'Banner com promoção', initialStatus: 'text_review' });

    // Save original.jpg (Path A has a reference image)
    const originalJpg = await fs.readFile(path.join(FIXTURES_DIR, 'original.jpg'));
    await localStorage.saveBytes(jobId, 'original.jpg', originalJpg);

    // Set a text brief with known sentinel values (different from vision.json "Hello"/"World")
    const sentinelId1 = crypto.randomUUID();
    const sentinelId2 = crypto.randomUUID();
    await setTextBrief(jobId, {
      textItems: [
        { id: sentinelId1, label: 'titulo', value: 'SENTINEL_TEXT' },
        { id: sentinelId2, label: 'preco', value: 'R$ 99,90' },
      ],
    });

    // Transition to iterating (simulating POST /api/jobs continuation)
    const t1 = transitionStatus(jobId, ['text_review'], 'iterating');
    expect(t1).toBe(true);

    // Save an iteration image
    const iterPng = await fs.readFile(path.join(FIXTURES_DIR, 'iter.png'));
    await localStorage.saveBytes(jobId, 'iterations/1.png', iterPng);
    updateJob(jobId, { current_iteration: 1 });

    // Approve → processing_step4 → preview_ready
    const t4 = transitionStatus(jobId, ['iterating'], 'processing_step4');
    expect(t4).toBe(true);

    await runStage4(jobId);

    const job = getJob(jobId);
    expect(job?.status).toBe('preview_ready');

    // Read layout.json and verify P-BRIEF-2
    const layoutPersisted = await localStorage.readJson<LayoutInput>(jobId, 'layout.json');

    // The brief has 2 non-empty items; vision.json has 2 elements → 2 matched
    expect(layoutPersisted.textElements.length).toBe(2);

    // Content must come from the brief (sentinel values), NOT from vision.json ("Hello"/"World")
    const contents = layoutPersisted.textElements.map((el) => el.content);
    expect(contents).toContain('SENTINEL_TEXT');
    expect(contents).toContain('R$ 99,90');

    // Vision content fields must NOT appear
    expect(contents).not.toContain('Hello');
    expect(contents).not.toContain('World');

    // IDs must match the brief item ids (P-BRIEF-2, Req 8.8)
    const ids = layoutPersisted.textElements.map((el) => el.id);
    expect(ids).toContain(sentinelId1);
    expect(ids).toContain(sentinelId2);

    // Render PDF to confirm the full pipeline completes
    const t7 = transitionStatus(jobId, ['preview_ready'], 'rendering_pdf');
    expect(t7).toBe(true);

    const cleanPng = await localStorage.readBytes(jobId, 'clean.png');
    const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;
    const layoutForRender = { ...layoutPersisted, background: { dataUrl: cleanDataUrl } };
    const html = renderLayoutHTML(layoutForRender);
    const pdfBuffer = await renderPdf({ html, widthMm, heightMm });
    await localStorage.saveBytes(jobId, 'final.pdf', pdfBuffer);

    const tDone = transitionStatus(jobId, ['rendering_pdf'], 'pdf_ready');
    expect(tDone).toBe(true);

    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
  }, 60000);

  // -----------------------------------------------------------------------
  // Task 8.2 — Path B scenario (no reference image)
  // -----------------------------------------------------------------------

  it('Path B — no original.jpg, text-brief.json round-trips, layout content from brief (P-PERSISTENCE-PARITY-1)', async () => {
    const jobId = crypto.randomUUID();
    const widthMm = 200;
    const heightMm = 300;

    // Path B: fresh creation, no reference image
    insertJob({ id: jobId, widthMm, heightMm, initialPrompt: 'Flyer sem imagem' });

    // Set text brief with ≥1 non-empty item (required for Path B)
    const briefItemId = crypto.randomUUID();
    const brief = {
      textItems: [
        { id: briefItemId, label: 'titulo', value: 'OFERTA ESPECIAL' },
        { id: crypto.randomUUID(), label: 'preco', value: 'R$ 49,90' },
      ],
    };
    await setTextBrief(jobId, brief);

    // Assert original.jpg does NOT exist (Path B — no reference image)
    expect(await localStorage.exists(jobId, 'original.jpg')).toBe(false);

    // Assert text-brief.json exists and matches the brief (P-PERSISTENCE-PARITY-1)
    const briefOnDisk = await localStorage.readJson<typeof brief>(jobId, 'text-brief.json');
    expect(briefOnDisk.textItems.length).toBe(2);
    expect(briefOnDisk.textItems[0]!.value).toBe('OFERTA ESPECIAL');
    expect(briefOnDisk.textItems[1]!.value).toBe('R$ 49,90');

    // Also verify DB round-trip
    const briefFromDb = getTextBrief(jobId);
    expect(briefFromDb).not.toBeNull();
    expect(briefFromDb!.textItems.length).toBe(2);
    expect(briefFromDb!.textItems[0]!.value).toBe('OFERTA ESPECIAL');

    // Transition to iterating (simulating POST /api/jobs fresh creation)
    const t1 = transitionStatus(jobId, ['created'], 'iterating');
    expect(t1).toBe(true);

    // Save an iteration image (simulating generateImageToImage with 1×1 transparent PNG fallback)
    const iterPng = await fs.readFile(path.join(FIXTURES_DIR, 'iter.png'));
    await localStorage.saveBytes(jobId, 'iterations/1.png', iterPng);
    updateJob(jobId, { current_iteration: 1 });

    // Iterate once more
    const iterPng2 = await fs.readFile(path.join(FIXTURES_DIR, 'iter.png'));
    await localStorage.saveBytes(jobId, 'iterations/2.png', iterPng2);
    updateJob(jobId, { current_iteration: 2 });

    // Approve → processing_step4 → preview_ready
    const t4 = transitionStatus(jobId, ['iterating'], 'processing_step4');
    expect(t4).toBe(true);

    await runStage4(jobId);

    const job = getJob(jobId);
    expect(job?.status).toBe('preview_ready');

    // Confirm original.jpg still does NOT exist (Path B invariant)
    expect(await localStorage.exists(jobId, 'original.jpg')).toBe(false);

    // Confirm text-brief.json still exists and matches text_brief_json (P-PERSISTENCE-PARITY-1)
    const briefOnDiskAfter = await localStorage.readJson<typeof brief>(jobId, 'text-brief.json');
    const briefFromDbAfter = getTextBrief(jobId);
    expect(briefFromDbAfter).not.toBeNull();
    expect(briefOnDiskAfter.textItems.length).toBe(briefFromDbAfter!.textItems.length);
    expect(briefOnDiskAfter.textItems[0]!.value).toBe(briefFromDbAfter!.textItems[0]!.value);
    expect(briefOnDiskAfter.textItems[1]!.value).toBe(briefFromDbAfter!.textItems[1]!.value);

    // Verify layout.json textElements content comes from the brief
    const layoutPersisted = await localStorage.readJson<LayoutInput>(jobId, 'layout.json');
    const contents = layoutPersisted.textElements.map((el) => el.content);
    expect(contents).toContain('OFERTA ESPECIAL');
    expect(contents).toContain('R$ 49,90');

    // Vision content must NOT appear
    expect(contents).not.toContain('Hello');
    expect(contents).not.toContain('World');

    // Render PDF to confirm the full pipeline completes
    const t7 = transitionStatus(jobId, ['preview_ready'], 'rendering_pdf');
    expect(t7).toBe(true);

    const cleanPng = await localStorage.readBytes(jobId, 'clean.png');
    const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;
    const layoutForRender = { ...layoutPersisted, background: { dataUrl: cleanDataUrl } };
    const html = renderLayoutHTML(layoutForRender);
    const pdfBuffer = await renderPdf({ html, widthMm, heightMm });
    await localStorage.saveBytes(jobId, 'final.pdf', pdfBuffer);

    const tDone = transitionStatus(jobId, ['rendering_pdf'], 'pdf_ready');
    expect(tDone).toBe(true);

    expect(pdfBuffer.slice(0, 5).toString('ascii')).toBe('%PDF-');
    expect(await localStorage.exists(jobId, 'final.pdf')).toBe(true);
  }, 60000);
});
