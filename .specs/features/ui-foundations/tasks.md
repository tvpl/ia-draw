# Fundações de UI Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: `.specs/features/ui-foundations/design.md`
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Build de estilo | none | UIF-01/04: a verificação é o próprio build emitindo CSS sem aviso de configuração; não há asserção automatizável útil sobre uma folha gerada. Confirmado aqui como `none` de propósito. | `apps/web/vite.config.ts` | `pnpm --filter @arch-canvas/web build` |
| Tokens | unit | UIF-02/03: nenhum componente de produção contém valor literal de cor; verificado por varredura no próprio teste | `apps/web/src/styles/theme.spec.ts` | `pnpm -w test:unit` |
| Telas estilizadas (estrutura) | unit | Os testes existentes de cada página continuam passando sem alteração de asserção (UIF-05) | `apps/web/src/**/*.spec.tsx` | `pnpm -w test:unit` |
| Telas estilizadas (acessibilidade) | unit (a11y) | UIF-11: sem violação axe e foco visível preservado em cada tela tocada | `apps/web/src/**/*.a11y.spec.tsx` | `pnpm -w test:unit` |
| Estados de lista | unit | UIF-09/10 e os edge cases: estado vazio próprio, carregando no lugar do conteúdo, erro com ação de tentar novamente, erro tem precedência sobre vazio | `apps/web/src/nav/*.spec.tsx` | `pnpm -w test:unit` |
| Chrome do editor | unit | UIF-13..17: painel com largura própria, canvas ocupando a altura restante, seções recolhíveis consistentes, recolher devolve largura | `apps/web/src/diagram/DiagramEditorPage.spec.tsx` | `pnpm -w test:unit` |
| Varredura de tokens (fim da onda) | unit | UIF-03/13: nenhum componente de produção com literal de cor ou `style={{}}`, com as isenções nomeadas no próprio teste | `apps/web/src/styles/tokenSweep.spec.ts` | `pnpm -w test:unit` |
| Divisão de bundle | unit | UIF-18/20: o chunk de entrada não contém o motor de canvas, verificado sobre a saída do build | `apps/web/src/bundle.spec.ts` | `pnpm -w test:unit` |
| Rota do editor (fim a fim) | e2e | O canvas continua montando com carregamento sob demanda (UIF-19) | `apps/web/e2e/editor-console.spec.ts` | `pnpm --filter @arch-canvas/web test:e2e` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois das tasks de bundle e antes do Verifier | `make ci && pnpm --filter @arch-canvas/web build && pnpm --filter @arch-canvas/web test:e2e` |

---

## Execution Plan

### Phase 1: Camada de estilo

```
T1 -> T2 -> T3
```

### Phase 2: Entrada e navegação

```
T3 -> T4
T3 -> T5
T5 -> T6
T5 -> T7
T5 -> T8
T5 -> T9
```

### Phase 3: Chrome do editor e bundle

```
T3 -> T10
T10 -> T11
T11 -> T12
T3 -> T13
T10 -> T13
```

---

## Task Breakdown

### T1: Tailwind v4 no build de `apps/web`

**What**: Instala e registra o plugin de Tailwind v4 no build do Vite. Sem arquivo de configuração
em JavaScript: a configuração é CSS-first e vive no `theme.css` de T2.
**Where**: `apps/web/vite.config.ts`
**Depends on**: None
**Reuses**: a configuração de plugins já existente no arquivo.
**Requirement**: UIF-01, UIF-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `pnpm --filter @arch-canvas/web build` emite a folha de estilo gerada
- [ ] O build não emite nenhum aviso de configuração da camada de estilo
- [ ] Nenhum arquivo de configuração em JavaScript foi criado
- [ ] Changeset não é necessário — `apps/web` não é um package publicável
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: full

**Commit**: `build(web): wire Tailwind v4 into the Vite build`

---

### T2: Tokens do produto em `theme.css`

**What**: Declara em um bloco `@theme` as escalas de cor (superfície, texto, borda, acento,
perigo), espaçamento, raio, tipografia e sombra. Este é o único arquivo do produto onde um valor
literal de cor pode existir.
**Where**: `apps/web/src/styles/theme.css`
**Depends on**: T1
**Reuses**: nada — é a raiz do sistema visual.
**Requirement**: UIF-02, UIF-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Todas as escalas nomeadas na spec estão declaradas
- [ ] Um teste de varredura falha se um componente de produção contiver valor literal de cor
- [ ] Cada par de cor de texto sobre superfície atinge contraste suficiente para leitura
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): declare the product design tokens`

---

### T3: Carregar a folha da aplicação depois da do canvas

**What**: Importa `theme.css` em `main.tsx` depois de `@excalidraw/excalidraw/index.css`, para que
nenhuma regra da aplicação alcance o interior do canvas e o estilo do Excalidraw permaneça
autoritativo dentro dele.
**Where**: `apps/web/src/main.tsx`
**Depends on**: T2
**Reuses**: a ordem de importação já existente no arquivo.
**Requirement**: UIF-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] `theme.css` é importado após o CSS do Excalidraw
- [ ] Nenhuma regra da aplicação seleciona elemento dentro do canvas do Excalidraw
- [ ] A suíte de `apps/web` continua passando sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): load the app stylesheet after the canvas stylesheet`

---

### T4: Estilizar entrada (login e primeiro acesso)

**What**: Aplica o sistema à tela de entrada: formulário centrado, rótulos associados, campos e ação
primária distinguíveis, mensagem de erro com destaque próprio, estado de envio visível.
**Where**: `apps/web/src/auth/LoginPage.tsx`
**Depends on**: T3
**Reuses**: a estrutura semântica já existente; nenhum elemento novo é introduzido.
**Requirement**: UIF-06, UIF-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Formulário centrado, com hierarquia visível entre rótulo, campo e ação primária
- [ ] Estado de foco visível em todos os controles
- [ ] Nenhum `style={{}}` no arquivo
- [ ] `LoginPage.spec.tsx` e `LoginPage.a11y.spec.tsx` passam sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the sign-in screen`

---

### T5: Estilizar o shell da aplicação

**What**: Cabeçalho separado do conteúdo, navegação com elementos visualmente distintos entre si
(hoje aparecem colados), largura de conteúdo limitada e espaçamento consistente.
**Where**: `apps/web/src/app-shell/AppShell.tsx`
**Depends on**: T3
**Reuses**: a semântica `header`/`main` já correta no arquivo.
**Requirement**: UIF-07, UIF-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cabeçalho e conteúdo separados por espaçamento consistente
- [ ] Links de navegação renderizam como elementos distintos, nunca colados
- [ ] Em viewport de 1024px não há rolagem horizontal
- [ ] `shell.a11y.spec.tsx` passa sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the application shell`

---

### T6: Estilizar a lista de workspaces

**What**: Cada workspace como linha delimitada, ações alinhadas à direita, estado vazio próprio,
estado de carregamento no lugar do conteúdo e estado de erro com ação de tentar novamente.
**Where**: `apps/web/src/nav/WorkspaceListPage.tsx`
**Depends on**: T5
**Reuses**: o `status` de `resourceListStore`, que já distingue carregando, erro e pronto.
**Requirement**: UIF-08, UIF-09, UIF-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cada item é uma linha delimitada com ações alinhadas
- [ ] Estados vazio, carregando e erro têm apresentação própria; erro tem precedência sobre vazio
- [ ] Texto longo é truncado preservando as ações visíveis
- [ ] Testes existentes da página passam sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the workspace list`

---

### T7: Estilizar a lista de projetos

**What**: Mesma forma de linha, ação e estado da lista de workspaces, aplicada à lista de projetos,
incluindo o formulário de criação de projeto que hoje aparece solto no fim da página.
**Where**: `apps/web/src/nav/ProjectListPage.tsx`
**Depends on**: T5
**Reuses**: as mesmas primitivas de lista definidas em T6.
**Requirement**: UIF-08, UIF-09, UIF-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Lista e formulário de criação com a mesma forma da lista de workspaces
- [ ] Estados vazio, carregando e erro presentes
- [ ] Nenhum `style={{}}` no arquivo
- [ ] Testes existentes da página passam sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the project list`

---

### T8: Estilizar a lista de diagramas

**What**: Mesma forma aplicada à lista de diagramas, com a ação de abrir o diagrama como ação
primária da linha.
**Where**: `apps/web/src/nav/DiagramListPage.tsx`
**Depends on**: T5
**Reuses**: as mesmas primitivas de lista definidas em T6.
**Requirement**: UIF-08, UIF-09, UIF-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Abrir o diagrama é visivelmente a ação primária da linha
- [ ] Estados vazio, carregando e erro presentes
- [ ] Nenhum `style={{}}` no arquivo
- [ ] Testes existentes da página passam sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the diagram list`

---

### T9: Estilizar a página de membros

**What**: Mesma forma de linha aplicada a membros, com o seletor de papel e a ação de remover
alinhados, e o formulário de convite destacado do restante da lista.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Depends on**: T5
**Reuses**: as mesmas primitivas de lista definidas em T6.
**Requirement**: UIF-08, UIF-09, UIF-10

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Seletor de papel e ação de remover alinhados em cada linha
- [ ] Formulário de convite visualmente separado da lista
- [ ] `WorkspaceMembersPage.a11y.spec.tsx` passa sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the workspace members page`

---

### T10: Layout do chrome do editor

**What**: Substitui os nove `style={{}}` da rota do editor por utilitários, dando ao painel lateral
largura própria e ao canvas a altura restante da viewport. Resolve a sobreposição entre painel e
área de desenho e a colisão entre o rótulo e o campo do dock de IA.
**Where**: `apps/web/src/diagram/DiagramEditorPage.tsx`
**Depends on**: T3
**Reuses**: a estrutura de duas colunas já existente, agora com largura declarada.
**Requirement**: UIF-13, UIF-14, UIF-15

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O painel lateral tem largura própria e não sobrepõe a área do canvas
- [ ] O canvas ocupa toda a altura restante da viewport
- [ ] Rótulo e campo do dock de IA ocupam linhas distintas
- [ ] Nenhum `style={{}}` permanece no arquivo
- [ ] `DiagramEditorPage.spec.tsx` passa sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): give the editor side panel its own width and the canvas full height`

---

### T11: Seções recolhíveis consistentes no painel lateral

**What**: Dá às seções recolhíveis do painel a mesma affordance de expandir e recolher, e faz o
recolhimento devolver a largura ao canvas.
**Where**: `apps/web/src/diagram/EditorSidePanel.tsx`
**Depends on**: T10
**Reuses**: o contêiner tabulado que o arquivo já implementa.
**Requirement**: UIF-16, UIF-17

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Todas as seções recolhíveis têm a mesma affordance visual
- [ ] Recolher o painel devolve a largura ao canvas
- [ ] Abas continuam alcançáveis por teclado na ordem visual
- [ ] `EditorSidePanel.spec.tsx` passa sem alteração de asserção
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): make the editor panel sections visually consistent`

---

### T12: Carregar a rota do editor sob demanda

**What**: A rota do editor passa a ser carregada sob demanda, com estado de carregamento próprio,
de modo que o motor de canvas saia do chunk de entrada — hoje quem abre apenas o login baixa
mermaid, cytoscape e katex.
**Where**: `apps/web/src/App.tsx`
**Depends on**: T11
**Reuses**: a tabela de rotas existente e o `RouteErrorBoundary` entregue em R17.
**Requirement**: UIF-18, UIF-19, UIF-20

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O build emite a rota do editor em um chunk separado do chunk de entrada
- [ ] O chunk de entrada não contém o motor de canvas, verificado sobre a saída do build
- [ ] Um estado de carregamento é apresentado enquanto o chunk é buscado
- [ ] `pnpm --filter @arch-canvas/web test:e2e` continua verde
- [ ] Gate check passes: `make ci && pnpm --filter @arch-canvas/web build && pnpm --filter @arch-canvas/web test:e2e`

**Tests**: unit
**Gate**: build

**Commit**: `perf(web): load the editor route on demand`

---

### T13: Fechar as três superfícies fora das listas e travar a varredura

**What**: `PresenterModePage.tsx`, `SharedResourcePage.tsx` e `SpecViewer.tsx` também usam
`style={{}}` e nenhuma task anterior os nomeava — encontrados pela varredura de tokens ao escrever
T2. Recebem o mesmo tratamento das demais superfícies e, na mesma task, a varredura passa a ser um
teste: nenhum componente de produção com literal de cor ou estilo inline, com isenção explícita e
justificada para `presence/collaboratorColor.ts`, que gera cor de cursor por participante e é lógica
de domínio, não estilo.
**Where**: `apps/web/src/styles/tokenSweep.spec.ts`
**Depends on**: T3, T10
**Reuses**: os mesmos tokens e utilitários das tasks anteriores.
**Requirement**: UIF-03, UIF-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Nenhum `style={{}}` permanece em componente de produção de `apps/web`
- [ ] A varredura reprova quando um literal de cor é introduzido num componente
- [ ] A isenção de `collaboratorColor.ts` está nomeada e justificada dentro do teste
- [ ] A varredura ignora comentários, para não confundir `#185` de um texto com uma cor
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): style the remaining surfaces and lock the token sweep`
