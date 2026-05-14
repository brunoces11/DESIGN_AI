/**
 * GET /api/jobs/:id/pdf
 *
 * Streams the final PDF file.
 * Requirements: 11.15
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/db';
import { localStorage } from '@/lib/storage';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const job = getJob(params.id);

  if (!job || job.status !== 'pdf_ready') {
    return NextResponse.json({ error: 'PDF not available' }, { status: 404 });
  }

  const pdfBuffer = await localStorage.readBytes(params.id, 'final.pdf');

  return new NextResponse(pdfBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="job-${params.id}.pdf"`,
      'Content-Length': String(pdfBuffer.length),
    },
  });
}
