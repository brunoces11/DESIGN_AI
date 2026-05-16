/**
 * Property-Based Test P4 — mergeBriefWithVisionLayout length arithmetic
 * **Validates: Requirements 8.5, 8.6**
 * Feature: initial-text-brief-flow, Property 4: output length equals effective brief length.
 * Extra brief items are kept; extra vision elements are dropped.
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { mergeBriefWithVisionLayout } from '@/lib/layout/normalize';
import {
  arbTextBrief,
  arbVisionResponse,
  arbCanvasMm,
  arbImageDims,
} from '../fixtures/arbs';

describe('P4 — mergeBriefWithVisionLayout length arithmetic', () => {
  it('output length equals effective brief length for any inputs', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbTextBrief, arbVisionResponse, arbCanvasMm, arbImageDims),
        ([brief, visionResponse, canvas, imageDims]) => {
          // Compute effective brief (non-empty values only)
          const effective = brief.textItems.filter(
            (t) => t.value.trim().length > 0,
          );

          // Call the function under test — must not throw
          const merged = mergeBriefWithVisionLayout({
            brief,
            visionResponse,
            imageWidthPx: imageDims.imageWidthPx,
            imageHeightPx: imageDims.imageHeightPx,
            canvasWidthMm: canvas.widthMm,
            canvasHeightMm: canvas.heightMm,
            backgroundDataUrl: 'data:image/png;base64,AA==',
          });

          // Property 4: output length === effective brief length
          return merged.textElements.length === effective.length;
        },
      ),
      { numRuns: 100 },
    );
  });
});
