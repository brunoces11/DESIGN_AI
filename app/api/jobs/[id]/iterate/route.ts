/**
 * POST /api/jobs/:id/iterate — Stage 3
 *
 * Accepts multipart/form-data: prompt (required), textItems (required), image (optional).
 * Requirements: 3.1–3.9, 6.1–6.7, 14.1, 14.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getJob, updateJob, transitionStatus, setTextBrief } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { generateImageToImage } from '@/lib/openai';
import type { EditableTextItem } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Validation schema (Req 6.1, 6.2, 12.7)
// ---------------------------------------------------------------------------

const EditableTextItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string().max(64),
  value: z.string().max(500),
});

const TextItemsSchema = z.array(EditableTextItemSchema);

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

    // Validate prompt (Req 3.1)
    const prompt = formData.get('prompt');
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      return NextResponse.json({ error: 'prompt is required and must not be empty' }, { status: 400 });
    }

    // Parse and validate textItems (Req 6.1, 6.2)
    const textItemsRaw = formData.get('textItems');
    if (!textItemsRaw || typeof textItemsRaw !== 'string') {
      return NextResponse.json({ error: 'textItems is required' }, { status: 400 });
    }

    let parsedItems: EditableTextItem[];
    try {
      const parsed = TextItemsSchema.safeParse(JSON.parse(textItemsRaw));
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid textItems', details: parsed.error.flatten() },
          { status: 400 },
        );
      }
      parsedItems = parsed.data;
    } catch {
      return NextResponse.json({ error: 'textItems must be valid JSON' }, { status: 400 });
    }

    // Optional imageModel param is ignored — model is fixed to gpt-image-2

    // Persist brief BEFORE generation (Req 6.3)
    await setTextBrief(id, { textItems: parsedItems });

    // Determine base image: uploaded file or last iteration
    let baseImage: Buffer;
    const imageFile = formData.get('image');
    if (imageFile instanceof File && imageFile.size > 0) {
      baseImage = Buffer.from(await imageFile.arrayBuffer());
    } else {
      baseImage = await localStorage.readBytes(id, `iterations/${job.current_iteration}.png`);
    }

    // Compute effective brief (filter empty values) and generate (Req 6.4, 5.10)
    const effective = parsedItems.filter((t) => t.value.trim().length > 0);

    const next = job.current_iteration + 1;
    // Req 6.5: NO Vision Stage 0 call here — only generateImageToImage
    const generated = await generateImageToImage({
      baseImage,
      prompt,
      widthMm: job.width_mm,
      heightMm: job.height_mm,
      textItems: effective,
    });
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
