# Recolher o painel do editor Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — um `useState` booleano e um controle condicional, sem decisão arquitetural
nova; a única escolha com alternativa real (sem persistência) já está em spec.md's Assumptions.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Toggle de recolher/expandir | unit | EPC-01..05 e os edge cases: recolher some com a largura, controle de expandir alcançável, aba interna preservada, rótulo distinto por estado | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm -w test:unit` |
| Rastreabilidade de `ui-foundations` | none | Correção da tabela para bater com `validation.md` — sem asserção automatizável, é edição de documento | `.specs/features/ui-foundations/spec.md` | `make ci` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de T1 | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make ci` |

---

## Execution Plan

### Phase 1: Controle

```
T1
T1 -> T2
```

### Phase 2: Documentação

```
T2 -> T3
```

---

## Task Breakdown

### T1: Controle de recolher/expandir o painel

**What**: Adiciona `const [panelCollapsed, setPanelCollapsed] = useState(false)` a
`DiagramEditorPage`. Quando `true`, não renderiza `<aside className="w-96 shrink-0 ...">` — em seu
lugar, uma faixa estreita (mesma posição na árvore, `row.children[1]`) com um botão "Expandir
painel". Quando `false` (padrão), renderiza o `<aside>` como hoje, com um botão "Recolher painel"
dentro dele. A aba interna ativa (`EditorSidePanel`'s estado de tab) não é afetada — ela já vive
dentro de `EditorSidePanel`, que continua montado o tempo todo quando expandido; recolher só o
deixa de RENDERIZAR, nunca desmonta seu estado entre re-expansões porque o componente
`EditorSidePanel` só desmonta quando `panelCollapsed` fica `true` — então a aba ativa É perdida a
cada recolhida. Para preservar a aba (AC4), a seleção de aba sobe para `DiagramEditorPage` como
estado próprio, passada como prop controlada para `EditorSidePanel` em vez de estado interno dele.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`, `apps/web/src/diagram/EditorSidePanel.tsx`
**Depends on**: None
**Reuses**: `css.buttonQuiet` (utilitário já existente, AD-014).
**Requirement**: EPC-01, EPC-02, EPC-03, EPC-04, EPC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] Acionar "Recolher painel" remove o `<aside>` e sua largura própria da árvore renderizada
- [x] O canvas ocupa o espaço liberado (a coluna do canvas já é `flex-1`, então isso é automático ao remover o irmão de largura fixa)
- [x] Enquanto recolhido, um controle "Expandir painel" está presente e alcançável por teclado (foco visível, `:focus-visible` de `theme.css`)
- [x] Acionar "Expandir painel" devolve o `<aside>` com `w-96` e a MESMA aba que estava ativa antes de recolher
- [x] Os dois rótulos são textualmente distintos (nunca "Recolher"/"Recolher")
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Deviation (documented, not scope creep):** este task também adiciona as duas chaves em
`apps/web/src/i18n/locales/pt-BR/translation.json` (`diagram.panel.collapse`/`expand`), embora
"Where" original só listasse os dois `.tsx`. Necessário: T1 referencia essas chaves via `t(...)`
(instrução do próprio T2), e sem a entrada pt-BR (locale padrão/de teste) os testes deste task não
teriam texto real para asserir — só a chave crua como fallback do i18next. T2 completa a cobertura
acrescentando a mesma chave em `en` (a entrada pt-BR já existirá).

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): collapse the editor side panel and return its width to the canvas`

---

### T2: Rótulos i18n

**What**: Acrescenta `diagram.panel.collapse` / `diagram.panel.expand` (e um rótulo de aria, se o
texto visível não bastar como nome acessível) em `en` e `pt-BR`.
**Where**: `apps/web/src/i18n/locales/en/translation.json`, `apps/web/src/i18n/locales/pt-BR/translation.json`
**Depends on**: T1
**Reuses**: convenção de namespace `diagram.*` já existente (`diagram.loading`).
**Requirement**: EPC-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] As duas chaves existem nos dois locales, com textos distintos entre si
- [x] `T1` referencia essas chaves via `t(...)`, nunca texto literal
- [x] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `i18n(web): add panel collapse/expand labels`

---

### T3: Corrigir a rastreabilidade de UIF-17 em `ui-foundations`

**What**: A tabela de rastreabilidade de `ui-foundations/spec.md` marca UIF-17 como `✅ Verified`
enquanto `validation.md` documenta "⚠️ Não implementado" — as duas fontes divergiam. Agora que
UIF-17 está implementado de verdade (T1), corrige a linha da tabela para `✅ Verified` de fato (não
mais uma afirmação falsa que por acaso ficou verdadeira) e acrescenta uma nota em `validation.md`
apontando para este fechamento.
**Where**: `.specs/features/ui-foundations/spec.md`, `.specs/features/ui-foundations/validation.md`
**Depends on**: T2
**Reuses**: nenhum.
**Requirement**: EPC-01..05 (fechamento documental)

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [x] A linha de UIF-17 em `ui-foundations/spec.md` bate com o estado real do código
- [x] `ui-foundations/validation.md` registra que UIF-17 foi fechado por esta feature, com referência
- [x] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(specs): reconcile UIF-17's traceability with its real implementation`
