# Requirements Document: AI Print Art — MVP 1

## Introduction

Este documento descreve, em formato EARS, os requisitos do MVP 1 da aplicação **AI Print Art**: uma aplicação web mobile-first que permite a um operador de vendas/design gerar arte impressa física (banners, placas, fachadas) com IA, em frente ao cliente, em poucos minutos.

Os requisitos foram **derivados diretamente** do `design.md` deste mesmo spec, que é a fonte da verdade da arquitetura, da máquina de estados, das interfaces, dos contratos de API e das propriedades de correção. Toda decisão técnica, escolha de stack e escopo segue o que está estabelecido no design.

O fluxo é estritamente linear (sem voltar): foto → geração inicial → iteração com prompt → primeira aprovação → processamento (Vision + regeneração sem texto) → preview do layout final → segunda aprovação → PDF para download. A peça arquitetural mais crítica é o **Layout Renderer** (`lib/layout/render.ts`), módulo puro compartilhado entre cliente e servidor, **única fonte da verdade** para a transformação `LayoutInput → HTML`, garantindo paridade pixel-a-mm entre o preview aprovado e o arquivo PDF entregue.

Estão **fora de escopo** do MVP 1 (não devem ser cobertos por requisitos): tratamento EXIF de orientação, reconciliação de aspect ratio entre saídas do GPT Image e dimensões físicas, upscaling, Ghostscript/CMYK/ICC/PDF/X-1a/bleed/prepress, autenticação, multi-usuário, fila de jobs (BullMQ etc), pool de browsers Playwright, botão "voltar" no preview, edição manual de layout, histórico de iterações visível na UI, efeitos visuais sobre texto (drop-shadow, glow, blend-mode), tracking de custo, rate limits e Tesseract OCR.

## Glossary

- **Job**: instância única de execução do fluxo, identificada por um UUID v4. Representada pela linha correspondente na tabela `jobs` do SQLite e pelo diretório `./storage/jobs/{id}/` no filesystem. Mantém o estado linear da máquina (`status`) e a referência aos artefatos de cada estágio.
- **LayoutInput**: estrutura de dados validada definida em `lib/layout/types.ts`, contendo `canvas` (dimensões em mm), `background` (data URL base64 do PNG sem texto) e `textElements` (lista de elementos de texto com posição/tamanho em mm e tipografia). É a entrada determinística do Layout Renderer.
- **Layout Renderer**: módulo `lib/layout/render.ts` que exporta a função pura `renderLayoutHTML(input: LayoutInput): string`. Compartilhado entre cliente e servidor, é a única fonte da verdade para a transformação `LayoutInput → HTML`. Sem I/O, sem dependência de tempo ou aleatoriedade, com saída determinística byte-a-byte.
- **canvas**: área retangular de impressão definida em milímetros (`widthMm`, `heightMm`), correspondente às dimensões físicas da peça impressa. Mapeada para `@page { size: W mm H mm }` e para o container raiz `.canvas` no HTML.
- **text element**: cada item de `LayoutInput.textElements`. Possui `id`, `content`, `position {xMm, yMm}`, `size {widthMm, heightMm}` e `typography {fontFamily, fontSizePx, fontWeight, color, align}`. Renderizado como `<div class="text">` posicionado absolutamente em mm.
- **base64 data URL**: string no formato `data:<mime>;base64,<payload>` usada para embutir o background PNG (`data:image/png;base64,...`) e a fonte Inter (`data:font/woff2;base64,...`) diretamente no HTML, sem dependência de recursos externos.
- **idempotency**: garantia, implementada via `transitionStatus(id, from, to)` em SQLite, de que múltiplos disparos concorrentes ou repetidos do mesmo endpoint de transição (ex.: `approve`, `render-pdf`) produzem exatamente uma execução efetiva. Operacionalmente: `UPDATE jobs SET status = ? WHERE id = ? AND status IN (?...)` com checagem de `changes()` retorna `true` em apenas um dos disparos.
- **System (genérico)**: a aplicação `AI Print Art MVP 1` como um todo. Subsistemas nomeados explicitamente: `Mobile_UI`, `API`, `Database`, `Storage`, `OpenAI_Image`, `OpenAI_Vision`, `Layout_Renderer`, `Vision_Normalizer`, `PDF_Renderer`.

## Requirements

### Requirement 1: Captura e upload de imagem (Stage 1)

**User Story:** Como operador de vendas/design em campo, eu quero capturar uma foto pela câmera do celular ou escolher uma imagem da galeria e enviá-la junto com as dimensões físicas e um prompt inicial, para que o sistema crie um job e dispare a geração inicial da arte.

#### Acceptance Criteria

1. THE Mobile_UI SHALL apresentar um controle de upload `<input type="file" accept="image/*" capture="environment">` que permita ao operador tirar uma foto pela câmera traseira ou selecionar uma imagem da galeria, conforme Component 1 do design.
2. WHEN o operador seleciona uma imagem antes de enviar, THE Mobile_UI SHALL comprimir a imagem no cliente usando `browser-image-compression` com `initialQuality = 0.85`, `maxWidthOrHeight = 2048`, `fileType = 'image/jpeg'` e `maxSizeMB = 4`, conforme seção "Example Usage — Cliente — Stage 1".
3. WHEN o operador submete o formulário inicial, THE Mobile_UI SHALL enviar um `POST /api/jobs` com `multipart/form-data` contendo os campos `image` (JPG comprimido), `widthMm`, `heightMm` e `prompt`.
4. IF qualquer um dos campos `image`, `widthMm`, `heightMm` ou `prompt` está ausente, vazio ou inválido, THEN THE API SHALL responder com HTTP 400 sem criar linha em `jobs` e sem efeitos colaterais no filesystem.
5. IF `widthMm` ou `heightMm` não é inteiro positivo, THEN THE API SHALL responder com HTTP 400, conforme Cenário 6 do Error Handling.
6. IF o tamanho do upload excede 10 MB, THEN THE API SHALL rejeitar a requisição com HTTP 400, conforme seção "Security Considerations".
7. WHEN um `POST /api/jobs` válido é recebido, THE API SHALL gerar um `jobId` UUID v4, executar `insertJob` com `status = 'created'` e salvar `original.jpg` em `./storage/jobs/{jobId}/original.jpg`, conforme pseudocódigo de Stage 1+2.

### Requirement 2: Geração inicial via image-to-image (Stage 2)

**User Story:** Como operador, eu quero que, após o upload, o sistema gere automaticamente a primeira proposta de arte a partir da minha foto e do prompt, para que eu já tenha algo visual para discutir com o cliente.

#### Acceptance Criteria

1. WHEN o `original.jpg` foi salvo com sucesso e o status corrente é `created`, THE API SHALL chamar `transitionStatus(jobId, ['created'], 'iterating')` antes de iniciar a geração.
2. WHEN a transição para `iterating` retorna `true`, THE API SHALL chamar `generateImageToImage({ baseImage, prompt })` do wrapper `lib/openai.ts`, usando o modelo `gpt-image-1`, conforme Component 5 do design.
3. WHEN a geração inicial retorna um PNG, THE Storage SHALL salvar o arquivo em `./storage/jobs/{jobId}/iterations/1.png` antes de qualquer atualização adicional do banco.
4. WHEN `iterations/1.png` foi persistido, THE Database SHALL atualizar o job com `current_iteration = 1`.
5. WHEN a Stage 2 conclui sem erro, THE API SHALL responder com HTTP 200 e corpo `{ jobId, iteration: 1 }`.
6. IF a chamada ao `gpt-image-1` lança erro (rede, rate, conteúdo) durante Stage 2, THEN THE API SHALL atualizar o job para `status = 'error'` com `error_message` populado e responder com HTTP 500, conforme Cenário 1 do Error Handling.

### Requirement 3: Loop de refinamento iterativo (Stage 3)

**User Story:** Como operador, eu quero ajustar a arte gerada enviando novos prompts e opcionalmente novas fotos, para que eu possa refinar a peça em frente ao cliente até que esteja boa.

#### Acceptance Criteria

1. THE API SHALL expor o endpoint `POST /api/jobs/:id/iterate` que aceita `multipart/form-data` com `prompt` obrigatório e `image` opcional, conforme seção "API Contracts".
2. IF o status corrente do job é diferente de `iterating`, THEN THE API SHALL responder com HTTP 409 Conflict sem efeitos colaterais.
3. IF o campo `prompt` da requisição de iteração é vazio, THEN THE API SHALL responder com HTTP 400 sem efeitos colaterais.
4. WHEN a requisição de iteração inclui um campo `image`, THE API SHALL usar essa imagem como `baseImage` da chamada a `generateImageToImage`.
5. WHEN a requisição de iteração não inclui um campo `image`, THE API SHALL ler `iterations/{current_iteration}.png` do Storage e usar esse buffer como `baseImage`.
6. WHEN uma iteração conclui com sucesso, THE Storage SHALL persistir o PNG resultante em `iterations/{current_iteration + 1}.png`.
7. WHEN o PNG da nova iteração foi persistido, THE Database SHALL atualizar `current_iteration` somando exatamente 1 ao valor anterior.
8. WHEN a iteração conclui sem erro, THE API SHALL responder com HTTP 200 e corpo `{ iteration: <novo número> }`.
9. WHILE o status do job é `iterating`, THE API SHALL aceitar múltiplas chamadas sucessivas a `POST /iterate` sem alterar o status para nenhum outro valor.
10. THE API SHALL expor o endpoint `GET /api/jobs/:id/iterations/:n` que faz stream do PNG correspondente em `iterations/{n}.png` com `Content-Type: image/png`, retornando HTTP 404 se o job ou o arquivo não existem; este endpoint é read-only e NÃO dispara transições de estado, conforme seção "API Contracts" do design.

### Requirement 4: Primeira aprovação e transição para processamento (Stage 3 → Stage 4)

**User Story:** Como operador, eu quero aprovar a iteração corrente como arte definitiva, para que o sistema avance para a fase de processamento (extração de layout e regeneração sem texto).

#### Acceptance Criteria

1. THE API SHALL expor o endpoint `POST /api/jobs/:id/approve` com corpo vazio, conforme seção "API Contracts".
2. WHEN um `POST /approve` é recebido, THE API SHALL chamar `transitionStatus(jobId, ['iterating'], 'processing_step4')` como guarda de idempotência antes de qualquer ação subsequente.
3. WHEN a transição para `processing_step4` retorna `true`, THE API SHALL responder imediatamente com HTTP 202 e corpo `{ status: 'processing_step4' }` e disparar a Stage 4 em background (fire-and-forget no mesmo processo Node), copiando `iterations/{current_iteration}.png` para `approved.png` antes da execução paralela 4A/4B.
4. IF `transitionStatus` retorna `false` e o status corrente é `processing_step4`, `preview_ready` ou `pdf_ready`, THEN THE API SHALL responder com HTTP 202 contendo o status corrente, sem reexecutar Stage 4.
5. IF `transitionStatus` retorna `false` e o status corrente não está em `['processing_step4', 'preview_ready', 'pdf_ready']`, THEN THE API SHALL responder com HTTP 409 Conflict.
6. IF a Stage 4 em background lança erro não tratado, THEN THE API SHALL atualizar o job para `status = 'error'` com `error_message` populado; o operador observa essa transição via polling de `/status` (P4).

### Requirement 5: Extração de layout via GPT-4o Vision (Stage 4A)

**User Story:** Como sistema, eu preciso extrair os elementos de texto da arte aprovada (conteúdo, bounding box, cor, peso, alinhamento) em formato JSON estruturado, para que esses textos possam ser reposicionados sobre o background sem texto na fase de montagem do layout.

#### Acceptance Criteria

1. WHEN a Stage 4 inicia, THE API SHALL chamar `extractLayoutVision({ image: approved })` do wrapper `lib/openai.ts` em paralelo com a Stage 4B, conforme diagrama "Stage 4 — Vision + Text-Free Regeneration".
2. WHEN a resposta crua do Vision é recebida, THE API SHALL validá-la contra `VisionResponseSchema` (zod), que exige `imageWidthPx > 0`, `imageHeightPx > 0` e, para cada `textElement`, `content` não vazio, `bboxPx` com `x ≥ 0`, `y ≥ 0`, `width > 0`, `height > 0`, `color` string, `fontWeight` inteiro entre 100 e 900 e `align ∈ {'left','center','right'}`.
3. IF a validação zod falha na primeira tentativa, THEN THE API SHALL executar exatamente uma nova chamada a `extractLayoutVision` (1 retry) antes de declarar falha, conforme `extractLayoutVisionWithRetry(approved, maxRetries = 1)`.
4. IF a validação zod falha após o único retry permitido, THEN THE API SHALL atualizar o job para `status = 'error'` com `error_message = 'vision_validation_failed'`, conforme Cenário 2 do Error Handling.
5. WHEN o JSON do Vision passa pela validação zod, THE Storage SHALL persistir a resposta crua em `vision.json` para auditoria.

### Requirement 6: Regeneração sem texto (Stage 4B)

**User Story:** Como sistema, eu preciso obter uma versão da arte aprovada totalmente livre de textos, para que o background do layout final possa ser composto puramente por imagem, com os textos reposicionados por cima via HTML.

#### Acceptance Criteria

1. WHEN a Stage 4 inicia, THE API SHALL chamar `regenerateWithoutText({ baseImage: approved, originalPrompt: job.initial_prompt })` em paralelo com a Stage 4A, conforme diagrama "Stage 4".
2. THE OpenAI_Image SHALL ser invocado pelo wrapper com um prompt rígido instruindo a remoção de todo e qualquer texto da imagem, sem uso de máscara e sem inpainting, conforme Component 5 do design.
3. WHEN a regeneração sem texto retorna um PNG, THE Storage SHALL persistir o arquivo em `clean.png`.
4. IF a chamada a `regenerateWithoutText` lança erro, THEN THE API SHALL atualizar o job para `status = 'error'` com `error_message` populado.

### Requirement 7: Normalização do Vision em LayoutInput

**User Story:** Como sistema, eu preciso converter a resposta validada do Vision em um `LayoutInput` com posições e tamanhos em milímetros, ancorado às dimensões físicas do canvas, para que o Layout Renderer possa produzir HTML coerente com a peça impressa.

#### Acceptance Criteria

1. WHEN a resposta do Vision foi validada e o `clean.png` foi salvo, THE Vision_Normalizer SHALL executar `normalizeVisionResponse({ raw, imageWidthPx, imageHeightPx, canvasWidthMm: job.width_mm, canvasHeightMm: job.height_mm, backgroundDataUrl })`.
2. THE Vision_Normalizer SHALL calcular `sx = canvasWidthMm / imageWidthPx` e `sy = canvasHeightMm / imageHeightPx` e aplicar essa escala a cada `bboxPx` para produzir `position` e `size` em mm.
3. THE Vision_Normalizer SHALL fazer clamp de cada `position.xMm` no intervalo `[0, canvasWidthMm]` e cada `position.yMm` no intervalo `[0, canvasHeightMm]`.
4. THE Vision_Normalizer SHALL fazer clamp de cada `size.widthMm` no intervalo `[0, canvasWidthMm]` e cada `size.heightMm` no intervalo `[0, canvasHeightMm]`.
5. THE Vision_Normalizer SHALL atribuir `id = 't{i}'` a cada elemento, com `i` sendo o índice (0-based) na lista original, garantindo unicidade.
6. THE Vision_Normalizer SHALL preservar a quantidade de elementos: o `LayoutInput` resultante terá `textElements.length === raw.textElements.length`.
7. THE Vision_Normalizer SHALL definir `typography.fontFamily = 'Inter, sans-serif'` para todos os elementos.
8. WHEN o `LayoutInput` é produzido com sucesso, THE Storage SHALL persistir uma versão em `layout.json` com `background.dataUrl = '__deferred__'` (sem o conteúdo base64) e THE Database SHALL gravar a mesma estrutura serializada em `layout_json` no job, conforme Stage 4 pseudocódigo.
9. WHEN o `layout.json` está persistido, THE API SHALL chamar `transitionStatus(jobId, ['processing_step4'], 'preview_ready')` para concluir a Stage 4.

### Requirement 8: Layout Renderer como única fonte da verdade do HTML (Stage 5)

**User Story:** Como arquiteto do sistema, eu quero que o HTML do preview e o HTML usado para gerar o PDF sejam produzidos pelo mesmo módulo puro `renderLayoutHTML`, para que exista paridade pixel-a-mm entre o que o operador aprova e o arquivo entregue.

#### Acceptance Criteria

1. THE Layout_Renderer SHALL ser implementado em `lib/layout/render.ts` e exportar exclusivamente a função `renderLayoutHTML(input: LayoutInput): string`, conforme Component 6 do design.
2. THE Layout_Renderer SHALL ser síncrono, sem chamadas de I/O, sem leitura do filesystem, sem `Date.now()`, sem `Math.random()` e sem mutação do argumento `input`.
3. THE Layout_Renderer SHALL produzir saída determinística: para qualquer `input` válido, duas invocações sucessivas SHALL retornar strings byte-a-byte idênticas (Property P1).
4. THE Layout_Renderer SHALL ser importável tanto pelo cliente (`app/page.tsx`) quanto pelo servidor (rotas em `app/api/jobs/...`), sem dependências de módulos Node-only como `fs` ou `path`, conforme Component 6 — Constraints.
5. THE Layout_Renderer SHALL gerar um documento HTML completo iniciando com `<!DOCTYPE html>` e contendo `<html>`, `<head>` com `<meta charset="utf-8">` e `<style>`, e `<body>`.
6. THE Layout_Renderer SHALL incluir no `<style>` exatamente uma regra `@page { size: {W}mm {H}mm; margin: 0 }` onde `{W}` e `{H}` correspondem a `input.canvas.widthMm` e `input.canvas.heightMm` (Property P7).
7. THE Layout_Renderer SHALL incluir no `<style>` exatamente uma declaração `@font-face` para `Inter` com `src: url(data:font/woff2;base64,...)` apontando para a constante `INTER_VARIABLE_BASE64` definida em `lib/layout/fonts.ts` (Property P6).
8. THE Layout_Renderer SHALL renderizar o background como um único elemento `<img class="bg">` filho de `.canvas`, com `position: absolute; left:0; top:0; width:100%; height:100%; object-fit: fill` e `src = input.background.dataUrl`.
9. THE Layout_Renderer SHALL renderizar cada elemento de `input.textElements` como um `<div class="text">` filho de `.canvas`, na ordem original do array, com `left/top/width/height` em mm e `font-size`, `font-weight`, `color`, `text-align`, `justify-content` aplicados via atributo `style` inline.
10. THE Layout_Renderer SHALL escapar os caracteres `<`, `>`, `&`, `"`, `'` em `t.content` e em `t.id` ao serializá-los no HTML, garantindo ausência de injeção (Property P9).
11. THE Layout_Renderer SHALL definir o container raiz `.canvas` com `position: relative`, `width: {W}mm`, `height: {H}mm` e `overflow: hidden`.

### Requirement 9: Endpoint de preview HTML

**User Story:** Como cliente da API, eu quero obter o HTML completo do preview a partir do job, para que eu possa exibi-lo em um iframe sem precisar montar o documento manualmente.

#### Acceptance Criteria

1. THE API SHALL expor o endpoint `GET /api/jobs/:id/preview-html`, conforme seção "API Contracts".
2. IF o status corrente do job não é `preview_ready` nem `pdf_ready`, THEN THE API SHALL responder com HTTP 409 Conflict.
3. IF o job não existe, THEN THE API SHALL responder com HTTP 404.
4. WHEN o status do job é `preview_ready` ou `pdf_ready`, THE API SHALL ler `clean.png` do Storage e codificá-lo em `data:image/png;base64,...` para hidratar `background.dataUrl` no `LayoutInput` antes de chamar `renderLayoutHTML`.
5. WHEN o `LayoutInput` está hidratado, THE API SHALL invocar `renderLayoutHTML(layoutInput)` e responder com HTTP 200, `Content-Type: text/html; charset=utf-8` e o corpo igual ao retorno da função.
6. IF `clean.png` está ausente no momento do preview, THEN THE API SHALL responder com HTTP 500, conforme Cenário 5 do Error Handling.

### Requirement 10: Renderização do preview e segunda aprovação (Stage 6)

**User Story:** Como operador, eu quero ver o layout final em escala dentro do meu celular antes de gerar o PDF, para que eu possa aprovar a peça final tendo certeza visual do resultado.

#### Acceptance Criteria

1. WHILE o status do job é `processing_step4`, THE Mobile_UI SHALL fazer polling de `GET /api/jobs/:id/status` em intervalos de aproximadamente 1500 ms até observar `status = 'preview_ready'`, conforme exemplo "Cliente — polling de status".
2. WHEN o status do job atinge `preview_ready`, THE Mobile_UI SHALL renderizar um `<iframe>` consumindo `GET /api/jobs/:id/preview-html`.
3. THE Mobile_UI SHALL aplicar ao iframe um wrapper com `transform: scale(s)` em que `s = min(containerWidth / mmToPx(widthMm), containerHeight / mmToPx(heightMm))`, conforme exemplo "Cliente — preview com transform de scale".
4. WHEN a janela do navegador dispara o evento `resize`, THE Mobile_UI SHALL recalcular o `scale` e aplicá-lo ao wrapper do iframe.
5. THE Mobile_UI SHALL NOT exibir um botão "voltar" na tela de preview.
6. THE Mobile_UI SHALL NOT oferecer nenhum mecanismo de edição manual do layout na tela de preview.
7. WHEN o operador aciona o botão "approve" na tela de preview, THE Mobile_UI SHALL enviar `POST /api/jobs/:id/render-pdf`.

### Requirement 11: Geração de PDF via Playwright (Stage 7)

**User Story:** Como operador, eu quero baixar o PDF final com as dimensões físicas exatas da peça impressa, para que eu possa enviar o arquivo direto para a impressão.

#### Acceptance Criteria

1. THE API SHALL expor o endpoint `POST /api/jobs/:id/render-pdf` com corpo vazio.
2. WHEN um `POST /render-pdf` é recebido, THE API SHALL chamar `transitionStatus(jobId, ['preview_ready'], 'rendering_pdf')` como guarda de idempotência antes de iniciar a renderização.
3. IF `transitionStatus` retorna `false` e o status corrente é `rendering_pdf`, THEN THE API SHALL responder com HTTP 202 contendo `{ status: 'rendering_pdf' }`, sem reexecutar Playwright (idempotência durante processamento).
4. IF `transitionStatus` retorna `false` e o status corrente é `pdf_ready`, THEN THE API SHALL responder com HTTP 200 contendo o `pdfPath` existente, sem reexecutar Playwright.
5. IF `transitionStatus` retorna `false` e o status corrente não é `preview_ready`, `rendering_pdf` nem `pdf_ready`, THEN THE API SHALL responder com HTTP 409 Conflict.
6. WHEN a transição para `rendering_pdf` é bem-sucedida, THE PDF_Renderer SHALL invocar `renderLayoutHTML(layoutInput)` para obter o mesmo HTML usado pelo preview.
7. THE PDF_Renderer SHALL chamar `chromium.launch({ headless: true })` por job, sem reaproveitamento de browser entre jobs (sem pool no MVP 1).
8. WHEN a página headless é aberta, THE PDF_Renderer SHALL chamar `page.setContent(html, { waitUntil: 'load' })` antes de qualquer outra interação.
9. WHEN o conteúdo é setado, THE PDF_Renderer SHALL aguardar `document.fonts.ready` via `page.evaluate(() => document.fonts.ready)` ANTES de invocar `page.pdf` (Property P10).
10. THE PDF_Renderer SHALL invocar `page.pdf({ width: '{W}mm', height: '{H}mm', printBackground: true, preferCSSPageSize: true })` onde `{W}` e `{H}` correspondem ao canvas do `LayoutInput`.
11. WHEN o PDF é retornado pelo Playwright, THE Storage SHALL persistir o buffer em `final.pdf`.
12. WHEN o PDF está persistido, THE PDF_Renderer SHALL fechar o browser via `browser.close()` em bloco `finally` antes de a rota retornar.
13. WHEN o `final.pdf` está salvo, THE Database SHALL atualizar o status do job para `pdf_ready`.
14. WHEN a Stage 7 conclui sem erro, THE API SHALL responder com HTTP 200 e corpo `{ pdfPath: <caminho interno servido por GET /api/jobs/:id/pdf> }`.
15. THE API SHALL expor `GET /api/jobs/:id/pdf` que faz stream de `final.pdf` com `Content-Type: application/pdf` e `Content-Disposition: attachment`.
16. IF Playwright lança erro durante `chromium.launch` ou `page.pdf`, THEN THE API SHALL atualizar o job para `status = 'error'` e responder com HTTP 500, garantindo que o browser seja fechado no `finally`, conforme Cenário 4 do Error Handling.

### Requirement 12: Máquina de estados do job e transições atômicas

**User Story:** Como operador da plataforma, eu quero que o ciclo de vida do job seja governado por uma máquina de estados explícita e linear, para que duplicações de cliques ou requisições concorrentes não corrompam o estado nem disparem efeitos colaterais redundantes.

#### Acceptance Criteria

1. THE Database SHALL persistir o `status` do job como uma das strings: `created`, `iterating`, `processing_step4`, `preview_ready`, `rendering_pdf`, `pdf_ready`, `error`, conforme `CHECK` constraint da tabela `jobs`.
2. THE Database SHALL implementar `transitionStatus(id, from, to): boolean` como um único `UPDATE jobs SET status = ? WHERE id = ? AND status IN (?...)` que retorna `true` se e somente se exatamente 1 linha foi afetada.
3. WHEN duas chamadas concorrentes invocam `transitionStatus(id, from, to)` para a mesma transição, THE Database SHALL garantir que exatamente uma das chamadas retorna `true` e a outra retorna `false` (Property P3).
4. THE API SHALL aceitar transições apenas conforme a tabela "Transições válidas" do design: `created → iterating`, `iterating → iterating`, `iterating → processing_step4`, `processing_step4 → preview_ready`, `preview_ready → rendering_pdf`, `rendering_pdf → pdf_ready` e qualquer estado pré-terminal → `error`.
5. IF um endpoint de transição é chamado a partir de um status que não está em sua lista `from` permitida, THEN THE API SHALL responder com HTTP 409 Conflict (com exceção das chamadas no-op idempotentes definidas nos requisitos 4 e 11).
6. THE Database SHALL aplicar na inicialização os PRAGMAs `journal_mode = WAL`, `synchronous = NORMAL` e `foreign_keys = ON`, conforme seção "Data Models — SQL Schema".

### Requirement 13: Endpoint de polling de status

**User Story:** Como cliente mobile, eu quero consultar o status corrente do job em tempo real, para que eu possa avançar a UI sem manter conexões abertas.

#### Acceptance Criteria

1. THE API SHALL expor o endpoint `GET /api/jobs/:id/status` como rota somente-leitura, conforme seção "API Contracts".
2. WHEN um `GET /status` é recebido para um job existente, THE API SHALL responder com HTTP 200 e corpo `{ status: JobStatus, currentIteration: number, errorMessage: string | null }`.
3. IF o `jobId` não existe, THEN THE API SHALL responder com HTTP 404.
4. THE API SHALL aceitar `GET /status` em qualquer status do job, sem disparar transições.
5. THE Mobile_UI SHALL fazer polling de `/status` em intervalos de aproximadamente 1500 ms enquanto o status indicar processamento assíncrono em curso (`processing_step4`, `rendering_pdf`).
6. THE sequência de status observada por um cliente que faz polling SHALL ser monotônica dentro do conjunto válido, sem regressão para um status anterior, exceto a transição final para `error` (Property P4).

### Requirement 14: Tratamento de erros e estado de falha

**User Story:** Como operador, eu quero que falhas em qualquer estágio levem o job a um estado de erro explícito com mensagem associada, para que eu possa identificar o problema e iniciar um novo job sem ambiguidade.

#### Acceptance Criteria

1. WHEN qualquer estágio assíncrono lança um erro não tratado, THE API SHALL atualizar o job para `status = 'error'` e popular `error_message` com a representação textual do erro.
2. THE API SHALL retornar HTTP 500 quando um estágio **síncrono** (handlers de `POST /api/jobs`, `POST /iterate`, `POST /render-pdf`) transicionou o job para `error`. Para a Stage 4, que roda em background após o handler `POST /approve` já ter respondido 202, a transição para `error` é refletida na coluna `status` do job e observada pelo cliente via polling de `GET /status`, conforme Requisito 4.6 e Property P4 — sem HTTP 500.
3. THE API SHALL executar exatamente um retry da chamada a `extractLayoutVision` quando a primeira resposta falhar a validação zod, conforme Requisito 5 e Cenário 2 do Error Handling.
4. THE API SHALL NOT executar retries automáticos para falhas do Playwright nem para falhas de `gpt-image-1`; o operador SHALL recriar o job para tentar novamente, conforme Cenário 4 do Error Handling.
5. IF o operador faz double-click em "approve" e o segundo disparo encontra status já em `processing_step4`, `preview_ready` ou `pdf_ready`, THEN THE API SHALL responder HTTP 202 no-op com o status corrente, sem reexecutar Stage 4, conforme Cenário 3 do Error Handling.
6. WHEN o status é `error`, THE Mobile_UI SHALL exibir a `error_message` ao operador e oferecer a opção de iniciar um novo job.

### Requirement 15: Camada de Storage no filesystem

**User Story:** Como desenvolvedor, eu quero que toda persistência de arquivos passe por uma interface `Storage` estável, para que possamos trocar a implementação local por S3 no futuro sem alterar os callers.

#### Acceptance Criteria

1. THE Storage SHALL expor a interface definida em `lib/storage.ts` com os métodos `saveBytes`, `readBytes`, `saveJson`, `readJson`, `exists` e `pathFor`, conforme Component 4 do design.
2. THE Storage SHALL organizar os arquivos por job em `./storage/jobs/{jobId}/` com a seguinte estrutura: `original.jpg`, `iterations/{n}.png`, `approved.png`, `clean.png`, `vision.json`, `layout.json`, `final.pdf`, conforme seção "Storage Layout".
3. THE Storage SHALL construir paths usando `path.join` e SHALL validar que `jobId` corresponde ao formato UUID v4 antes de tocar no filesystem, conforme seção "Security Considerations".
4. IF um caller tenta usar um `jobId` que não passa na validação UUID v4, THEN THE Storage SHALL rejeitar a operação sem acessar o filesystem.
5. THE Storage SHALL persistir `layout.json` com `background.dataUrl = '__deferred__'`, deixando a re-hidratação para runtime via leitura de `clean.png`, conforme Requisito 7.8.
6. THE Storage SHALL ser o único módulo a manipular paths absolutos do filesystem; rotas e wrappers SHALL acessar arquivos exclusivamente via essa interface.

### Requirement 16: Propriedades de correção como alvos de testabilidade

**User Story:** Como engenheiro de qualidade, eu quero que as propriedades formais P1–P10 do design sejam tratadas como requisitos verificáveis, para que possamos cobri-las com testes unitários e property-based testing usando `fast-check`.

#### Acceptance Criteria

1. FOR ALL `LayoutInput input`, THE Layout_Renderer SHALL satisfazer `renderLayoutHTML(input) === renderLayoutHTML(input)` (P1 — Determinismo).
2. FOR ALL `LayoutInput input`, THE Layout_Renderer SHALL preservar `input` por deep equality antes e depois da chamada e SHALL NOT realizar I/O (P2 — Pureza).
3. FOR ALL `jobId` e qualquer transição crítica `from → to`, duas invocações concorrentes de `transitionStatus(jobId, [from], to)` SHALL produzir exatamente um `true` e um `false` (P3 — Idempotência).
4. FOR ALL sequência de status observada por um cliente que faz polling, a sequência SHALL ser monotônica no grafo válido, exceto para a transição terminal a `error` (P4 — Consistência do polling state machine).
5. FOR ALL job com `clean.png` existente, o `data:image/png;base64,...` extraído do HTML retornado por `renderLayoutHTML` SHALL ser byte-equivalente ao conteúdo de `clean.png` após `base64Decode`, isto é: `base64Decode(stripDataUrlPrefix(extractBackgroundSrc(html))) === readBytes('clean.png')` (P5 — Integridade do background).
6. FOR ALL HTML retornado por `renderLayoutHTML`, o documento SHALL conter exatamente uma `@font-face` para `Inter` com `src: url(data:font/woff2;base64,...)` apontando para a constante `INTER_VARIABLE_BASE64` de `lib/layout/fonts.ts`; a integridade binária do payload base64 SHALL ser verificada como teste de constante (decodificação válida iniciando com o magic number WOFF2 `wOF2`), não como propriedade do renderer (P6 — Integridade da fonte).
7. FOR ALL `LayoutInput` com `canvas { widthMm: W, heightMm: H }`, o HTML retornado SHALL conter `@page { size: W mm H mm; margin: 0 }` e o container `.canvas` SHALL ter `width: W mm; height: H mm`; adicionalmente, o `page.pdf` SHALL ser invocado com `width: '${W}mm', height: '${H}mm'` (P7 — Estabilidade dimensional).
8. FOR ALL `VisionResponse` válido e qualquer canvas `{W, H}` em mm, o resultado de `normalizeVisionResponse` SHALL satisfazer, para todo `t ∈ textElements`: `0 ≤ t.position.xMm ≤ W`, `0 ≤ t.position.yMm ≤ H`, `t.position.xMm + t.size.widthMm ≤ W` e `t.position.yMm + t.size.heightMm ≤ H` (P8 — Bounds das bboxes).
9. FOR ALL `text element` cujo `content` contém qualquer um dos caracteres `<`, `>`, `&`, `"`, `'`, o HTML retornado por `renderLayoutHTML` SHALL NOT conter esses caracteres como literais fora de contextos válidos (atributos style, etc.); para verificação, o `<div class="text" data-id="${id}">` correspondente é localizado por regex ancorada no `data-id` único, e suas entidades HTML (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#x27;`) decodificadas devem ser iguais ao `t.content` original (P9 — HTML escape).
10. THE PDF_Renderer SHALL chamar `document.fonts.ready` antes de qualquer chamada a `page.pdf` no mesmo contexto de página (P10 — Playwright fonts.ready antes de page.pdf).

