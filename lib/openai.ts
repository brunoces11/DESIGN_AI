/**
 * lib/openai.ts
 *
 * OpenAI wrappers — server-side only.
 * Each function makes exactly ONE API call and returns the raw result.
 * Retry logic lives in lib/openai/visionRetry.ts.
 *
 * Prompts are loaded from lib/prompts.ts (editable via the Settings UI).
 *
 * Requirements: 9.1–9.4
 */

import OpenAI from 'openai';
import { loadPrompts, interpolate, formatTextInstructions } from './prompts';
import type { EditableTextItem } from './layout/types';

// ---------------------------------------------------------------------------
// Image model types
// ---------------------------------------------------------------------------

export type ImageModel = 'gpt-image-1' | 'gpt-image-2';

// ---------------------------------------------------------------------------
// Singleton client
// ---------------------------------------------------------------------------

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (_client) return _client;

  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY environment variable is not set. ' +
        'This module must only be used on the server.',
    );
  }

  _client = new OpenAI({ apiKey });
  return _client;
}

// ---------------------------------------------------------------------------
// generateImageToImage
// ---------------------------------------------------------------------------

/**
 * Generates an image from an existing image + prompt using gpt-image-1.
 * The prompt template is loaded from the prompts store and interpolated
 * with the user's prompt and print dimensions.
 *
 * Requirements: 2.2, 3.1
 */
export async function generateImageToImage(args: {
  baseImage: Buffer;
  prompt: string;
  widthMm?: number;
  heightMm?: number;
  textItems?: EditableTextItem[];
  imageModel?: ImageModel;
}): Promise<Buffer> {
  const client = getClient();
  const prompts = loadPrompts();
  const model: ImageModel = args.imageModel ?? 'gpt-image-1';

  const finalPrompt = interpolate(prompts.imageGeneration, {
    userPrompt: args.prompt,
    widthMm: String(args.widthMm ?? ''),
    heightMm: String(args.heightMm ?? ''),
    textInstructions: formatTextInstructions(args.textItems ?? []),
  });

  const imageFile = new File([args.baseImage], 'image.jpg', { type: 'image/jpeg' });

  let response: Awaited<ReturnType<typeof client.images.edit>>;

  if (model === 'gpt-image-2') {
    // gpt-image-2: use size:'auto' so the model picks the best aspect ratio,
    // plus quality:'high' for best output. The 'auto' size is the closest
    // available option to custom dimensions on this model.
    response = await client.images.edit({
      model: 'gpt-image-2',
      image: imageFile,
      prompt: finalPrompt,
      n: 1,
      size: 'auto',
      quality: 'high',
    } as Parameters<typeof client.images.edit>[0]);
  } else {
    // gpt-image-1: pick the closest supported fixed size based on physical dimensions.
    // Supported: '1024x1024' (square), '1536x1024' (landscape), '1024x1536' (portrait).
    const w = args.widthMm ?? 1;
    const h = args.heightMm ?? 1;
    const ratio = w / h;
    const size: '1024x1024' | '1536x1024' | '1024x1536' =
      ratio > 1.2 ? '1536x1024' : ratio < 0.833 ? '1024x1536' : '1024x1024';

    response = await client.images.edit({
      model: 'gpt-image-1',
      image: imageFile,
      prompt: finalPrompt,
      n: 1,
      size,
    });
  }

  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error('generateImageToImage: no image data returned from API');
  }

  if (imageData.b64_json) {
    return Buffer.from(imageData.b64_json, 'base64');
  }

  if (imageData.url) {
    const res = await fetch(imageData.url);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error('generateImageToImage: unexpected response format');
}

// ---------------------------------------------------------------------------
// regenerateWithoutText
// ---------------------------------------------------------------------------

/**
 * Regenerates an image without any text using gpt-image-1.
 * Uses the removeText prompt template from the prompts store.
 *
 * Requirements: 6.1, 6.2
 */
export async function regenerateWithoutText(args: {
  baseImage: Buffer;
  originalPrompt: string;
}): Promise<Buffer> {
  const client = getClient();
  const prompts = loadPrompts();

  const finalPrompt = interpolate(prompts.removeText, {
    originalPrompt: args.originalPrompt,
  });

  const imageFile = new File([args.baseImage], 'image.png', { type: 'image/png' });

  const response = await client.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size: '1024x1024',
  });

  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error('regenerateWithoutText: no image data returned from API');
  }

  if (imageData.b64_json) {
    return Buffer.from(imageData.b64_json, 'base64');
  }

  if (imageData.url) {
    const res = await fetch(imageData.url);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  throw new Error('regenerateWithoutText: unexpected response format');
}

// ---------------------------------------------------------------------------
// extractLayoutVision
// ---------------------------------------------------------------------------

/**
 * Extracts text layout information from an image using gpt-4o Vision.
 * Uses the visionLayout prompt template from the prompts store.
 * Returns the raw (unvalidated) JSON response.
 *
 * Requirements: 5.1, 5.2
 */
export async function extractLayoutVision(args: { image: Buffer }): Promise<unknown> {
  const client = getClient();
  const prompts = loadPrompts();

  const systemPrompt = prompts.visionLayout;

  const base64Image = args.image.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Image}`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: dataUrl, detail: 'high' },
          },
          {
            type: 'text',
            text: systemPrompt,
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('extractLayoutVision: empty response from API');
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`extractLayoutVision: failed to parse JSON response: ${content.slice(0, 200)}`);
  }
}
