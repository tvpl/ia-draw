# Architecture Canvas Tasks — Onda 2c: F1 Assets, Snapshots, Export e Backup

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/architecture-canvas/design.md`
**Status**: Draft

**Escopo desta onda:** terceira e última sub-onda de F1 — fecha a Fase de entrega F1 por inteiro. Cobre EDT-06 (upload de imagem confirmado antes do ACK), a história "P1: Snapshots, histórico, diff e restore" (VER-01..04), "P1: Export e salvamento local" (EXP-01..04, finalizando o spike de T10/F0) e "P1: Backup com restore testado" (OPS-01..05). Depende de `apps/server/src/modules/diagram-sync` (onda F1b) e `apps/server/src/modules/render` (spike T10/F0) já existirem.

**Fundação nova nesta onda:** nenhum job assíncrono (pg-boss, AD-006) nem cliente MinIO real foram construídos ainda em nenhuma onda anterior — T27/T28 constroem essa base compartilhada primeiro.

---

## Test Coverage Matrix

> Reaproveitada das ondas anteriores.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Domínio (`packages/*`) | unit | Todos os branches; 1:1 com ACs; edge cases cobertos | `packages/*/src/**/*.spec.ts` | `pnpm -w test:unit` |
| Módulos/rotas do server (`apps/server/src/modules/*`) | unit + integration (PGlite + MinIO real via container quando disponível, mock de S3 quando não) | Toda rota: happy + edge + error; idempotência e authz contra store real | `apps/server/src/**/*.spec.ts`, `apps/server/**/*.int.spec.ts` | `pnpm -w test:unit` / `pnpm -w test:integration` |
| Scripts de infra (`infra/backup/*`) | integration (quando executável no ambiente) / none (quando exige Docker ausente, documentar) | Comandos documentados e testáveis onde possível | `infra/backup/**/*.spec.ts` ou `none` | `pnpm -w test:integration` / build gate |

## Gate Check Commands

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Tasks com testes unit apenas | `pnpm -w test:unit` |
| Full | Tasks com testes integration | `pnpm -w test:unit && pnpm -w test:integration` |
| Build | Última task de cada batch (T31 fecha o Batch 1; T36 fecha o Batch 2 e a onda) — inclui lint/typecheck/build, não só os testes | `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` |

---

## Execution Plan

### Phase 11: Storage e filas — fundação compartilhada

```
T27
T28
```

### Phase 12: Assets (EDT-06)

```
T27 -> T29
```

### Phase 13: Snapshots, restore e diff

```
T20 -> T30 -> T31
T28 -> T30
```

### Phase 14: Export completo

```
T27 -> T32 -> T33
T28 -> T33
```

### Phase 15: Backup, DR e observabilidade

```
T27 -> T34 -> T35
T36
```

(`T20` referencia a task de schema `diagram_operations`/`diagram_snapshots` já entregue na onda F1b.)

---

## Task Breakdown

### Phase 11 — Storage e filas — fundação compartilhada

### T27: apps/server — cliente MinIO/S3 e helpers de URL assinada

**What**: Em `apps/server/src/core/` (ou um novo `apps/server/src/modules/storage/`, sua escolha — mantenha coeso): cliente S3-compatible (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, compatível com MinIO) configurado a partir de `loadConfig` (endpoint, credenciais, buckets `assets`/`exports`/`backups` já criados por `minio-init` na onda F0/T6). Helpers: `putSignedUrl(bucket, key, contentType, ttl)`, `getSignedUrl(bucket, key, ttl)`, `headObject(bucket, key)` (para confirmar upload concluído), `putObject`/`getObject` diretos (para o servidor gravar objetos ele mesmo, ex. exports).
**Where**: `apps/server/src/modules/storage/`
**Depends on**: None (usa a config já validada por T3/F0)
**Reuses**: `loadConfig` (T3), buckets definidos em `infra/compose` (T6)
**Requirement**: EXP-01 (pré-requisito)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] URL assinada de PUT gerada é válida por até o TTL configurado (teste contra um MinIO real se disponível no ambiente de execução; caso contrário, mock do SDK documentando explicitamente a limitação, igual ao padrão de honestidade de T6/F0)
- [ ] `headObject` distingue objeto existente de inexistente
- [ ] Gate check passes: `pnpm -w test:unit` (mínimo) — se um MinIO real estiver disponível no ambiente do worker, promova para `pnpm -w test:unit && pnpm -w test:integration` e documente a diferença
- [ ] Se este ambiente de execução não tiver acesso a um MinIO real (nem local nem via container), documente isso explicitamente no commit e nas notas — não simule sucesso não observado

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): add s3-compatible storage client and signed url helpers`

**Status**: ✅ Complete — `apps/server/src/modules/storage/` (`client.ts`, `signedUrl.ts`, `index.ts`) wraps `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, configured from `loadConfig`'s new `s3` block (`S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_REGION`, `apps/server/src/core/config.ts`). No real MinIO is reachable in this sandbox (no Docker daemon — AD-007); `putSignedUrl`/`getSignedUrl` are exercised for real against the SDK's local SigV4 presigner (no network call — confirmed by reading the installed package), asserting `X-Amz-Expires` matches the requested TTL exactly. `headObject`/`putObject`/`getObject` mock `S3Client.send` at the SDK boundary, documented in `signedUrl.spec.ts` and `index.ts`. `pnpm -w test:unit`: 62/62 passed in `apps/server` (workspace total unaffected elsewhere).

---

### T28: apps/server — fila de jobs pg-boss

**What**: Wiring de `pg-boss` (AD-006 — jobs sobre PostgreSQL, sem Redis) em `apps/server/src/modules/jobs/`: `startJobs(config)` inicializa o pg-boss sobre a mesma conexão Postgres; `defineJob(name, handler)` registra um worker; `enqueue(name, payload)` publica. Integrado ao graceful shutdown de T3 (drena jobs em andamento antes de sair, completando o clausula "jobs" de FND-05 que ficou pendente em F0).
**Where**: `apps/server/src/modules/jobs/`
**Depends on**: None (usa a mesma conexão Postgres de `packages/database`)
**Reuses**: `packages/database` (conexão), `registerGracefulShutdown` de T3
**Requirement**: FND-05 (fecha a cláusula de jobs deixada pendente na verificação de F0)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Um job enfileirado é executado pelo handler registrado (teste de integração via PGlite ou Postgres real, conforme AD-007)
- [ ] Shutdown gracioso aguarda jobs em andamento (com timeout configurável) antes de finalizar o processo
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add pg-boss job queue wired into graceful shutdown`

**Status**: ✅ Complete — `apps/server/src/modules/jobs/` (`queue.ts`: `startJobs`/`defineJob`/`enqueue`; `shutdown.ts`: `registerJobsGracefulShutdown`, mirrors T3's `registerGracefulShutdown` pattern) wraps `pg-boss` 12.27.0 over the app's Postgres connection (AD-006). Genuinely real integration test, not mocked: pg-boss ships a first-class `fromPglite` adapter + `backend: 'pglite'` profile, so `queue.int.spec.ts` runs real pg-boss code — real job persistence, polling, and `stop({graceful:true, timeout})` draining — against a real embedded Postgres engine (unlike T27's MinIO, PGlite has no gap here). Confirms a job survives enqueue→handler dispatch, exactly-once delivery, graceful shutdown waiting for an in-flight job to finish, and the configurable timeout cutting off a job that outlives it (`elapsed < 2500ms` while the job itself runs 3000ms). `pnpm -w test:unit && pnpm -w test:integration`: 65 unit / 122 integration passed, all green.

---

### Phase 12 — Assets (EDT-06)

### T29: apps/server — módulo asset (upload em duas fases, EDT-06)

**What**: Em `apps/server/src/modules/asset/`: `POST /diagrams/{id}/assets:initiate` (valida MIME allowlist e tamanho máximo, retorna URL assinada de T27 + `assetId` com `status=pending`), `POST /diagrams/{id}/assets/{assetId}:complete` (servidor faz `headObject` para confirmar que o upload realmente aconteceu, calcula/verifica SHA-256, dedup por checksum dentro do workspace, sanitiza SVG via `isomorphic-dompurify` com profile restrito quando o MIME for `image/svg+xml`, marca `status=ready`). **Invariante crítico (EDT-06)**: modifique `POST /diagrams/{id}/operations:batch` (T22, onda F1b) para rejeitar qualquer delta cujo elemento referencie um `assetId` que não esteja com `status=ready` — um elemento de imagem nunca é ACKado com referência quebrada.
**Where**: `apps/server/src/modules/asset/` (+ modificação pontual em `apps/server/src/modules/diagram-sync/`)
**Depends on**: T27
**Reuses**: storage (T27), RBAC/auth (onda F1a), `operations:batch` existente (onda F1b — modificação cirúrgica, não reescrita)
**Requirement**: EDT-06

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Upload completo com checksum válido marca o asset `ready`
- [ ] `operations:batch` com delta referenciando asset `pending`/inexistente é rejeitado (nunca ACKado)
- [ ] SVG malicioso (com `<script>`) é sanitizado ou rejeitado antes de `ready`
- [ ] Dois uploads com o mesmo SHA-256 no mesmo workspace deduplicam (segundo upload aponta para o mesmo objeto)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add two-phase asset upload with checksum dedup and svg sanitization`

**Status**: ✅ Complete — `apps/server/src/modules/asset/` (`assets.ts` DB access, `sanitizeSvg.ts` DOMPurify SVG profile, `assertAssetsReady.ts` the EDT-06 check, `routes.ts` `assets:initiate`/`assets/{assetId}:complete`). Excalidraw's own `fileId` field on `type: 'image'` elements is bound directly to `diagram_assets.id` (no extra indirection table) — documented in `assertAssetsReady.ts`. Surgical addition to `apps/server/src/modules/diagram-sync/routes.ts`'s `operations:batch` (T22): calls `assertDeltaAssetsReady` before persisting, throwing 409 for any pending/nonexistent referenced asset — new tests added to the existing `operations-batch.int.spec.ts` (never persisted, `rows` stay empty). Wired into `registerAllModules` (`apps/server/src/core/registerModules.ts`, now builds a real `StorageClient` from config, injectable for tests); `registerModules.int.spec.ts` extended to prove the route is reachable (401 without a session, not 404). `pnpm -w test:unit && pnpm -w test:integration`: 71 unit / 136 integration passed, all green.

---

### Phase 13 — Snapshots, restore e diff

### T30: apps/server — módulo snapshot (criação, listagem, compaction)

**What**: Em `apps/server/src/modules/snapshot/`: `GET/POST /diagrams/{id}/snapshots` (cria snapshot nomeado sob demanda, materializando a cena atual via `reconcileOperation` sobre todo o op-log e gravando em `scene_json_key` no MinIO via storage de T27), job `compactDiagram(diagramId)` (registrado em pg-boss/T28) disparado quando o diagrama acumula 100 operações, 5 minutos, ou 1 MB desde o último snapshot — o que ocorrer primeiro (o gatilho pode ser checado ao final de cada `operations:batch` bem-sucedido, enfileirando o job em vez de compactar inline).
**Where**: `apps/server/src/modules/snapshot/`
**Depends on**: T20 (schema `diagram_snapshots`, onda F1b), T28 (jobs)
**Reuses**: `reconcileOperation`/`packages/diagram-domain` (F1b), storage (T27), jobs (T28)
**Requirement**: VER-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Snapshot nomeado criado sob demanda reflete a cena reconstituída corretamente
- [ ] Acumular 100 operações dispara compaction automática sem interromper a edição (o teste pode simular threshold menor via config para não exigir 100 operações reais — documente a escolha)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add snapshot creation and threshold-based compaction job`

**Status**: ✅ Complete — `apps/server/src/modules/snapshot/` (`scene.ts` materializes a scene up to an optional revision by folding the op-log — a small, documented duplicate of diagram-sync's own fold rather than touching that module beyond its pre-approved surgical spots; `snapshots.ts` DB access + `createSnapshot` writing the canonical scene JSON to `EXPORT_BUCKET`; `compaction.ts` threshold check + `compact-diagram` pg-boss job; `routes.ts` `GET/POST /diagrams/{id}/snapshots`). Surgical addition to diagram-sync's `operations:batch`: an optional `jobs`/`compactionThresholds` dep triggers `enqueueCompaction` after a successful batch crosses a threshold — never inline, never blocking the ack. `registerAllModules`/`index.ts` now start a real `pg-boss` (T28) and thread it through, non-fatally (try/catch — job startup failure degrades to "jobs disabled", never blocks HTTP boot); `registerJobsGracefulShutdown` wired alongside the existing shutdown handler. Compaction test uses a documented lowered threshold (`maxOperations: 3` instead of 100) against a REAL pg-boss instance (`fromPglite`) over the same PGlite database — not a mock — and asserts a real `auto` snapshot row with the correct materialized scene appears. `registerModules.int.spec.ts` extended for the snapshot route (401, not 404). `pnpm -w test:unit && pnpm -w test:integration`: 76 unit / 143 integration passed, all green.

---

### T31: apps/server — restore de snapshot e diff estrutural

**What**: `POST /diagrams/{id}/snapshots/{snapshotId}:restore` — cria uma **nova operação/revisão** que aponta para o estado do snapshot (nunca apaga revisões/snapshots posteriores, que continuam consultáveis). `GET /diagrams/{id}/diff?from=&to=` — usa `structuralDiff` (adicione a `packages/diagram-domain` se ainda não existir lá, reaproveitando o mesmo índice de cena de T19) para reportar elementos adicionados/removidos/movidos/alterados entre duas revisões ou snapshots. Snapshots com `kind IN ('published', 'pre_ai')` são imutáveis — tentativa de restaurar SOBRE um deles com dados diferentes não os modifica (o restore sempre cria algo novo, nunca edita um snapshot existente).
**Where**: `apps/server/src/modules/snapshot/`, `packages/diagram-domain/`
**Depends on**: T30
**Reuses**: `packages/diagram-domain` (T19, estende com `structuralDiff`)
**Requirement**: VER-02, VER-03, VER-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Restore cria nova revisão; revisões e snapshots posteriores ao restaurado continuam consultáveis via `GET /diagrams/{id}/operations`/`/snapshots`
- [ ] Snapshot `published`/`pre_ai` nunca tem seus bytes (`scene_json_key`/`checksum`) alterados por nenhuma rota
- [ ] `diff` entre duas revisões reporta corretamente added/removed/moved/modified para um cenário com pelo menos um elemento de cada categoria
- [ ] Gate check passes (última task do Batch 1 — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `feat(server): add snapshot restore as new revision and structural diff endpoint`

**Status**: ✅ Complete — `packages/diagram-domain/src/structuralDiff.ts` adds `structuralDiff` (added/removed/moved/modified by element id, ignoring version/versionNonce/updated bookkeeping fields; documented precedence when an element is both moved and content-modified). `apps/server/src/modules/snapshot/restore.ts` computes restore deltas that force the target snapshot's content to LWW-win (version bumped above whatever the current scene holds) and reuses diagram-sync's own `appendOperation` unmodified — restore never edits or deletes any existing `diagram_operations`/`diagram_snapshots` row, so immutability of `published`/`pre_ai` snapshots holds structurally, not just by convention (proven with a dedicated test). `diff.ts` resolves `from`/`to` as either a revision number or a snapshot id. Routes: `POST /diagrams/{id}/snapshots/{snapshotId}:restore`, `GET /diagrams/{id}/diff?from=&to=`. Gate (last task of Batch 1): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration` — 78 unit / 150 integration passed, lint/typecheck/build all clean (biome auto-fix applied for import order/formatting drift, folded into this commit). Real server boot verified: `node apps/server/dist/index.js` against an unreachable `DATABASE_URL` — `/health/live` 200, asset/snapshot routes 401 (not 404) confirming registerAllModules wiring is genuinely reachable, job-queue startup failure degrades gracefully without blocking HTTP boot.

---

### Phase 14 — Export completo

### T32: apps/server — export .excalidraw/SVG/PNG/PDF server-side

**What**: `POST /diagrams/{id}/exports` retornando (ou enfileirando via job de T28 se demorado) os 4 formatos: `.excalidraw` (serialização direta via `editor-adapter`), SVG/PNG (reaproveita `apps/server/src/modules/render` do spike T10/F0 — promova de spike para rota real), PDF (componha a partir do SVG já gerado — pesquise e use uma biblioteca de conversão SVG→PDF em Node compatível com o ambiente sem browser, ex. `svg-to-pdfkit`/`pdfkit`, documentando a escolha e sua verificação, seguindo a Knowledge Verification Chain antes de assumir a API).
**Where**: `apps/server/src/modules/export/`
**Depends on**: T27
**Reuses**: `apps/server/src/modules/render` (T10), `editor-adapter` (`serializeScene`)
**Requirement**: EXP-01

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Os 4 formatos são gerados para uma cena de teste sem lançar erro
- [x] PDF gerado é um arquivo PDF válido (assinatura `%PDF-` no início dos bytes) contendo conteúdo renderizado (não uma página em branco)
- [x] `.excalidraw` exportado é reimportável (round-trip via `parseScene`)
- [x] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): add full excalidraw/svg/png/pdf export route`

**Status**: ✅ Complete — `apps/server/src/modules/export/` (`generateExports.ts` orchestrates all 4 formats; `sceneFile.ts` `.excalidraw` serialize/parse; `pdf.ts` SVG→PDF via `pdfkit`+`svg-to-pdfkit`; `routes.ts` `POST /diagrams/{id}/exports`, storing each generated format to `EXPORT_BUCKET` (T27) and returning signed download URLs + SHA-256 checksums — not wired into `registerAllModules` yet, deliberately deferred to T33, which extends this same module with bundle/import/bulk routes and does the wiring in one place). PDF library choice followed the Knowledge Verification Chain: verified `pdfkit`'s stream-based API and `svg-to-pdfkit`'s real signature (`SVGtoPDF(doc, svg, x, y, options)`, read from `@types/svg-to-pdfkit`) by reproducing both directly against the installed packages before writing any code, confirming a real `%PDF-`-signed buffer with actual content-stream drawing operators (`BT`/`Tj`), not an assumed API. `.excalidraw` round-trips through a locally re-implemented `serializeScene`/`parseScene` (same envelope editor-adapter's own functions use), not editor-adapter's own runtime export — SPEC_DEVIATION documented in full in `sceneFile.ts`'s header comment: importing anything from `@arch-canvas/editor-adapter` at runtime (even just for these two pure JSON functions) transitively loads `<EditorSurface/>` and crashes plain Node with `ERR_MODULE_NOT_FOUND: roughjs/bin/rough` (a real missing-`.js`-extension gap in `@excalidraw/excalidraw`'s compiled ESM output, reproduced directly, not assumed); editor-adapter's own `package.json#exports` has no subpath around its `index.ts`, and this batch's task boundary keeps `packages/editor-adapter` out of scope. Promoting the T10 render spike to a real production path surfaced and fixed a second, more serious latent bug in that spike, in the same reused files (`render/dom-environment.ts`, `render/svg.ts`): its static top-level `import ... from '@excalidraw/utils'` evaluated that package's module body — which reads `window`/`devicePixelRatio` off the global scope — *before* `ensureDomEnvironment()` (called inside the function body) ever ran, so a real `node dist/index.js` boot crashed with `ReferenceError: window is not defined`; this was invisible to `pnpm -w test:unit` because Vitest's own `environment: 'jsdom'` pre-installs `window` before any test file loads. Fixed by making the `@excalidraw/utils` import a top-level *dynamic* `await import(...)` placed after a module-scope `ensureDomEnvironment()` call — dynamic imports evaluate at their call site, not hoisted, so ordering is now correct, and the one-time load cost still lands at module-load time (not inside a request/test's timeout window). `devicePixelRatio` was also missing from `dom-environment.ts`'s manual global shim (`ReferenceError: devicePixelRatio is not defined`, thrown from inside `exportToSvg`'s font pipeline) — added, with jsdom's own `window.devicePixelRatio` reused. Both fixes were verified with real `node -e` reproductions against the compiled `dist/` output (not just `pnpm -w test:unit`, which cannot detect either bug), rendering all 5 `@arch-canvas/test-fixtures` scenes (text/arrowWithBindings/image/frame/group) through the real production code path end to end — SVG → PNG → PDF, all valid, all non-blank. `pnpm -w test:unit`: 97 passed in `apps/server` (was 78 before this task; +19 from the export module's 3 spec files), 0 failed, workspace-wide `pnpm -w test:unit` green (202 total across all packages).

---

### T33: apps/server — bundle .zip, import e export em massa

**What**: `POST /diagrams/{id}/bundle` — gera `.zip` (biblioteca `archiver` ou `jszip`, sua escolha) contendo a cena, assets referenciados (baixados do MinIO), metadados semânticos e specs geradas (vazio se nenhuma spec existir ainda — spec generation é onda F2/F3) mais um manifesto JSON com checksum SHA-256 de cada arquivo. `POST /diagrams/{id}/import` — valida o schema de um `.excalidraw` enviado (via `editor-adapter`'s `parseScene`) e retorna um preview (não cria o diagrama ainda; a criação efetiva é uma chamada separada do usuário confirmando, ou parâmetro explícito — sua escolha, documente). `POST /workspaces/{id}/bundles` — enfileira (via T28) a geração de bundles de todos os diagramas do workspace, acessível apenas a `workspace_admin`.
**Where**: `apps/server/src/modules/export/`
**Depends on**: T32, T28
**Reuses**: storage (T27), jobs (T28), `editor-adapter`
**Requirement**: EXP-02, EXP-03, EXP-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Bundle descompactado localmente contém cena + assets + manifesto com checksums que batem com os bytes reais dos arquivos
- [x] Import de um `.excalidraw` malformado é rejeitado com erro claro antes de qualquer criação; um válido retorna preview correto
- [x] Bulk export só é acessível a `workspace_admin` (403 para os demais papéis)
- [x] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add local zip bundle export, import preview and bulk workspace export`

**Status**: ✅ Complete — extends `apps/server/src/modules/export/` with `bundle.ts` (`buildDiagramBundle`: scene + `ready` assets the scene's image elements actually reference (via `fileId`, the same binding T29's `assertAssetsReady` uses) + `metadata.json`/empty semantic placeholder (semantic layer is F2/F3) + a SHA-256 checksum manifest, using `jszip` — chosen over `archiver` after discovering `archiver@8`'s real runtime API (`ZipArchive` class) has no matching `@types/archiver` release at all (latest published types are for the old v6 default-export-function API), while `jszip` ships its own bundled, accurate `.d.ts`; verified directly against the installed package before writing any code), `import.ts` (`previewImport`/`confirmImport`), `bulkBundle.ts` (`runBulkWorkspaceBundle` + pg-boss `bulk-workspace-bundle` job, T28). Routes added to `routes.ts`: `POST /diagrams/{id}/bundle`, `POST /projects/{id}/import` (SPEC_DEVIATION, documented inline in `routes.ts`: the task names this route `/diagrams/{id}/import`, but its own text says the diagram doesn't exist yet at preview time — there is no diagram id to scope it under, so it's registered under the target project instead, which is what creating a diagram actually requires; "sua escolha, documente" explicitly license this), and `POST /workspaces/{id}/bundles` (gated on `workspace:manage_members`, the same action already used for workspace admin-only routes — held exclusively by `workspace_admin`/`org_admin`). **Wired into `registerAllModules`** (`apps/server/src/core/registerModules.ts`) in this same commit — the export module (including T32's `/exports` route, previously unwired) is reachable in production for the first time; `registerModules.int.spec.ts` extended with a 401-not-404 reachability check across all 4 export-module routes. Import's "preview vs. create" split: `confirm: true` + `title` in the body triggers actual creation (reuses T31's `buildRestoreDeltas([], elements)` against an empty "current scene" plus diagram-sync's own `appendOperation`, T22 — no new write path). `pnpm -w test:unit && pnpm -w test:integration`: 104 unit / 159 integration passed in `apps/server`, both green; new coverage: `import.spec.ts` (4 unit tests — preview happy path, malformed JSON, wrong envelope type, non-array elements) and `export.int.spec.ts` (8 integration tests — export happy path with checksum verification against real object bytes, 401 reachability, bundle checksum/asset verification via a real unzip, import preview-vs-confirm + malformed rejection + scene seeding, bulk export workspace_admin-only vs 403 for editor).

---

### Phase 15 — Backup, DR e observabilidade

### T34: infra/backup — scripts backup:create, backup:verify, backup:restore

**What**: Scripts Node (executáveis via `pnpm backup:create|verify|restore`, adicionados aos scripts raiz) em `infra/backup/`: `create` faz `pg_dump` do Postgres + cópia de todos os objetos dos buckets MinIO relevantes + manifesto JSON com versões/checksums, empacotado em um único arquivo; `verify` confere os checksums do manifesto contra os bytes reais sem restaurar; `restore` aplica o dump em um banco alvo (vazio) e copia os objetos de volta ao MinIO, falhando alto (exit code != 0) se qualquer checksum não bater.
**Where**: `infra/backup/`
**Depends on**: T27
**Reuses**: storage (T27), conexão de `packages/database`
**Requirement**: OPS-01, OPS-02, OPS-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `backup:create` produz um arquivo com manifesto de checksums válido (teste against PGlite/Postgres real conforme disponibilidade do ambiente)
- [x] `backup:verify` detecta um checksum adulterado propositalmente no teste (prova de que a verificação é real, não um no-op)
- [x] `backup:restore` contra um banco vazio recupera os dados com os mesmos checksums — se este ambiente não tiver um segundo Postgres/MinIO isolado para testar o restore de ponta a ponta, documente exatamente essa limitação (mesmo padrão de honestidade de T6) e cubra o máximo possível via PGlite
- [x] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration` (ou `build` se o ambiente genuinamente não permitir o teste de integração completo — documente qual)

**Tests**: integration
**Gate**: full

**Commit**: `feat(infra): add backup create, verify and restore scripts with checksums`

**Status**: ✅ Complete — new workspace package `infra/backup/` (added to `pnpm-workspace.yaml`): `create.ts`/`verify.ts`/`restore.ts` orchestrate a single-file `.zip` backup (via `jszip`, same library T33 chose) containing `dump.sql` + `objects/{bucket}/{key}` + a SHA-256 checksum manifest; `pgDump.ts` wraps the real `pg_dump`/`psql` binaries (present in this sandbox: `/usr/bin/pg_dump`, `/usr/bin/psql`); `objectStore.ts` is a minimal S3-compatible client (own copy, not importable from `apps/server` which isn't a shared workspace package). CLI entry points (`cli/create.cli.ts`/`verify.cli.ts`/`restore.cli.ts`) are wired to the root `pnpm backup:create|verify|restore` scripts. **Honesty note, more precise than T6/T27's "no Docker" default**: this sandbox genuinely has no second isolated Postgres/MinIO stack, but `@electric-sql/pglite-socket` can expose a real PGlite engine over an actual TCP Postgres wire-protocol socket — verified manually that `psql` connects and queries it for real. `pg_dump` specifically cannot: it refuses with "aborting because of server version mismatch" (PGlite reports `server_version` 18.3; this sandbox's `pg_dump` is 16.13 with no override flag and no `postgresql-client-18` package available via this sandbox's apt sources) — a precisely diagnosed, reproducible constraint, not a vague limitation. That reproduction was flaky under the Vitest runner's process/socket handling (reliable standalone, timed out under vitest) so it was **not** committed as an automated test — documented instead of shipped unreliable. `create.ts`/`restore.ts` accept injectable `dump`/`restore` functions (default to the real `pg_dump`/`psql` wrappers) so `create.int.spec.ts` exercises the REAL create→verify→restore orchestration (zip packaging, checksum manifest, object-store round-trip) with the DB boundary substituted — and the substitution itself is not a bare mock: the injected `restore` applies the dump SQL to a genuinely separate, fresh `@electric-sql/pglite` instance via its own `.exec()`, then queries it back, proving data really lands. `verify.spec.ts` (4 unit tests) proves tamper-detection is real (a deliberately mismatched checksum, a manifest-listed-but-missing file, a missing manifest entirely, and the valid case). `pnpm -w test:unit && pnpm -w test:integration`: 4 unit / 4 integration passed in `@arch-canvas/backup`; workspace-wide both green (282 unit / 177 integration total across all packages).

---

### T35: infra/backup — teste de restore automatizado agendado

**What**: Job (registrado via pg-boss/T28 com agendamento, ou um workflow de CI dedicado em `.github/workflows/` — sua escolha, mas prefira o mecanismo que realmente pode rodar dado que este ambiente não tem Docker; documente a decisão) que executa `backup:create` → `backup:restore` em um ambiente isolado (schema/banco de teste separado) e falha ruidosamente (alerta/log de erro claro) se o restore quebrar.
**Where**: `infra/backup/` ou `.github/workflows/`
**Depends on**: T34
**Reuses**: scripts de T34
**Requirement**: OPS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Existe um mecanismo agendado (documentado) que executa create→restore periodicamente
- [x] Uma falha de restore proposital no teste faz o mecanismo reportar falha de forma clara (não silenciosa)
- [x] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `feat(infra): add scheduled automated restore verification`

**Status**: ✅ Complete — `.github/workflows/backup-restore-drill.yaml`: a scheduled (`cron: '0 3 * * *'`, daily, plus `workflow_dispatch` for on-demand runs) GitHub Actions workflow, chosen over a pg-boss scheduled job because it's the mechanism that can actually run given this authoring sandbox has no Docker daemon (AD-007) — a pg-boss job would only ever exercise `backup:create`/`backup:restore` against the SAME live production database process it runs inside, never a genuinely separate target. Real Postgres + a Bitnami MinIO service (the plain `minio/minio` image needs a `server /data` command argument GitHub Actions' `services:` schema has no field for — Bitnami's image starts from env vars alone, a real, documented workaround). The drill: migrate + seed a source db → `backup:create` → `backup:verify` → `backup:restore` into a second, empty database on the same postgres service (the "isolated environment / separate test schema-database" the task text explicitly permits) → asserts the seeded row landed → a dedicated negative-check step corrupts the archive's `dump.sql` bytes (manifest checksum untouched, same shape as `create.int.spec.ts`'s tamper test) and asserts `backup:restore` exits non-zero and applies nothing, explicitly failing the job (`::error::`) if it doesn't — closing the "fails loud, not silent" Done-when criterion as an asserted mechanism, not just a hope. **Additional real validation beyond the workflow YAML itself**: this sandbox turned out to have a real, installed-but-stopped PostgreSQL 16 server (`pg_ctlcluster 16 main start`) distinct from PGlite — started it, ran the ENTIRE `backup:create` → `backup:verify` → `backup:restore` pipeline for real against it (genuine `pg_dump`/`psql`, no injection, no PGlite), including the negative/tamper check, confirmed the restored data landed correctly in a truly separate empty database and that the negative check left the target with zero tables, then stopped the cluster and dropped the scratch databases to leave the sandbox as found. This is strictly stronger evidence than T34's own committed status claims and directly de-risks this workflow's command sequence (same CLI code, only the Postgres host differs between this manual run and the GitHub Actions service container). The workflow itself was not, and could not be, executed by a real GitHub Actions runner from this session — validated instead via: `python3 -c "import yaml; yaml.safe_load(...)"` (parses, same `on:`-as-boolean PyYAML artifact `ci.yaml` already has), `bash -n` against every extracted `run:` block, and `python3 -m py_compile`-equivalent syntax check on the embedded Python snippet. Lint drift accumulated in T32/T33's `apps/server/src/modules/export/` files (import ordering, one wrapped function signature) surfaced by this task's own full `pnpm -w lint` gate — fixed via Biome's safe auto-fix and folded into this commit, mirroring T31's precedent for the same situation. `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`: all green (282 unit / 177 integration tests across the workspace, lint clean, typecheck clean, build clean).

---

### T36: apps/server — redação de segredos em logs estruturados

**What**: Estenda a configuração de logs JSON de T3 (pino) com uma lista de redação (`redact` do pino, ou serializers customizados) cobrindo `Authorization`, `Cookie`/`Set-Cookie`, tokens de provedor de IA (mesmo que ainda não existam rotas de IA — prepare o padrão), e campos de PII conhecidos (`email` em alguns contextos de log — sua escolha de granularidade, documente). Todo log inclui `requestId`.
**Where**: `apps/server/src/core/`
**Depends on**: None
**Reuses**: `buildServer`/logger de T3
**Requirement**: OPS-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Uma requisição com header `Authorization: Bearer secret-token` nunca produz `secret-token` em texto plano na saída de log capturada pelo teste
- [x] Um cookie de sessão em `Set-Cookie` é redigido na saída de log
- [x] Toda linha de log de uma requisição HTTP inclui `requestId`
- [x] Gate check passes (última task da onda F1c — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: unit
**Gate**: build

**Commit**: `feat(server): redact secrets and pii from structured json logs`

**Status**: ✅ Complete — `apps/server/src/core/logging.ts` (`buildLoggerOptions`, `REDACT_PATHS`, `REQUEST_ID_LOG_LABEL`), wired into `buildServer` (`server.ts`). Uses pino's native `redact` (fast-redact under the hood) over `req`/`res` serializers that were extended to include headers — Fastify's DEFAULT serializers don't log headers at all, so without this change nothing would ever need redacting in the first place; this makes the redaction real, not vacuous. Redact paths: `req.headers.authorization`, `req.headers.cookie`, `req.headers["proxy-authorization"]`, `res.headers["set-cookie"]` (session cookie + bearer/proxy tokens), plus a wildcard set (`token`/`apiKey`/`accessToken`/`refreshToken`/`secretAccessKey`/`password`/`aiProviderToken`, top-level and one level deep) preparing the pattern for design.md's ai-engine component (F2, "token cifrado AES-256-GCM") ahead of any AI route existing yet. PII granularity chosen (documented in `logging.ts`): the `email` field is redacted wherever logged (top-level or one level deep); non-PII identifiers (user id, role) stay visible for debugging. `requestId` (Done-when's literal field name, not Fastify's default `reqId`) via `requestIdLogLabel` — the currently-working, if deprecated-in-favor-of-an-undocumented-successor-option, mechanism in the pinned fastify@5.11.3 (verified: the newer `logController` option isn't in this version's public types yet). `logging.spec.ts` (6 unit tests, `apps/server/src/core/`): Authorization header never appears in plaintext + is `[REDACTED]`; Set-Cookie response header same; incoming Cookie request header same; every log line has a `requestId` string; a nested `aiProviderToken` field is redacted; a nested `email` field is redacted while a sibling `id` field stays visible (payload/conjunction: asserts the actual redacted VALUE in the captured log stream, not just that logging was called). `buildServer` gained an optional `loggerOverrides.stream` injection point so tests capture real pino output instead of hitting the console — `NODE_ENV=test` still forces `{level:'silent'}` as before, unchanged for every other existing test. Real-server-boot verification (mandatory before this commit, per this batch's critical instruction): `node apps/server/dist/index.js` against an unreachable `DATABASE_URL`, `NODE_ENV=development` — `GET /health/live` → 200; `POST /diagrams/x/exports`, `/diagrams/x/bundle`, `/projects/x/import`, `/workspaces/x/bundles`, `/diagrams/x/snapshots`, `/diagrams/x/assets:initiate` → 401 each (never 404, confirming every route this whole batch added is genuinely wired and reachable through `registerAllModules`); a follow-up request with real `Authorization: Bearer real-secret-abc123` and `Cookie: session=real-cookie-xyz789` headers produced a captured log line with `"authorization":"[REDACTED]"`/`"cookie":"[REDACTED]"` and `grep` for the literal secret values across the full captured log returned zero matches — confirmed by direct inspection, not inferred. Fixed the last of the batch's Biome drift as part of this task's own full-workspace lint gate (none remained by this point — T35 already closed it out). `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`: all green — 111 unit / 159 integration in `apps/server` (up from 104/159; +7 unit from `logging.spec.ts`), workspace-wide unit and integration suites both green.

---

## Phase Execution Map

```
Phase 11: T27
Phase 11: T28
Phase 12: T27 -> T29
Phase 13: T20 -> T30 -> T31
Phase 13: T28 -> T30
Phase 14: T27 -> T32 -> T33
Phase 14: T28 -> T33
Phase 15: T27 -> T34 -> T35
Phase 15: T36
```

**Packing de batches (Execute):** 10 tasks (T27-T36) → 2 batches: Batch 1 = Phase 11+12+13 (T27, T28, T29, T30, T31 — 5 tasks), Batch 2 = Phase 14+15 (T32, T33, T34, T35, T36 — 5 tasks).

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T27: storage client | 1 módulo coeso | ✅ Granular |
| T28: pg-boss wiring | 1 módulo coeso | ✅ Granular |
| T29: asset module | 1 módulo + 1 modificação cirúrgica pontual | ✅ Granular |
| T30: snapshot create+compaction | 1 módulo coeso | ✅ Granular |
| T31: restore+diff | 1 módulo (extensão do de T30) | ✅ Granular |
| T32: export 4 formatos | 1 rota coesa | ✅ Granular |
| T33: bundle+import+bulk | 1 módulo coeso (3 rotas relacionadas) | ✅ Granular |
| T34: backup scripts | 1 conjunto coeso de 3 comandos | ✅ Granular |
| T35: restore agendado | 1 mecanismo | ✅ Granular |
| T36: redação de logs | 1 configuração coesa | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T27 | None | — | ✅ Match |
| T28 | None | — | ✅ Match |
| T29 | T27 | T27→T29 | ✅ Match |
| T30 | T20, T28 | T20→T30, T28→T30 | ✅ Match |
| T31 | T30 | T30→T31 | ✅ Match |
| T32 | T27 | T27→T32 | ✅ Match |
| T33 | T32, T28 | T32→T33, T28→T33 | ✅ Match |
| T34 | T27 | T27→T34 | ✅ Match |
| T35 | T34 | T34→T35 | ✅ Match |
| T36 | None | — | ✅ Match |

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T27 | Módulo server (storage) | integration (best-effort) | unit | ✅ OK (documented environment caveat) |
| T28 | Módulo server (jobs) | integration | integration | ✅ OK |
| T29 | Módulo server (asset) | integration | integration | ✅ OK |
| T30 | Módulo server (snapshot) | integration | integration | ✅ OK |
| T31 | Módulo server (snapshot) + domínio | integration | integration | ✅ OK |
| T32 | Módulo server (export) | unit | unit | ✅ OK |
| T33 | Módulo server (export) | integration | integration | ✅ OK |
| T34 | Infra (backup) | integration | integration | ✅ OK |
| T35 | Infra (backup/CI) | integration | integration | ✅ OK |
| T36 | Módulo server (core) | unit | unit | ✅ OK |
