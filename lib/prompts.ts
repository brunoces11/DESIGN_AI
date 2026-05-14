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

Physical dimensions: {{widthMm}}mm × {{heightMm}}mm. Generate a high-quality image suitable for large-format printing at these dimensions.`,

  /**
   * Stage 4B — Regenerate without text (gpt-image-1)
   * {{originalPrompt}} — the initial prompt from Stage 1
   */
  removeText: `Remove all text, letters, numbers, words, and typography from this image completely. Keep the visual scene, colors, composition, and background elements intact. Do not use inpainting or masks — regenerate the image without any text elements. Scene context: {{originalPrompt}}`,

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
}`,
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
