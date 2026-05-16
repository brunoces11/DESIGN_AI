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
import type { EditableTextItem, LayoutInput, TextBrief, TextElement } from './types';

// ---------------------------------------------------------------------------
// Zod schemas (Vision Raw Schema)
// ---------------------------------------------------------------------------

export const VisionTextElementSchema = z.object({
  content: z.string().min(1),
  /**
   * Free-form visual hierarchy hint extracted by the Vision step
   * (e.g. "titulo", "subtitulo", "preço"). No enum constraint —
   * any string is acceptable. Consumed by `mergeBriefWithVisionLayout`
   * and the `analyze-reference` route; `normalizeVisionResponse`
   * ignores this field.
   *
   * Refs: design § b.1; Req 2.2, 8.10, 9.2; P-SCHEMA-1.
   */
  label: z.string(),
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
// Zod schemas (TextBrief)
// ---------------------------------------------------------------------------

/**
 * EditableTextItem schema — validates a single text item in the brief.
 *
 * - `id`: UUID v4 string (stable identifier within a job).
 * - `label`: visual hierarchy hint, free-form, max 64 characters.
 * - `value`: literal text content to be rendered, max 500 characters.
 *
 * Requirements: 12.4, 12.7
 */
export const EditableTextItemSchema: z.ZodType<EditableTextItem> = z.object({
  id: z.string().uuid(),
  label: z.string().max(64),
  value: z.string().max(500),
});

/**
 * TextBrief schema — validates the canonical text content of a job.
 *
 * No maximum length on the `textItems` array (Req 12.4).
 *
 * Requirements: 12.4, 12.7
 */
export const TextBriefSchema: z.ZodType<TextBrief> = z.object({
  textItems: z.array(EditableTextItemSchema),
});

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

// ---------------------------------------------------------------------------
// sortByReadingOrder
// ---------------------------------------------------------------------------

/**
 * Inferred type of a single validated Vision text element.
 *
 * Refs: design § b.2.
 */
export type VisionTextElement = z.infer<typeof VisionTextElementSchema>;

/**
 * Pure, deterministic, total-order sort of vision text elements
 * by visual reading order: top-to-bottom (primary),
 * left-to-right (secondary, when y-overlap > 50% of the larger element height).
 *
 * The comparator computes the y-overlap between two boxes and treats them as
 * being on the "same row" when `overlap / max(heightA, heightB) > 0.5`. On the
 * same row, `x` is the primary key (with `y` as a deterministic tiebreaker).
 * Otherwise, `y` is the primary key (with `x` as a deterministic tiebreaker).
 *
 * The function does not mutate its input (uses `[...elements].sort(...)`),
 * performs no I/O, and does not consult `Date.now()`, `Math.random()`, or any
 * locale-sensitive APIs.
 *
 * Refs: design § b.2; Req 2.4, 2.5; P-ORDER-1.
 */
export function sortByReadingOrder(
  elements: VisionTextElement[],
): VisionTextElement[] {
  return [...elements].sort((a, b) => {
    const ay1 = a.bboxPx.y;
    const ay2 = a.bboxPx.y + a.bboxPx.height;
    const by1 = b.bboxPx.y;
    const by2 = b.bboxPx.y + b.bboxPx.height;

    const overlap = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
    const maxH = Math.max(a.bboxPx.height, b.bboxPx.height);
    const sameRow = maxH > 0 && overlap / maxH > 0.5;

    if (sameRow) {
      if (a.bboxPx.x !== b.bboxPx.x) return a.bboxPx.x - b.bboxPx.x;
      if (a.bboxPx.y !== b.bboxPx.y) return a.bboxPx.y - b.bboxPx.y;
      return 0;
    }

    if (a.bboxPx.y !== b.bboxPx.y) return a.bboxPx.y - b.bboxPx.y;
    return a.bboxPx.x - b.bboxPx.x;
  });
}

// ---------------------------------------------------------------------------
// mergeBriefWithVisionLayout
// ---------------------------------------------------------------------------

/**
 * Arguments for `mergeBriefWithVisionLayout`.
 *
 * Refs: design § b.3.
 */
export interface MergeArgs {
  brief: TextBrief;
  visionResponse: VisionResponse;
  imageWidthPx: number;
  imageHeightPx: number;
  canvasWidthMm: number;
  canvasHeightMm: number;
  backgroundDataUrl: string;
}

/**
 * Pure merge of a `TextBrief` (canonical text source) with a Vision response
 * (positioning source) into a printable `LayoutInput`.
 *
 * Behaviour:
 *  1. Filters brief items where `value.trim().length > 0` (the "effective"
 *     brief). Empty items are dropped silently.
 *  2. Sorts the Vision elements by reading order via `sortByReadingOrder`.
 *     The brief order is treated as canonical (the order the user typed) and
 *     is NOT re-sorted.
 *  3. Matches by index up to `min(briefLen, visionLen)`. For each match, the
 *     resulting `TextElement` takes `id` and `content` from the brief and
 *     `bbox`/`color`/`fontWeight`/`align` from the Vision element. The bbox
 *     is scaled px → mm using `sx = canvasWidthMm / imageWidthPx` and
 *     `sy = canvasHeightMm / imageHeightPx`, then position and size are
 *     clamped to the canvas bounds.
 *  4. Extra brief items (when `briefLen > visionLen`) are kept and laid out
 *     with default positioning: stacked vertically starting at the canvas
 *     centre, gap 10mm, height 20mm, width 80% of canvas, font size 24px,
 *     weight 400, color `#000000`, align `center`.
 *  5. Extra Vision elements (when `visionLen > briefLen`) are dropped.
 *
 * Pure: no I/O, deterministic, locale-independent.
 *
 * Refs: design § b.3; Req 8.3, 8.4, 8.5, 8.6, 8.7, 8.8; P-BRIEF-2, P-MATCH-1.
 */
export function mergeBriefWithVisionLayout(args: MergeArgs): LayoutInput {
  const {
    brief,
    visionResponse,
    imageWidthPx,
    imageHeightPx,
    canvasWidthMm,
    canvasHeightMm,
    backgroundDataUrl,
  } = args;

  // (1) Filter brief to non-empty values
  const effective = brief.textItems.filter(
    (t) => t.value.trim().length > 0,
  );

  // (2) Sort vision by reading order; brief order is canonical (user's typed order).
  const sortedVision = sortByReadingOrder(visionResponse.textElements);
  const sortedBrief = effective;

  const sx = canvasWidthMm / imageWidthPx;
  const sy = canvasHeightMm / imageHeightPx;

  const matched = Math.min(sortedBrief.length, sortedVision.length);
  const elements: TextElement[] = [];

  // (3) Match by index up to min length
  for (let i = 0; i < matched; i++) {
    const b = sortedBrief[i]!;
    const v = sortedVision[i]!;

    const xMm = clamp(v.bboxPx.x * sx, 0, canvasWidthMm);
    const yMm = clamp(v.bboxPx.y * sy, 0, canvasHeightMm);
    const widthMm = clamp(v.bboxPx.width * sx, 0, canvasWidthMm - xMm);
    const heightMm = clamp(v.bboxPx.height * sy, 0, canvasHeightMm - yMm);

    elements.push({
      id: b.id,
      content: b.value,
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx: estimateFontSizePx(v.bboxPx.height, b.value),
        fontWeight: v.fontWeight,
        color: v.color,
        align: v.align,
      },
    });
  }

  // (4) Extra brief items get default positioning (Req 8.5).
  const extraBrief = sortedBrief.slice(matched);
  const DEFAULT_HEIGHT_MM = 20;
  const DEFAULT_GAP_MM = 10;
  const DEFAULT_FONT_PX = 24;
  const DEFAULT_WIDTH_MM = canvasWidthMm * 0.8;
  const stackStartY = canvasHeightMm / 2;

  extraBrief.forEach((b, k) => {
    const yMm = clamp(
      stackStartY + k * (DEFAULT_HEIGHT_MM + DEFAULT_GAP_MM),
      0,
      Math.max(0, canvasHeightMm - DEFAULT_HEIGHT_MM),
    );
    const widthMm = Math.min(DEFAULT_WIDTH_MM, canvasWidthMm);
    const xMm = clamp((canvasWidthMm - widthMm) / 2, 0, canvasWidthMm);
    const heightMm = Math.min(DEFAULT_HEIGHT_MM, canvasHeightMm - yMm);

    elements.push({
      id: b.id,
      content: b.value,
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx: DEFAULT_FONT_PX,
        fontWeight: 400,
        color: '#000000',
        align: 'center',
      },
    });
  });

  // (5) Extra vision elements are dropped.

  return {
    canvas: { widthMm: canvasWidthMm, heightMm: canvasHeightMm },
    background: { dataUrl: backgroundDataUrl },
    textElements: elements,
  };
}
