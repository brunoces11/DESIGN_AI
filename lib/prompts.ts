/**
 * lib/prompts.ts
 *
 * Prompt store — manages the three system prompts used in OpenAI calls.
 * Prompts are persisted in storage/prompts.json and can be edited via the UI.
 * Falls back to built-in defaults if the file doesn't exist.
 *
 * Server-side only (uses fs).
 */

import fs from 'fs';
import path from 'path';

import type { EditableTextItem } from './layout/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PromptId = 'imageGeneration' | 'removeText' | 'visionLayout';

export interface PromptDefinition {
  id: PromptId;
  label: string;
  description: string;
  /** Variables that get injected into this prompt at runtime */
  variables: PromptVariable[];
  /** The editable template. Use {{variableName}} syntax for injected values. */
  template: string;
}

export interface PromptVariable {
  name: string;
  description: string;
  example: string;
}

export interface PromptsConfig {
  imageGeneration: string;
  removeText: string;
  visionLayout: string;
}

// ---------------------------------------------------------------------------
// Default prompt templates
// ---------------------------------------------------------------------------

export const DEFAULT_PROMPTS: PromptsConfig = {
  /**
   * Stage 1 & 3 — Image generation (gpt-image-1)
   * The user's prompt IS the full prompt — no system wrapper by default.
   * This template wraps it with optional context.
   * {{userPrompt}} — the text typed by the user in the form
   * {{widthMm}} / {{heightMm}} — physical dimensions of the print piece
   */
  imageGeneration: `{{userPrompt}}

Physical dimensions: {{widthMm}}mm × {{heightMm}}mm. Generate a high-quality image suitable for large-format printing at these dimensions.

{{textInstructions}}`,

  /**
   * Stage 4B — Regenerate without text (gpt-image-1 or gpt-image-2)
   * The approved image is sent as the base. The goal is pixel-perfect
   * preservation of everything except the text elements.
   * {{originalPrompt}} — the initial prompt from Stage 1
   */
  removeText: `You are given an image. Your task is to reproduce this image IDENTICALLY, with ONE single change: remove all text, letters, numbers, words, and typographic elements.

CRITICAL RULES — follow every one without exception:
1. Preserve the EXACT same composition, layout, and spatial arrangement of all visual elements.
2. Preserve the EXACT same colors, color palette, gradients, and tones.
3. Preserve the EXACT same proportions and aspect ratio of the image.
4. Preserve ALL empty spaces, white areas, negative space, and blank regions exactly as they appear — do NOT fill them in.
5. Preserve ALL background textures, patterns, shapes, and decorative elements.
6. The ONLY change allowed is erasing text/typography. Replace text areas with the background that would logically be behind them (inpaint with surrounding context).
7. Do NOT recompose, crop, zoom, or alter the framing in any way.
8. Do NOT add any new visual elements.

Scene context for background reconstruction: {{originalPrompt}}`,

  /**
   * Stage 4A — Vision layout extraction (gpt-4o)
   * No dynamic variables — the image is sent as a separate attachment.
   */
  visionLayout: `You are a precise layout analysis assistant.
Analyze the provided image and extract all visible text elements with their exact positions and styling.
Return ONLY a valid JSON object matching this exact schema — no markdown, no explanation:

{
  "imageWidthPx": <number — width of the image in pixels>,
  "imageHeightPx": <number — height of the image in pixels>,
  "textElements": [
    {
      "content": "<exact text content, preserve newlines as \\n>",
      "label": "<short hierarchy hint, e.g. 'titulo', 'subtitulo', 'preco', 'descricao', 'rodape'; any string is acceptable>",
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
}

Return elements ordered top-to-bottom (primary) and left-to-right (secondary when y-overlap exceeds 50% of the larger element height).`,
};

// ---------------------------------------------------------------------------
// Prompt metadata (for the settings UI)
// ---------------------------------------------------------------------------

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    id: 'imageGeneration',
    label: 'Image Generation',
    description:
      'Sent to gpt-image-1 during Stage 1 (initial generation) and Stage 3 (refinement iterations). The user\'s prompt is injected via {{userPrompt}}.',
    variables: [
      {
        name: 'userPrompt',
        description: 'The prompt text typed by the user in the form',
        example: 'A vibrant banner for a coffee shop with warm colors',
      },
      {
        name: 'widthMm',
        description: 'Physical width of the print piece in millimetres',
        example: '300',
      },
      {
        name: 'heightMm',
        description: 'Physical height of the print piece in millimetres',
        example: '500',
      },
      {
        name: 'textInstructions',
        description:
          'Bloco de instruções textuais geradas a partir do TextBrief; lista cada item ou instrui a ausência total de texto',
        example: 'Include EXACTLY these texts...\n- titulo: "PROMOÇÃO"\n- preco: "R$ 19,90"',
      },
    ],
    template: DEFAULT_PROMPTS.imageGeneration,
  },
  {
    id: 'removeText',
    label: 'Remove Text (Stage 4B)',
    description:
      'Sent to gpt-image-1 to regenerate the approved image without any text. The original prompt is injected as scene context via {{originalPrompt}}.',
    variables: [
      {
        name: 'originalPrompt',
        description: 'The initial prompt from Stage 1, used as scene context',
        example: 'A vibrant banner for a coffee shop with warm colors',
      },
    ],
    template: DEFAULT_PROMPTS.removeText,
  },
  {
    id: 'visionLayout',
    label: 'Vision Layout Extraction (Stage 4A)',
    description:
      'Sent to gpt-4o Vision to extract text elements, bounding boxes, colors and typography from the approved image. The image is attached separately — no dynamic variables in this prompt.',
    variables: [],
    template: DEFAULT_PROMPTS.visionLayout,
  },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function getPromptsFilePath(): string {
  return path.join(process.cwd(), 'storage', 'prompts.json');
}

export function loadPrompts(): PromptsConfig {
  try {
    const filePath = getPromptsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<PromptsConfig>;
      // Merge with defaults so new prompts added in future versions are included
      return {
        imageGeneration: parsed.imageGeneration ?? DEFAULT_PROMPTS.imageGeneration,
        removeText: parsed.removeText ?? DEFAULT_PROMPTS.removeText,
        visionLayout: parsed.visionLayout ?? DEFAULT_PROMPTS.visionLayout,
      };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_PROMPTS };
}

export function savePrompts(config: PromptsConfig): void {
  const filePath = getPromptsFilePath();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

/**
 * Replaces {{variableName}} placeholders in a template string.
 */
export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? `{{${key}}}`);
}

// ---------------------------------------------------------------------------
// Text instructions formatter (design § d.4)
// ---------------------------------------------------------------------------

/**
 * Pure, deterministic, server-side. Maps an effective brief
 * (already filtered to non-empty values by the caller) into a
 * single block of instructions for gpt-image-1.
 *
 * Empty input → "no text" instruction.
 * Non-empty   → enumerated list with mandatory header.
 *
 * Determinism: order of items is preserved as given; no Date/random/locale.
 */
export function formatTextInstructions(
  textItems: EditableTextItem[],
): string {
  if (textItems.length === 0) {
    return 'Generate a 100% text-free image: no letters, numbers, words, watermarks, or typographic elements anywhere.';
  }

  const lines = textItems
    .map((t) => `- ${t.label}: "${t.value}"`)
    .join('\n');

  return [
    'Include EXACTLY these texts in the image, with no spelling, number or punctuation changes. Do not invent extra texts. Do not omit any. Use the labels as visual hierarchy hints but do not render the labels themselves.',
    lines,
  ].join('\n');
}
