/**
 * lib/openai.ts
 *
 * OpenAI wrappers — server-side only.
 * Each function makes exactly ONE API call and returns the raw result.
 * Retry logic lives in lib/openai/visionRetry.ts.
 *
 * Requirements: 9.1–9.4
 */

import OpenAI from 'openai';

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
 * Returns a PNG buffer.
 *
 * Requirements: 2.2, 3.1
 */
export async function generateImageToImage(args: {
  baseImage: Buffer;
  prompt: string;
}): Promise<Buffer> {
  const client = getClient();

  // Convert buffer to a File object for the API
  const imageFile = new File([args.baseImage], 'image.jpg', { type: 'image/jpeg' });

  const response = await client.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt: args.prompt,
    n: 1,
    size: '1024x1024',
  });

  const imageData = response.data?.[0];
  if (!imageData) {
    throw new Error('generateImageToImage: no image data returned from API');
  }

  // gpt-image-1 returns base64 by default
  if (imageData.b64_json) {
    return Buffer.from(imageData.b64_json, 'base64');
  }

  // Fallback: URL response
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
 * Uses a rigid internal prompt that instructs text removal.
 *
 * Requirements: 6.1, 6.2
 */
export async function regenerateWithoutText(args: {
  baseImage: Buffer;
  originalPrompt: string;
}): Promise<Buffer> {
  const client = getClient();

  const noTextPrompt =
    `Remove all text, letters, numbers, words, and typography from this image completely. ` +
    `Keep the visual scene, colors, composition, and background elements intact. ` +
    `Do not use inpainting or masks — regenerate the image without any text elements. ` +
    `Scene context: ${args.originalPrompt}`;

  const imageFile = new File([args.baseImage], 'image.png', { type: 'image/png' });

  const response = await client.images.edit({
    model: 'gpt-image-1',
    image: imageFile,
    prompt: noTextPrompt,
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
 * Returns the raw (unvalidated) JSON response.
 *
 * Requirements: 5.1, 5.2
 */
export async function extractLayoutVision(args: { image: Buffer }): Promise<unknown> {
  const client = getClient();

  const base64Image = args.image.toString('base64');
  const dataUrl = `data:image/png;base64,${base64Image}`;

  const systemPrompt = `You are a precise layout analysis assistant. 
Analyze the provided image and extract all visible text elements with their exact positions and styling.
Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation:

{
  "imageWidthPx": <number — width of the image in pixels>,
  "imageHeightPx": <number — height of the image in pixels>,
  "textElements": [
    {
      "content": "<exact text content, preserve newlines as \\n>",
      "bboxPx": {
        "x": <number — left edge in pixels, >= 0>,
        "y": <number — top edge in pixels, >= 0>,
        "width": <number — width in pixels, > 0>,
        "height": <number — height in pixels, > 0>
      },
      "color": "<CSS color string, e.g. '#FFFFFF' or 'white'>",
      "fontWeight": <integer multiple of 100 between 100 and 900>,
      "align": "<'left' | 'center' | 'right'>"
    }
  ]
}`;

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
