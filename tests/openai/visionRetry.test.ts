/**
 * Unit tests do visionRetry helper (Task 11.1)
 *
 * Caso 1: primeiro inválido, segundo válido → resolve.
 * Caso 2: ambos inválidos → rejeita com vision_validation_failed.
 * Caso 3: primeiro válido → não chama segundo.
 * Requirements: 5.3, 5.4, 14.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock lib/openai before importing visionRetry
// ---------------------------------------------------------------------------

vi.mock('@/lib/openai', () => ({
  extractLayoutVision: vi.fn(),
}));

import { extractLayoutVisionWithRetry } from '@/lib/openai/visionRetry';
import { extractLayoutVision } from '@/lib/openai';

const mockExtractLayoutVision = vi.mocked(extractLayoutVision);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_VISION_RESPONSE = {
  imageWidthPx: 1024,
  imageHeightPx: 1024,
  textElements: [
    {
      content: 'Hello World',
      label: 'titulo',
      bboxPx: { x: 10, y: 20, width: 200, height: 50 },
      color: '#FFFFFF',
      fontWeight: 700,
      align: 'center',
    },
    {
      content: 'Subtitle',
      label: 'subtitulo',
      bboxPx: { x: 10, y: 80, width: 150, height: 30 },
      color: '#CCCCCC',
      fontWeight: 400,
      align: 'left',
    },
  ],
};

const INVALID_VISION_RESPONSE = {
  // Missing required fields
  imageWidthPx: 0, // invalid: must be positive
  imageHeightPx: 1024,
  textElements: [],
};

const DUMMY_IMAGE = Buffer.from('fake-png-data');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractLayoutVisionWithRetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Caso 1: primeiro retorno inválido, segundo válido → resolve com parsed', async () => {
    mockExtractLayoutVision
      .mockResolvedValueOnce(INVALID_VISION_RESPONSE)
      .mockResolvedValueOnce(VALID_VISION_RESPONSE);

    const result = await extractLayoutVisionWithRetry(DUMMY_IMAGE, 1);

    expect(result.imageWidthPx).toBe(1024);
    expect(result.imageHeightPx).toBe(1024);
    expect(result.textElements).toHaveLength(2);
    expect(mockExtractLayoutVision).toHaveBeenCalledTimes(2);
  });

  it('Caso 2: ambos inválidos → rejeita com vision_validation_failed', async () => {
    mockExtractLayoutVision
      .mockResolvedValueOnce(INVALID_VISION_RESPONSE)
      .mockResolvedValueOnce(INVALID_VISION_RESPONSE);

    await expect(extractLayoutVisionWithRetry(DUMMY_IMAGE, 1)).rejects.toThrow(
      'vision_validation_failed',
    );

    expect(mockExtractLayoutVision).toHaveBeenCalledTimes(2);
  });

  it('Caso 3: primeiro válido → não chama segundo', async () => {
    mockExtractLayoutVision.mockResolvedValueOnce(VALID_VISION_RESPONSE);

    const result = await extractLayoutVisionWithRetry(DUMMY_IMAGE, 1);

    expect(result.imageWidthPx).toBe(1024);
    expect(mockExtractLayoutVision).toHaveBeenCalledTimes(1);
  });

  it('maxRetries = 0 → apenas uma tentativa', async () => {
    mockExtractLayoutVision.mockResolvedValueOnce(INVALID_VISION_RESPONSE);

    await expect(extractLayoutVisionWithRetry(DUMMY_IMAGE, 0)).rejects.toThrow(
      'vision_validation_failed',
    );

    expect(mockExtractLayoutVision).toHaveBeenCalledTimes(1);
  });

  it('passa o buffer de imagem correto para extractLayoutVision', async () => {
    mockExtractLayoutVision.mockResolvedValueOnce(VALID_VISION_RESPONSE);

    await extractLayoutVisionWithRetry(DUMMY_IMAGE, 1);

    expect(mockExtractLayoutVision).toHaveBeenCalledWith({ image: DUMMY_IMAGE });
  });

  it('retorna VisionResponse tipado corretamente', async () => {
    mockExtractLayoutVision.mockResolvedValueOnce(VALID_VISION_RESPONSE);

    const result = await extractLayoutVisionWithRetry(DUMMY_IMAGE, 1);

    // Type check via runtime assertions
    expect(typeof result.imageWidthPx).toBe('number');
    expect(typeof result.imageHeightPx).toBe('number');
    expect(Array.isArray(result.textElements)).toBe(true);
    expect(result.textElements[0]?.content).toBe('Hello World');
    expect(result.textElements[0]?.bboxPx.width).toBe(200);
  });
});
