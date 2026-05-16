/**
 * Property-Based Test P7 — formatTextInstructions is deterministic
 * **Validates: Requirements 9.4, 9.5, 9.6, 9.7**
 * Feature: initial-text-brief-flow, Property 7: byte-identical output, totality, and exact format.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

import { formatTextInstructions } from '@/lib/prompts';
import { arbEditableTextItem } from '../fixtures/arbs';

// The mandatory header sentence start (Req 9.5).
const HEADER_PREFIX = 'Include EXACTLY these texts';

// The exact "no-text" instruction defined in design § d.4 (Req 9.4).
const EMPTY_OUTPUT =
  'Generate a 100% text-free image: no letters, numbers, words, watermarks, or typographic elements anywhere.';

/** Array of 0..30 EditableTextItem entries. */
const arbTextItems = fc.array(arbEditableTextItem, {
  minLength: 0,
  maxLength: 30,
});

describe('P7 — formatTextInstructions is deterministic', () => {
  /**
   * (1) Determinism: byte-identical output across two calls with the same input.
   * **Validates: Requirements 9.4, 9.5, 9.6, 9.7**
   */
  it('returns byte-identical output across two calls with the same input', () => {
    fc.assert(
      fc.property(arbTextItems, (textItems) => {
        const a = formatTextInstructions(textItems);
        const b = formatTextInstructions(textItems);
        return a === b;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (2) Totality: output is a non-empty string for every input.
   * **Validates: Requirements 9.4, 9.5**
   */
  it('returns a non-empty string for every input', () => {
    fc.assert(
      fc.property(arbTextItems, (textItems) => {
        const out = formatTextInstructions(textItems);
        return typeof out === 'string' && out.length > 0;
      }),
      { numRuns: 100 },
    );
  });

  /**
   * (3a) Empty form: when textItems.length === 0, output is exactly the
   * no-text instruction string defined in design § d.4.
   * **Validates: Requirement 9.4**
   */
  it('returns the exact no-text instruction when textItems is empty', () => {
    expect(formatTextInstructions([])).toBe(EMPTY_OUTPUT);
  });

  /**
   * (3b) Non-empty form: when textItems.length > 0, output starts with the
   * mandatory header and contains exactly one line per item formatted as
   * `- {label}: "{value}"` (counted by splitting on '\n' and filtering
   * lines that start with '- ').
   * **Validates: Requirements 9.5, 9.6, 9.7**
   */
  it('starts with the mandatory header and contains exactly one line per item', () => {
    const arbNonEmptyTextItems = fc.array(arbEditableTextItem, {
      minLength: 1,
      maxLength: 30,
    });

    fc.assert(
      fc.property(arbNonEmptyTextItems, (textItems) => {
        const out = formatTextInstructions(textItems);

        // Header must be present at the very start of the output (Req 9.5).
        if (!out.startsWith(HEADER_PREFIX)) return false;

        // Count item lines: those starting with '- ' (Req 9.6, 9.7).
        const itemLineCount = out
          .split('\n')
          .filter((line) => line.startsWith('- ')).length;

        return itemLineCount === textItems.length;
      }),
      { numRuns: 100 },
    );
  });
});
