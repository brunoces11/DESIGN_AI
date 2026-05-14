/**
 * GET /api/jobs/:id/iterations/:n
 *
 * Streams the PNG for iteration n.
 * Read-only — does not trigger state transitions.
 * Requirements: 3.10, 21
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/db';
import { localStorage } from '@/lib/storage';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; n: string } },
): Promise<NextResponse> {
  const job = getJob(params.id);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const n = parseInt(params.n, 10);
  if (isNaN(n) || n < 1) {
    return NextResponse.json({ error: 'Invalid iteration number' }, { status: 400 });
  }

  const exists = await localStorage.exists(params.id, `iterations/${n}.png`);
  if (!exists) {
    return NextResponse.json({ error: 'Iteration not found' }, { status: 404 });
  }

  const pngBuffer = await localStorage.readBytes(params.id, `iterations/${n}.png`);

  return new NextResponse(pngBuffer, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(pngBuffer.length),
    },
  });
}
