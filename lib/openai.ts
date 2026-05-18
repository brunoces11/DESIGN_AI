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
 * Per OpenAI's recommended pattern, aspect ratio is communicated via the
 * PROMPT (in the form "strict W:H aspect ratio", with counter-examples),
 * not via pixel dimensions in the size parameter. The API call uses
 * size: 'auto' so the model picks the closest supported output size for
 * the requested composition. The HTML/CSS render layer then stretches the
 * background to the exact mm canvas via object-fit:fill, so the PDF always
 * comes out at the correct physical dimensions.
 *
 * Requirements: 9.1–9.4
 */

import OpenAI from 'openai';
import { loadPrompts, interpolate, formatTextInstructions, formatAspectRatioInstructions } from './prompts';
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
// generateImageToImage
// ---------------------------------------------------------------------------

/**
 * Generates an image from an existing image + prompt using gpt-image-2.
 * The prompt template is loaded from the prompts store and interpolated
 * with the user's prompt, the aspect-ratio instruction block, and text
 * instructions. The size parameter is 'auto' — the proportion is enforced
 * via the prompt itself.
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
    aspectRatioBlock: formatAspectRatioInstructions(args.widthMm ?? 1, args.heightMm ?? 1),
    textInstructions: formatTextInstructions(args.textItems ?? []),
  });

  const imageFile = new File([args.baseImage], 'image.jpg', { type: 'image/jpeg' });

  const response = await client.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size: 'auto',
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
    aspectRatioBlock: formatAspectRatioInstructions(args.widthMm ?? 1, args.heightMm ?? 1),
  });

  // Use PNG to avoid JPEG compression artifacts on the approved image.
  const imageFile = new File([args.baseImage], 'approved.png', { type: 'image/png' });

  const response = await client.images.edit({
    model: 'gpt-image-2',
    image: imageFile,
    prompt: finalPrompt,
    n: 1,
    size: 'auto',
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
