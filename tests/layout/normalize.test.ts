/**
 * Unit tests do Vision Normalizer (Task 6.4)
 *
 * Casos: escala, bboxes na borda, schema rejeita negativos, preserva newlines.
 * Requirements: 7.1, 7.2, 5.2
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeVisionResponse,
  VisionResponseSchema,
  estimateFontSizePx,
  type VisionResponse,
} from '@/lib/layout/normalize';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRaw(overrides: Partial<VisionResponse> = {}): VisionResponse {
  return {
    imageWidthPx: 1000,
    imageHeightPx: 500,
    textElements: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('VisionResponseSchema', () => {
  it('aceita um VisionResponse válido', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 10, y: 20, width: 100, height: 50 },
          color: '#FFFFFF',
          fontWeight: 700,
          align: 'center',
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejeita imageWidthPx = 0', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 0,
      imageHeightPx: 500,
      textElements: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita imageHeightPx negativo', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: -1,
      textElements: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita bboxPx.x negativo', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: -1, y: 0, width: 100, height: 50 },
          color: '#FFF',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita bboxPx.y negativo', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 0, y: -5, width: 100, height: 50 },
          color: '#FFF',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita bboxPx.width = 0', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 0, height: 50 },
          color: '#FFF',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita content vazio', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: '',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 100, height: 50 },
          color: '#FFF',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita fontWeight fora de [100, 900]', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 100, height: 50 },
          color: '#FFF',
          fontWeight: 50,
          align: 'left',
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejeita align inválido', () => {
    const result = VisionResponseSchema.safeParse({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 100, height: 50 },
          color: '#FFF',
          fontWeight: 400,
          align: 'justify',
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeVisionResponse — escala
// ---------------------------------------------------------------------------

describe('normalizeVisionResponse — escala', () => {
  it('imagem 1000x500 px → canvas 200x100 mm com escala 0.2', () => {
    const raw = makeRaw({
      imageWidthPx: 1000,
      imageHeightPx: 500,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 100, y: 50, width: 200, height: 100 },
          color: '#FFFFFF',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 1000,
      imageHeightPx: 500,
      canvasWidthMm: 200,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    // sx = 200/1000 = 0.2, sy = 100/500 = 0.2
    expect(output.textElements[0]?.position.xMm).toBeCloseTo(20); // 100 * 0.2
    expect(output.textElements[0]?.position.yMm).toBeCloseTo(10); // 50 * 0.2
    expect(output.textElements[0]?.size.widthMm).toBeCloseTo(40); // 200 * 0.2
    expect(output.textElements[0]?.size.heightMm).toBeCloseTo(20); // 100 * 0.2
  });

  it('preserva canvas dimensions no output', () => {
    const raw = makeRaw();
    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 1000,
      imageHeightPx: 500,
      canvasWidthMm: 300,
      canvasHeightMm: 400,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    expect(output.canvas.widthMm).toBe(300);
    expect(output.canvas.heightMm).toBe(400);
  });

  it('preserva backgroundDataUrl', () => {
    const raw = makeRaw();
    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,TESTDATA',
    });

    expect(output.background.dataUrl).toBe('data:image/png;base64,TESTDATA');
  });
});

// ---------------------------------------------------------------------------
// normalizeVisionResponse — bboxes na borda
// ---------------------------------------------------------------------------

describe('normalizeVisionResponse — bboxes na borda', () => {
  it('bbox exatamente no canto (0,0) com tamanho máximo', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: [
        {
          content: 'Edge',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 100, height: 100 },
          color: '#000',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    const t = output.textElements[0]!;
    expect(t.position.xMm).toBe(0);
    expect(t.position.yMm).toBe(0);
    expect(t.size.widthMm).toBe(100);
    expect(t.size.heightMm).toBe(100);
  });

  it('bbox excedente é clampada ao canvas', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: [
        {
          content: 'Overflow',
          label: 'titulo',
          bboxPx: { x: 80, y: 80, width: 100, height: 100 }, // exceeds 100x100
          color: '#000',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    const t = output.textElements[0]!;
    // xMm = clamp(80, 0, 100) = 80
    // widthMm = clamp(100, 0, 100 - 80) = 20
    expect(t.position.xMm).toBe(80);
    expect(t.position.yMm).toBe(80);
    expect(t.position.xMm + t.size.widthMm).toBeLessThanOrEqual(100);
    expect(t.position.yMm + t.size.heightMm).toBeLessThanOrEqual(100);
  });
});

// ---------------------------------------------------------------------------
// normalizeVisionResponse — IDs e preservação de ordem
// ---------------------------------------------------------------------------

describe('normalizeVisionResponse — IDs e preservação', () => {
  it('atribui ids t0, t1, t2 em ordem', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: [
        { content: 'A', label: 'titulo', bboxPx: { x: 0, y: 0, width: 10, height: 10 }, color: '#000', fontWeight: 400, align: 'left' },
        { content: 'B', label: 'titulo', bboxPx: { x: 0, y: 0, width: 10, height: 10 }, color: '#000', fontWeight: 400, align: 'left' },
        { content: 'C', label: 'titulo', bboxPx: { x: 0, y: 0, width: 10, height: 10 }, color: '#000', fontWeight: 400, align: 'left' },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    expect(output.textElements[0]?.id).toBe('t0');
    expect(output.textElements[1]?.id).toBe('t1');
    expect(output.textElements[2]?.id).toBe('t2');
  });

  it('preserva textElements.length', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: Array.from({ length: 7 }, (_, i) => ({
        content: `Text ${i}`,
        label: 'titulo',
        bboxPx: { x: 0, y: 0, width: 10, height: 10 },
        color: '#000',
        fontWeight: 400 as const,
        align: 'left' as const,
      })),
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    expect(output.textElements.length).toBe(7);
  });

  it('preserva newlines em content', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: [
        {
          content: 'Line 1\nLine 2\nLine 3',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 50, height: 30 },
          color: '#000',
          fontWeight: 400,
          align: 'left',
        },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    expect(output.textElements[0]?.content).toBe('Line 1\nLine 2\nLine 3');
  });

  it('define fontFamily como Inter, sans-serif', () => {
    const raw = makeRaw({
      imageWidthPx: 100,
      imageHeightPx: 100,
      textElements: [
        {
          content: 'Hello',
          label: 'titulo',
          bboxPx: { x: 0, y: 0, width: 50, height: 20 },
          color: '#000',
          fontWeight: 700,
          align: 'center',
        },
      ],
    });

    const output = normalizeVisionResponse({
      raw,
      imageWidthPx: 100,
      imageHeightPx: 100,
      canvasWidthMm: 100,
      canvasHeightMm: 100,
      backgroundDataUrl: 'data:image/png;base64,abc',
    });

    expect(output.textElements[0]?.typography.fontFamily).toBe('Inter, sans-serif');
  });
});

// ---------------------------------------------------------------------------
// estimateFontSizePx
// ---------------------------------------------------------------------------

describe('estimateFontSizePx', () => {
  it('retorna pelo menos 8px', () => {
    expect(estimateFontSizePx(1, 'x')).toBeGreaterThanOrEqual(8);
    expect(estimateFontSizePx(0.1, 'x')).toBeGreaterThanOrEqual(8);
  });

  it('retorna 70% da altura para valores maiores', () => {
    expect(estimateFontSizePx(100, 'text')).toBe(70);
    expect(estimateFontSizePx(50, 'text')).toBe(35);
  });
});
