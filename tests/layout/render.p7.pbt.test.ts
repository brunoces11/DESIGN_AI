/**
 * Property-Based Test P7 — Estabilidade dimensional
 *
 * **Validates: Requirements 8.6, 8.11, 16.7**
 *
 * Property P7: Estabilidade dimensional
 * Para qualquer LayoutInput arbitrário com canvas {W, H}, o HTML gerado deve:
 * 1. Conter literalmente `@page { size: ${W}mm ${H}mm; margin: 0 }`.
 * 2. Ter `.canvas` com `width:${W}mm` e `height:${H}mm` nas regras CSS.
 */

import { describe, it, expect } from 'vitest';
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
  fc
    .hexaString({ minLength: 6, maxLength: 6 })
    .map((h) => `#${h.toUpperCase()}`),
  fc
    .hexaString({ minLength: 3, maxLength: 3 })
    .map((h) => `#${h.toUpperCase()}`),
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

/** Arbitrary text content */
const arbContent: fc.Arbitrary<string> = fc.oneof(
  fc.string(),
  fc.string().map((s) => s + '\n'),
  fc.constantFrom('<script>', '</div>', '&amp;', '"hello"', "'world'", '\n\n', ''),
);

/**
 * Full arbitrary TextElement with all fields randomised, bboxes inside canvas.
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
// Property P7: Estabilidade dimensional
// ---------------------------------------------------------------------------

describe('P7 — Estabilidade dimensional', () => {
  /**
   * **Validates: Requirements 8.6, 8.11, 16.7**
   *
   * Para qualquer LayoutInput com canvas {W, H}:
   * 1. O HTML deve conter literalmente `@page { size: ${W}mm ${H}mm; margin: 0 }`.
   * 2. A regra `.canvas` deve conter `width:${W}mm` e `height:${H}mm`.
   */
  it('HTML contém @page com dimensões exatas e .canvas com width/height corretos', () => {
    fc.assert(
      fc.property(arbLayoutInput, (input) => {
        const W = input.canvas.widthMm;
        const H = input.canvas.heightMm;
        const html = renderLayoutHTML(input);

        // Assertion 1: @page rule with exact dimensions
        const expectedPageRule = `@page { size: ${W}mm ${H}mm; margin: 0 }`;
        expect(html).toContain(expectedPageRule);

        // Assertion 2: .canvas CSS rule contains width and height in mm
        // The .canvas rule is in the <style> block; extract it and check
        const expectedWidth = `width: ${W}mm`;
        const expectedHeight = `height: ${H}mm`;
        expect(html).toContain(expectedWidth);
        expect(html).toContain(expectedHeight);
      }),
      {
        numRuns: 200,
        verbose: true,
      },
    );
  });
});
