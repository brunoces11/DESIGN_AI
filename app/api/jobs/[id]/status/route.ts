/**
 * GET /api/jobs/:id/status
 *
 * Read-only status endpoint. Never triggers transitions.
 * Requirements: 13.1–13.4
 */

import { NextRequest, NextResponse } from 'next/server';
import { getJob } from '@/lib/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const job = getJob(params.id);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  return NextResponse.json({
    status: job.status,
    currentIteration: job.current_iteration,
    errorMessage: job.error_message,
  });
}
