/**
 * lib/layout/normalize.ts
 *
 * Vision Normalizer — converts raw GPT-4o Vision response into a validated
 * LayoutInput with positions and sizes in millimetres.
 *
 * Pure function — no I/O, no side effects.
 * Requirements: 7.1–7.7
 */

import { z } from 'zod';
import type { LayoutInput } from './types';

// ---------------------------------------------------------------------------
// Zod schemas (Vision Raw Schema)
// ---------------------------------------------------------------------------

export const VisionTextElementSchema = z.object({
  content: z.string().min(1),
  bboxPx: z.object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  color: z.string(),
  fontWeight: z.number().int().min(100).max(900),
  align: z.enum(['left', 'center', 'right']),
});

export const VisionResponseSchema = z.object({
  imageWidthPx: z.number().positive(),
  imageHeightPx: z.number().positive(),
  textElements: z.array(VisionTextElementSchema),
});

export type VisionResponse = z.infer<typeof VisionResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Heuristic font size estimate from bounding box height.
 * Simple: 70% of bbox height, minimum 8px.
 */
export function estimateFontSizePx(bboxHeightPx: number, _content: string): number {
  return Math.max(8, Math.round(bboxHeightPx * 0.7));
}

// ---------------------------------------------------------------------------
// normalizeVisionResponse
// ---------------------------------------------------------------------------

export interface NormalizeArgs {
  raw: VisionResponse;
  imageWidthPx: number;
  imageHeightPx: number;
  canvasWidthMm: number;
  canvasHeightMm: number;
  backgroundDataUrl: string;
}

/**
 * Converts a validated VisionResponse into a LayoutInput.
 *
 * - Scales bboxPx → mm using sx = canvasWidthMm / imageWidthPx, sy = canvasHeightMm / imageHeightPx.
 * - Clamps all positions and sizes to [0, canvas*Mm].
 * - Ensures position + size ≤ canvas dimension.
 * - Assigns id = 't{i}' (0-based index).
 * - Sets fontFamily = 'Inter, sans-serif' for all elements.
 *
 * Requirements: 7.1–7.7
 */
export function normalizeVisionResponse(args: NormalizeArgs): LayoutInput {
  const { raw, imageWidthPx, imageHeightPx, canvasWidthMm, canvasHeightMm, backgroundDataUrl } =
    args;

  const sx = canvasWidthMm / imageWidthPx;
  const sy = canvasHeightMm / imageHeightPx;

  const textElements = raw.textElements.map((t, i) => {
    const xMm = clamp(t.bboxPx.x * sx, 0, canvasWidthMm);
    const yMm = clamp(t.bboxPx.y * sy, 0, canvasHeightMm);
    // Clamp size to remaining space after position
    const widthMm = clamp(t.bboxPx.width * sx, 0, canvasWidthMm - xMm);
    const heightMm = clamp(t.bboxPx.height * sy, 0, canvasHeightMm - yMm);

    return {
      id: `t${i}`,
      content: t.content,
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx: estimateFontSizePx(t.bboxPx.height, t.content),
        fontWeight: t.fontWeight,
        color: t.color,
        align: t.align,
      },
    };
  });

  return {
    canvas: { widthMm: canvasWidthMm, heightMm: canvasHeightMm },
    background: { dataUrl: backgroundDataUrl },
    textElements,
  };
}
