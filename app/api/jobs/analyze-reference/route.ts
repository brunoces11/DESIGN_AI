/**
 * app/api/jobs/analyze-reference/route.ts
 *
 * POST /api/jobs/analyze-reference — Stage 0 reference-image analysis.
 *
 * Accepts multipart/form-data with:
 *   - image      (File, required, ≤ 10 MB)
 *   - widthMm    (positive integer, required)
 *   - heightMm   (positive integer, required)
 *   - prompt     (string, optional, defaults to '')
 *
 * Flow:
 *   1. Validate inputs (400 on failure — no job created).
 *   2. Insert job at status 'analyzing_reference'.
 *   3. Save original.jpg to storage.
 *   4. Call extractLayoutVisionWithRetry(imageBuffer, 1).
 *      - On Vision success  → persist reference-analysis.json + text-brief.json,
 *        update DB columns, transition to 'text_review', return 200 with textItems.
 *      - On Vision failure  → graceful degradation: empty brief, NULL analysis,
 *        transition to 'text_review', return 200 with warning:'vision_unavailable'.
 *   5. On any other (non-Vision) failure → set error_message, transition to 'error',
 *      return 500.
 *
 * Refs: design § f; Req 1.1–1.14, 2.1, 2.4, 14.1, 14.2, 14.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { insertJob, updateJob, transitionStatus } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { extractLayoutVisionWithRetry } from '@/lib/openai/visionRetry';
import { buildBriefFromVision } from '@/lib/openai/buildBrief';
import type { VisionResponse } from '@/lib/layout/normalize';
import type { TextBrief } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const RequestSchema = z.object({
  widthMm: z.coerce.number().int().positive(),
  heightMm: z.coerce.number().int().positive(),
  prompt: z.string().optional().default(''),
});

// ---------------------------------------------------------------------------
// Route handler — task 4.1
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let jobId: string | null = null;

  try {
    const formData = await req.formData();

    // ── 1. Validate image ────────────────────────────────────────────────────
    // Req 1.4: missing or zero-size → 400, no job created
    const imageFile = formData.get('image');
    if (!imageFile || !(imageFile instanceof File) || imageFile.size === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid image field' },
        { status: 400 },
      );
    }
    // Req 1.5: exceeds 10 MB → 400, no job created
    if (imageFile.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Image exceeds maximum size of 10 MB' },
        { status: 400 },
      );
    }

    // ── 2. Validate other fields ─────────────────────────────────────────────
    // Req 1.6: missing / non-numeric / zero / negative widthMm or heightMm → 400
    const parsed = RequestSchema.safeParse({
      widthMm: formData.get('widthMm'),
      heightMm: formData.get('heightMm'),
      prompt: formData.get('prompt') ?? '',
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { widthMm, heightMm, prompt } = parsed.data;

    // ── 3. Create job at 'analyzing_reference' ───────────────────────────────
    // Req 1.2, 13.3: insert synchronously before any Vision call
    jobId = crypto.randomUUID();
    insertJob({
      id: jobId,
      widthMm,
      heightMm,
      initialPrompt: prompt,
      initialStatus: 'analyzing_reference',
    });

    // ── 4. Save original.jpg BEFORE Vision ──────────────────────────────────
    // Req 1.3: raw bytes persisted before the Vision call
    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    await localStorage.saveBytes(jobId, 'original.jpg', imageBuffer);

    // ── 5. Vision call (with graceful degradation) ───────────────────────────
    // Req 2.1: one retry via extractLayoutVisionWithRetry
    let visionResponse: VisionResponse | null = null;
    try {
      visionResponse = await extractLayoutVisionWithRetry(imageBuffer, 1);
    } catch (visionErr) {
      // ── Graceful degradation path (Req 1.12, 14.1, 14.2, 14.4) ────────────
      console.warn(`[analyze-reference ${jobId}] Vision failed, degrading gracefully:`, visionErr);

      const emptyBrief: TextBrief = { textItems: [] };
      updateJob(jobId, {
        text_brief_json: JSON.stringify(emptyBrief),
        reference_analysis_json: null,
      });
      await localStorage.saveJson(jobId, 'text-brief.json', emptyBrief);

      const ok = transitionStatus(jobId, ['analyzing_reference'], 'text_review');
      if (!ok) {
        // Should not happen in normal flow, but guard defensively
        throw new Error('Failed to transition to text_review (graceful degradation path)');
      }

      // Req 1.12: HTTP 200 with warning
      return NextResponse.json(
        { jobId, status: 'text_review', textItems: [], warning: 'vision_unavailable' },
        { status: 200 },
      );
    }

    // ── 6. Persist reference analysis (Req 1.7) ──────────────────────────────
    await localStorage.saveJson(jobId, 'reference-analysis.json', visionResponse);

    // ── 7. Build TextBrief from Vision (Req 1.8, 2.4) ───────────────────────
    // Uses the exported pure helper (task 4.2)
    const brief = buildBriefFromVision(visionResponse);

    // ── 8. Persist brief and reference analysis to DB (Req 1.9, 11.2) ───────
    updateJob(jobId, {
      text_brief_json: JSON.stringify(brief),
      reference_analysis_json: JSON.stringify(visionResponse),
    });
    await localStorage.saveJson(jobId, 'text-brief.json', brief);

    // ── 9. Transition analyzing_reference → text_review (Req 1.10) ──────────
    const ok = transitionStatus(jobId, ['analyzing_reference'], 'text_review');
    if (!ok) {
      throw new Error('Failed to transition to text_review');
    }

    // ── 10. Respond (Req 1.11) ───────────────────────────────────────────────
    return NextResponse.json(
      { jobId, status: 'text_review', textItems: brief.textItems },
      { status: 200 },
    );
  } catch (err) {
    // ── Non-Vision failure path (Req 1.14, 14.3) ────────────────────────────
    // I/O errors, DB errors, unexpected failures
    if (jobId) {
      try {
        updateJob(jobId, { error_message: String(err) });
        transitionStatus(jobId, ['analyzing_reference'], 'error');
      } catch {
        // best-effort — do not mask the original error
      }
    }
    console.error('[POST /api/jobs/analyze-reference]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
