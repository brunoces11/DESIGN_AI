/**
 * POST /api/jobs — Stage 1 + 2
 *
 * Accepts multipart/form-data: image, widthMm, heightMm, prompt.
 * Creates a job, saves original.jpg, generates first iteration.
 *
 * Requirements: 1.3–1.7, 2.1–2.6, 14.1, 14.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { insertJob, transitionStatus, updateJob } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { generateImageToImage } from '@/lib/openai';

const RequestSchema = z.object({
  widthMm: z.coerce.number().int().positive(),
  heightMm: z.coerce.number().int().positive(),
  prompt: z.string().min(1),
});

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(req: NextRequest): Promise<NextResponse> {
  let jobId: string | null = null;

  try {
    const formData = await req.formData();

    const imageFile = formData.get('image');
    if (!imageFile || !(imageFile instanceof File)) {
      return NextResponse.json({ error: 'Missing or invalid image field' }, { status: 400 });
    }

    if (imageFile.size === 0) {
      return NextResponse.json({ error: 'Image file is empty' }, { status: 400 });
    }

    if (imageFile.size > MAX_IMAGE_SIZE) {
      return NextResponse.json(
        { error: 'Image exceeds maximum size of 10 MB' },
        { status: 400 },
      );
    }

    const parsed = RequestSchema.safeParse({
      widthMm: formData.get('widthMm'),
      heightMm: formData.get('heightMm'),
      prompt: formData.get('prompt'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { widthMm, heightMm, prompt } = parsed.data;

    // Stage 1: create job
    jobId = crypto.randomUUID();
    insertJob({ id: jobId, widthMm, heightMm, initialPrompt: prompt });

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    await localStorage.saveBytes(jobId, 'original.jpg', imageBuffer);

    // Transition created → iterating
    const transitioned = transitionStatus(jobId, ['created'], 'iterating');
    if (!transitioned) {
      throw new Error('Failed to transition job to iterating state');
    }

    // Stage 2: generate first iteration
    const generated = await generateImageToImage({ baseImage: imageBuffer, prompt });
    await localStorage.saveBytes(jobId, 'iterations/1.png', generated);
    updateJob(jobId, { current_iteration: 1 });

    return NextResponse.json({ jobId, iteration: 1 });
  } catch (err) {
    if (jobId) {
      try {
        updateJob(jobId, { error_message: String(err) });
        transitionStatus(jobId, ['created', 'iterating'], 'error');
      } catch {
        // best-effort error recording
      }
    }
    console.error('[POST /api/jobs]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
