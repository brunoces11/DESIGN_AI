/**
 * Shared fast-check arbitraries (generators) for the
 * `initial-text-brief-flow` PBT suite (P1–P10).
 *
 * Refs: design § "Testing Strategy — PBT generators (specifications)"
 *
 * Conventions:
 *  - `import * as fc from 'fast-check'` (matches existing PBT files).
 *  - These generators target the input/output shapes used by the
 *    Zod schemas in `lib/layout/normalize.ts` and `lib/layout/types.ts`.
 *  - Numeric ranges are kept generous but bounded to keep PBT runs fast.
 */

import * as fc from 'fast-check';

// ---------------------------------------------------------------------------
// Primitive arbitraries
// ---------------------------------------------------------------------------

/**
 * UUID v4 string. The schemas under test use `z.string().uuid()` which
 * accepts any valid UUID variant, but we constrain to v4 to match the
 * format produced by `crypto.randomUUID()` used by the app.
 */
export const arbUuidV4 = fc.uuid({ version: 4 });

/** Free-form label, 0–64 chars (matches EditableTextItemSchema bounds). */
export const arbLabel = fc.string({ minLength: 0, maxLength: 64 });

/** Free-form value, 0–500 chars (matches EditableTextItemSchema bounds). */
export const arbValue = fc.string({ minLength: 0, maxLength: 500 });

// ---------------------------------------------------------------------------
// EditableTextItem / TextBrief
// ---------------------------------------------------------------------------

/** A single editable text item (id + label + value). */
export const arbEditableTextItem = fc.record({
  id: arbUuidV4,
  label: arbLabel,
  value: arbValue,
});

/** A full TextBrief with 0–30 items. */
export const arbTextBrief = fc.record({
  textItems: fc.array(arbEditableTextItem, { minLength: 0, maxLength: 30 }),
});

// ---------------------------------------------------------------------------
// Vision response shapes
// ---------------------------------------------------------------------------

/** Pixel-space bounding box. width/height are >= 1 by construction. */
export const arbBboxPx = fc.record({
  x: fc.integer({ min: 0, max: 4000 }),
  y: fc.integer({ min: 0, max: 4000 }),
  width: fc.integer({ min: 1, max: 2000 }),
  height: fc.integer({ min: 1, max: 2000 }),
});

/** Horizontal alignment literal union. */
export const arbAlign = fc.constantFrom(
  'left' as const,
  'center' as const,
  'right' as const,
);

/**
 * A single text element as returned by the Vision step.
 *  - content: 1..100 chars, must contain a non-whitespace character
 *  - color: random `#RRGGBB` hex OR a small fixed palette of CSS names
 *  - fontWeight: 100..900 in 100-step increments
 */
export const arbVisionTextElement = fc.record({
  content: fc
    .string({ minLength: 1, maxLength: 100 })
    .filter((s) => s.trim().length > 0),
  label: fc.string({ minLength: 0, maxLength: 32 }),
  bboxPx: arbBboxPx,
  color: fc.oneof(
    fc.hexaString({ minLength: 6, maxLength: 6 }).map((h) => `#${h}`),
    fc.constantFrom('red', 'blue', 'white', 'black', '#FFFFFF'),
  ),
  fontWeight: fc.integer({ min: 1, max: 9 }).map((n) => n * 100),
  align: arbAlign,
});

/**
 * A full VisionResponse: image dimensions + 0..20 text elements.
 * Built via `fc.tuple(...).map(...)` so the dimensions and the array
 * are sampled independently and then merged into the canonical shape.
 */
export const arbVisionResponse = fc
  .tuple(
    fc.record({
      imageWidthPx: fc.integer({ min: 1, max: 4000 }),
      imageHeightPx: fc.integer({ min: 1, max: 4000 }),
    }),
    fc.array(arbVisionTextElement, { minLength: 0, maxLength: 20 }),
  )
  .map(([dims, els]) => ({ ...dims, textElements: els }));

// ---------------------------------------------------------------------------
// Canvas / image dimension helpers (used by the normalizer PBTs)
// ---------------------------------------------------------------------------

/** Canvas dimensions in millimeters. */
export const arbCanvasMm = fc.record({
  widthMm: fc.integer({ min: 1, max: 5000 }),
  heightMm: fc.integer({ min: 1, max: 5000 }),
});

/** Source image dimensions in pixels. */
export const arbImageDims = fc.record({
  imageWidthPx: fc.integer({ min: 1, max: 4000 }),
  imageHeightPx: fc.integer({ min: 1, max: 4000 }),
});
