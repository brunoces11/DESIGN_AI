# Implementation Plan: initial-text-brief-flow

## Overview

This plan follows the rollout order from `design.md` § Rollout Plan, steps 1–8. Every task references requirement IDs (Req X.Y from `requirements.md`) and design sections by letter (a–m from `design.md` § Components and Interfaces). Properties P1–P10 refer to `design.md` § Correctness Properties; P-* identifiers refer to `requirements.md` § Correctness Properties.

H2 headings match the rollout plan; tasks 1–8 mirror rollout steps 1–8 plus an Acceptance section (9) that consolidates requirements coverage. The migration verification (delete `storage/jobs.db`) is the first hot point, embedded as task 1.9.

## Test commands

- Run the full suite: `npm test`
- Run a subset by path or pattern: `npm test -- tests/layout/`
- Run a single file: `npm test -- tests/layout/mergeBrief.structural.pbt.test.ts`
- Run by test name match: `npm test -- -t "sortByReadingOrder"`

All tests use Vitest + fast-check (already in `package.json`). PBT tests use ≥100 iterations per the testing-strategy convention.

---

## 1. Types and DB schema

_Rollout step 1 — design § a, c — Req 10, Req 13.1, Req 13.5, Req 12.7_

- [x] 1.1 Extend `JobStatus` union and add `EditableTextItem` / `TextBrief` types
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\layout\types.ts`
  - Add `'analyzing_reference'` and `'text_review'` to `JobStatus`.
  - Add `export type EditableTextItem = { id: string; label: string; value: string }`.
  - Add `export type TextBrief = { textItems: EditableTextItem[] }`.
  - _Refs: design § a; Req 10.4, 12.7, 13.1_

- [x] 1.2 Add Zod schemas for `EditableTextItem` and `TextBrief`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\layout\types.ts` (or co-located in `lib/layout/normalize.ts` if preferred — match existing repo convention by exporting from `normalize.ts`)
  - `EditableTextItemSchema = z.object({ id: z.string().uuid(), label: z.string().max(64), value: z.string().max(500) })`
  - `TextBriefSchema = z.object({ textItems: z.array(EditableTextItemSchema) })` — no max length.
  - _Refs: design § "Data Models"; Req 12.4, 12.7_

- [ ]* 1.3 PBT for `EditableTextItemSchema` cardinality (Property 8, P-VALIDATION-1 adjacent)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\editableTextItemSchema.pbt.test.ts`
  - **Property 8: `EditableTextItemSchema` accepts any conforming input regardless of cardinality**
  - **Validates: Req 12.4, 12.7**
  - Generators: `arbTextItems` with `maxLength: 200`.

- [x] 1.4 Update SQL schema, `JobRow`, `insertJob`, `updateJob`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\db.ts`
  - Extend `CREATE TABLE` `CHECK (status IN (...))` to include `'analyzing_reference'` and `'text_review'`.
  - Add columns `text_brief_json TEXT`, `reference_analysis_json TEXT` (both NULLABLE).
  - Extend `JobRow` with the two new columns (`string | null`).
  - Add optional `initialStatus?: JobStatus` parameter to `insertJob` (defaults to `'created'`).
  - Extend `updateJob`'s patchable union to include `text_brief_json` and `reference_analysis_json`.
  - _Refs: design § c.1–c.4; Req 10.1, 10.2, 10.3, 10.5, 10.6, 10.7, 13.5_

- [x] 1.5 Implement `getTextBrief` and `setTextBrief` wrappers (DB-first, FS best-effort)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\db.ts`
  - `setTextBrief(id, brief)` writes DB column then calls `localStorage.saveJson(id, 'text-brief.json', brief)`; logs and swallows file-write errors after a successful DB write.
  - _Refs: design § c.5; Req 11.2, 11.5; P-PERSISTENCE-PARITY-1_

- [ ]* 1.6 Unit test: `initSchema` columns and CHECK
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\db\initSchema.test.ts`
  - Open a tmp SQLite file, run `initSchema`, assert PRAGMA `table_info` reports `text_brief_json` and `reference_analysis_json`, and that an INSERT with each new status name succeeds while a bogus status fails the CHECK.
  - _Refs: design § Testing Strategy "Unit and integration tests"; Req 10.1, 10.2, 10.3_

- [ ]* 1.7 PBT: TextBrief DB↔FS round-trip parity (Property 6)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\db\textBrief.roundtrip.pbt.test.ts`
  - **Property 6: TextBrief persistence round-trip (DB ↔ FS parity)**
  - **Validates: Req 5.17, 11.5, 12.6**
  - Generator: `arbTextBrief`. Use a tmp sqlite + tmp storage dir; assert `getTextBrief(id)` and `JSON.parse(read('text-brief.json'))` agree on the happy path.

- [ ]* 1.8 PBT: `transitionStatus` atomicity on the two new edges (Property 10)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\db\transitionStatus.newEdges.pbt.test.ts`
  - **Property 10: transitionStatus is atomic on the two new edges**
  - **Validates: Req 13.1, 13.5; P-IDEMPOTENCY-1**
  - Calls `transitionStatus` `N ≥ 2` times in succession for `analyzing_reference → text_review` and `text_review → iterating`; assert `true` exactly once, `false` thereafter.

- [x] 1.9 **Verification step (migration hot-point)** — delete the dev SQLite database so `initSchema` recreates it with the new CHECK and columns, then run the schema tests.
  - Command: delete `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\storage\jobs.db` and any `storage\jobs.db-*` sidecar files (`-shm`, `-wal`).
  - Then run: `npm test -- tests/db/`
  - Expected: `tests/db/initSchema.test.ts`, `tests/db/textBrief.roundtrip.pbt.test.ts`, `tests/db/transitionStatus.newEdges.pbt.test.ts` all pass.
  - _Refs: design § Rollout Plan step 1 hot point; Req 10.8_

---

## 2. Pure modules (`normalize.ts` and `prompts.ts`)

_Rollout step 2 — design § b, d — Req 2, Req 8.3–8.8, Req 9_

- [x] 2.1 Extend `VisionTextElementSchema` with required `label: z.string()`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\layout\normalize.ts`
  - No enum constraint on `label`. Keep `normalizeVisionResponse` exported and unchanged in behaviour.
  - _Refs: design § b.1; Req 2.2, 8.10, 9.2_

- [ ]* 2.2 PBT: Vision schema accepts any `label` string (Property 9)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\visionSchemaLabel.pbt.test.ts`
  - **Property 9: Vision schema accepts any `label` string**
  - **Validates: Req 2.2; P-SCHEMA-1**
  - Generator: `fc.string()` for `label`, otherwise valid element fields.

- [x] 2.3 Implement pure `sortByReadingOrder`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\layout\normalize.ts`
  - Total, deterministic comparator using y-overlap > 50% of larger height as the "same row" rule; x as tiebreaker on the same row, y otherwise.
  - _Refs: design § b.2; Req 2.4, 2.5_

- [x] 2.4 PBT: `sortByReadingOrder` is a valid reading-order permutation (Property 1, P-ORDER-1)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\normalize.sortReadingOrder.pbt.test.ts`
  - **Property 1: sortByReadingOrder produces a valid reading-order permutation**
  - **Validates: Req 2.4, 2.5**
  - Generators: `arbVisionTextElement`, arrays of length 0–30. Asserts (i) permutation, (ii) pairwise predicate, (iii) idempotence.
  - _Pure-function PBT companion to 2.3._

- [x] 2.5 Implement pure `mergeBriefWithVisionLayout`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\layout\normalize.ts`
  - Filter empty values, sort vision by reading order, match by index, keep extra brief items with default positioning, drop excess vision elements, set `id = brief.id`, `content = brief.value`.
  - _Refs: design § b.3; Req 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

- [~] 2.6 PBT: `mergeBriefWithVisionLayout` structural correctness (Property 3, P-BRIEF-2)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\mergeBrief.structural.pbt.test.ts`
  - **Property 3: mergeBriefWithVisionLayout structural correctness**
  - **Validates: Req 8.3, 8.4, 8.5, 8.7, 8.8**
  - Generators: `arbTextBrief`, `arbVisionResponse`, `arbCanvasMm`, `arbImageDims`.
  - _Pure-function PBT companion to 2.5._

- [~] 2.7 PBT: `mergeBriefWithVisionLayout` length arithmetic (Property 4, P-MATCH-1)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\mergeBrief.length.pbt.test.ts`
  - **Property 4: merge length arithmetic**
  - **Validates: Req 8.5, 8.6**
  - Same generators as 2.6; assert `merged.textElements.length === Math.max(effectiveBrief.length, min(effectiveBrief.length, sortedVision.length))`.

- [ ]* 2.8 PBT: effective-filter is a value-trim subsequence (Property 5)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\layout\effectiveFilter.pbt.test.ts`
  - **Property 5: Effective brief filter is a value-trim subsequence**
  - **Validates: Req 5.10, 5.17, 12.5, 12.6**

- [x] 2.9 Add fast-check generators fixture (shared by P1–P10 PBTs)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\fixtures\arbs.ts`
  - Export `arbUuidV4`, `arbLabel`, `arbValue`, `arbEditableTextItem`, `arbTextBrief`, `arbBboxPx`, `arbAlign`, `arbVisionTextElement`, `arbVisionResponse`, `arbCanvasMm`, `arbImageDims`.
  - _Refs: design § Testing Strategy "PBT generators (specifications)"_

- [x] 2.10 Update `DEFAULT_PROMPTS.imageGeneration` with `{{textInstructions}}`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\prompts.ts`
  - _Refs: design § d.1; Req 9.1_

- [x] 2.11 Update `DEFAULT_PROMPTS.visionLayout` with `label` field and reading-order instruction
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\prompts.ts`
  - _Refs: design § d.2; Req 9.2, 9.3_

- [x] 2.12 Update `PROMPT_DEFINITIONS` to expose `textInstructions` variable for `imageGeneration`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\prompts.ts`
  - _Refs: design § d.3; Req 9.9_

- [x] 2.13 Implement pure `formatTextInstructions`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\prompts.ts`
  - Empty input → fixed "no text" instruction string. Non-empty → mandatory header + `\n` + `- {label}: "{value}"` lines joined by `\n`.
  - _Refs: design § d.4; Req 9.4, 9.5, 9.6, 9.7_

- [x] 2.14 PBT: `formatTextInstructions` determinism (Property 7, P-DETERMINISM-1)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\prompts\formatTextInstructions.pbt.test.ts`
  - **Property 7: formatTextInstructions is deterministic**
  - **Validates: Req 9.4, 9.5, 9.6, 9.7**
  - _Pure-function PBT companion to 2.13._

- [ ]* 2.15 Unit test: default templates contain expected substrings
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\prompts\templates.test.ts`
  - Asserts `imageGeneration` contains `{{textInstructions}}`; `visionLayout` contains `"label"` and the reading-order sentence; `removeText` is unchanged.
  - _Refs: design § Testing Strategy; Req 9.1, 9.2, 9.3, 9.5, 9.6, 9.8_

- [~] 2.16 **Verification step** — `npm test -- tests/layout/ tests/prompts/`
  - Expected: P1, P3, P4, P5, P7, P8, P9 PBTs pass; existing P8 normalize test (`tests/layout/normalize.p8.pbt.test.ts`) still passes since `normalizeVisionResponse` is unchanged.
  - _Refs: design § Rollout Plan step 2 hot point_

---

## 3. OpenAI wrapper extension (`generateImageToImage`)

_Rollout step 3 — design § m — Req 5.10, Req 6.4, Req 9_

- [~] 3.1 Extend `generateImageToImage` to accept `textItems` and inject `formatTextInstructions(textItems)` into `{{textInstructions}}`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\lib\openai.ts`
  - Optional `textItems?: EditableTextItem[]`. When undefined, pass `[]` to `formatTextInstructions` so the "no-text" block is injected.
  - Keep `regenerateWithoutText` and `extractLayoutVision` untouched (Req 9.8, 15.8).
  - _Refs: design § m; Req 5.10, 6.4_

- [ ]* 3.2 Unit test: `generateImageToImage` interpolates `{{textInstructions}}` correctly
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\openai\wrappers.test.ts` (extend the existing file)
  - Mock the OpenAI client; assert the final prompt string contains the expected `formatTextInstructions(...)` block for both empty and non-empty `textItems`.
  - _Refs: design § m; Req 5.10, 9.5, 9.6_

- [~] 3.3 **Verification step** — manual smoke: trigger `npm test -- tests/openai/` and confirm wrappers pass; spot-check that an iterate flow with empty `textItems` still produces the "no text" instruction in the assembled prompt (verifiable via the mock-assertion test above).
  - _Refs: design § Rollout Plan step 3 hot point_

---

## 4. New endpoint `analyze-reference`

_Rollout step 4 — design § f — Req 1, Req 2, Req 14_

- [~] 4.1 Implement `POST /api/jobs/analyze-reference`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\api\jobs\analyze-reference\route.ts` (new file)
  - Validate multipart fields (`image`, `widthMm`, `heightMm`, optional `prompt`); enforce 10 MB cap; insert job at `analyzing_reference`; save `original.jpg`; call `extractLayoutVisionWithRetry(buf, 1)`; on success persist `reference-analysis.json` + `text-brief.json` + DB columns and transition to `text_review`; on Vision throw, degrade gracefully with `{ warning: 'vision_unavailable', textItems: [] }`.
  - _Refs: design § f; Req 1.1–1.14, 2.1, 2.4, 14.1, 14.2, 14.4_

- [~] 4.2 Extract a pure `buildBriefFromVision(vision)` helper for testability
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\api\jobs\analyze-reference\route.ts` (or a co-located `lib/openai/analyzeReference.ts` module if preferred for unit-testability)
  - Pure function: takes a validated `VisionResponse`, returns `TextBrief` with one `EditableTextItem` per element in reading order, fresh UUIDs.
  - _Refs: design § f; design § Testing Strategy P2 generator note; Req 1.8, 2.6_

- [~] 4.3 PBT: TextBrief build is a sorted bijection (Property 2)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\openai\analyzeReference.buildBrief.pbt.test.ts`
  - **Property 2: TextBrief build from Vision is a sorted bijection**
  - **Validates: Req 1.8, 2.6**
  - Generator: `arbVisionResponse` with `label`. Asserts length match, label/value mapping by sorted index, and unique UUIDs.
  - _Pure-function PBT companion to 4.2._

- [ ]* 4.4 Integration tests for `analyze-reference` (happy path + degradation + 4xx + 500)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\analyzeReference.test.ts`
  - Mocks `extractLayoutVisionWithRetry`. Cases:
    - Happy path: 200 with `status: 'text_review'` and non-empty `textItems`; both files present on disk; DB columns populated.
    - Missing `image`: 400 `Missing or invalid image field`; no job row created.
    - Oversized `image` (> 10 MB): 400; no job row created.
    - Invalid `widthMm`/`heightMm`: 400 with Zod details; no job row created.
    - Vision throws after retry: 200 with `warning: 'vision_unavailable'`, `textItems: []`, status `text_review`; `reference_analysis_json` is NULL.
    - Storage I/O throws after job insert: 500 `Internal server error`, job in `error`.
  - _Refs: design § Testing Strategy "Unit and integration tests"; Req 1.1–1.14, 14.1–14.4_

- [~] 4.5 **Verification step** — `npm test -- tests/integration/analyzeReference.test.ts tests/openai/analyzeReference.buildBrief.pbt.test.ts`
  - Optional manual: `curl -F image=@tests/fixtures/original.jpg -F widthMm=300 -F heightMm=500 http://localhost:3000/api/jobs/analyze-reference` and confirm 200 with `textItems`.
  - _Refs: design § Rollout Plan step 4 hot point_

---

## 5. Endpoint alterations (`POST /api/jobs` and `iterate`)

_Rollout step 5 — design § g, h — Req 5, Req 6, Req 12_

- [~] 5.1 Update `POST /api/jobs` to handle continuation vs fresh creation
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\api\jobs\route.ts`
  - Define the 1×1 transparent PNG constant (`TRANSPARENT_PNG_1X1`).
  - Branch A: `jobId` provided AND DB status `text_review` → `setTextBrief`, optional overwrite of `original.jpg`, `transitionStatus(['text_review'], 'iterating')`, generate, save `iterations/1.png`. 409 otherwise.
  - Branch B: no `jobId` → enforce ≥1 non-empty textItem when no image; `insertJob(initialStatus='created')`; save `original.jpg` only if image present; `setTextBrief`; `transitionStatus(['created'], 'iterating')`; generate using `uploadedImage ?? TRANSPARENT_PNG_1X1`.
  - Filter `effectiveBrief` server-side before passing to `generateImageToImage`. Persisted `text_brief_json` must contain the unfiltered list.
  - _Refs: design § g; Req 5.1–5.17, 12.1, 12.2, 12.4, 12.5, 12.6_

- [~] 5.2 Update `POST /api/jobs/:id/iterate` to accept and persist `textItems`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\api\jobs\[id]\iterate\route.ts`
  - Validate `textItems` JSON via the same Zod schema; enforce `prompt` non-empty; assert job status `iterating` (409 otherwise); call `setTextBrief(id, { textItems })` BEFORE generation; pass `effective` items into `generateImageToImage`; save `iterations/{n+1}.png`; bump `current_iteration`. Endpoint MUST NOT call any Vision Stage 0.
  - _Refs: design § h; Req 6.1–6.7_

- [ ]* 5.3 Integration test: `POST /api/jobs` (both branches)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\jobsCreate.test.ts`
  - Mock `generateImageToImage`. Cases: continuation success, continuation 409 when status not `text_review`, fresh+image success, fresh-no-image with non-empty brief success (1×1 PNG fallback path), fresh-no-image with empty brief 400, oversized image 400, persisted `text_brief_json` keeps empty values, OpenAI throws → 500 + status `error`.
  - _Refs: Req 5.1–5.17, 12.1–12.6_

- [ ]* 5.4 Integration test: `POST /api/jobs/:id/iterate`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\jobsIterate.test.ts`
  - Mock `generateImageToImage`. Assert `text_brief_json` is updated BEFORE the OpenAI call; iteration count bumps; 409 when status is not `iterating`; 400 when `textItems` malformed.
  - _Refs: Req 6.1–6.7_

- [~] 5.5 **Verification step** — `npm test -- tests/integration/jobsCreate.test.ts tests/integration/jobsIterate.test.ts`
  - _Refs: design § Rollout Plan step 5 hot point_

---

## 6. Approve endpoint (swap merge function)

_Rollout step 6 — design § i — Req 8_

- [~] 6.1 Replace `normalizeVisionResponse` with `mergeBriefWithVisionLayout` in `runStage4`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\api\jobs\[id]\approve\route.ts`
  - Read brief via `getTextBrief(id)`; default to `{ textItems: [] }` when null. Pass `imageWidthPx`, `imageHeightPx`, `canvasWidthMm`, `canvasHeightMm`, `backgroundDataUrl`. Persist `layout.json` with `background.dataUrl: '__deferred__'` exactly as today.
  - Keep parallel `extractLayoutVisionWithRetry` + `regenerateWithoutText` (Req 8.2). Do not invoke `normalizeVisionResponse` from this route after the swap (Req 8.10).
  - _Refs: design § i; Req 8.1, 8.2, 8.3, 8.4, 8.9, 8.10_

- [ ]* 6.2 Integration test: approve uses brief as text source (P-BRIEF-2)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\jobsApprove.test.ts`
  - Mock vision + clean regen. Seed a job in `iterating` with a brief whose values are obviously different from the vision `content`s. After `POST /approve`, read `layout.json` and assert every `textElements[i].content` equals a `briefItem.value` (never the vision `content`); assert `textElements[i].id === briefItem.id`. Also test brief-longer-than-vision (extras kept) and vision-longer-than-brief (extras dropped).
  - _Refs: design § i; Req 8.3–8.8; P-BRIEF-2_

- [~] 6.3 **Verification step** — `npm test -- tests/integration/jobsApprove.test.ts`
  - _Refs: design § Rollout Plan step 6 hot point_

---

## 7. Frontend (`page.tsx` + `SettingsModal` indirect via `PROMPT_DEFINITIONS`)

_Rollout step 7 — design § j, l — Req 3, Req 4, Req 7, Req 9.9, Req 12.3_

- [~] 7.1 Refactor `AppState` and add shared form state for text brief flow
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - Replace `idle` with `text_setup`. Add `text_review` variant carrying `jobId`, `widthMm`, `heightMm`, optional `warning`. Hoist `imageFile`, `widthMm`, `heightMm`, `prompt`, `textItems` to top-level component state.
  - _Refs: design § j.1; Req 3.1, 3.7, 7.1_

- [~] 7.2 Implement `handleAnalyzeReference`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - POSTs `multipart/form-data` to `/api/jobs/analyze-reference` with image + dims + optional prompt; populates `textItems` and switches to `text_review` on 200; surfaces `vision_unavailable` warning non-blockingly; disables both buttons while in flight.
  - _Refs: design § j.2; Req 3.4, 3.5, 3.6, 3.7, 3.8_

- [~] 7.3 Implement `handleSubmitInitial` (branches on `jobId`)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - POSTs `multipart/form-data` to `/api/jobs` with `widthMm`, `heightMm`, `prompt`, `textItems`, optional `image` and (when continuation) `jobId`. Transitions to `iterating` on success.
  - Client-side validation must mirror Req 12.3 (block when no image and no non-empty item).
  - _Refs: design § j.3; Req 3.11, 4.9, 5.1, 12.3_

- [~] 7.4 Implement `handleIterate` to include `textItems`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - Sends current `textItems` (JSON-serialised) on every refine request.
  - _Refs: design § j.4; Req 7.2_

- [~] 7.5 Implement `renderTextBriefEditor`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - Per-row label/value inputs, "Remover", "+ Adicionar texto"; yellow "este item será ignorado" badge when `value.trim() === ''`. No drag-and-drop, no max-count cap.
  - Used by both `text_review` and `iterating` screens.
  - _Refs: design § j.5; Req 4.1–4.12, 7.1, 7.3, 7.4, 15.1_

- [~] 7.6 Implement disabled-button rules and inline hint message
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - "Analisar imagem" enabled only in `text_setup` with image and valid dims; "Gerar arte" enabled per Req 3.3, 4.10, 4.11. Inline message: "Adicione ao menos um texto ou envie uma imagem de referência" when applicable.
  - _Refs: design § j.6; Req 3.3, 3.4, 4.10, 4.11, 12.3_

- [~] 7.7 Reset analysis on reference-image change
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\page.tsx`
  - When the user picks a different file while in `text_review`, clear `textItems` and `jobId` and return to `text_setup`.
  - _Refs: design § j.7; Req 3.9_

- [~] 7.8 `SettingsModal` exposes `textInstructions` variable indirectly via `PROMPT_DEFINITIONS`
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\app\components\SettingsModal.tsx` (no structural change; verify the variables list now renders the new entry from § d.3)
  - _Refs: design § l; Req 9.9_

- [ ]* 7.9 RTL component test: `text_setup` screen
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\uiTextSetup.test.tsx`
  - Asserts disabled-button rules, "Analisar imagem" only with image + dims, file-change resets, warning rendering.
  - _Refs: Req 3.1–3.11_

- [ ]* 7.10 RTL component test: brief editor (review + iterating)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\uiBriefEditor.test.tsx`
  - Asserts add/edit/remove, empty-value warning badge, no max-count, no analyze button in `text_review`/`iterating`.
  - _Refs: Req 4.1–4.12, 7.1, 7.3, 7.4_

- [~] 7.11 **Verification step** — `npm test -- tests/integration/uiTextSetup.test.tsx tests/integration/uiBriefEditor.test.tsx`. Visually confirm the Settings UI now lists `textInstructions` under the `imageGeneration` card.
  - _Refs: design § Rollout Plan step 7 hot point_

---

## 8. End-to-end smoke

_Rollout step 8 — design § Rollout Plan step 8 — Req 1, Req 5, Req 6, Req 8, Req 11, Req 14_

- [~] 8.1 Extend the existing e2e test with a Path A scenario (with reference image)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\e2e.test.ts`
  - Mocks `extractLayoutVisionWithRetry`, `generateImageToImage`, `regenerateWithoutText`. Flow: `analyze-reference` → edit `textItems` (mutate one value to a known sentinel) → `POST /api/jobs` (continuation) → `POST /iterate` once → `POST /approve` → `POST /render-pdf`. Assert the persisted `layout.json` `textElements[*].content` set equals the post-edit brief's non-empty values (P-BRIEF-2).
  - _Refs: design § Rollout Plan step 8 (Path A); Req 1, 5, 6, 8, 11_

- [~] 8.2 Add a Path B scenario (no reference image)
  - File: `c:\Users\Bruno\Desktop\VIBE\DESIGN_AI\tests\integration\e2e.test.ts`
  - Flow: `POST /api/jobs` with no `jobId` and no image but ≥1 non-empty textItem → assert `original.jpg` is NOT written; assert generation was invoked with the 1×1 transparent PNG fallback (mock spy on `generateImageToImage`); then `iterate` → `approve` → `render-pdf` succeed. Assert `text_brief_json` round-trips through `text-brief.json` (P-PERSISTENCE-PARITY-1).
  - _Refs: design § Rollout Plan step 8 (Path B); Req 5.5, 5.13, 5.9, 11.2, 11.5, 12.2_

- [~] 8.3 **Verification step (final)** — `npm test`
  - All suites green, including existing tests untouched (`tests/layout/normalize.p8.pbt.test.ts`, `tests/layout/render.*.pbt.test.ts`, `tests/pdf/render.test.ts`, etc.).
  - _Refs: design § Rollout Plan step 8 hot point_

---

## 9. Acceptance — requirements coverage and final smoke

_Maps every functional requirement (Req 1–Req 14) to the tests that cover it, and asserts the e2e smoke from rollout step 8._

- [~] 9.1 Confirm requirements-to-tests coverage matrix
  - Walk this matrix and confirm each row's tests are present and passing:

  | Req | Test file(s) |
  |---|---|
  | Req 1 (analyze-reference) | `tests/integration/analyzeReference.test.ts`; `tests/openai/analyzeReference.buildBrief.pbt.test.ts` (P2) |
  | Req 2 (Vision Stage 0 sharing + reading order) | `tests/layout/normalize.sortReadingOrder.pbt.test.ts` (P1); `tests/layout/visionSchemaLabel.pbt.test.ts` (P9); `tests/integration/analyzeReference.test.ts` |
  | Req 3 (text setup UI) | `tests/integration/uiTextSetup.test.tsx` |
  | Req 4 (brief editor) | `tests/integration/uiBriefEditor.test.tsx` |
  | Req 5 (POST /api/jobs alterations) | `tests/integration/jobsCreate.test.ts`; `tests/layout/effectiveFilter.pbt.test.ts` (P5) |
  | Req 6 (iterate textItems) | `tests/integration/jobsIterate.test.ts` |
  | Req 7 (iterating UI) | `tests/integration/uiBriefEditor.test.tsx` |
  | Req 8 (approve uses brief) | `tests/integration/jobsApprove.test.ts`; `tests/layout/mergeBrief.structural.pbt.test.ts` (P3); `tests/layout/mergeBrief.length.pbt.test.ts` (P4) |
  | Req 9 (prompt extensions) | `tests/prompts/templates.test.ts`; `tests/prompts/formatTextInstructions.pbt.test.ts` (P7) |
  | Req 10 (DB migration) | `tests/db/initSchema.test.ts` |
  | Req 11 (storage layout) | `tests/db/textBrief.roundtrip.pbt.test.ts` (P6); `tests/integration/e2e.test.ts` |
  | Req 12 (validation rules) | `tests/layout/editableTextItemSchema.pbt.test.ts` (P8); `tests/integration/jobsCreate.test.ts`; `tests/integration/uiTextSetup.test.tsx` |
  | Req 13 (state machine) | `tests/db/transitionStatus.newEdges.pbt.test.ts` (P10); `tests/db/transition.p3.pbt.test.ts` (existing — must still pass) |
  | Req 14 (Stage 0 error handling) | `tests/integration/analyzeReference.test.ts` (Vision-throw + non-Vision-throw cases) |

- [~] 9.2 Confirm Path A e2e smoke (rollout step 8)
  - Test: `tests/integration/e2e.test.ts` — Path A scenario from task 8.1.
  - Assert: `final.pdf` is produced; `layout.json.textElements[*].content` set equals the user-edited brief's non-empty `value`s; no Vision `content` field leaked into `LayoutInput` (P-BRIEF-2).

- [~] 9.3 Confirm Path B e2e smoke (rollout step 8)
  - Test: `tests/integration/e2e.test.ts` — Path B scenario from task 8.2.
  - Assert: no `original.jpg` is written; `generateImageToImage` was called with the 1×1 transparent PNG fallback; the rest of the pipeline (iterate → approve → render-pdf) completes; `text-brief.json` matches `text_brief_json` (P-PERSISTENCE-PARITY-1).

- [~] 9.4 **Final verification step** — `npm test`
  - All suites green. Re-run `npm test -- tests/db/` after the migration verification step (1.9) is confirmed.

---

## Notes

- Sub-tasks marked with `*` are optional and can be skipped for a faster MVP, in line with the workflow's testing convention. PBT sub-tasks for newly introduced **pure functions** are kept as required (no `*`) per the project rule that pure-function changes must ship with their property test.
- Every requirement (Req 1–Req 14) is referenced by at least one task above; Req 15 is purely negative (out of scope) and intentionally has no implementation task.
- Section letters (a–m) cite `design.md` § Components and Interfaces; property numbers (P1–P10) cite `design.md` § Correctness Properties; `P-*` identifiers cite `requirements.md` § Correctness Properties.
- Migration: per Req 10.8, the dev SQLite file is deleted and recreated by `initSchema`; this happens at the verification hot-point of task 1 (step 1.9), before any other module change is verified.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.9"] },
    { "id": 2, "tasks": ["1.5", "1.6", "2.1", "2.10", "2.11", "2.12", "2.13"] },
    { "id": 3, "tasks": ["1.7", "1.8", "2.2", "2.3", "2.14", "2.15"] },
    { "id": 4, "tasks": ["2.4", "2.5"] },
    { "id": 5, "tasks": ["2.6", "2.7", "2.8", "3.1"] },
    { "id": 6, "tasks": ["3.2", "4.1"] },
    { "id": 7, "tasks": ["4.2", "5.1", "5.2"] },
    { "id": 8, "tasks": ["4.3", "4.4", "5.3", "5.4", "6.1"] },
    { "id": 9, "tasks": ["6.2", "7.1"] },
    { "id": 10, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.7", "7.8"] },
    { "id": 11, "tasks": ["7.9", "7.10", "8.1", "8.2"] },
    { "id": 12, "tasks": ["9.1", "9.2", "9.3"] }
  ]
}
```
