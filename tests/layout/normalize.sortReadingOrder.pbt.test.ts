/**
 * Property-Based Test P1 — sortByReadingOrder produces a valid reading-order permutation
 * **Validates: Requirements 2.4, 2.5**
 * Feature: initial-text-brief-flow, Property 1: sortByReadingOrder is a permutation that
 * obeys the top-to-bottom + same-row-left-to-right total order.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { sortByReadingOrder, type VisionTextElement } from '@/lib/layout/normalize';
import { arbVisionTextElement } from '../fixtures/arbs';

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Arrays of 0–30 vision text elements (generous bound, design § Testing Strategy).
 * Uses the shared `arbVisionTextElement` from `tests/fixtures/arbs.ts`.
 */
const arbElementsArray = fc.array(arbVisionTextElement, {
  minLength: 0,
  maxLength: 30,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pairwise predicate from Property 1: returns whether `a` may legitimately
 * precede `b` in a reading-order-valid sequence.
 *
 * - When the y-overlap fraction `overlap / max(a.h, b.h) > 0.5`, the boxes
 *   are on the same row → `a.bboxPx.x <= b.bboxPx.x`.
 * - Otherwise → `a.bboxPx.y <= b.bboxPx.y`.
 */
function isReadingOrderValid(a: VisionTextElement, b: VisionTextElement): boolean {
  const ay1 = a.bboxPx.y;
  const ay2 = a.bboxPx.y + a.bboxPx.height;
  const by1 = b.bboxPx.y;
  const by2 = b.bboxPx.y + b.bboxPx.height;

  const overlap = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const maxH = Math.max(a.bboxPx.height, b.bboxPx.height);
  const fraction = maxH > 0 ? overlap / maxH : 0;

  if (fraction > 0.5) {
    // Same row → x is the primary ordering key.
    return a.bboxPx.x <= b.bboxPx.x;
  }
  // Different rows → y is the primary ordering key.
  return a.bboxPx.y <= b.bboxPx.y;
}

/**
 * Multiset equality: two arrays contain the same elements (regardless of
 * order) iff the sorted JSON serialisations of each element are equal.
 */
function sameMultiset(
  xs: VisionTextElement[],
  ys: VisionTextElement[],
): boolean {
  if (xs.length !== ys.length) return false;
  const a = xs.map((e) => JSON.stringify(e)).sort();
  const b = ys.map((e) => JSON.stringify(e)).sort();
  return a.every((s, i) => s === b[i]);
}

// ---------------------------------------------------------------------------
// Property P1 — sortByReadingOrder is a valid reading-order permutation
// ---------------------------------------------------------------------------

describe('P1 — sortByReadingOrder produces a valid reading-order permutation', () => {
  /**
   * (i) Permutation: result has the same length AND same multiset as input.
   * **Validates: Requirements 2.4, 2.5**
   */
  it('result is a permutation of the input (same length, same multiset)', () => {
    fc.assert(
      fc.property(arbElementsArray, (elements) => {
        const result = sortByReadingOrder(elements);
        expect(result.length).toBe(elements.length);
        expect(sameMultiset(result, elements)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (ii) Pairwise predicate: for every i < j in the sorted result, the
   * `isReadingOrderValid(result[i], result[j])` predicate holds.
   * **Validates: Requirements 2.4, 2.5**
   */
  it('every adjacent and non-adjacent pair (i < j) satisfies the reading-order predicate', () => {
    fc.assert(
      fc.property(arbElementsArray, (elements) => {
        const result = sortByReadingOrder(elements);
        for (let i = 0; i < result.length; i++) {
          for (let j = i + 1; j < result.length; j++) {
            const a = result[i]!;
            const b = result[j]!;
            if (!isReadingOrderValid(a, b)) {
              // Surface the offending pair for fast-check shrinking output.
              expect.fail(
                `Reading-order violation at (i=${i}, j=${j}): ` +
                  `a=${JSON.stringify(a.bboxPx)} b=${JSON.stringify(b.bboxPx)}`,
              );
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (iii) Idempotence: sorting twice yields the same array as sorting once.
   * **Validates: Requirements 2.4, 2.5**
   */
  it('sortByReadingOrder is idempotent', () => {
    fc.assert(
      fc.property(arbElementsArray, (elements) => {
        const once = sortByReadingOrder(elements);
        const twice = sortByReadingOrder(once);
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
      }),
      { numRuns: 100 },
    );
  });
});
