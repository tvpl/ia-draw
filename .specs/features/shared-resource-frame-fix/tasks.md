# Bug real de navegação entre frames Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — correção pontual sem decisão arquitetural nova (usar `key` para forçar
remount é o padrão React estabelecido para "este componente precisa de um novo estado inicial").
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| `SharedResourcePage` remount por frame | unit | SRF-01: `EditorSurface` recebe uma `key` que muda por frame; unmount/mount reais, não só props | `apps/web/src/share/SharedResourcePage.spec.tsx` | `pnpm -w test:unit` |
| `EditorSurface`'s contrato de `initialData` | unit | SRF-02: o teste que hoje fixa "hands new scene without remount" é reescrito para fixar o contrato real (mount-only) | `packages/editor-adapter/src/EditorSurface.spec.tsx` | `pnpm -w test:unit` |
| Navegação real de frame contra o Excalidraw real | e2e | SRF-04: canvas muda de conteúdo entre frames publicados, sem mock do Excalidraw | `apps/web/e2e/shared-presentation.spec.ts` | `pnpm --filter @arch-canvas/web run test:e2e` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de T1/T2 | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois de T4, antes do Verifier | `make ci` |

---

## Execution Plan

### Phase 1: Correção

```
T1
T1 -> T2
```

### Phase 2: Prova

```
T2 -> T3
T3 -> T4
```

---

## Task Breakdown

### T1: `SharedResourcePage` remonta o canvas por frame

**What**: Dá a `<EditorSurface>` dentro de `renderCanvas` uma `key={frame.id}` (a ramificação
`presentation`) — força o React a desmontar e remontar a cada troca de frame, já que
`viewModeEnabled` é sempre `true` aqui e não há edição local a preservar.
**Where**: `apps/web/src/share/SharedResourcePage.tsx`
**Depends on**: None
**Reuses**: `frame.id`, já presente em `ViewableFrame`.
**Requirement**: SRF-01, SRF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] `<EditorSurface>` na ramificação `presentation` recebe `key={frame.id}`
- [x] A ramificação de diagrama compartilhado (sem apresentação) permanece sem `key` — monta uma vez, nunca navega
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `fix(web): remount the shared canvas per presentation frame`

---

### T2: Corrigir o comentário e o teste que fixam a premissa errada

**What**: O comentário em `EditorSurface.tsx`'s `initialData` `useMemo` afirma que
`SharedResourcePage` "legitimately hands this component a different scene per frame without
remounting it" — falso: o `<Excalidraw/>` real só lê `initialData` no mount. Corrige o comentário
para descrever o contrato real (memoização é só estabilidade referencial; um chamador que precisa
de cena nova força remount via `key`). O teste `'hands <Excalidraw/> the new scene when
initialElements actually changes (ESTB-04)'` fixa a mesma premissa errada — reescreve para provar
só o que é verdade (o mock recebe a prop nova; isso não implica que o componente real re-lê a
cena).
**Where**: `packages/editor-adapter/src/EditorSurface.tsx`, `packages/editor-adapter/src/EditorSurface.spec.tsx`
**Depends on**: T1
**Reuses**: nenhum código novo — só correção de comentário e reescrita de teste existente.
**Requirement**: SRF-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] O comentário não afirma mais que trocar `initialElements` sem remount atualiza a cena renderizada
- [x] O comentário nomeia explicitamente o mecanismo real: remontar via `key` (referência a T1/`SharedResourcePage.tsx`)
- [x] O teste reescrito não afirma que o `<Excalidraw/>` real reage a `initialElements` pós-mount
- [x] O teste `'keeps initialData referentially stable...'` permanece verde, sem mudança
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `docs(editor-adapter): correct the initialData mount-only contract`

---

### T3: E2e contra o Excalidraw real prova a mudança de frame

**What**: Novo teste Playwright que publica uma apresentação com 2+ frames (via seed/fixture),
abre `/share/:token`, navega para o próximo frame, e afirma que o conteúdo renderizado do canvas
(ex. um elemento de texto presente só no frame 2) aparece — sem nenhum mock do `@excalidraw/
excalidraw`. É a única prova que um mock não pode fornecer, e é exatamente o tipo de teste que
teria pego o bug original.
**Where**: `apps/web/e2e/shared-presentation.spec.ts` (novo)
**Depends on**: T2
**Reuses**: `apps/web/e2e/support/runTestServer.ts` (mesmo harness de `editor-console.spec.ts`).
**Requirement**: SRF-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O teste publica uma apresentação com frames de conteúdo distinto entre si
- [ ] O teste afirma presença de um elemento exclusivo do frame 1 antes de navegar
- [ ] O teste navega para o frame 2 e afirma ausência do elemento do frame 1 e presença de um elemento exclusivo do frame 2
- [ ] O teste roda contra o `<Excalidraw/>` real, sem `vi.mock`/mock algum
- [ ] Gate check passes: `pnpm --filter @arch-canvas/web run test:e2e`

**Tests**: e2e
**Gate**: build

**Commit**: `test(web): prove frame navigation changes the real canvas content`

---

### T4: Fechar a dívida no roadmap e no handoff

**What**: Marca a entrada de `SharedResourcePage` em `remediation-roadmap.md`'s "Descoberto durante
a execução" como fechada (já feito ao criar esta spec — confirmar) e atualiza a subseção
`platform-remediation` de `.specs/STATE.md` removendo este item de "Aberto e sem dono".
**Where**: `.specs/features/platform-maturity/remediation-roadmap.md`, `.specs/STATE.md`
**Depends on**: T3
**Reuses**: nenhum.
**Requirement**: SRF-01..04 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `remediation-roadmap.md` não lista mais este item como aberto
- [ ] `.specs/STATE.md`'s "Aberto e sem dono" não lista mais o bug de `SharedResourcePage`
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): close the SharedResourcePage frame-navigation debt`
