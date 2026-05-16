/**
 * POST /api/jobs — Stage 1 (fresh creation) + continuation from text_review
 *
 * Accepts multipart/form-data: optional jobId, widthMm, heightMm, prompt,
 * textItems (JSON-serialised array), optional image.
 *
 * Branch A (continuation): jobId provided, job must be in 'text_review'.
 * Branch B (fresh):        no jobId; image OR ≥1 non-empty textItem required.
 *
 * Requirements: 5.1–5.17, 12.1, 12.2, 12.4, 12.5, 12.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getJob, insertJob, transitionStatus, updateJob, setTextBrief } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { generateImageToImage, type ImageModel } from '@/lib/openai';
import type { EditableTextItem } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// 1×1 transparent PNG fallback — used when no reference image is present
// (gpt-image-1 images.edit requires an image; this no-op base satisfies it)
// Req 5.13
// ---------------------------------------------------------------------------
const TRANSPARENT_PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const TRANSPARENT_PNG_1X1 = Buffer.from(TRANSPARENT_PNG_1X1_BASE64, 'base64');

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const EditableTextItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(64),
  value: z.string().max(500),
});

const RequestSchema = z.object({
  jobId: z.string().uuid().optional(),
  widthMm: z.coerce.number().int().positive(),
  heightMm: z.coerce.number().int().positive(),
  prompt: z.string().min(1),
  textItems: z.array(EditableTextItemSchema), // no max length — Req 5.4, 12.4
  imageModel: z.enum(['gpt-image-1', 'gpt-image-2']).optional(),
});

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest): Promise<NextResponse> {
  let jobId: string | null = null;

  try {
    const formData = await req.formData();

    // Parse textItems from JSON string (Req 5.3)
    const rawTextItems = formData.get('textItems');
    if (typeof rawTextItems !== 'string') {
      return NextResponse.json(
        { error: 'textItems is required (JSON array)' },
        { status: 400 },
      );
    }
    let parsedTextItems: unknown;
    try {
      parsedTextItems = JSON.parse(rawTextItems);
    } catch {
      return NextResponse.json({ error: 'textItems is not valid JSON' }, { status: 400 });
    }

    // Validate all scalar fields + textItems together
    const parsed = RequestSchema.safeParse({
      jobId: formData.get('jobId') || undefined,
      widthMm: formData.get('widthMm'),
      heightMm: formData.get('heightMm'),
      prompt: formData.get('prompt'),
      textItems: parsedTextItems,
      imageModel: formData.get('imageModel') || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { jobId: jobIdFromBody, widthMm, heightMm, prompt, textItems, imageModel } = parsed.data;

    // Optional image (Req 5.1)
    const imageFile = formData.get('image');
    let uploadedImage: Buffer | null = null;
    if (imageFile instanceof File && imageFile.size > 0) {
      if (imageFile.size > MAX_IMAGE_SIZE) {
        return NextResponse.json(
          { error: 'Image exceeds maximum size of 10 MB' },
          { status: 400 },
        );
      }
      uploadedImage = Buffer.from(await imageFile.arrayBuffer());
    }

    // -------------------------------------------------------------------------
    // Branch A — continuation (jobId provided)
    // -------------------------------------------------------------------------
    if (jobIdFromBody) {
      jobId = jobIdFromBody;

      const job = getJob(jobId);
      if (!job || job.status !== 'text_review') {
        // Req 5.7
        return NextResponse.json(
          { error: 'Cannot start generation in current state' },
          { status: 409 },
        );
      }

      // Persist brief (Req 5.6, 11.2, 5.17)
      await setTextBrief(jobId, { textItems });

      // Optionally overwrite original.jpg (Req 5.12)
      if (uploadedImage) {
        await localStorage.saveBytes(jobId, 'original.jpg', uploadedImage);
      }

      // Transition text_review → iterating (Req 5.6)
      const ok = transitionStatus(jobId, ['text_review'], 'iterating');
      if (!ok) {
        return NextResponse.json(
          { error: 'Cannot start generation in current state' },
          { status: 409 },
        );
      }

      // Base image: newly uploaded, or previously saved original.jpg (Req 5.11, 5.12)
      const baseImage =
        uploadedImage ?? (await localStorage.readBytes(jobId, 'original.jpg'));

      const generated = await runGeneration({ baseImage, prompt, widthMm, heightMm, textItems, imageModel });
      await localStorage.saveBytes(jobId, 'iterations/1.png', generated);
      updateJob(jobId, { current_iteration: 1 });

      return NextResponse.json({ jobId, iteration: 1 });
    }

    // -------------------------------------------------------------------------
    // Branch B — fresh creation (no jobId)
    // -------------------------------------------------------------------------

    // Req 5.5, 12.2: no image AND no non-empty textItem → 400
    const effectiveCount = textItems.filter((t) => t.value.trim().length > 0).length;
    if (!uploadedImage && effectiveCount === 0) {
      return NextResponse.json(
        {
          error:
            'At least one non-empty text item is required when no reference image is provided',
        },
        { status: 400 },
      );
    }

    // Insert job at 'created' (momentary) — Req 5.8, 13.3
    jobId = crypto.randomUUID();
    insertJob({ id: jobId, widthMm, heightMm, initialPrompt: prompt });

    // Save original.jpg only if image present (Req 5.9)
    if (uploadedImage) {
      await localStorage.saveBytes(jobId, 'original.jpg', uploadedImage);
    }

    // Persist brief (Req 5.8, 11.2, 5.17)
    await setTextBrief(jobId, { textItems });

    // Transition created → iterating (Req 5.8)
    const ok = transitionStatus(jobId, ['created'], 'iterating');
    if (!ok) {
      throw new Error('Failed to transition created → iterating');
    }

    // Base image: uploaded image or 1×1 transparent PNG fallback (Req 5.13)
    const baseImage = uploadedImage ?? TRANSPARENT_PNG_1X1;

    const generated = await runGeneration({ baseImage, prompt, widthMm, heightMm, textItems, imageModel });
    await localStorage.saveBytes(jobId, 'iterations/1.png', generated);
    updateJob(jobId, { current_iteration: 1 });

    return NextResponse.json({ jobId, iteration: 1 });
  } catch (err) {
    // Req 5.16: on any failure, record error and transition to 'error'
    if (jobId) {
      try {
        updateJob(jobId, { error_message: String(err) });
        transitionStatus(jobId, ['created', 'text_review', 'iterating'], 'error');
      } catch {
        // best-effort error recording
      }
    }
    console.error('[POST /api/jobs]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helper: filter effective brief and call generateImageToImage
// ---------------------------------------------------------------------------

async function runGeneration(args: {
  baseImage: Buffer;
  prompt: string;
  widthMm: number;
  heightMm: number;
  textItems: EditableTextItem[];
  imageModel?: ImageModel;
}): Promise<Buffer> {
  const effective = args.textItems.filter((t) => t.value.trim().length > 0);
  return generateImageToImage({
    baseImage: args.baseImage,
    prompt: args.prompt,
    widthMm: args.widthMm,
    heightMm: args.heightMm,
    textItems: effective,
    imageModel: args.imageModel,
  });
}
