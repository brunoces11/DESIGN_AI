/**
 * Unit tests dos OpenAI wrappers (Task 9.5)
 *
 * Mock do SDK para asserir parâmetros enviados.
 * Requirements: 2.2, 5.1, 6.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the openai SDK before importing wrappers
// ---------------------------------------------------------------------------

const mockImagesEdit = vi.fn();
const mockChatCompletionsCreate = vi.fn();

vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      images: {
        edit: mockImagesEdit,
      },
      chat: {
        completions: {
          create: mockChatCompletionsCreate,
        },
      },
    })),
  };
});

// Set API key before importing
process.env['OPENAI_API_KEY'] = 'test-key-for-unit-tests';

import { generateImageToImage, regenerateWithoutText, extractLayoutVision } from '@/lib/openai';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]); // PNG magic bytes
const FAKE_B64 = FAKE_PNG.toString('base64');

// ---------------------------------------------------------------------------
// generateImageToImage
// ---------------------------------------------------------------------------

describe('generateImageToImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa modelo gpt-image-1', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await generateImageToImage({ baseImage: FAKE_PNG, prompt: 'test prompt' });

    expect(mockImagesEdit).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1' }),
    );
  });

  it('envia o prompt correto (contém o userPrompt no prompt interpolado)', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await generateImageToImage({ baseImage: FAKE_PNG, prompt: 'my custom prompt' });

    const call = mockImagesEdit.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain('my custom prompt');
  });

  it('injeta bloco "no text" quando textItems está vazio', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await generateImageToImage({ baseImage: FAKE_PNG, prompt: 'test', textItems: [] });

    const call = mockImagesEdit.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain('text-free image');
  });

  it('injeta lista de textos quando textItems é não-vazio', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    const textItems = [
      { id: '00000000-0000-4000-8000-000000000001', label: 'titulo', value: 'PROMOÇÃO' },
      { id: '00000000-0000-4000-8000-000000000002', label: 'preco', value: 'R$ 19,90' },
    ];

    await generateImageToImage({ baseImage: FAKE_PNG, prompt: 'test', textItems });

    const call = mockImagesEdit.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain('Include EXACTLY these texts');
    expect(call.prompt).toContain('- titulo: "PROMOÇÃO"');
    expect(call.prompt).toContain('- preco: "R$ 19,90"');
  });

  it('retorna Buffer PNG a partir de b64_json', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    const result = await generateImageToImage({ baseImage: FAKE_PNG, prompt: 'test' });

    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result[0]).toBe(0x89); // PNG magic
  });

  it('lança erro se nenhum dado retornado', async () => {
    mockImagesEdit.mockResolvedValueOnce({ data: [] });

    await expect(
      generateImageToImage({ baseImage: FAKE_PNG, prompt: 'test' }),
    ).rejects.toThrow('no image data');
  });
});

// ---------------------------------------------------------------------------
// regenerateWithoutText
// ---------------------------------------------------------------------------

describe('regenerateWithoutText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa modelo gpt-image-1', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await regenerateWithoutText({ baseImage: FAKE_PNG, originalPrompt: 'banner' });

    expect(mockImagesEdit).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-image-1' }),
    );
  });

  it('prompt contém instrução de remoção de texto', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await regenerateWithoutText({ baseImage: FAKE_PNG, originalPrompt: 'banner' });

    const call = mockImagesEdit.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt.toLowerCase()).toContain('remove');
    expect(call.prompt.toLowerCase()).toContain('text');
  });

  it('inclui originalPrompt como contexto de cena', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    await regenerateWithoutText({ baseImage: FAKE_PNG, originalPrompt: 'colorful banner' });

    const call = mockImagesEdit.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain('colorful banner');
  });

  it('retorna Buffer PNG', async () => {
    mockImagesEdit.mockResolvedValueOnce({
      data: [{ b64_json: FAKE_B64 }],
    });

    const result = await regenerateWithoutText({ baseImage: FAKE_PNG, originalPrompt: 'test' });

    expect(Buffer.isBuffer(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractLayoutVision
// ---------------------------------------------------------------------------

describe('extractLayoutVision', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usa modelo gpt-4o', async () => {
    const fakeJson = JSON.stringify({
      imageWidthPx: 1024,
      imageHeightPx: 1024,
      textElements: [],
    });

    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: fakeJson } }],
    });

    await extractLayoutVision({ image: FAKE_PNG });

    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o' }),
    );
  });

  it('usa response_format json_object', async () => {
    const fakeJson = JSON.stringify({ imageWidthPx: 100, imageHeightPx: 100, textElements: [] });

    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: fakeJson } }],
    });

    await extractLayoutVision({ image: FAKE_PNG });

    expect(mockChatCompletionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: { type: 'json_object' },
      }),
    );
  });

  it('retorna JSON parseado como unknown', async () => {
    const fakeResponse = { imageWidthPx: 512, imageHeightPx: 512, textElements: [] };

    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify(fakeResponse) } }],
    });

    const result = await extractLayoutVision({ image: FAKE_PNG });

    expect(result).toEqual(fakeResponse);
  });

  it('lança erro se resposta vazia', async () => {
    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '' } }],
    });

    await expect(extractLayoutVision({ image: FAKE_PNG })).rejects.toThrow();
  });

  it('envia imagem como data URL base64 no conteúdo', async () => {
    const fakeJson = JSON.stringify({ imageWidthPx: 100, imageHeightPx: 100, textElements: [] });

    mockChatCompletionsCreate.mockResolvedValueOnce({
      choices: [{ message: { content: fakeJson } }],
    });

    await extractLayoutVision({ image: FAKE_PNG });

    const call = mockChatCompletionsCreate.mock.calls[0]?.[0] as {
      messages: Array<{ content: Array<{ type: string; image_url?: { url: string } }> }>;
    };
    const imageContent = call.messages[0]?.content.find((c) => c.type === 'image_url');
    expect(imageContent?.image_url?.url).toContain('data:image/png;base64,');
  });
});
