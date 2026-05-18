/**
 * lib/openai.ts
 *
 * OpenAI wrappers — server-side only.
 * Each function makes exactly ONE API call and returns the raw result.
 * Retry logic lives in lib/openai/visionRetry.ts.
 *
 * Prompts are loaded from lib/prompts.ts (editable via the Settings UI).
 *
 * Model: gpt-image-2 exclusively.
 *
 * The gpt-image-2 images.edit API accepts only these fixed sizes:
 *   '1024x1024'  (square,    ratio 1.00)
 *   '1536x1024'  (landscape, ratio 1.50)
 *   '1024x1536'  (portrait,  ratio 0.67)
 *   'auto'       (model picks — equivalent to the closest of the above)
 *
 * Custom pixel dimensions are NOT supported by the API. We pick the fixed
 * size whose aspect ratio is closest to the canvas dimensions (widthMm/heightMm)
 * to minimise distortion. The HTML/CSS render layer stretches the background
 * to fill the exact canvas via object-fit:fill, so the PDF always comes out
 * at the correct physical dimensions regardless of which size was chosen.
 *
 * Requirements: 9.1–9.4
 */

import OpenAI from 'openai';
import { loadPrompts, interpolate, formatTextInstructions, formatAspectRatio } from './prompts';
import type { EditableTextItem } from './layout/types';

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
// Size selection helper
// ---------------------------------------------------------------------------

/**
 * Picks the gpt-image-2 fixed size whose aspect ratio is closest to the
 * given canvas dimensions.
 *
 * Supported sizes and their ratios (w/h):
 *   1024x1024  → 1.000  (square)
 *   1536x1024  → 1.500  (landscape)
 *   1024x1536  → 0.667  (portrait)
 *
 * Selection boundaries (midpoints between adjacent ratios):
 *   ratio > 1.25  → landscape  (midpoint between 1.00 and 1.50)
 *   ratio < 0.833 → portrait   (midpoint between 0.67 and 1.00)
 *   otherwise     → square
 */
function pickSize(widthMm: number, heightMm: number): '1024x1024' | '1536x1024' | '1024x1536' {
  const ratio = widthMm / Math.max(heightMm, 1);
  if (ratio > 1.25) return '1536x1024';
  if (ratio < 0.833) return '1024x1536';
  return '1024x1024';
}

// ---------------------------------------------------------------------------
// generateImageToImage
// ---------------------------------------------------------------------------

/**
 * Generates an image from an existing image + prompt using gpt-image-2.
 * The prompt template is loaded from the prompts store and interpolated
 * with the user's prompt, print dimensions, and text instructions.
 *
 * The size parameter is derived from widthMm/heightMm to pick the closest
 * supported fixed size — this is the best approximation possible given the
 * API's fixed-size constraint.
 *
 * Requirements: 2.2, 3.1
 */
export async function generateImageToImage(args: {
  baseImage: Buffer;
  prompt: string;
  widthMm?: number;
  heightMm?: number;
  textItems?: EditableTextItem[];
}): Promise<Buffer> {
  const client = getClient();
  const prompts = loadPrompts();

  const finalPrompt = interpolate(prompts.imageGeneration, {
    userPrompt: args.prompt,
    widthMm: String(args.widthMm ?? ''),
    heightMm: String(args.heightMm ?? ''),
    aspectRatio: formatAspectRatio(args.widthMm ?? 1, args.heightMm ?? 1),
    textInstructions: formatTextInstructions(args.textItems ?? []),
  });

  const size = pickSize(args.widthMm ?? 1, args.heightMm ?? 1);
  const imageFile = new File([args.baseImage], 'image.jpg', { type: 'image/jpeg' });

  const response = await client.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size,
    quality: 'high',
  } as Parameters<typeof client.images.edit>[0]);

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
 * Regenerates an image without any text using gpt-image-2.
 * Sends the approved image as the base so the model can preserve layout exactly.
 * Uses the removeText prompt template from the prompts store.
 *
 * Requirements: 6.1, 6.2
 */
export async function regenerateWithoutText(args: {
  baseImage: Buffer;
  originalPrompt: string;
  widthMm?: number;
  heightMm?: number;
}): Promise<Buffer> {
  const client = getClient();
  const prompts = loadPrompts();

  const finalPrompt = interpolate(prompts.removeText, {
    originalPrompt: args.originalPrompt,
    aspectRatio: formatAspectRatio(args.widthMm ?? 1, args.heightMm ?? 1),
  });

  const size = pickSize(args.widthMm ?? 1, args.heightMm ?? 1);

  // Use PNG to avoid JPEG compression artifacts on the approved image.
  const imageFile = new File([args.baseImage], 'approved.png', { type: 'image/png' });

  const response = await client.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size,
    quality: 'high',
  } as Parameters<typeof client.images.edit>[0]);

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

// ---------------------------------------------------------------------------
// locateBriefInImage
// ---------------------------------------------------------------------------

/**
 * Supervised Vision call for Stage 4A.
 *
 * Sends the approved image + the known TextBrief items to gpt-4o and asks
 * the model to locate each item by id, returning normalised coordinates
 * (0–1 fractions of image dimensions) and typographic properties.
 *
 * Requirements: Stage 4A supervised; Gaps 3, 4, 5, 6 fix.
 */
export async function locateBriefInImage(args: {
  image: Buffer;
  briefItems: Array<{ id: string; label: string; value: string }>;
}): Promise<unknown> {
  const client = getClient();
  const prompts = loadPrompts();

  const briefJson = JSON.stringify(args.briefItems, null, 2);
  const promptText = interpolate(prompts.visionLocateBrief, { briefItems: briefJson });

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
            text: promptText,
          },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('locateBriefInImage: empty response from API');
  }

  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new Error(`locateBriefInImage: failed to parse JSON response: ${content.slice(0, 200)}`);
  }
}
