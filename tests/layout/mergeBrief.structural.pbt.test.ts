/**
 * Property-Based Test P3 — mergeBriefWithVisionLayout structural correctness
 * **Validates: Requirements 8.3, 8.4, 8.5, 8.7, 8.8**
 * Feature: initial-text-brief-flow, Property 3: content always comes from brief,
 * style from vision, positions clamped to canvas, background passed through.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  mergeBriefWithVisionLayout,
  sortByReadingOrder,
} from '@/lib/layout/normalize';
import {
  arbTextBrief,
  arbVisionResponse,
  arbCanvasMm,
  arbImageDims,
} from '../fixtures/arbs';

// ---------------------------------------------------------------------------
// Property P3 — mergeBriefWithVisionLayout structural correctness
// ---------------------------------------------------------------------------

describe('P3 — mergeBriefWithVisionLayout structural correctness', () => {
  /**
   * Sub-property 1 — Content origin:
   * For every element `e` in `merged.textElements`, there exists a brief item
   * `b ∈ effective` such that `e.content === b.value` and `e.id === b.id`.
   * No element's `content` is ever taken from the vision response.
   *
   * **Validates: Requirements 8.7, 8.8**
   */
  it('every merged element content and id comes from the brief, never from vision', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbTextBrief, arbVisionResponse, arbCanvasMm, arbImageDims, fc.string()),
        ([brief, visionResponse, canvas, image, backgroundDataUrl]) => {
          const merged = mergeBriefWithVisionLayout({
            brief,
            visionResponse,
            imageWidthPx: image.imageWidthPx,
            imageHeightPx: image.imageHeightPx,
            canvasWidthMm: canvas.widthMm,
            canvasHeightMm: canvas.heightMm,
            backgroundDataUrl,
          });

          const effective = brief.textItems.filter(
            (t) => t.value.trim().length > 0,
          );

          for (const e of merged.textElements) {
            // There must exist a brief item with matching id and content
            const match = effective.find(
              (b) => b.id === e.id && b.value === e.content,
            );
            expect(match).toBeDefined();

            // The content must NOT come from any vision element
            const visionContents = visionResponse.textElements.map(
              (v) => v.content,
            );
            // Only fail if the content matches a vision element but NOT a brief item
            // (it's possible a brief value coincidentally equals a vision content)
            if (!match) {
              expect(visionContents).not.toContain(e.content);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Sub-property 2 — Style inheritance for matched indices:
   * For `0 ≤ i < min(effective.length, sortedV.length)`,
   * `merged.textElements[i].typography.color === sortedV[i].color`,
   * `merged.textElements[i].typography.fontWeight === sortedV[i].fontWeight`,
   * `merged.textElements[i].typography.align === sortedV[i].align`.
   *
   * **Validates: Requirements 8.3, 8.4**
   */
  it('matched elements inherit color, fontWeight, and align from vision', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbTextBrief, arbVisionResponse, arbCanvasMm, arbImageDims, fc.string()),
        ([brief, visionResponse, canvas, image, backgroundDataUrl]) => {
          const merged = mergeBriefWithVisionLayout({
            brief,
            visionResponse,
            imageWidthPx: image.imageWidthPx,
            imageHeightPx: image.imageHeightPx,
            canvasWidthMm: canvas.widthMm,
            canvasHeightMm: canvas.heightMm,
            backgroundDataUrl,
          });

          const effective = brief.textItems.filter(
            (t) => t.value.trim().length > 0,
          );
          const sortedV = sortByReadingOrder(visionResponse.textElements);
          const matchedCount = Math.min(effective.length, sortedV.length);

          for (let i = 0; i < matchedCount; i++) {
            const e = merged.textElements[i]!;
            const v = sortedV[i]!;

            expect(e.typography.color).toBe(v.color);
            expect(e.typography.fontWeight).toBe(v.fontWeight);
            expect(e.typography.align).toBe(v.align);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Sub-property 3 — Bounds:
   * Every `e ∈ merged.textElements` satisfies:
   *   0 ≤ e.position.xMm ≤ canvas.widthMm
   *   0 ≤ e.position.yMm ≤ canvas.heightMm
   *   e.position.xMm + e.size.widthMm ≤ canvas.widthMm + 1e-9
   *   e.position.yMm + e.size.heightMm ≤ canvas.heightMm + 1e-9
   *
   * **Validates: Requirements 8.5**
   */
  it('all element positions and sizes are clamped within canvas bounds', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbTextBrief, arbVisionResponse, arbCanvasMm, arbImageDims, fc.string()),
        ([brief, visionResponse, canvas, image, backgroundDataUrl]) => {
          const merged = mergeBriefWithVisionLayout({
            brief,
            visionResponse,
            imageWidthPx: image.imageWidthPx,
            imageHeightPx: image.imageHeightPx,
            canvasWidthMm: canvas.widthMm,
            canvasHeightMm: canvas.heightMm,
            backgroundDataUrl,
          });

          const EPS = 1e-9;

          for (const e of merged.textElements) {
            expect(e.position.xMm).toBeGreaterThanOrEqual(0);
            expect(e.position.yMm).toBeGreaterThanOrEqual(0);
            expect(e.position.xMm).toBeLessThanOrEqual(canvas.widthMm);
            expect(e.position.yMm).toBeLessThanOrEqual(canvas.heightMm);
            expect(e.position.xMm + e.size.widthMm).toBeLessThanOrEqual(
              canvas.widthMm + EPS,
            );
            expect(e.position.yMm + e.size.heightMm).toBeLessThanOrEqual(
              canvas.heightMm + EPS,
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Sub-property 4 — Background pass-through:
   * `merged.background.dataUrl === backgroundDataUrl`
   * `merged.canvas.widthMm === canvasWidthMm`
   * `merged.canvas.heightMm === canvasHeightMm`
   *
   * **Validates: Requirements 8.3, 8.4**
   */
  it('background dataUrl and canvas dimensions are passed through unchanged', () => {
    fc.assert(
      fc.property(
        fc.tuple(arbTextBrief, arbVisionResponse, arbCanvasMm, arbImageDims, fc.string()),
        ([brief, visionResponse, canvas, image, backgroundDataUrl]) => {
          const merged = mergeBriefWithVisionLayout({
            brief,
            visionResponse,
            imageWidthPx: image.imageWidthPx,
            imageHeightPx: image.imageHeightPx,
            canvasWidthMm: canvas.widthMm,
            canvasHeightMm: canvas.heightMm,
            backgroundDataUrl,
          });

          expect(merged.background.dataUrl).toBe(backgroundDataUrl);
          expect(merged.canvas.widthMm).toBe(canvas.widthMm);
          expect(merged.canvas.heightMm).toBe(canvas.heightMm);
        },
      ),
      { numRuns: 100 },
    );
  });
});
