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

- [ ] Os 4 formatos são gerados para uma cena de teste sem lançar erro
- [ ] PDF gerado é um arquivo PDF válido (assinatura `%PDF-` no início dos bytes) contendo conteúdo renderizado (não uma página em branco)
- [ ] `.excalidraw` exportado é reimportável (round-trip via `parseScene`)
- [ ] Gate check passes: `pnpm -w test:unit`

**Tests**: unit
**Gate**: quick

**Commit**: `feat(server): add full excalidraw/svg/png/pdf export route`

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

- [ ] Bundle descompactado localmente contém cena + assets + manifesto com checksums que batem com os bytes reais dos arquivos
- [ ] Import de um `.excalidraw` malformado é rejeitado com erro claro antes de qualquer criação; um válido retorna preview correto
- [ ] Bulk export só é acessível a `workspace_admin` (403 para os demais papéis)
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: full

**Commit**: `feat(server): add local zip bundle export, import preview and bulk workspace export`

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

- [ ] `backup:create` produz um arquivo com manifesto de checksums válido (teste against PGlite/Postgres real conforme disponibilidade do ambiente)
- [ ] `backup:verify` detecta um checksum adulterado propositalmente no teste (prova de que a verificação é real, não um no-op)
- [ ] `backup:restore` contra um banco vazio recupera os dados com os mesmos checksums — se este ambiente não tiver um segundo Postgres/MinIO isolado para testar o restore de ponta a ponta, documente exatamente essa limitação (mesmo padrão de honestidade de T6) e cubra o máximo possível via PGlite
- [ ] Gate check passes: `pnpm -w test:unit && pnpm -w test:integration` (ou `build` se o ambiente genuinamente não permitir o teste de integração completo — documente qual)

**Tests**: integration
**Gate**: full

**Commit**: `feat(infra): add backup create, verify and restore scripts with checksums`

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

- [ ] Existe um mecanismo agendado (documentado) que executa create→restore periodicamente
- [ ] Uma falha de restore proposital no teste faz o mecanismo reportar falha de forma clara (não silenciosa)
- [ ] Gate check passes: `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: integration
**Gate**: build

**Commit**: `feat(infra): add scheduled automated restore verification`

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

- [ ] Uma requisição com header `Authorization: Bearer secret-token` nunca produz `secret-token` em texto plano na saída de log capturada pelo teste
- [ ] Um cookie de sessão em `Set-Cookie` é redigido na saída de log
- [ ] Toda linha de log de uma requisição HTTP inclui `requestId`
- [ ] Gate check passes (última task da onda F1c — inclui lint/typecheck/build): `pnpm -w lint && pnpm -w typecheck && pnpm -w build && pnpm -w test:unit && pnpm -w test:integration`

**Tests**: unit
**Gate**: build

**Commit**: `feat(server): redact secrets and pii from structured json logs`

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
