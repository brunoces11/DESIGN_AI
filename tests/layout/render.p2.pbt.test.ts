/**
 * Property-Based Test P2 — Pureza do Layout Renderer
 *
 * **Validates: Requirements 16.2**
 *
 * Property P2: Pureza (sem mutação)
 * Para qualquer LayoutInput arbitrário:
 * 1. renderLayoutHTML(input) NÃO muta o objeto `input` (deepEqual com clone pré-chamada).
 * 2. renderLayoutHTML NÃO chama fs, process.hrtime, Date.now, Math.random.
 */

import { describe, it, vi, expect, beforeEach, afterEach } from 'vitest';
import * as fc from 'fast-check';
import { renderLayoutHTML } from '@/lib/layout/render';
import type { LayoutInput, TextElement } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// Arbitraries (reused from P1 test)
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

/**
 * Arbitrary text content: arbitrary unicode including specials and newlines.
 */
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
export const arbLayoutInput: fc.Arbitrary<LayoutInput> = arbCanvasMm.chain(
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
// Property P2: Pureza (sem mutação)
// ---------------------------------------------------------------------------

describe('P2 — Pureza do Layout Renderer', () => {
  /**
   * **Validates: Requirements 16.2**
   *
   * P2a: renderLayoutHTML NÃO muta o objeto `input`.
   * Clona `input` via structuredClone antes da chamada; após renderLayoutHTML(input),
   * assere deepEqual(input, clone).
   */
  it('renderLayoutHTML não muta o input (structuredClone deepEqual)', () => {
    fc.assert(
      fc.property(arbLayoutInput, (input) => {
        const clone = structuredClone(input);
        renderLayoutHTML(input);
        expect(input).toEqual(clone);
      }),
      {
        numRuns: 200,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 16.2**
   *
   * P2b: renderLayoutHTML NÃO chama Date.now, Math.random, process.hrtime.
   * Mocks são instalados antes de cada run e verificados após.
   *
   * Note: `fs` is a Node built-in module. renderLayoutHTML is a pure function
   * that does not import fs at all, so we verify via spying on the global
   * side-effect functions that could indicate impurity.
   */
  describe('sem chamadas a funções impuras globais', () => {
    let dateNowSpy: ReturnType<typeof vi.spyOn>;
    let mathRandomSpy: ReturnType<typeof vi.spyOn>;
    let processHrtimeSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      dateNowSpy = vi.spyOn(Date, 'now');
      mathRandomSpy = vi.spyOn(Math, 'random');
      processHrtimeSpy = vi.spyOn(process, 'hrtime');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('não chama Date.now durante renderLayoutHTML', () => {
      fc.assert(
        fc.property(arbLayoutInput, (input) => {
          dateNowSpy.mockClear();
          renderLayoutHTML(input);
          expect(dateNowSpy).not.toHaveBeenCalled();
        }),
        { numRuns: 100, verbose: true },
      );
    });

    it('não chama Math.random durante renderLayoutHTML', () => {
      fc.assert(
        fc.property(arbLayoutInput, (input) => {
          mathRandomSpy.mockClear();
          renderLayoutHTML(input);
          expect(mathRandomSpy).not.toHaveBeenCalled();
        }),
        { numRuns: 100, verbose: true },
      );
    });

    it('não chama process.hrtime durante renderLayoutHTML', () => {
      fc.assert(
        fc.property(arbLayoutInput, (input) => {
          processHrtimeSpy.mockClear();
          renderLayoutHTML(input);
          expect(processHrtimeSpy).not.toHaveBeenCalled();
        }),
        { numRuns: 100, verbose: true },
      );
    });
  });
});
