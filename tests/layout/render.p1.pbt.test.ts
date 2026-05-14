/**
 * Property-Based Test P1 — Determinismo do Layout Renderer
 *
 * **Validates: Requirements 8.3, 16.1**
 *
 * Property P1: Determinismo
 * Para qualquer LayoutInput arbitrário, renderLayoutHTML(input) deve retornar
 * exatamente a mesma string byte-a-byte em chamadas consecutivas.
 *
 * Asserção: renderLayoutHTML(input) === renderLayoutHTML(input)
 */

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { renderLayoutHTML } from '@/lib/layout/render';
import type { LayoutInput, TextElement } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Canvas dimensions in mm: [10, 5000] */
const arbCanvasMm = fc.record({
  widthMm: fc.integer({ min: 10, max: 5000 }),
  heightMm: fc.integer({ min: 10, max: 5000 }),
});

/** Arbitrary CSS color: hex (#RRGGBB / #RGB) or a CSS named color */
const arbColor: fc.Arbitrary<string> = fc.oneof(
  // 6-digit hex
  fc
    .hexaString({ minLength: 6, maxLength: 6 })
    .map((h) => `#${h.toUpperCase()}`),
  // 3-digit hex
  fc
    .hexaString({ minLength: 3, maxLength: 3 })
    .map((h) => `#${h.toUpperCase()}`),
  // CSS named colors (small representative set)
  fc.constantFrom(
    'red',
    'green',
    'blue',
    'black',
    'white',
    'yellow',
    'cyan',
    'magenta',
    'orange',
    'purple',
    'pink',
    'brown',
    'gray',
    'transparent',
  ),
);

/** fontWeight: multiple of 100 in [100, 900] */
const arbFontWeight: fc.Arbitrary<number> = fc
  .integer({ min: 1, max: 9 })
  .map((n) => n * 100);

/** align: 'left' | 'center' | 'right' */
const arbAlign: fc.Arbitrary<'left' | 'center' | 'right'> = fc.constantFrom(
  'left',
  'center',
  'right',
);

/**
 * Arbitrary text content: arbitrary unicode including specials and newlines.
 * Uses fc.string() which covers the full unicode range, plus we mix in
 * explicit newline and special characters.
 */
const arbContent: fc.Arbitrary<string> = fc.oneof(
  fc.string(), // arbitrary unicode
  fc.string().map((s) => s + '\n'), // with trailing newline
  fc.constantFrom('<script>', '</div>', '&amp;', '"hello"', "'world'", '\n\n', ''),
);

/**
 * Arbitrary TextElement with bboxes constrained to be within the canvas.
 * Receives canvas dimensions to ensure bboxes stay inside.
 */
function arbTextElement(
  canvasWidthMm: number,
  canvasHeightMm: number,
  index: number,
): fc.Arbitrary<TextElement> {
  // Ensure bbox fits inside canvas: position + size <= canvas dimension
  const arbX = fc.integer({ min: 0, max: Math.max(0, canvasWidthMm - 1) });
  const arbY = fc.integer({ min: 0, max: Math.max(0, canvasHeightMm - 1) });

  return fc
    .tuple(arbX, arbY)
    .chain(([x, y]) => {
      const maxW = Math.max(1, canvasWidthMm - x);
      const maxH = Math.max(1, canvasHeightMm - y);
      return fc.record({
        xMm: fc.constant(x),
        yMm: fc.constant(y),
        widthMm: fc.integer({ min: 1, max: maxW }),
        heightMm: fc.integer({ min: 1, max: maxH }),
      });
    })
    .map(({ xMm, yMm, widthMm, heightMm }) => ({
      id: `t${index}`,
      content: '', // will be overridden below via chain
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx: 16,
        fontWeight: 400,
        color: '#000000',
        align: 'left' as const,
      },
    }));
}

/**
 * Full arbitrary TextElement with all fields randomised.
 */
function arbFullTextElement(
  canvasWidthMm: number,
  canvasHeightMm: number,
  index: number,
): fc.Arbitrary<TextElement> {
  const arbX = fc.integer({ min: 0, max: Math.max(0, canvasWidthMm - 1) });
  const arbY = fc.integer({ min: 0, max: Math.max(0, canvasHeightMm - 1) });

  return fc
    .tuple(arbX, arbY)
    .chain(([x, y]) => {
      const maxW = Math.max(1, canvasWidthMm - x);
      const maxH = Math.max(1, canvasHeightMm - y);
      return fc.record({
        xMm: fc.constant(x),
        yMm: fc.constant(y),
        widthMm: fc.integer({ min: 1, max: maxW }),
        heightMm: fc.integer({ min: 1, max: maxH }),
        content: arbContent,
        color: arbColor,
        fontWeight: arbFontWeight,
        align: arbAlign,
        fontSizePx: fc.integer({ min: 6, max: 200 }),
      });
    })
    .map(({ xMm, yMm, widthMm, heightMm, content, color, fontWeight, align, fontSizePx }) => ({
      id: `t${index}`,
      content,
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx,
        fontWeight,
        color,
        align,
      },
    }));
}

/** Arbitrary LayoutInput with 0–50 text elements, bboxes inside canvas */
const arbLayoutInput: fc.Arbitrary<LayoutInput> = arbCanvasMm.chain(
  ({ widthMm, heightMm }) => {
    const count = fc.integer({ min: 0, max: 50 });
    return count.chain((n) => {
      if (n === 0) {
        return fc.constant<LayoutInput>({
          canvas: { widthMm, heightMm },
          background: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
          textElements: [],
        });
      }
      const elementArbs = Array.from({ length: n }, (_, i) =>
        arbFullTextElement(widthMm, heightMm, i),
      );
      return fc.tuple(...(elementArbs as [fc.Arbitrary<TextElement>])).map(
        (elements) =>
          ({
            canvas: { widthMm, heightMm },
            background: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
            textElements: Array.isArray(elements) ? elements : [elements],
          }) satisfies LayoutInput,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Property P1: Determinismo
// ---------------------------------------------------------------------------

describe('P1 — Determinismo do Layout Renderer', () => {
  /**
   * **Validates: Requirements 8.3, 16.1**
   *
   * Para qualquer LayoutInput arbitrário, duas chamadas consecutivas a
   * renderLayoutHTML com o mesmo input devem produzir saídas idênticas.
   */
  it('renderLayoutHTML(input) === renderLayoutHTML(input) para qualquer LayoutInput', () => {
    fc.assert(
      fc.property(arbLayoutInput, (input) => {
        const first = renderLayoutHTML(input);
        const second = renderLayoutHTML(input);
        return first === second;
      }),
      {
        numRuns: 200,
        verbose: true,
      },
    );
  });
});
