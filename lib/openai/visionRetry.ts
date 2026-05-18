/**
 * lib/openai/visionRetry.ts
 *
 * Vision retry helpers — wrap Vision calls with zod validation + 1 retry.
 * Requirements: 5.3, 5.4, 14.3, 11
 */

import { extractLayoutVision, locateBriefInImage } from '../openai';
import { VisionResponseSchema, type VisionResponse, LocatedItemsResponseSchema, type LocatedItemsResponse } from '../layout/normalize';

/**
 * Calls extractLayoutVision and validates the response against VisionResponseSchema.
 * Retries up to maxRetries times on validation failure.
 *
 * On success: returns the validated VisionResponse.
 * On failure after all retries: throws Error('vision_validation_failed: <lastErr>').
 *
 * Requirements: 5.3, 5.4, 14.3
 */
export async function extractLayoutVisionWithRetry(
  image: Buffer,
  maxRetries = 1,
): Promise<VisionResponse> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await extractLayoutVision({ image });
    const parsed = VisionResponseSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
    lastErr = parsed.error;
  }

  throw new Error(`vision_validation_failed: ${String(lastErr)}`);
}

/**
 * Calls locateBriefInImage and validates the response against LocatedItemsResponseSchema.
 * Retries up to maxRetries times on validation failure.
 *
 * On success: returns the validated LocatedItemsResponse.
 * On failure after all retries: throws Error('locate_brief_validation_failed: <lastErr>').
 *
 * Requirements: Stage 4A supervised; Gaps 3, 4, 5, 6 fix.
 */
export async function locateBriefInImageWithRetry(
  image: Buffer,
  briefItems: Array<{ id: string; label: string; value: string }>,
  maxRetries = 1,
): Promise<LocatedItemsResponse> {
  let lastErr: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const raw = await locateBriefInImage({ image, briefItems });
    const parsed = LocatedItemsResponseSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
    lastErr = parsed.error;
  }

  throw new Error(`locate_brief_validation_failed: ${String(lastErr)}`);
}
