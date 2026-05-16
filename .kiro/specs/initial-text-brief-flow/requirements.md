# Requirements Document

## Introduction

Esta feature adiciona uma nova etapa inicial (Stage 0) ao pipeline existente do AI Print Art MVP 1. Antes de qualquer geração de arte, o sistema executa uma extração de textos a partir da imagem de referência do usuário (via GPT-4o Vision) e popula um formulário editável onde o usuário pode revisar, editar, remover ou adicionar itens textuais.

Os itens textuais editados pelo usuário tornam-se a fonte da verdade (source of truth) do conteúdo textual em todo o pipeline: geração inicial (gpt-image-1), iterações de refinamento e PDF final. O fluxo aceita dois caminhos de entrada:

- **Caminho A — com imagem de referência**: Vision extrai itens, usuário revisa/edita, depois gera arte.
- **Caminho B — sem imagem de referência**: usuário fornece manualmente ao menos um item textual e gera arte direto.

A chamada Vision existente no endpoint `approve` é mantida (ainda opera sobre `approved.png`), porém seu papel é reduzido: o campo `content` é descartado e somente bbox/cor/peso/alinhamento/label são utilizados para posicionamento. O conteúdo textual sempre vem do brief editado pelo usuário.

## Glossary

- **TextBrief**: Coleção ordenada de itens textuais (`{ textItems: EditableTextItem[] }`) que representa o conteúdo textual canônico de um job. Persistido em `text_brief_json` no banco e em `storage/jobs/{id}/text-brief.json`.
- **EditableTextItem**: Estrutura `{ id: string, label: string, value: string }`. `id` é UUID v4 estável dentro do job; `label` é uma dica visual (ex.: "titulo", "subtitulo", "preco"); `value` é o texto literal a ser renderizado.
- **Reference_Image**: Imagem JPEG/PNG enviada pelo usuário no início do fluxo, salva em `storage/jobs/{id}/original.jpg`. Pode estar ausente no Caminho B.
- **Reference_Analysis**: Resposta crua e validada (`VisionResponse`) da chamada Vision Stage 0, persistida em `storage/jobs/{id}/reference-analysis.json` e em `reference_analysis_json`.
- **Reading_Order**: Ordenação visual top-to-bottom como critério primário e left-to-right como critério secundário quando dois elementos sobrepõem verticalmente (sobreposição em y > 50% da maior altura).
- **LayoutInput**: Estrutura existente (`lib/layout/types.ts`) consumida pelo renderer HTML/CSS. Contém `canvas`, `background.dataUrl` e `textElements[]` posicionados em milímetros. NÃO se confunde com `TextBrief` — `TextBrief` é a fonte do conteúdo, `LayoutInput.textElements` é a representação posicionada para renderização.
- **Vision_Schema**: Schema Zod (`VisionResponseSchema` em `lib/layout/normalize.ts`) que valida a resposta crua do gpt-4o. Será estendido com o campo `label`.
- **Stage_0**: Nova etapa de análise de referência (extração de textos pré-geração).
- **Reference_Analyzer**: Componente lógico do servidor responsável por executar Stage 0 (chamada Vision sobre `original.jpg`, validação, ordenação, persistência).
- **Brief_Editor**: Componente de UI do client onde o usuário revisa e edita os itens textuais.
- **Layout_Merger**: Função `mergeBriefWithVisionLayout` que combina o `TextBrief` com a resposta Vision do approve para produzir `LayoutInput`. Substitui o uso de `normalizeVisionResponse` no endpoint approve.
- **Reading_Order_Sorter**: Função pura `sortByReadingOrder` que reorganiza um array de elementos com `bboxPx` na ordem de leitura definida.
- **Job_Status**: Enum `'created' | 'analyzing_reference' | 'text_review' | 'iterating' | 'processing_step4' | 'preview_ready' | 'rendering_pdf' | 'pdf_ready' | 'error'`.
- **Vision_Prompt**: Template editável `visionLayout` em `lib/prompts.ts`, compartilhado entre Stage 0 e approve.
- **Image_Generation_Prompt**: Template editável `imageGeneration` em `lib/prompts.ts`, estendido com a variável `{{textInstructions}}`.
- **TextInstructions_Block**: String produzida pela função pura `formatTextInstructions(textItems)` e injetada em `{{textInstructions}}` no prompt do gpt-image-1.

## Requirements

### Requirement 1: analyze-reference endpoint (Stage 0)

**User Story:** Como usuário com uma imagem de referência, quero que o sistema detecte automaticamente os textos da minha imagem antes da geração, para que eu possa revisá-los e editá-los antes de gastar uma chamada gpt-image-1.

#### Acceptance Criteria

1. THE Server SHALL expose `POST /api/jobs/analyze-reference` accepting `multipart/form-data` with fields `image` (required, File), `widthMm` (required, positive integer), `heightMm` (required, positive integer), and `prompt` (optional, string).
2. WHEN `POST /api/jobs/analyze-reference` is called with all required fields valid (including the file size constraint defined in AC 5 already satisfied), THE Server SHALL create a new job row with a freshly generated UUID v4 `id`, persist `widthMm`, `heightMm`, `initial_prompt` (empty string when `prompt` is absent), and set status to `analyzing_reference` synchronously before any Vision call.
3. WHEN `POST /api/jobs/analyze-reference` receives a valid image, THE Server SHALL save the raw bytes to `storage/jobs/{id}/original.jpg` before invoking Vision.
4. IF the request is missing the `image` field or the file size is `0`, THEN THE Server SHALL respond with HTTP 400 and a JSON body `{ "error": "Missing or invalid image field" }` and SHALL NOT create a job row.
5. IF the request `image` exceeds 10 MB, THEN THE Server SHALL respond with HTTP 400 and `{ "error": "Image exceeds maximum size of 10 MB" }` and SHALL NOT create a job row.
6. IF `widthMm` or `heightMm` is missing, non-numeric, zero, or negative, THEN THE Server SHALL respond with HTTP 400 and a validation error and SHALL NOT create a job row.
7. WHEN Stage 0 Vision returns successfully and validates against `VisionResponseSchema`, THE Reference_Analyzer SHALL persist the validated response to `storage/jobs/{id}/reference-analysis.json` and to the column `reference_analysis_json`.
8. WHEN Stage 0 Vision succeeds, THE Reference_Analyzer SHALL build a `TextBrief` whose `textItems` are derived in Reading_Order from the validated Vision response, with one item per Vision element using `{ id: <fresh UUID v4>, label: <vision.label>, value: <vision.content> }`.
9. WHEN Stage 0 Vision succeeds, THE Reference_Analyzer SHALL persist the `TextBrief` to `storage/jobs/{id}/text-brief.json` and to the column `text_brief_json` before transitioning the job status.
10. WHEN persistence of `reference-analysis.json` and `text-brief.json` completes, THE Reference_Analyzer SHALL transition the job from `analyzing_reference` to `text_review` using `transitionStatus(id, ['analyzing_reference'], 'text_review')`.
11. WHEN the transition to `text_review` succeeds, THE Server SHALL respond with HTTP 200 and a JSON body `{ "jobId": <string>, "status": "text_review", "textItems": <EditableTextItem[]> }`.
12. IF Stage 0 Vision fails (network, timeout, schema validation after retry), THEN THE Reference_Analyzer SHALL still persist `text-brief.json` containing `{ "textItems": [] }`, persist `reference_analysis_json` as SQL `NULL`, transition the job from `analyzing_reference` to `text_review`, AND THEN THE Server SHALL respond with HTTP 200 and the JSON body `{ "jobId": <string>, "status": "text_review", "textItems": [], "warning": "vision_unavailable" }`.
13. THE `POST /api/jobs/analyze-reference` endpoint SHALL be synchronous: the response SHALL only be sent after the status transition to `text_review` (or `error`) is final.
14. IF persistence of `original.jpg`, `reference-analysis.json`, or `text-brief.json` fails with an I/O error, THEN THE Server SHALL set `error_message`, transition the job from `analyzing_reference` to `error`, and respond with HTTP 500 and `{ "error": "Internal server error" }`.

### Requirement 2: Stage 0 Vision call shares prompt and respects Reading_Order

**User Story:** Como mantenedor, quero uma única definição editável do Vision_Prompt, para que mudanças de instrução afetem consistentemente Stage 0 e approve.

#### Acceptance Criteria

1. THE Reference_Analyzer SHALL invoke `extractLayoutVisionWithRetry(originalImage, 1)` (one retry) using the same `extractLayoutVision` wrapper that the approve endpoint uses.
2. THE Vision_Schema SHALL include a required field `label: z.string()` on each element of `textElements`, with no enum constraint.
3. WHILE the Vision_Prompt is interpreted by gpt-4o, THE Vision_Prompt SHALL explicitly instruct the model to return `textElements` ordered top-to-bottom (primary) and left-to-right (secondary, when y-overlap exceeds 50% of the larger element height).
4. WHEN the validated Vision response is received by the Reference_Analyzer, THE Server SHALL apply `sortByReadingOrder(visionResponse.textElements)` defensively before constructing the `TextBrief`, regardless of the order returned by the model.
5. THE function `sortByReadingOrder` SHALL live in `lib/layout/normalize.ts` and SHALL be a pure function (no I/O, deterministic).
6. WHERE the validated Vision response contains zero `textElements`, THE Reference_Analyzer SHALL produce a `TextBrief` with `textItems: []`.

### Requirement 3: Text setup UI (sub-state `text_setup`)

**User Story:** Como usuário no início do fluxo, quero uma única tela de configuração onde escolho dimensões, descrevo o prompt geral, opcionalmente envio uma imagem de referência e gerencio a lista de textos, para que o setup seja simples e linear.

#### Acceptance Criteria

1. WHEN the application loads at `/`, THE Client SHALL render the text setup screen with empty fields: `widthMm`, `heightMm`, `prompt`, no image, and an empty `textItems` list.
2. THE text setup screen SHALL provide a file input that accepts a single image file.
3. WHILE no Reference_Image is selected AND `textItems` is empty, THE Client SHALL display the "Gerar arte" button as disabled with an inline message "Adicione ao menos um texto ou envie uma imagem de referência".
4. WHILE a Reference_Image is selected AND no analysis has run yet, THE Client SHALL display an enabled "Analisar imagem" button.
5. WHEN the user clicks "Analisar imagem", THE Client SHALL POST `multipart/form-data` to `/api/jobs/analyze-reference` with the current `image`, `widthMm`, `heightMm` and (when present) `prompt`.
6. WHILE the `analyze-reference` request is in flight, THE Client SHALL disable both "Analisar imagem" and "Gerar arte" buttons and display a loading indicator.
7. WHEN `analyze-reference` returns HTTP 200, THE Client SHALL store `jobId` in component state, populate the `textItems` list from the response, and switch the screen sub-state from `text_setup` to `text_review`.
8. IF the `analyze-reference` response contains `"warning": "vision_unavailable"`, THEN THE Client SHALL display a non-blocking notice "Não conseguimos detectar textos automaticamente, você pode adicioná-los manualmente." and still transition to `text_review`.
9. IF the user changes the Reference_Image file selection after a successful analysis, THEN THE Client SHALL clear the local `textItems` list, clear `jobId`, hide the `text_review` sub-state, and re-show the "Analisar imagem" button.
10. WHILE in `text_setup` sub-state and no Reference_Image is present, THE Client SHALL allow the user to add `EditableTextItem` rows manually via an "Adicionar texto" control.
11. THE "Gerar arte" button SHALL submit `POST /api/jobs` with the current form values (described in Requirement 5).

### Requirement 4: Brief editor (sub-state `text_review`)

**User Story:** Como usuário após a análise da referência, quero editar livremente cada item textual antes da geração, para garantir que a arte final saia com os textos corretos.

#### Acceptance Criteria

1. WHILE the screen is in `text_review` sub-state, THE Brief_Editor SHALL render one row per item in `textItems`, each row containing two text inputs (`label`, `value`) and a "Remover" button.
2. WHEN the user types in the `label` or `value` input of any row, THE Brief_Editor SHALL update the corresponding item in client-side state without contacting the server.
3. WHEN the user clicks "Adicionar texto", THE Brief_Editor SHALL append a new `EditableTextItem` with a freshly generated UUID v4 `id`, empty `label`, and empty `value` to the end of `textItems`.
4. WHEN the user clicks "Remover" on a row, THE Brief_Editor SHALL remove the corresponding item from `textItems` by `id`.
5. WHILE the user is in `text_review` sub-state, THE Brief_Editor SHALL hide the "Analisar imagem" button.
6. WHILE an item has `value` equal to the empty string after `trim()`, THE Brief_Editor SHALL render a yellow warning badge "este item será ignorado" next to the row.
7. THE Brief_Editor SHALL NOT permit drag-and-drop reordering in this iteration of the feature.
8. THE Brief_Editor SHALL render items strictly in the array index order of `textItems`.
9. WHEN the user clicks "Gerar arte" from `text_review` sub-state, THE Client SHALL POST `multipart/form-data` to `/api/jobs` with `jobId`, current `textItems` (JSON-serialised), `widthMm`, `heightMm`, `prompt`, and any optional new image.
10. WHILE in `text_review` sub-state with a Reference_Image present, THE "Gerar arte" button SHALL be enabled regardless of whether `textItems` is empty or whether any item has an empty `value`.
11. WHILE in `text_setup` sub-state without a Reference_Image, THE "Gerar arte" button SHALL be enabled IF AND ONLY IF `textItems` contains at least one item with `value.trim().length > 0`.
12. THE Brief_Editor SHALL NOT impose any maximum number of items; the "Adicionar texto" control SHALL remain enabled regardless of the current count.

### Requirement 5: POST /api/jobs alterations (fresh creation vs. continuation)

**User Story:** Como usuário, quero que `POST /api/jobs` aceite tanto a criação direta (sem análise prévia) quanto a continuação a partir de um job já analisado, para que ambos os caminhos (com e sem imagem) funcionem na mesma rota.

#### Acceptance Criteria

1. THE Server SHALL accept `POST /api/jobs` with `multipart/form-data` containing optional `jobId` (string), required `widthMm` (positive integer), required `heightMm` (positive integer), required `prompt` (non-empty string), required `textItems` (JSON-serialised array), and optional `image` (File ≤ 10 MB).
2. IF the request body is missing `prompt` or `prompt.trim()` is empty, THEN THE Server SHALL respond with HTTP 400 and `{ "error": "prompt is required" }`.
3. IF the request body is missing `textItems` or it does not parse as an array of `EditableTextItem`, THEN THE Server SHALL respond with HTTP 400 with a Zod validation error.
4. THE Server SHALL NOT impose any maximum length on the `textItems` array; arrays of any non-negative length SHALL be accepted as long as each element passes `EditableTextItem` validation.
5. IF the request includes no `image` AND no `jobId` AND `textItems` contains zero items with `value.trim().length > 0`, THEN THE Server SHALL respond with HTTP 400 and `{ "error": "At least one non-empty text item is required when no reference image is provided" }`.
6. WHEN `jobId` is provided AND the corresponding job exists with status `text_review`, THE Server SHALL update `text_brief_json` with the supplied `textItems` and transition the job from `text_review` to `iterating` using `transitionStatus(id, ['text_review'], 'iterating')`.
7. WHEN `jobId` is provided AND the corresponding job does not exist OR is in any status other than `text_review`, THE Server SHALL respond with HTTP 409 and `{ "error": "Cannot start generation in current state" }` and SHALL NOT modify the job.
8. WHEN `jobId` is NOT provided, THE Server SHALL create a new job row with a fresh UUID v4 `id`, persist `widthMm`, `heightMm`, `initial_prompt = prompt`, persist `text_brief_json` with the supplied `textItems`, and transition directly from the internal momentary `created` state to `iterating`.
9. WHEN `jobId` is NOT provided AND `image` is present, THE Server SHALL save the bytes to `storage/jobs/{id}/original.jpg` before generation; WHEN `jobId` is NOT provided AND `image` is absent, THE Server SHALL skip writing `original.jpg` (case B without reference).
10. WHEN the job is in `iterating` state, THE Server SHALL filter `textItems` server-side to keep only items with `value.trim().length > 0` (the "effective brief") and SHALL invoke `generateImageToImage` with a final prompt produced by interpolating `imageGeneration` with `userPrompt = prompt`, `widthMm`, `heightMm`, and `textInstructions = formatTextInstructions(effectiveBrief)`.
11. WHEN the request comes from continuation (`jobId` present) AND no new `image` is uploaded, THE Server SHALL use the previously saved `original.jpg` as the base image for `generateImageToImage`.
12. WHEN the request comes from continuation AND a new `image` is uploaded, THE Server SHALL overwrite `storage/jobs/{id}/original.jpg` with the new bytes and use them as the base image.
13. WHEN no Reference_Image exists for the job AND no new image is uploaded, THE Server SHALL invoke `generateImageToImage` without `baseImage` (fresh generation; `image` parameter SHALL be passed as a 1×1 transparent PNG fallback to satisfy gpt-image-1's `images.edit` API).
14. WHEN `generateImageToImage` returns successfully, THE Server SHALL save the result as `storage/jobs/{id}/iterations/1.png` and update `current_iteration = 1`.
15. WHEN the full workflow completes successfully, THE Server SHALL respond with HTTP 200 and `{ "jobId": <string>, "iteration": 1 }`.
16. IF any step (DB write, storage, OpenAI call) fails, THEN THE Server SHALL persist `error_message`, transition the job to `error` (using `from = ['created', 'text_review', 'iterating']`), and respond with HTTP 500 and `{ "error": "Internal server error" }`.
17. THE persisted `text_brief_json` SHALL contain the unfiltered `textItems` (including empty values) so the user can re-edit them in subsequent iterations; only the in-memory `effectiveBrief` passed to gpt-image-1 SHALL exclude empty values.

### Requirement 6: Iterate endpoint accepts textItems

**User Story:** Como usuário refinando a arte, quero poder editar a lista de textos a cada iteração, para que cada nova geração reflita o conteúdo textual atualizado.

#### Acceptance Criteria

1. THE Server SHALL accept `POST /api/jobs/:id/iterate` with `multipart/form-data` containing required `prompt` (non-empty), required `textItems` (JSON-serialised array of `EditableTextItem`), and optional `image` (File ≤ 10 MB).
2. IF `textItems` is missing, malformed, or any item has missing `id`/`label`/`value` fields, THEN THE Server SHALL respond with HTTP 400 and a validation error and SHALL NOT modify the job.
3. WHEN the iterate request validates, THE Server SHALL update `text_brief_json` with the supplied `textItems` BEFORE invoking `generateImageToImage`.
4. WHEN preparing the prompt for `generateImageToImage`, THE Server SHALL apply the same effective-brief filter as Requirement 5.10 and inject `formatTextInstructions(effectiveBrief)` into the `{{textInstructions}}` placeholder.
5. THE Iterate endpoint SHALL NOT trigger any new Vision Stage 0 analysis under any circumstance.
6. WHEN the iterate generation succeeds, THE Server SHALL save the result as `storage/jobs/{id}/iterations/{n+1}.png`, update `current_iteration = n+1`, and respond with HTTP 200 and `{ "iteration": <n+1> }`.
7. IF the job is not in status `iterating`, THEN THE Server SHALL respond with HTTP 409 and `{ "error": "Job is not in iterating state" }`.

### Requirement 7: Iterating UI exposes editable text items

**User Story:** Como usuário entre iterações, quero ver e editar os mesmos itens textuais durante o refinamento, para corrigir conteúdos sem perder o contexto da imagem atual.

#### Acceptance Criteria

1. WHILE the application is in `iterating` step, THE Client SHALL render the editable list of `textItems` alongside the current iteration image and the refine prompt.
2. WHEN the user clicks "Refinar" (refine), THE Client SHALL include the current `textItems` (JSON-serialised) in the `multipart/form-data` body sent to `/api/jobs/:id/iterate`.
3. THE iterating screen SHALL allow add, edit, and remove operations on `textItems` with the same semantics as Requirement 4 (including the empty-value warning badge); the iterating screen SHALL NOT impose any item-count limit.
4. THE iterating screen SHALL NOT expose an "Analisar imagem" button and SHALL NOT impose any maximum number of `textItems`.

### Requirement 8: Approve endpoint uses brief as text source

**User Story:** Como sistema, devo garantir que o PDF final contenha estritamente os textos do brief editado, para que erros de OCR do Vision não contaminem a saída.

#### Acceptance Criteria

1. WHEN `POST /api/jobs/:id/approve` is invoked AND the job is in status `iterating`, THE Server SHALL transition to `processing_step4` using the existing idempotency guard.
2. WHEN `runStage4` runs, THE Server SHALL still call `extractLayoutVisionWithRetry(approvedPng, 1)` and still call `regenerateWithoutText` in parallel (unchanged from current behaviour).
3. WHEN building the `LayoutInput` in `runStage4`, THE Server SHALL replace the call to `normalizeVisionResponse` with a call to `mergeBriefWithVisionLayout({ brief, visionResponse, imageWidthPx, imageHeightPx, canvasWidthMm, canvasHeightMm, backgroundDataUrl })`.
4. THE function `mergeBriefWithVisionLayout` SHALL load the `TextBrief` from `text_brief_json` of the job, filter out items where `value.trim().length === 0`, and SHALL match brief items to Vision elements by index after sorting both lists by Reading_Order.
5. WHEN `briefItems.length > visionElements.length` AND `mergeBriefWithVisionLayout` is performing the merge for an approve operation, THE Layout_Merger SHALL keep the extra brief items and assign default positioning (centred horizontally, stacked vertically with a fixed gap) so they still render in the PDF.
6. WHEN `visionElements.length > briefItems.length`, THE Layout_Merger SHALL drop the extra Vision elements (no `LayoutInput.textElement` is produced for them).
7. WHEN producing each `LayoutInput.textElements[i]`, THE Layout_Merger SHALL use `briefItem.value` as `content` and SHALL discard the Vision `content` field; positioning, color, fontWeight, and align SHALL come from the matched Vision element when available, otherwise from defaults.
8. WHEN producing each `LayoutInput.textElements[i]`, THE Layout_Merger SHALL set `id = briefItem.id` so identifiers remain stable between brief and rendered output.
9. WHEN `runStage4` completes, THE Server SHALL persist the resulting `LayoutInput` (with `background.dataUrl` replaced by `'__deferred__'`) to `layout.json` and to `layout_json` exactly as the current implementation does.
10. THE function `normalizeVisionResponse` SHALL remain available in `lib/layout/normalize.ts` for backward compatibility but SHALL NOT be invoked by the approve endpoint after this feature is shipped.

### Requirement 9: Prompt template extensions

**User Story:** Como mantenedor de prompts, quero que os templates editáveis reflitam as novas regras (ordem de leitura, label, instruções de texto), para que o comportamento permaneça configurável via Settings UI.

#### Acceptance Criteria

1. THE `imageGeneration` template SHALL include a new placeholder `{{textInstructions}}` documented in `PROMPT_DEFINITIONS` with description "Bloco de instruções textuais geradas a partir do TextBrief; lista cada item ou instrui a ausência total de texto".
2. THE `visionLayout` template SHALL be updated so that the JSON schema described to gpt-4o includes a required string field `label` per element, with documentation in the prompt body listing example values "titulo", "subtitulo", "preco", "descricao", "rodape" and a note that any string is acceptable.
3. THE `visionLayout` template SHALL include an explicit instruction "Return elements ordered top-to-bottom (primary) and left-to-right (secondary when y-overlap exceeds 50% of the larger element height)".
4. THE function `formatTextInstructions(textItems: EditableTextItem[]): string` SHALL be a pure server-side function exported from `lib/prompts.ts` (or from a new module imported by it).
5. WHEN `formatTextInstructions` receives a non-empty list of items (after empty-value filter), THE function SHALL return a block listing each item as `- {label}: "{value}"`, prefixed by mandatory instructions "Include EXACTLY these texts in the image, with no spelling, number or punctuation changes. Do not invent extra texts. Do not omit any. Use the labels as visual hierarchy hints but do not render the labels themselves."
6. WHEN `formatTextInstructions` receives an empty list, THE function SHALL return a block instructing the model to "Generate a 100% text-free image: no letters, numbers, words, watermarks, or typographic elements anywhere".
7. THE function `formatTextInstructions` SHALL be deterministic (same input → same output, byte-for-byte).
8. THE `removeText` template SHALL remain unchanged.
9. THE Settings UI (`SettingsModal`) SHALL continue to expose all three editable templates (`imageGeneration`, `removeText`, `visionLayout`); WHEN the user views the `imageGeneration` template, THE Settings UI SHALL list `userPrompt`, `widthMm`, `heightMm`, and `textInstructions` as available variables.

### Requirement 10: Database migration

**User Story:** Como mantenedor, quero o schema SQLite estendido com as novas colunas e estados, para que a persistência do brief e do reference analysis seja consistente.

#### Acceptance Criteria

1. THE table `jobs` SHALL include a column `text_brief_json TEXT` (NULLABLE) added by `initSchema` for new databases.
2. THE table `jobs` SHALL include a column `reference_analysis_json TEXT` (NULLABLE) added by `initSchema` for new databases.
3. THE `CHECK` constraint on `jobs.status` SHALL be extended to allow the values `'created'`, `'analyzing_reference'`, `'text_review'`, `'iterating'`, `'processing_step4'`, `'preview_ready'`, `'rendering_pdf'`, `'pdf_ready'`, `'error'`.
4. THE TypeScript type `JobStatus` in `lib/layout/types.ts` SHALL be updated to include `'analyzing_reference'` and `'text_review'`.
5. THE TypeScript type `JobRow` in `lib/db.ts` SHALL include `text_brief_json: string | null` and `reference_analysis_json: string | null`.
6. THE function `updateJob` SHALL accept `text_brief_json` and `reference_analysis_json` as patchable fields.
7. THE function `insertJob` SHALL accept an optional `initialStatus` parameter (defaulting to `'created'`) so that `analyze-reference` and the fresh-creation path can write the initial status atomically with creation.
8. WHERE the developer needs to migrate an existing dev database, THE project SHALL document that the SQLite file `storage/jobs.db` may be deleted and recreated by `initSchema`; THE project SHALL NOT ship an `ALTER TABLE` migration for this MVP.

### Requirement 11: Storage layout

**User Story:** Como sistema, quero arquivos do brief e da análise de referência colocalizados no mesmo diretório por job, para que debug e auditoria sejam diretos.

#### Acceptance Criteria

1. THE Storage layout per job SHALL include `storage/jobs/{id}/original.jpg` as the user reference image filename (NOT renamed to `reference.jpg`).
2. THE Storage layout per job SHALL include `storage/jobs/{id}/text-brief.json` as the canonical brief snapshot, written every time `text_brief_json` is updated in DB.
3. THE Storage layout per job SHALL include `storage/jobs/{id}/reference-analysis.json` as the validated raw Stage 0 Vision response (when Stage 0 succeeded).
4. THE existing files (`approved.png`, `clean.png`, `iterations/{n}.png`, `vision.json`, `layout.json`, `final.pdf`) SHALL remain in their current locations with their current names.
5. WHEN any update to `text_brief_json` is performed via DB, THE Server SHALL also attempt to rewrite `storage/jobs/{id}/text-brief.json` so the on-disk JSON and the DB column stay aligned on the happy path; IF the file write fails AFTER a successful DB write, THEN THE Server SHALL log the error and SHALL NOT roll back the DB update (potential drift between DB and filesystem is accepted).

### Requirement 12: Validation rules

**User Story:** Como produto, quero regras de validação claras para os dois caminhos (com/sem referência), para que apenas inputs significativos cheguem ao gpt-image-1.

#### Acceptance Criteria

1. WHEN a Reference_Image is present for a job, THE TextBrief SHALL be allowed to be empty (zero items or all items with empty `value`); the Server SHALL still proceed to generate the art.
2. WHEN no Reference_Image exists for a job (case B), THE TextBrief SHALL contain at least one item with `value.trim().length > 0` before generation can be triggered; the Server SHALL enforce this with HTTP 400 (Requirement 5.5).
3. WHEN no Reference_Image exists for a job, THE Client SHALL also enforce the same rule by disabling the "Gerar arte" button and showing the inline message described in Requirement 3.3.
4. THE TextBrief SHALL NOT have a maximum number of items; both client-side and server-side validation SHALL accept arrays of any non-negative length.
5. WHEN building the effective brief for `generateImageToImage`, THE Server SHALL silently filter items where `value.trim().length === 0`; these items SHALL NOT be included in the gpt-image-1 prompt and SHALL NOT be counted in the brief↔bbox matching at approve time.
6. THE persisted `text_brief_json` SHALL preserve all items the user typed (including empty ones) so the user can edit them in later iterations without losing rows; only the in-memory `effectiveBrief` SHALL be filtered.
7. THE Zod schema for `EditableTextItem` SHALL require `id` to be a UUID v4 string, `label` to be a string of length ≤ 64, and `value` to be a string of length ≤ 500; the schema SHALL NOT impose any cap on the number of items in `textItems`.

### Requirement 13: State machine extensions

**User Story:** Como sistema, quero estados explícitos para análise e revisão de textos, para que a UI e os endpoints reflitam corretamente onde o job está.

#### Acceptance Criteria

1. THE Server SHALL allow the transitions: `analyzing_reference → text_review`, `analyzing_reference → error`, `text_review → iterating`, `text_review → error`.
2. THE existing transitions (`iterating → processing_step4`, `processing_step4 → preview_ready`, `preview_ready → rendering_pdf`, `rendering_pdf → pdf_ready`, any → `error`) SHALL remain unchanged.
3. THE `created` status SHALL be used only as an internal momentary value during job-row insertion in `POST /api/jobs` (case B fresh creation); WHEN `analyze-reference` creates the job, the row SHALL be inserted directly with status `analyzing_reference`, AND IF the database insertion fails to set `analyzing_reference` for any reason, THEN THE Reference_Analyzer SHALL fail the entire `analyze-reference` operation (no fallback to `created`).
4. WHEN the Client polls `GET /api/jobs/:id/status`, THE Server SHALL return the current `status` column value verbatim, including `created`, `analyzing_reference`, and `text_review` when applicable; the Client SHALL handle these statuses without erroring out (`text_review` is the persisted state while the user edits the brief, `created` is normally too brief to be observed but SHALL not crash the polling code if it is).
5. THE function `transitionStatus` SHALL continue to be the only authorised point that mutates the `status` column; all new transitions in this feature SHALL go through it with the exact `from` array specified above.

### Requirement 14: Error handling for Stage 0 failures

**User Story:** Como usuário, quero que falhas do Vision não me bloqueiem, para que eu possa adicionar textos manualmente e seguir adiante.

#### Acceptance Criteria

1. WHEN `extractLayoutVisionWithRetry` throws after exhausting retries during Stage 0, THE Reference_Analyzer SHALL catch the error, log it, and continue with the graceful-degradation path described in Requirement 1.12.
2. THE graceful-degradation path SHALL NOT mark the job as `error`; the job SHALL still transition to `text_review` so the user can continue.
3. IF a non-Vision error occurs during Stage 0 (e.g., disk full, DB write failure), THEN the job SHALL be transitioned to `error` and the request SHALL respond with HTTP 500.
4. THE response payload for a Stage 0 partial-failure (graceful degradation) SHALL include the field `"warning": "vision_unavailable"` at the top level of the JSON body.

### Requirement 15: Out of scope (negative requirements)

**User Story:** Como mantenedor, quero registrar explicitamente o que NÃO está nesta entrega, para evitar escopo escorregadio.

#### Acceptance Criteria

1. THE Brief_Editor SHALL NOT support drag-and-drop reordering in this feature.
2. THE Client SHALL NOT persist form state to `localStorage`; refreshing the browser SHALL reset progress (consistent with current MVP behaviour).
3. THE Client SHALL NOT expose manual position editing in the preview screen.
4. THE Vision_Prompt SHALL remain a single editable template covering both Stage 0 and approve; splitting into two distinct prompts is out of scope.
5. THE Vision_Prompt SHALL NOT be tuned for multiple languages; only the existing language behaviour is preserved.
6. THE PDF rendering pipeline (`clean.png` + HTML/CSS + Inter Variable + Playwright + `final.pdf`) SHALL remain unchanged.
7. THE function `renderLayoutHTML` in `lib/layout/render.ts` SHALL remain unchanged.
8. THE `regenerateWithoutText` wrapper and the `removeText` prompt SHALL remain unchanged.

## Correctness Properties

The following invariants are stated as testable correctness properties. Each is mapped to a property identifier and a verification strategy (PBT = property-based test, INT = integration test, UNIT = unit test).

- **P-BRIEF-1** (UNIT/INT): For any job in status `text_review`, `iterating`, `processing_step4`, `preview_ready`, `rendering_pdf`, or `pdf_ready`, the column `text_brief_json` SHALL exist (non-NULL) and SHALL parse as valid JSON satisfying the `TextBrief` Zod schema. Verifiable by reading every row in the DB after a representative end-to-end run, plus a unit test ensuring every status transition into these states is preceded by a `text_brief_json` write.
- **P-BRIEF-2** (UNIT/INT): After `runStage4` completes, for every element `e` in `LayoutInput.textElements`, `e.content` SHALL equal `briefItem.value` for some `briefItem` in `text_brief_json.textItems` whose `value.trim().length > 0`. Equivalently, no `LayoutInput.textElements[i].content` SHALL ever come from the Vision response's `content` field. Verifiable by an integration test on a representative approved job and by a unit test on `mergeBriefWithVisionLayout`.
- **P-VALIDATION-1** (UNIT): A job SHALL NOT transition into `iterating` unless either (a) `original.jpg` exists in storage for that job OR (b) `text_brief_json` contains at least one item with `value.trim().length > 0`. Verifiable by a unit test on the validation function and by `transitionStatus` pre-condition checks at the call sites.
- **P-ORDER-1** (PBT): For any input `elements: VisionTextElement[]` and `result = sortByReadingOrder(elements)`: for any pair of indices `i < j`, either `result[i].bboxPx.y + result[i].bboxPx.height ≤ result[j].bboxPx.y + 0.5 * max(result[i].bboxPx.height, result[j].bboxPx.height)` (e_i is above e_j) OR (the y-ranges overlap by more than 50% of the larger height AND `result[i].bboxPx.x ≤ result[j].bboxPx.x`). Verifiable by a property-based test generating random bbox sets and asserting the predicate over all index pairs.
- **P-MATCH-1** (PBT): For any pair of arrays `(briefItems, visionElements)` and the result `merged = mergeBriefWithVisionLayout(...)`: `merged.textElements.length === Math.min(briefItems.length, visionElements.length) + max(0, briefItems.length - visionElements.length)`, i.e., extra brief items are kept and extra vision elements are dropped, and no exception is thrown for any length mismatch. Verifiable by a property-based test over arbitrary list lengths.
- **P-IDEMPOTENCY-1** (UNIT): Calling `transitionStatus(id, from, to)` twice in succession with the same arguments SHALL return `true` exactly once and `false` on every subsequent call (atomic guarantee). This invariant is preserved by the existing implementation; unit tests SHALL cover the two new transitions (`analyzing_reference → text_review`, `text_review → iterating`).
- **P-SCHEMA-1** (UNIT): For any `label: string`, the Vision_Schema validation SHALL accept the element regardless of label content (no enum constraint). Verifiable by a unit test feeding both expected labels ("titulo", "subtitulo") and arbitrary strings ("zzz", "", "🎨").
- **P-DETERMINISM-1** (UNIT): For any `textItems`, `formatTextInstructions(textItems)` SHALL produce byte-identical output across calls. Verifiable by a unit test invoking the function twice and comparing the strings.
- **P-PERSISTENCE-PARITY-1** (INT): On the happy path, after every successful write to `text_brief_json` (DB column), the file `storage/jobs/{id}/text-brief.json` SHALL exist and parse to the same value. (When the file write fails after a successful DB write, drift is accepted per Requirement 11.5.) Verifiable by an integration test that updates the brief and asserts both reads agree on the happy path.

## Acceptance Criteria → Verification Strategy Map

| Requirement section | Strategy | Notes |
|---|---|---|
| Req 1 (analyze-reference endpoint) | INT | End-to-end with mocked OpenAI client; cover happy path, missing image, oversized image, and Vision-failure graceful degradation. |
| Req 2 (Vision Stage 0 sharing) | UNIT + PBT | Unit-test the schema extension; PBT for `sortByReadingOrder` (P-ORDER-1). |
| Req 3 (text setup UI) | INT | React Testing Library / Playwright; cover button-disabled rules and reference-image-change invalidation. |
| Req 4 (brief editor) | INT | Component test with state assertions for add/edit/remove/cap. |
| Req 5 (POST /api/jobs alterations) | INT + UNIT | Cover both fresh creation and continuation; unit-test the validation Zod schema. |
| Req 6 (iterate textItems) | INT | Mock OpenAI; assert `text_brief_json` is updated before generation. |
| Req 7 (iterating UI) | INT | Component test ensuring textItems list is editable mid-iteration. |
| Req 8 (approve uses brief) | UNIT + PBT + INT | Unit-test `mergeBriefWithVisionLayout`; PBT for P-MATCH-1; integration test asserts P-BRIEF-2. |
| Req 9 (prompt extensions) | UNIT | Unit-test `formatTextInstructions` (empty + non-empty cases); P-DETERMINISM-1. |
| Req 10 (DB migration) | UNIT | Test `initSchema` produces the expected columns and CHECK; assert dev-discard documentation exists. |
| Req 11 (storage layout) | INT | Round-trip test: write brief → assert file exists and parses (P-PERSISTENCE-PARITY-1). |
| Req 12 (validation rules) | UNIT + INT | Zod-schema unit tests; integration test for both client-side and server-side enforcement. |
| Req 13 (state machine) | UNIT | P-IDEMPOTENCY-1 unit test for new transitions. |
| Req 14 (error handling Stage 0) | INT | Mock Vision to throw; assert HTTP 200 with `warning: "vision_unavailable"` and job in `text_review`. |
| Req 15 (out of scope) | N/A | Negative; no implementation, no test. |
