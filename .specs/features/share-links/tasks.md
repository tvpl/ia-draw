# Compartilhamento externo por link — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user - do not proceed without it.**

---

**Design**: `.specs/features/share-links/design.md`
**Status**: Approved

---

## Test Coverage Matrix

> Gerada por amostragem do código (`apps/server/src/core/logging.spec.ts`, `packages/editor-adapter/src/EditorSurface.spec.tsx`, `apps/web/src/nav/memberClient.spec.ts`, `apps/web/src/nav/WorkspaceMembersPage.spec.tsx`, `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`, `apps/web/src/App.spec.tsx`) e da spec. Guidelines encontradas: `CLAUDE.md` (comandos e gate substituto) e `.claude/commands/gate.md`; nenhum limiar de cobertura por arquivo além dos pisos globais de `apps/server/vitest.config.ts`, que esta onda não pode baixar.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Serializer de log (servidor) | unit | Função pura em isolamento (com `/share/`, com `ticket=`, com nenhum dos dois) + ponta a ponta pelo stream capturado do Pino; 1:1 a SHR-23..26 | `apps/server/src/core/logging.spec.ts` | `pnpm --filter @arch-canvas/server run test:unit` |
| Componente de pacote compartilhado (`EditorSurface`) | unit | Prop presente `true`, presente `false`, ausente (compatibilidade); 1:1 a SHR-18 | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm --filter @arch-canvas/editor-adapter run test:unit` |
| Cliente HTTP (`shareLinkClient`) | unit | Todo ramo de status documentado: criar 201/403/outro/201-sem-token, revogar 200/403/404, resolver 200-diagrama/200-apresentação/404/erro de rede | `apps/web/src/share/shareLinkClient.spec.ts` | `pnpm --filter @arch-canvas/web run test:unit` |
| Componente de tela (`ShareLinkPanel`, `SharedResourcePage`, `PublicShell`) | unit (RTL) | 1:1 às ACs da spec que a tela implementa, incluindo cada Edge Case listado que caia nela | `apps/web/src/share/*.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Acessibilidade de tela nova | unit (axe) | Zero violação `serious`/`critical` nos estados renderizáveis; foco por teclado; `aria-live`; segundo locale (SHR-29..31) | `apps/web/src/share/*.a11y.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Fiação de rota (`App.tsx`) | unit (RTL) | `/share/:token` renderiza sem sessão, sem redirect e sem `GET /me`; as rotas existentes continuam guardadas (SHR-12/13) | `apps/web/src/App.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| Fiação de página existente (`DiagramEditorPage`) | unit (RTL) | `viewModeEnabled` nos dois valores de `canMutate`; painel montado só com `canMutate` (SHR-01/22) | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm --filter @arch-canvas/web run test:unit` |
| JSON de i18n | none | Gate de build/lint apenas | `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | build gate only |
| Changeset / documentação gerada | none | Gate de build/lint e `repo-tools audit` | `.changeset/*.md`, `docs/route-inventory.md` | build gate only |

## Gate Check Commands

> Extraídas do `Makefile` e dos `package.json` do workspace; o gate substituto (`make ci` falha nesta máquina por falta de `pg_lsclusters`/`redis-server`) é o documentado em `CLAUDE.md`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | Task com testes unitários de um pacote só | `pnpm --filter @arch-canvas/<pkg> run test:unit` |
| Full | Task que atravessa pacotes, ou fiação de rota/página | `make lint && make typecheck && make test-unit` |
| Build | Task sem teste próprio (i18n, changeset, docs) e fechamento de fase | `make lint && make typecheck && make test-unit` |

`make test-integration` não é exigido por nenhuma task desta onda: nenhuma toca schema, migration ou
caminho de banco. O Verifier roda o gate completo no fechamento.

---

## Execution Plan

14 tasks no total, em 4 fases. Executadas por um único worker, em ordem — sem split de sub-agentes.

### Phase 1: Fundação independente

Quatro deliverables sem dependência entre si: o serializer de log (servidor), a prop do pacote
compartilhado, o cliente HTTP e as chaves de i18n.

```
T1
T2
T3
T4
```

### Phase 2: Superfícies novas

Inclui as arestas que vêm da fase 1 (o cliente, as chaves de i18n e a prop de `EditorSurface`).

```
T4 -> T5
T5 -> T6 -> T7
T2 -> T6
T3 -> T6
T4 -> T6
T3 -> T8
T4 -> T8
T8 -> T9
```

### Phase 3: Fiação

```
T6 -> T10
T2 -> T11
T11 -> T12
T8 -> T12
```

### Phase 4: Fechamento

```
T13 -> T14
```

---

## Task Breakdown

### T1: Redigir token e ticket na URL logada

**What**: `redactSensitiveUrl(url)` — substitui o segmento seguinte a `/share/` e o valor do parâmetro de query `ticket` por `[REDACTED]` — chamada dentro do serializer `req` existente (`url: redactSensitiveUrl(request.url)`).
**Where**: `apps/server/src/core/logging.ts`
**Depends on**: None
**Reuses**: a constante `REDACT_CENSOR` já existente no arquivo; `devConfigWithCapturedLogs()` de `logging.spec.ts` para o teste de ponta a ponta
**Requirement**: SHR-23, SHR-24, SHR-25, SHR-26

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `redactSensitiveUrl('/share/abc123')` devolve `/share/[REDACTED]`
- [x] `redactSensitiveUrl('/ws/diagrams/d-1?ticket=abc123')` devolve a mesma URL com o valor de `ticket` trocado por `[REDACTED]`
- [x] Uma URL sem `/share/` e sem `ticket=` volta idêntica
- [x] Com `NODE_ENV=development` e stream capturado, `GET /share/<token>` produz saída de log que NÃO contém o token e que contém `/share/[REDACTED]`
- [x] `request.url` real não é reatribuído: o corpo `problem+json` de um 404 continua trazendo a URL original com o token (prova de SHR-26)
- [x] Gate check passes: `pnpm --filter @arch-canvas/server run test:unit`
- [x] Test count: 5 testes novos passam (nenhum teste existente removido)

**Tests**: unit
**Gate**: quick

**Commit**: `fix(server): redact share token and ws ticket from logged urls`

---

### T2: Adicionar `viewModeEnabled` a `EditorSurface`

**What**: Prop opcional `viewModeEnabled?: boolean` em `EditorSurfaceProps`, repassada direto para `<Excalidraw viewModeEnabled={...}/>`; ausente preserva o comportamento atual.
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`
**Depends on**: None
**Reuses**: o mesmo `<Excalidraw/>` já renderizado; a prop existe em `ExcalidrawProps` de `@excalidraw/excalidraw@0.18.1`
**Requirement**: SHR-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `<EditorSurface viewModeEnabled />` renderiza `<Excalidraw/>` recebendo `viewModeEnabled === true`
- [x] `<EditorSurface viewModeEnabled={false} />` repassa `false`
- [x] `<EditorSurface />` sem a prop repassa `undefined` (compatibilidade: nenhum consumidor existente muda de comportamento)
- [x] `onDeltas`/`onSelectionChange`/`applyRemoteScene` seguem funcionando (nenhum teste existente de `EditorSurface.spec.tsx` foi tocado)
- [x] Gate check passes: `pnpm --filter @arch-canvas/editor-adapter run test:unit`
- [x] Test count: 3 testes novos passam, todos os existentes continuam passando

**Tests**: unit
**Gate**: quick

**Commit**: `feat(editor-adapter): add optional viewModeEnabled prop to EditorSurface`

---

### T3: Criar `shareLinkClient`

**What**: Cliente HTTP dedicado com `createForDiagram`, `revoke` e `resolve`, cada um com união discriminada por status; `resolve` descarta `frames` guardando só `frames.length`.
**Where**: `apps/web/src/share/shareLinkClient.ts`
**Depends on**: None
**Reuses**: forma e convenções de `apps/web/src/nav/memberClient.ts` (injeção de `fetchImpl`, `fetchImpl(...)` literal em cada chamada para o extrator de `repo-tools audit` reconhecer as rotas)
**Requirement**: SHR-04, SHR-05, SHR-06, SHR-07, SHR-09, SHR-10, SHR-11, SHR-14, SHR-15, SHR-16, SHR-27, SHR-28

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `createForDiagram(diagramId, role, expiresAt)` emite `POST /diagrams/:id/share-links` com corpo `{role, expiresAt}` e devolve `{status:'created', shareLink, token}` no `201`
- [x] `403` na criação vira `{status:'forbidden'}`; qualquer outro status vira `{status:'error'}`
- [x] Um `201` cujo corpo não traz `token` vira `{status:'error'}` (Edge Case da spec)
- [x] `revoke(id)` emite `POST /share-links/:id:revoke` e devolve `{status:'revoked', shareLink}` no `200`, `{status:'forbidden'}` no `403`, `{status:'not_found'}` no `404`
- [x] `resolve(token)` emite `GET /share/:token` e devolve `{status:'diagram', role, scene, revision}` para `resourceType:'diagram'`
- [x] `resolve(token)` devolve `{status:'presentation', role, presentation, frameCount}` para `resourceType:'presentation'`, e o objeto devolvido não contém `notes` nem `navLinksJson` de nenhum frame
- [x] `404` em `resolve` vira `{status:'not_found'}`; falha de rede vira `{status:'error'}`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 11 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add dedicated shareLinkClient`

---

### T4: Adicionar as chaves de i18n de `share` (pt-BR, en)

**What**: Bloco `share` novo no topo dos dois locales — título do painel, rótulos do formulário (papel, expiração), papéis, aviso de revelação única, mensagens de teto de papel/falha/expiração no passado, aviso de lista limitada à sessão, textos da visão pública (carregando, link inválido, placeholder de apresentação, cabeçalho público).
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json` (o mesmo bloco, espelhado — dois arquivos do mesmo formato, não duas unidades de trabalho)
**Depends on**: None
**Reuses**: convenção de aninhamento por feature já usada por `nav`, `library`, `history`, `export`
**Requirement**: SHR-31

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] `share.*` existe nos dois arquivos de locale com exatamente o mesmo conjunto de chaves
- [x] Nenhuma chave existente é renomeada ou removida
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `feat(web): add share-link i18n keys for pt-BR and en`

---

### T5: Criar `PublicShell`

**What**: Chrome mínimo da página pública — cabeçalho com o nome do produto e o seletor de idioma, `<main>` para o conteúdo; nenhum import de `auth/`, nenhum logout, nenhuma navegação de workspace.
**Where**: `apps/web/src/share/PublicShell.tsx`
**Depends on**: T4
**Reuses**: `apps/web/src/app-shell/LanguageSwitcher.tsx` (verificado: usa apenas `useTranslation`, sem `useAuth`)
**Requirement**: SHR-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Renderiza `children` dentro de um `<main>`, com cabeçalho de produto
- [x] Não renderiza botão de logout nem nenhum link para rota autenticada (asserção explícita, não só ausência de import)
- [x] Renderiza fora de `AuthProvider` sem lançar (teste monta o componente sem provider nenhum)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 3 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add minimal PublicShell chrome for the public share view`

---

### T6: Criar `SharedResourcePage`

**What**: A visão pública de `/share/:token` — quatro estados (carregando, diagrama com canvas somente leitura, apresentação em placeholder, link inválido), montada dentro de `PublicShell`.
**Where**: `apps/web/src/share/SharedResourcePage.tsx`
**Depends on**: T2, T3, T4, T5
**Reuses**: `shareLinkClient.resolve` (T3), `EditorSurface` com `viewModeEnabled` (T2), `PublicShell` (T5)
**Requirement**: SHR-14, SHR-15, SHR-16, SHR-19, SHR-20, SHR-21, SHR-27, SHR-28

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Ao montar, emite `GET /share/:token` exatamente uma vez (contador de chamadas, não só "foi chamada")
- [x] `200` com `resourceType:'diagram'` renderiza `EditorSurface` recebendo os elementos de `scene`
- [x] `EditorSurface` recebe `viewModeEnabled === true`, inclusive quando o papel do link é `editor` (asserção na prop repassada)
- [x] `404` renderiza a mensagem única de link inválido e nenhum canvas
- [x] Falha de rede renderiza a mesma mensagem de falha, sem segunda requisição
- [x] `scene: []` renderiza o canvas vazio, nunca a mensagem de link inválido
- [x] `resourceType:'presentation'` renderiza o nome da apresentação e o placeholder, e nenhum texto de `notes` aparece na tela mesmo quando a resposta traz `notes` preenchido
- [x] Nenhum `DiagramSyncClient`/fila de mutação é construído e nenhuma requisição de mutação é emitida (asserção sobre as URLs chamadas)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 9 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add public SharedResourcePage for share links`

---

### T7: Teste de acessibilidade de `SharedResourcePage`

**What**: `SharedResourcePage.a11y.spec.tsx` — axe nos estados renderizáveis (diagrama, inválido, apresentação), foco por teclado e segundo locale, tudo montado SEM `AuthProvider`.
**Where**: `apps/web/src/share/SharedResourcePage.a11y.spec.tsx`
**Depends on**: T6
**Reuses**: convenção de `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx` (helper `seriousOrCriticalViolations`, restauração de locale no `afterEach`)
**Requirement**: SHR-29, SHR-31

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Zero violação `serious`/`critical` no estado de diagrama, no de link inválido e no de apresentação
- [x] Todo controle interativo da página é focável por teclado
- [x] A página renderiza no locale `en` além do `pt-BR`
- [x] Todo render deste arquivo acontece sem `AuthProvider` no topo (contexto novo, diferente de toda onda anterior)
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 5 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add a11y coverage for the public share view`

---

### T8: Criar `ShareLinkPanel`

**What**: Painel de gestão dentro do editor autenticado — formulário de criação (papel + expiração), lista dos links criados nesta sessão com a URL revelada uma vez, ação de revogar por item, região `aria-live`.
**Where**: `apps/web/src/share/ShareLinkPanel.tsx`
**Depends on**: T3, T4
**Reuses**: `shareLinkClient` (T3), chaves de i18n (T4), padrão de `aria-live`/guarda de requisição em voo de `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Requirement**: SHR-02, SHR-03, SHR-04, SHR-05, SHR-06, SHR-07, SHR-08, SHR-09, SHR-10, SHR-11, SHR-30

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Com papel ou expiração vazios, o envio não emite requisição nenhuma
- [x] Com expiração no passado, o envio é bloqueado com mensagem própria e nenhuma requisição é emitida
- [x] Com papel e expiração futura, emite `POST /diagrams/:id/share-links` com `{role, expiresAt}`
- [x] No `201`, exibe `${origin}/share/${token}` e o aviso de revelação única
- [x] No `403`, exibe a mensagem de teto de papel e a lista continua vazia
- [x] Em qualquer outro erro, exibe falha genérica e a lista continua vazia
- [x] A tela declara visivelmente que a lista só contém os links criados nesta sessão
- [x] Revogar emite `POST /share-links/:id:revoke`; no `200` o item vira revogado e a URL some da tela
- [x] Revogar com `403`/`404` anuncia falha e o item continua exibido como ativo, com a URL
- [x] Um segundo envio enquanto a criação está em voo não emite segunda requisição
- [x] Toda mensagem de resultado passa pela região `aria-live="polite"`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 11 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `feat(web): add ShareLinkPanel for creating and revoking share links`

---

### T9: Teste de acessibilidade de `ShareLinkPanel`

**What**: `ShareLinkPanel.a11y.spec.tsx` — axe no estado vazio e no estado com link criado, foco por teclado em todos os controles, `aria-live` afirmada por atributo, segundo locale.
**Where**: `apps/web/src/share/ShareLinkPanel.a11y.spec.tsx`
**Depends on**: T8
**Reuses**: convenção de `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx`
**Requirement**: SHR-29, SHR-30, SHR-31

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [x] Zero violação `serious`/`critical` no estado vazio e no estado com um link criado
- [x] Formulário (papel, expiração, enviar) e ação de revogar são focáveis por teclado
- [x] A região de anúncio tem `aria-live="polite"` afirmado pelo atributo, e anuncia um resultado real
- [x] O painel renderiza no locale `en` além do `pt-BR`
- [x] Gate check passes: `pnpm --filter @arch-canvas/web run test:unit`
- [x] Test count: 5 testes novos passam

**Tests**: unit
**Gate**: quick

**Commit**: `test(web): add a11y coverage for ShareLinkPanel`

---

### T10: Registrar `/share/:token` fora de `AuthProvider`

**What**: `AuthLayout` (`<AuthProvider><Outlet/></AuthProvider>`) como rota de layout sem path envolvendo todas as rotas atuais, e `/share/:token` como rota irmã fora dela.
**Where**: `apps/web/src/App.tsx`
**Depends on**: T6
**Reuses**: a mecânica de rota-pai com `<Outlet/>` que `/` já usa desde R3; os testes de `apps/web/src/App.spec.tsx` como piso de regressão
**Requirement**: SHR-12, SHR-13

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `/share/<token>` sem sessão renderiza a visão pública e a rota permanece `/share/<token>` (nenhum redirect para `/login`)
- [ ] Nenhuma requisição a `GET /me` nem a `POST /auth/refresh` é emitida numa visita a `/share/<token>` (contador, não ausência de asserção)
- [ ] Todas as rotas existentes continuam guardadas: uma visita anônima a `/w/:workspaceId/d/:diagramId` continua redirecionando para `/login?next=...` (testes existentes de `App.spec.tsx` continuam passando sem alteração)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: 2 testes novos passam; nenhum dos existentes em `App.spec.tsx` foi modificado

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): route /share/:token outside AuthProvider`

---

### T11: Ligar `viewModeEnabled` ao papel no editor autenticado

**What**: `DiagramEditorPage` passa `viewModeEnabled={!canMutate}` ao `EditorSurface`, fechando a lacuna pré-existente de `reviewer`/`viewer`.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T2
**Reuses**: o `canMutate` já resolvido do bootstrap (`mutatePermissions.allowed`), que já gateia `AiDock`/`LibraryPanel`/`MetadataPanel`
**Requirement**: SHR-22

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Com `mutatePermissions.allowed === false` no bootstrap, o `EditorSurface` do editor recebe `viewModeEnabled === true`
- [ ] Com `mutatePermissions.allowed === true`, recebe `viewModeEnabled === false`
- [ ] Nenhum outro comportamento da página muda (testes existentes de `DiagramEditorPage.spec.tsx` continuam passando sem alteração)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: 2 testes novos passam

**Tests**: unit
**Gate**: full

**Commit**: `fix(web): put the canvas in view mode when the role cannot mutate`

---

### T12: Montar `ShareLinkPanel` no editor

**What**: `ShareLinkPanel` na coluna lateral de `DiagramEditorPage`, num `<details>` colapsado, montado apenas quando `canMutate` for verdadeiro.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T8, T11
**Reuses**: a convenção de `<details><summary>` já usada por `LibraryPanel`/`MetadataPanel` na mesma coluna
**Requirement**: SHR-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Com `mutatePermissions.allowed === true`, o painel de compartilhamento aparece na página
- [ ] Com `mutatePermissions.allowed === false`, o painel não é renderizado de forma nenhuma
- [ ] Nenhum painel existente muda de posição ou some (testes existentes continuam passando)
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`
- [ ] Test count: 2 testes novos passam

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): mount ShareLinkPanel in the diagram editor sidebar`

---

### T13: Adicionar changeset da mudança em `editor-adapter`

**What**: Changeset de `patch` para `@arch-canvas/editor-adapter`, exigido pelo job `changeset-check` do CI para qualquer mudança em `packages/*/src`.
**Where**: `.changeset/share-links-view-mode.md`
**Depends on**: None
**Reuses**: formato dos changesets já presentes em `.changeset/`
**Requirement**: SHR-18

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Existe um changeset nomeando `@arch-canvas/editor-adapter` com bump `patch` e descrição da prop nova
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `chore: add changeset for the editor-adapter view-mode prop`

---

### T14: Regenerar o inventário de rotas e registrar o escopo de R11

**What**: Rodar `repo-tools audit`, commitar o `docs/route-inventory.md` regenerado, e anotar na entrada R11 do roadmap que 3 das 4 rotas foram consumidas (a de apresentação fica com R12).
**Where**: `docs/route-inventory.md`, `.specs/features/platform-maturity/ui-roadmap.md`
**Depends on**: T13
**Reuses**: o fluxo versionado `/audit` (`.claude/commands/audit.md`)
**Requirement**: SHR-01, SHR-04, SHR-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` sai 0
- [ ] `POST /diagrams/:id/share-links`, `GET /share/:token` e `POST /share-links/:id:revoke` deixam de aparecer como `pending-product` no inventário regenerado
- [ ] A entrada R11 de `.specs/features/platform-maturity/ui-roadmap.md` registra que `POST /presentations/:id/share-links` fica com R12, com a justificativa
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: build

**Commit**: `docs: regenerate route inventory and record the R11 scope call`

---

## Phase Execution Map

```
Phase 1:  T1     T2     T3     T4         (independentes entre si)
Phase 2:  T4 -> T5 -> T6 -> T7
          T2 -> T6
          T3 -> T6
          T4 -> T6
          T3 -> T8 -> T9
          T4 -> T8
Phase 3:  T6 -> T10
          T2 -> T11 -> T12
          T8 -> T12
Phase 4:  T13 -> T14
```

Execução estritamente sequencial: um worker, uma task por vez, na ordem acima. 14 tasks cabem em
dois batches de orçamento (~7), mas esta onda é executada inteira por um único worker por decisão
explícita do orquestrador — nenhum sub-agente é despachado antes do Verifier.

Dependências entre fases (não desenhadas acima, porque o cross-check de diagrama é por fase):
T5←T4; T6←T2,T3,T4; T8←T3,T4; T10←T6; T11←T2; T12←T8. Todas apontam para trás.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: serializer de log | 1 função + 1 call site no mesmo arquivo | ✅ Granular |
| T2: prop de `EditorSurface` | 1 prop, 1 arquivo | ✅ Granular |
| T3: `shareLinkClient` | 1 módulo cliente (3 métodos coesos, 1 arquivo) | ✅ Granular |
| T4: i18n | 1 bloco de chaves, espelhado em 2 locales do mesmo formato | ✅ Granular |
| T5: `PublicShell` | 1 componente | ✅ Granular |
| T6: `SharedResourcePage` | 1 componente | ✅ Granular |
| T7: a11y da visão pública | 1 arquivo de teste | ✅ Granular |
| T8: `ShareLinkPanel` | 1 componente | ✅ Granular |
| T9: a11y do painel | 1 arquivo de teste | ✅ Granular |
| T10: rota pública | 1 arquivo, 1 mudança de estrutura de rota | ✅ Granular |
| T11: `viewModeEnabled` no editor | 1 prop num call site | ✅ Granular |
| T12: montar o painel | 1 componente montado | ✅ Granular |
| T13: changeset | 1 arquivo | ✅ Granular |
| T14: inventário + roadmap | 1 arquivo gerado + 1 nota | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (sem seta) | ✅ Match |
| T2 | None | (sem seta) | ✅ Match |
| T3 | None | (sem seta) | ✅ Match |
| T4 | None | (sem seta) | ✅ Match |
| T5 | T4 | T4 -> T5 | ✅ Match |
| T6 | T2, T3, T4, T5 | T2 -> T6, T3 -> T6, T4 -> T6, T5 -> T6 | ✅ Match |
| T7 | T6 | T6 -> T7 | ✅ Match |
| T8 | T3, T4 | T3 -> T8, T4 -> T8 | ✅ Match |
| T9 | T8 | T8 -> T9 | ✅ Match |
| T10 | T6 | T6 -> T10 | ✅ Match |
| T11 | T2 | T2 -> T11 | ✅ Match |
| T12 | T8, T11 | T8 -> T12, T11 -> T12 | ✅ Match |
| T13 | None | (sem seta de entrada) | ✅ Match |
| T14 | T13 | T13 -> T14 | ✅ Match |

Nenhuma dependência aponta para uma fase posterior: toda aresta vai de uma fase anterior (ou da
mesma) para a seguinte. As arestas cross-phase são desenhadas no bloco da fase que as consome.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Serializer de log (servidor) | unit | unit | ✅ OK |
| T2 | Componente de pacote compartilhado | unit | unit | ✅ OK |
| T3 | Cliente HTTP | unit | unit | ✅ OK |
| T4 | JSON de i18n | none | none | ✅ OK |
| T5 | Componente de tela | unit | unit | ✅ OK |
| T6 | Componente de tela | unit | unit | ✅ OK |
| T7 | Acessibilidade de tela nova | unit (axe) | unit | ✅ OK |
| T8 | Componente de tela | unit | unit | ✅ OK |
| T9 | Acessibilidade de tela nova | unit (axe) | unit | ✅ OK |
| T10 | Fiação de rota | unit | unit | ✅ OK |
| T11 | Fiação de página existente | unit | unit | ✅ OK |
| T12 | Fiação de página existente | unit | unit | ✅ OK |
| T13 | Changeset | none | none | ✅ OK |
| T14 | Documentação gerada | none | none | ✅ OK |

Nenhuma task adia teste para outra: T7 e T9 criam arquivos de teste que são o próprio deliverable
(camada "Acessibilidade de tela nova" da matriz, com localização própria), seguindo a convenção já
usada em `workspace-members` (T5 daquela onda).
