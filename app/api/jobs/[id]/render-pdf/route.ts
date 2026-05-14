/**
 * POST /api/jobs/:id/render-pdf — Stage 7
 *
 * Renders the final PDF using Playwright.
 * Requirements: 11.1–11.16, 14.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob, updateJob, transitionStatus } from '@/lib/db';
import { localStorage } from '@/lib/storage';
import { renderLayoutHTML } from '@/lib/layout/render';
import { renderPdf } from '@/lib/pdf';
import type { LayoutInput } from '@/lib/layout/types';

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id } = params;

  const job = getJob(id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Idempotency guard
  const transitioned = transitionStatus(id, ['preview_ready'], 'rendering_pdf');

  if (!transitioned) {
    const current = getJob(id);
    const currentStatus = current?.status ?? job.status;

    if (currentStatus === 'rendering_pdf') {
      return NextResponse.json({ status: 'rendering_pdf' }, { status: 202 });
    }

    if (currentStatus === 'pdf_ready') {
      return NextResponse.json({ pdfPath: `/api/jobs/${id}/pdf` });
    }

    return NextResponse.json(
      { error: `Cannot render PDF in state: ${currentStatus}` },
      { status: 409 },
    );
  }

  try {
    // Hydrate layout
    if (!job.layout_json) {
      throw new Error('layout_json not found');
    }

    const cleanPng = await localStorage.readBytes(id, 'clean.png');
    const cleanDataUrl = `data:image/png;base64,${cleanPng.toString('base64')}`;

    const layoutInput = JSON.parse(job.layout_json) as LayoutInput;
    layoutInput.background = { dataUrl: cleanDataUrl };

    const html = renderLayoutHTML(layoutInput);

    // Render PDF (browser.close() is guaranteed in finally inside renderPdf)
    const pdfBuffer = await renderPdf({
      html,
      widthMm: job.width_mm,
      heightMm: job.height_mm,
    });

    await localStorage.saveBytes(id, 'final.pdf', pdfBuffer);

    const ok = transitionStatus(id, ['rendering_pdf'], 'pdf_ready');
    if (!ok) {
      throw new Error('Failed to transition to pdf_ready');
    }

    return NextResponse.json({ pdfPath: `/api/jobs/${id}/pdf` });
  } catch (err) {
    try {
      updateJob(id, { error_message: String(err) });
      transitionStatus(id, ['rendering_pdf'], 'error');
    } catch {
      // best-effort
    }
    console.error(`[POST /api/jobs/${id}/render-pdf]`, err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
