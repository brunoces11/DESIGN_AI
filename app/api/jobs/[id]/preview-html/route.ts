/**
 * GET /api/jobs/:id/preview-html
 *
 * Returns the rendered HTML for the job's layout preview.
 * Requirements: 9.1–9.6
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { renderLayoutHTML } from '@/lib/layout/render';
import type { LayoutInput } from '@/lib/layout/types';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const job = getJob(params.id);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  if (!['preview_ready', 'pdf_ready'].includes(job.status)) {
    return NextResponse.json(
      { error: `Preview not available in state: ${job.status}` },
      { status: 409 },
    );
  }

  // Check clean.png exists
  const cleanExists = await localStorage.exists(params.id, 'clean.png');
  if (!cleanExists) {
    return NextResponse.json({ error: 'clean.png not found' }, { status: 500 });
  }

  // Hydrate background.dataUrl from clean.png
  const cleanPng = await localStorage.readBytes(params.id, 'clean.png');
  const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;

  // Parse layout_json and hydrate
  if (!job.layout_json) {
    return NextResponse.json({ error: 'layout_json not found' }, { status: 500 });
  }

  const layoutInput = JSON.parse(job.layout_json) as LayoutInput;
  layoutInput.background = { dataUrl: cleanDataUrl };

  const html = renderLayoutHTML(layoutInput);

  return new NextResponse(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
