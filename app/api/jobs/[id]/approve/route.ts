/**
 * POST /api/jobs/:id/approve — Stage 4
 *
 * Idempotent approval endpoint. Fires Stage 4 in background.
 * Requirements: 4.1–4.6, 5.1–5.5, 6.1–6.4, 7.1–7.9, 14.1, 14.2, 14.5
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, updateJob, transitionStatus, getTextBrief, type JobRow } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { regenerateWithoutText } from '@/lib/openai';
import { locateBriefInImageWithRetry } from '@/lib/openai/visionRetry';
import { applyLocatedLayoutToBrief } from '@/lib/layout/normalize';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = params;

  // imageModel header is ignored — model is fixed to gpt-image-2

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Idempotency guard
  const transitioned = transitionStatus(id, ['iterating'], 'processing_step4');

  if (!transitioned) {
    const current = getJob(id);
    const currentStatus = current?.status ?? job.status;

    if (['processing_step4', 'preview_ready', 'pdf_ready'].includes(currentStatus)) {
      return NextResponse.json({ status: currentStatus }, { status: 202 });
    }

    return NextResponse.json(
      { error: `Cannot approve job in state: ${currentStatus}` },
      { status: 409 },
    );
  }

  // Fire-and-forget Stage 4 — respond 202 immediately
  void runStage4(id, job).catch((err: unknown) => {
    try {
      updateJob(id, { error_message: String(err) });
      transitionStatus(id, ['processing_step4'], 'error');
    } catch {
      // best-effort
    }
    console.error(`[Stage 4 background error for job ${id}]`, err);
  });

  return NextResponse.json({ status: 'processing_step4' }, { status: 202 });
}

async function runStage4(id: string, job: JobRow): Promise<void> {
  // Copy approved iteration
  const approved = await localStorage.readBytes(id, `iterations/${job.current_iteration}.png`);
  await localStorage.saveBytes(id, 'approved.png', approved);

  // Load the canonical brief — this is the source of truth for text content
  const brief = getTextBrief(id) ?? { textItems: [] };
  const effectiveBriefItems = brief.textItems
    .filter((t) => t.value.trim().length > 0)
    .map((t) => ({ id: t.id, label: t.label, value: t.value }));

  // Parallel: 4A (supervised Vision locate) + 4B (clean regen)
  const [locatedItems, cleanPng] = await Promise.all([
    // 4A: send the brief to Vision so it locates each known text element by id,
    // returning normalised coordinates (0–1) and typographic properties.
    // This replaces the blind extractLayoutVision call and fixes positional misalignment.
    locateBriefInImageWithRetry(approved, effectiveBriefItems, 1),
    // 4B: regenerate without text for the clean background
    regenerateWithoutText({
      baseImage: approved,
      originalPrompt: job.initial_prompt,
      widthMm: job.width_mm,
      heightMm: job.height_mm,
    }),
  ]);

  await localStorage.saveJson(id, 'vision.json', locatedItems);
  await localStorage.saveBytes(id, 'clean.png', cleanPng);

  const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;

  // Build layout: brief provides content (canonical), locatedItems provides
  // normalised positions and typography (from the actual approved image).
  const layoutInput = applyLocatedLayoutToBrief({
    brief,
    locatedItems,
    canvasWidthMm: job.width_mm,
    canvasHeightMm: job.height_mm,
    backgroundDataUrl: cleanDataUrl,
  });

  // Persist without dataUrl to save space
  const persisted = { ...layoutInput, background: { dataUrl: '__deferred__' } };
  await localStorage.saveJson(id, 'layout.json', persisted);
  updateJob(id, { layout_json: JSON.stringify(persisted) });

  const ok = transitionStatus(id, ['processing_step4'], 'preview_ready');
  if (!ok) {
    throw new Error('Failed to transition to preview_ready — unexpected state');
  }
}
