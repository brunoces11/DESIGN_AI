/**
 * Property-Based Test P2 — TextBrief build from Vision is a sorted bijection
 * **Validates: Requirements 1.8, 2.6**
 * Feature: initial-text-brief-flow, Property 2: buildBriefFromVision produces
 * a TextBrief whose items match the reading-order-sorted Vision elements.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildBriefFromVision } from '@/app/api/jobs/analyze-reference/route';
import { sortByReadingOrder } from '@/lib/layout/normalize';
import { arbVisionResponse } from '../fixtures/arbs';

// UUID v4 regex (variant 1, version 4)
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Property P2 — buildBriefFromVision is a sorted bijection
// ---------------------------------------------------------------------------

describe('P2 — buildBriefFromVision produces a TextBrief that is a sorted bijection of the Vision elements', () => {
  /**
   * (i) Length preservation: brief.textItems.length === v.textElements.length
   * **Validates: Requirements 1.8, 2.6**
   */
  it('brief.textItems.length equals v.textElements.length', () => {
    fc.assert(
      fc.property(arbVisionResponse, (v) => {
        const brief = buildBriefFromVision(v);
        expect(brief.textItems.length).toBe(v.textElements.length);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (ii) Sorted bijection: each item's label and value match the
   * corresponding reading-order-sorted Vision element.
   * **Validates: Requirements 1.8, 2.6**
   */
  it('each textItem.label and textItem.value match the reading-order-sorted Vision element', () => {
    fc.assert(
      fc.property(arbVisionResponse, (v) => {
        const brief = buildBriefFromVision(v);
        const sorted = sortByReadingOrder(v.textElements);

        for (let i = 0; i < sorted.length; i++) {
          expect(brief.textItems[i]!.label).toBe(sorted[i]!.label);
          expect(brief.textItems[i]!.value).toBe(sorted[i]!.content);
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (iii) UUID validity and uniqueness: every id is a valid UUID v4 and
   * there are no duplicates within the brief.
   * **Validates: Requirements 1.8, 2.6**
   */
  it('every textItem.id is a valid UUID v4 and all IDs are unique within the brief', () => {
    fc.assert(
      fc.property(arbVisionResponse, (v) => {
        const brief = buildBriefFromVision(v);
        const ids = brief.textItems.map((item) => item.id);

        // All IDs must match UUID v4 format
        for (const id of ids) {
          expect(id).toMatch(UUID_V4_RE);
        }

        // No duplicate IDs
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 100 },
    );
  });
});
