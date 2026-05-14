/**
 * Property-Based Test P9 — HTML escape sem injeção
 *
 * **Validates: Requirements 8.10, 16.9**
 *
 * Property P9: HTML escape
 * Para qualquer LayoutInput com content arbitrário (incluindo caracteres HTML
 * especiais), renderLayoutHTML deve:
 *   1. Escapar corretamente o content de cada TextElement no HTML gerado.
 *   2. Garantir que o HTML completo NÃO contém o content literal quando este
 *      inclui caracteres que precisam de escape (< > & " ').
 *
 * Estratégia de verificação (sem dependências novas):
 *   - Extrair o <div class="text" data-id="${id}" ...>...</div> via regex
 *     ancorada no data-id único.
 *   - Decodificar entidades HTML (&lt; &gt; &amp; &quot; &#x27;) do conteúdo
 *     extraído.
 *   - Asserir que o resultado decodificado === t.content original.
 *   - Asserir que o HTML completo NÃO contém t.content literalmente quando
 *     t.content inclui caracteres HTML especiais.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { renderLayoutHTML } from '@/lib/layout/render';
import type { LayoutInput, TextElement } from '@/lib/layout/types';

// ---------------------------------------------------------------------------
// HTML entity decoder (no external deps)
// ---------------------------------------------------------------------------

/**
 * Decodes the five HTML entities that escapeHtml produces.
 * This is the inverse of escapeHtml for the specific entities it emits.
 *
 * IMPORTANT: We must decode &amp; LAST to avoid double-decoding.
 * For example, if the original content was "&lt;" (which contains &, <, ;),
 * escapeHtml produces "&amp;lt;" — decoding &amp; first would give "&lt;"
 * which would then be decoded again to "<", losing the original meaning.
 *
 * By decoding &amp; last, we correctly recover the original string:
 * "&amp;lt;" → (decode &lt; → no match) → (decode &amp; → "&lt;") ✓
 *
 * Single-pass approach using a regex alternation to avoid ordering issues:
 */
function decodeHtmlEntities(s: string): string {
  return s.replace(/&lt;|&gt;|&quot;|&#x27;|&amp;/g, (entity) => {
    switch (entity) {
      case '&lt;': return '<';
      case '&gt;': return '>';
      case '&quot;': return '"';
      case '&#x27;': return "'";
      case '&amp;': return '&';
      default: return entity;
    }
  });
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Canvas dimensions in mm: [10, 500] — smaller range for faster tests */
const arbCanvasMm = fc.record({
  widthMm: fc.integer({ min: 10, max: 500 }),
  heightMm: fc.integer({ min: 10, max: 500 }),
});

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
 * Arbitrary content that specifically targets HTML injection vectors.
 * Includes: <script> tags, </div> closing tags, &amp; entities, quotes,
 * bare < and > characters, and combinations thereof.
 */
const arbMaliciousContent: fc.Arbitrary<string> = fc.oneof(
  // Explicit injection payloads
  fc.constantFrom(
    '<script>alert("xss")</script>',
    '</div><script>evil()</script>',
    '&amp;',
    '&lt;b&gt;bold&lt;/b&gt;',
    '"double quoted"',
    "'single quoted'",
    '<img src=x onerror=alert(1)>',
    '"><script>alert(1)</script>',
    "' OR '1'='1",
    '<br/>',
    '&',
    '<',
    '>',
    '"',
    "'",
    '< > & " \'',
    '<<>>&&""\'\'',
    '</div></body></html><script>pwned()</script>',
    'normal text without specials',
    '',
  ),
  // Arbitrary strings that may contain HTML special chars
  fc.string().filter((s) => s.length <= 200),
  // Strings with embedded HTML chars
  fc.tuple(fc.string(), fc.constantFrom('<', '>', '&', '"', "'"), fc.string()).map(
    ([a, mid, b]) => a + mid + b,
  ),
);

/**
 * Arbitrary TextElement with unique id and malicious content.
 */
function arbTextElementWithId(
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
        content: arbMaliciousContent,
        fontWeight: arbFontWeight,
        align: arbAlign,
        fontSizePx: fc.integer({ min: 6, max: 200 }),
      });
    })
    .map(({ xMm, yMm, widthMm, heightMm, content, fontWeight, align, fontSizePx }) => ({
      // Use a unique, predictable id that won't be confused with other elements
      id: `p9-elem-${index}`,
      content,
      position: { xMm, yMm },
      size: { widthMm, heightMm },
      typography: {
        fontFamily: 'Inter, sans-serif',
        fontSizePx,
        fontWeight,
        color: '#000000',
        align,
      },
    }));
}

/**
 * Arbitrary LayoutInput with 1–10 text elements containing potentially
 * malicious content. We use at least 1 element to always have something to verify.
 */
const arbLayoutInputWithMaliciousContent: fc.Arbitrary<LayoutInput> = arbCanvasMm.chain(
  ({ widthMm, heightMm }) =>
    fc.integer({ min: 1, max: 10 }).chain((n) => {
      const elementArbs = Array.from({ length: n }, (_, i) =>
        arbTextElementWithId(widthMm, heightMm, i),
      );
      return fc.tuple(...(elementArbs as [fc.Arbitrary<TextElement>])).map(
        (elements) =>
          ({
            canvas: { widthMm, heightMm },
            background: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
            textElements: Array.isArray(elements) ? elements : [elements],
          }) satisfies LayoutInput,
      );
    }),
);

// ---------------------------------------------------------------------------
// Helper: extract inner content of a text div by its data-id
// ---------------------------------------------------------------------------

/**
 * Extracts the inner HTML content of the <div class="text" data-id="...">
 * element with the given id from the rendered HTML string.
 *
 * Uses a regex anchored on the unique data-id attribute. The id is escaped
 * for use in a regex pattern (ids are of the form "p9-elem-N" which are safe,
 * but we escape anyway for correctness).
 *
 * Returns null if the element is not found.
 */
function extractTextDivContent(html: string, id: string): string | null {
  // Escape the id for use in a regex (handles any special regex chars in id)
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match: <div class="text" data-id="<id>" style="...">CONTENT</div>
  // The style attribute is between data-id and the closing >, then content follows.
  // We use a non-greedy match for the content to stop at the first </div>.
  // Note: the content itself is HTML-escaped so it won't contain raw </div>.
  const pattern = new RegExp(
    `<div class="text" data-id="${escapedId}"[^>]*>(.*?)<\\/div>`,
    's', // dotAll flag so . matches newlines
  );

  const match = html.match(pattern);
  return match ? match[1]! : null;
}

// ---------------------------------------------------------------------------
// Helper: check if content contains HTML-special characters (unused in P9b now)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Property P9: HTML escape
// ---------------------------------------------------------------------------

describe('P9 — HTML escape sem injeção', () => {
  /**
   * **Validates: Requirements 8.10, 16.9**
   *
   * P9a: Para cada TextElement, o conteúdo extraído do HTML (após decodificação
   * de entidades) deve ser igual ao t.content original.
   *
   * Estratégia:
   * 1. Renderizar o HTML.
   * 2. Para cada elemento, extrair o inner content do <div data-id="..."> via regex.
   * 3. Decodificar entidades HTML do conteúdo extraído.
   * 4. Asserir que o resultado decodificado === t.content.
   */
  it('conteúdo extraído e decodificado deve ser igual ao content original', () => {
    fc.assert(
      fc.property(arbLayoutInputWithMaliciousContent, (input) => {
        const html = renderLayoutHTML(input);

        for (const t of input.textElements) {
          const rawExtracted = extractTextDivContent(html, t.id);

          // The div must be present in the HTML
          expect(rawExtracted, `div with data-id="${t.id}" not found in HTML`).not.toBeNull();

          const decoded = decodeHtmlEntities(rawExtracted!);

          // After decoding, the content must match the original exactly
          expect(decoded).toBe(t.content);
        }
      }),
      {
        numRuns: 300,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 8.10, 16.9**
   *
   * P9b: O HTML completo NÃO deve conter o content literal quando este inclui
   * sequências que poderiam formar tags HTML ou injeções de script.
   *
   * Isso garante que nenhum conteúdo malicioso é injetado como HTML bruto.
   * Verificamos especificamente que sequências de injeção (como `<tag`, `</tag`,
   * `<script`, etc.) não aparecem literalmente no HTML gerado.
   *
   * Nota: fragmentos muito curtos como `<`, `>`, `</`, `<b` podem aparecer
   * legitimamente na estrutura HTML (em tags, atributos, etc.), portanto
   * verificamos apenas conteúdos que contêm sequências de tag completas
   * (letra(s) seguidas de espaço ou >) que constituem vetores de injeção reais.
   */
  it('HTML não contém sequências de injeção literais quando content tem tags HTML', () => {
    fc.assert(
      fc.property(arbLayoutInputWithMaliciousContent, (input) => {
        const html = renderLayoutHTML(input);

        for (const t of input.textElements) {
          // Only check content that contains a complete tag pattern:
          // < followed by a letter/slash+letter and then space, >, or /
          // This filters out bare `<`, `</`, `<b` etc. that appear in HTML structure
          const completeTagPattern = /<[a-zA-Z][a-zA-Z0-9]*[\s>\/]|<\/[a-zA-Z][a-zA-Z0-9]*[\s>]/;
          if (!completeTagPattern.test(t.content)) {
            continue;
          }

          // The raw content (which contains a complete tag) must NOT appear
          // literally in the HTML text nodes.
          // escapeHtml converts `<` to `&lt;`, so the escaped version differs.
          const escaped = t.content
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;');

          // The escaped content must appear in the HTML (it was rendered)
          expect(
            html.includes(escaped),
            `Escaped content for "${t.content.slice(0, 80)}" not found in HTML`,
          ).toBe(true);

          // The raw content must NOT appear in the HTML
          // (it would indicate an injection vulnerability)
          expect(
            html.includes(t.content),
            `Raw content "${t.content.slice(0, 80)}" found literally in HTML — injection not prevented`,
          ).toBe(false);
        }
      }),
      {
        numRuns: 300,
        verbose: true,
      },
    );
  });

  /**
   * **Validates: Requirements 8.10, 16.9**
   *
   * P9c: Casos determinísticos de injeção conhecidos.
   * Verifica payloads XSS clássicos explicitamente.
   */
  it('payloads XSS conhecidos são escapados corretamente', () => {
    const xssPayloads = [
      '<script>alert("xss")</script>',
      '</div><script>evil()</script>',
      '"><script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      "' OR '1'='1",
    ];

    for (const payload of xssPayloads) {
      const input: LayoutInput = {
        canvas: { widthMm: 100, heightMm: 100 },
        background: { dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        textElements: [
          {
            id: 'xss-test',
            content: payload,
            position: { xMm: 0, yMm: 0 },
            size: { widthMm: 50, heightMm: 20 },
            typography: {
              fontFamily: 'Inter, sans-serif',
              fontSizePx: 16,
              fontWeight: 400,
              color: '#000000',
              align: 'left',
            },
          },
        ],
      };

      const html = renderLayoutHTML(input);

      // The raw payload must not appear literally in the HTML
      expect(
        html.includes(payload),
        `XSS payload "${payload}" found literally in HTML`,
      ).toBe(false);

      // The content must be recoverable via extraction + decoding
      const rawExtracted = extractTextDivContent(html, 'xss-test');
      expect(rawExtracted).not.toBeNull();
      const decoded = decodeHtmlEntities(rawExtracted!);
      expect(decoded).toBe(payload);
    }
  });
});
