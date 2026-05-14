/**
 * POST /api/jobs/:id/iterate — Stage 3
 *
 * Accepts multipart/form-data: prompt (required), image (optional).
 * Requirements: 3.1–3.9, 14.1, 14.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, updateJob, transitionStatus } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { generateImageToImage } from '@/lib/openai';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = params;

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (job.status !== 'iterating') {
    return NextResponse.json(
      { error: `Job is not in iterating state (current: ${job.status})` },
      { status: 409 },
    );
  }

  try {
    const formData = await req.formData();
    const prompt = formData.get('prompt');

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'prompt is required and must not be empty' }, { status: 400 });
    }

    // Determine base image: uploaded file or last iteration
    let baseImage: Buffer;
    const imageFile = formData.get('image');
    if (imageFile instanceof File && imageFile.size > 0) {
      baseImage = Buffer.from(await imageFile.arrayBuffer());
    } else {
      baseImage = await localStorage.readBytes(id, `iterations/${job.current_iteration}.png`);
    }

    const next = job.current_iteration + 1;
    const generated = await generateImageToImage({ baseImage, prompt, widthMm: job.width_mm, heightMm: job.height_mm });
    await localStorage.saveBytes(id, `iterations/${next}.png`, generated);
    updateJob(id, { current_iteration: next });

    return NextResponse.json({ iteration: next });
  } catch (err) {
    try {
      updateJob(id, { error_message: String(err) });
      transitionStatus(id, ['iterating'], 'error');
    } catch {
      // best-effort
    }
    console.error(`[POST /api/jobs/${id}/iterate]`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
