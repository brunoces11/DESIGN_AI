/**
 * lib/openai/buildBrief.ts
 *
 * Pure helper: builds a TextBrief from a validated VisionResponse.
 * Extracted from the route handler so it can be exported for tests
 * without violating Next.js route-file constraints (route files may
 * only export HTTP handler functions).
 *
 * Refs: design § f; Req 1.8, 2.4, 2.6
 */

import { sortByReadingOrder } from '@/lib/layout/normalize';
import type { VisionResponse } from '@/lib/layout/normalize';
import type { TextBrief, EditableTextItem } from '@/lib/layout/types';

/**
 * Builds a TextBrief from a validated VisionResponse.
 *
 * 1. Sorts Vision text elements by reading order.
 * 2. Maps each element to an EditableTextItem with a fresh UUID v4 id,
 *    the element's label, and the element's content as value.
 * 3. Returns { textItems }.
 */
export function buildBriefFromVision(vision: VisionResponse): TextBrief {
  const sorted = sortByReadingOrder(vision.textElements);
  const textItems: EditableTextItem[] = sorted.map((v) => ({
    id: crypto.randomUUID(),
    label: v.label,
    value: v.content,
  }));
  return { textItems };
}
