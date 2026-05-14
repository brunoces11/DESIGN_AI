/**
 * Property-Based Test P8 — Bounds das bboxes do Normalizer
 *
 * **Validates: Requirements 7.3, 7.4, 7.6, 16.8**
 *
 * Property P8: Bounds
 * Para qualquer VisionResponse válido com bboxes potencialmente excedentes,
 * normalizeVisionResponse deve garantir que todas as bboxes resultantes
 * ficam dentro dos limites do canvas.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { normalizeVisionResponse, VisionResponseSchema, type VisionResponse } from '@/lib/layout/normalize';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Canvas dimensions in mm: [10, 5000] */
const arbCanvasMm = fc.record({
  canvasWidthMm: fc.integer({ min: 10, max: 5000 }),
  canvasHeightMm: fc.integer({ min: 10, max: 5000 }),
});

/** Image dimensions in px: [1, 10000] */
const arbImageDims = fc.record({
  imageWidthPx: fc.integer({ min: 1, max: 10000 }),
  imageHeightPx: fc.integer({ min: 1, max: 10000 }),
});

/** Arbitrary CSS color */
const arbColor = fc.oneof(
  fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `#${h}`),
  fc.constantFrom('red', 'blue', 'white', 'black'),
);

/** fontWeight: multiple of 100 in [100, 900] */
const arbFontWeight = fc.integer({ min: 1, max: 9 }).map((n) => n * 100);

/** align */
const arbAlign = fc.constantFrom('left' as const, 'center' as const, 'right' as const);

/**
 * Arbitrary VisionTextElement with bboxes that may exceed image dimensions.
 * We allow large values to test clamping.
 * Use integers to avoid fc.float 32-bit constraint issues.
 */
const arbVisionTextElement = (imageWidthPx: number, imageHeightPx: number) =>
  fc.record({
    content: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
    bboxPx: fc.record({
      x: fc.integer({ min: 0, max: imageWidthPx * 2 }),
      y: fc.integer({ min: 0, max: imageHeightPx * 2 }),
      width: fc.integer({ min: 1, max: imageWidthPx * 2 }),
      height: fc.integer({ min: 1, max: imageHeightPx * 2 }),
    }),
    color: arbColor,
    fontWeight: arbFontWeight,
    align: arbAlign,
  });

/**
 * Arbitrary VisionResponse with 0–10 text elements.
 * Bboxes may exceed image dimensions to test clamping.
 */
const arbVisionResponse: fc.Arbitrary<{
  raw: VisionResponse;
  imageWidthPx: number;
  imageHeightPx: number;
}> = fc
  .tuple(arbImageDims, fc.integer({ min: 0, max: 10 }))
  .chain(([{ imageWidthPx, imageHeightPx }, n]) => {
    if (n === 0) {
      return fc.constant({
        raw: {
          imageWidthPx,
          imageHeightPx,
          textElements: [],
        } as VisionResponse,
        imageWidthPx,
        imageHeightPx,
      });
    }

    const elementArbs = Array.from({ length: n }, () =>
      arbVisionTextElement(imageWidthPx, imageHeightPx),
    );

    return fc
      .tuple(...(elementArbs as [fc.Arbitrary<{
        content: string;
        bboxPx: { x: number; y: number; width: number; height: number };
        color: string;
        fontWeight: number;
        align: 'left' | 'center' | 'right';
      }>]))
      .map((elements) => {
        const elemArray = Array.isArray(elements) ? elements : [elements];
        // Validate through schema to ensure it's a valid VisionResponse
        const raw: VisionResponse = {
          imageWidthPx,
          imageHeightPx,
          textElements: elemArray.map((e) => ({
            content: e.content,
            bboxPx: {
              x: Math.max(0, e.bboxPx.x),
              y: Math.max(0, e.bboxPx.y),
              width: Math.max(1, e.bboxPx.width),
              height: Math.max(1, e.bboxPx.height),
            },
            color: e.color,
            fontWeight: e.fontWeight,
            align: e.align,
          })),
        };
        return { raw, imageWidthPx, imageHeightPx };
      });
  });

// ---------------------------------------------------------------------------
// Property P8: Bounds
// ---------------------------------------------------------------------------

describe('P8 — Bounds das bboxes do Normalizer', () => {
  /**
   * **Validates: Requirements 7.3, 7.4, 7.6, 16.8**
   *
   * Para qualquer VisionResponse com bboxes potencialmente excedentes:
   * - 0 ≤ xMm ≤ canvasWidthMm
   * - 0 ≤ yMm ≤ canvasHeightMm
   * - xMm + widthMm ≤ canvasWidthMm
   * - yMm + heightMm ≤ canvasHeightMm
   * - output.textElements.length === raw.textElements.length
   * - ids são únicos: t0, t1, ..., t{n-1}
   */
  it('todas as bboxes resultantes ficam dentro dos limites do canvas', () => {
    fc.assert(
      fc.property(
        arbVisionResponse,
        arbCanvasMm,
        ({ raw, imageWidthPx, imageHeightPx }, { canvasWidthMm, canvasHeightMm }) => {
          const output = normalizeVisionResponse({
            raw,
            imageWidthPx,
            imageHeightPx,
            canvasWidthMm,
            canvasHeightMm,
            backgroundDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          });

          // Length preserved
          expect(output.textElements.length).toBe(raw.textElements.length);

          // Check each element
          output.textElements.forEach((t, i) => {
            // ID is t{i}
            expect(t.id).toBe(`t${i}`);

            // Position bounds
            expect(t.position.xMm).toBeGreaterThanOrEqual(0);
            expect(t.position.yMm).toBeGreaterThanOrEqual(0);
            expect(t.position.xMm).toBeLessThanOrEqual(canvasWidthMm);
            expect(t.position.yMm).toBeLessThanOrEqual(canvasHeightMm);

            // Size bounds
            expect(t.size.widthMm).toBeGreaterThanOrEqual(0);
            expect(t.size.heightMm).toBeGreaterThanOrEqual(0);

            // Position + size ≤ canvas
            expect(t.position.xMm + t.size.widthMm).toBeLessThanOrEqual(
              canvasWidthMm + 1e-9, // small epsilon for float precision
            );
            expect(t.position.yMm + t.size.heightMm).toBeLessThanOrEqual(
              canvasHeightMm + 1e-9,
            );
          });

          // IDs are unique
          const ids = output.textElements.map((t) => t.id);
          const uniqueIds = new Set(ids);
          expect(uniqueIds.size).toBe(ids.length);
        },
      ),
      { numRuns: 300, verbose: false },
    );
  });

  it('fontFamily é sempre Inter, sans-serif', () => {
    fc.assert(
      fc.property(arbVisionResponse, arbCanvasMm, ({ raw, imageWidthPx, imageHeightPx }, { canvasWidthMm, canvasHeightMm }) => {
        const output = normalizeVisionResponse({
          raw,
          imageWidthPx,
          imageHeightPx,
          canvasWidthMm,
          canvasHeightMm,
          backgroundDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        });

        output.textElements.forEach((t) => {
          expect(t.typography.fontFamily).toBe('Inter, sans-serif');
        });
      }),
      { numRuns: 100 },
    );
  });
});
