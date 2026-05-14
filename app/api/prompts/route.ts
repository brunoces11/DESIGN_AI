/**
 * GET  /api/prompts — returns current prompts config + metadata
 * PUT  /api/prompts — saves updated prompts config
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { loadPrompts, savePrompts, PROMPT_DEFINITIONS } from '@/lib/prompts';

const PromptsUpdateSchema = z.object({
  imageGeneration: z.string().min(1),
  removeText: z.string().min(1),
  visionLayout: z.string().min(1),
});

export async function GET(): Promise<NextResponse> {
  const config = loadPrompts();
  return NextResponse.json({ config, definitions: PROMPT_DEFINITIONS });
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as unknown;
    const parsed = PromptsUpdateSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid prompts config', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    savePrompts(parsed.data);
    return NextResponse.json({ ok: true, config: parsed.data });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
