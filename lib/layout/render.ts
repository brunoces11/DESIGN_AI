/**
 * lib/layout/render.ts
 *
 * Pure Layout Renderer — shared between client and server.
 * This module has NO I/O, NO Date.now(), NO Math.random(), NO global state.
 */

import { INTER_VARIABLE_BASE64 } from './fonts';
import type { LayoutInput, TextElement } from './types';

/**
 * Escapes HTML special characters to their entity equivalents.
 * Covers: & < > " '
 *
 * Pure function — no regex global state, deterministic substitution table.
 * Requirements: 8.10, 16.9 (P9)
 */
export function escapeHtml(input: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
  };

  return input.replace(/[&<>"']/g, (char) => replacements[char] ?? char);
}

/**
 * Renders a single text element as an absolutely-positioned flex div.
 * Pure function — no I/O, no side effects.
 */
function renderTextNode(t: TextElement): string {
  const justify =
    t.typography.align === 'left'
      ? 'flex-start'
      : t.typography.align === 'right'
        ? 'flex-end'
        : 'center';

  const style = [
    `left:${t.position.xMm}mm`,
    `top:${t.position.yMm}mm`,
    `width:${t.size.widthMm}mm`,
    `height:${t.size.heightMm}mm`,
    `font-size:${t.typography.fontSizePx}px`,
    `font-weight:${t.typography.fontWeight}`,
    `color:${t.typography.color}`,
    `text-align:${t.typography.align}`,
    `justify-content:${justify}`,
  ].join(';');

  return `<div class="text" data-id="${escapeHtml(t.id)}" style="${style}">${escapeHtml(t.content)}</div>`;
}

/**
 * Converts a LayoutInput into a complete, self-contained HTML string.
 *
 * - Output is deterministic: same input → identical byte sequence every time.
 * - Pure: no I/O, no Date.now(), no Math.random(), no mutation of input.
 * - Self-contained: Inter Variable font embedded via @font-face base64 data URL.
 *
 * Requirements: 8.1–8.11, 16.1 (P1), 16.2 (P2), 16.6 (P6), 16.7 (P7), 16.9 (P9)
 */
export function renderLayoutHTML(input: LayoutInput): string {
  const W = input.canvas.widthMm;
  const H = input.canvas.heightMm;

  const fontFace = `@font-face {
      font-family: 'Inter';
      font-weight: 100 900;
      font-style: normal;
      src: url(${INTER_VARIABLE_BASE64}) format('woff2-variations');
      font-display: block;
    }`;

  const pageRule = `@page { size: ${W}mm ${H}mm; margin: 0 }`;

  const rootRules = `*, *::before, *::after { box-sizing: border-box }
    html, body { margin: 0; padding: 0 }
    .canvas {
      position: relative;
      width: ${W}mm;
      height: ${H}mm;
      overflow: hidden;
    }
    .canvas > .bg {
      position: absolute;
      left: 0; top: 0;
      width: 100%; height: 100%;
      object-fit: fill;
    }
    .canvas > .text {
      position: absolute;
      display: flex;
      align-items: center;
      font-family: 'Inter', sans-serif;
      white-space: pre-wrap;
      word-break: break-word;
    }`;

  const textNodes = input.textElements.map((t) => renderTextNode(t)).join('\n  ');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
${fontFace}
${pageRule}
${rootRules}
</style>
</head>
<body>
<div class="canvas">
  <img class="bg" src="${input.background.dataUrl}" alt="">
  ${textNodes}
</div>
</body>
</html>`;
}
