# Documentação verdadeira Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — a ferramenta de auditoria já existe e já lê as duas fontes; esta onda
acrescenta uma direção de verificação e um bloco gerado. As decisões com alternativa real (bloco
delimitado em vez de README gerado, e como a superfície é reconhecida) estão em `spec.md`'s
Assumptions.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Auditoria do mapa de capacidades | unit | DOCS-05..08 e os edge cases: capacidade `backend-only` com consumidor reprova; `ui_surface` inexistente reprova; capacidade sem `ui_surface` e sem `status` reprova; rota declarada que não existe mais reprova; remoção de tela volta a ser aceita | `tools/repo-tools/src/capabilityMap.spec.ts` | `pnpm -w test:unit` |
| Bloco de números do README | unit | DOCS-01..03: o bloco é reescrito a partir das contagens medidas; divergência reprova; README ilegível ou sem bloco reprova | `tools/repo-tools/src/capabilityMap.spec.ts` | `pnpm -w test:unit` |
| `capability-map.yaml` (dados) | unit | DOCS-04: toda capacidade com componente correspondente declara `ui_surface`; verificado pela própria auditoria | `docs/capability-map.yaml` | `pnpm --filter @arch-canvas/repo-tools run audit` |
| Documentação em prosa | none | DOCS-09..13 não têm asserção automatizável — é o residual de F7 já registrado em `STATE.md`. A verificação é seguir o Quick start literalmente e o gate exercitar cada passo afirmado. Confirmado aqui como `none` de propósito. | `README.md`, `docs/adr/`, `CLAUDE.md` | `make ci` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de tasks só com unit tests | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task, antes do Verifier | `make ci && pnpm --filter @arch-canvas/repo-tools run audit` |

---

## Execution Plan

### Phase 1: Dados corretos primeiro

```
T1
```

### Phase 2: Ferramenta

```
T1 -> T2
T2 -> T3
T3 -> T4
```

### Phase 3: Prosa e decisões

```
T4 -> T5
T5 -> T6
T6 -> T7
```

---

## Task Breakdown

### T1: Corrigir o mapa de capacidades

**What**: Declara `ui_surface` para toda capacidade que hoje tem componente correspondente em
`apps/web/src` e remove o `status: backend-only` dessas entradas — entre elas "Workspaces, projetos
e RBAC", ainda marcada `backend-only` embora `WorkspaceMembersPage.tsx` exista com três arquivos de
teste. Vem antes da ferramenta de propósito: ligar um gate sobre dados errados produz um vermelho
que ninguém consegue resolver.
**Where**: `docs/capability-map.yaml`
**Depends on**: None
**Reuses**: o próprio formato de entrada já validado pela auditoria.
**Requirement**: DOCS-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Toda capacidade com componente correspondente declara `ui_surface` apontando um arquivo existente
- [ ] Nenhuma capacidade com tela permanece marcada `backend-only`
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` sai 0
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `docs(capability-map): declare the UI surfaces that already exist`

---

### T2: Auditoria passa a checar a direção reversa

**What**: A auditoria passa a reprovar quando uma capacidade marcada `backend-only` tem alguma de
suas rotas consumida por um componente de `apps/web/src`, e quando uma capacidade nova não declara
nem `ui_surface` nem `status`. É a direção que faltava: hoje o gate só verifica mapa → código, então
criar uma tela nunca obriga a atualizar o mapa e a documentação só pode subdimensionar.
**Where**: `tools/repo-tools/src/capabilityMap.ts`
**Depends on**: T1
**Reuses**: `webConsumers.ts`, que já extrai qual rota cada componente consome.
**Requirement**: DOCS-05, DOCS-06, DOCS-07, DOCS-08

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Marcar uma capacidade com tela como `backend-only` reprova a auditoria nomeando capacidade e consumidor
- [ ] Uma `ui_surface` apontando arquivo inexistente continua reprovando
- [ ] Uma capacidade sem `ui_surface` e sem `status` reprova exigindo um dos dois
- [ ] Uma rota declarada que não existe mais reprova nomeando a rota
- [ ] Remover uma tela e voltar a capacidade para `backend-only` é aceito sem intervenção manual
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(repo-tools): fail the audit when a shipped surface is still marked backend-only`

---

### T3: Auditoria reescreve o bloco de números

**What**: A auditoria passa a reescrever um bloco delimitado do README com as contagens medidas
(capacidades, capacidades com tela, rotas registradas, rotas consumidas) e a reprovar quando o bloco
no arquivo diverge do medido. A prosa em volta permanece intocada — é o que envelhece bem.
**Where**: `tools/repo-tools/src/routeInventory.ts`
**Depends on**: T2
**Reuses**: a mesma escrita de arquivo que já gera `docs/route-inventory.md`.
**Requirement**: DOCS-01, DOCS-03

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Rodar a auditoria com o README correto não altera o arquivo
- [ ] Alterar um número à mão faz a auditoria reprovar
- [ ] README sem o bloco delimitado faz a auditoria reprovar pedindo o bloco
- [ ] README ilegível faz a auditoria reprovar, nunca passar por omissão
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(repo-tools): generate the README capability and route counts`

---

### T4: Bloco delimitado no README com os números reais

**What**: Insere o bloco delimitado no README, preenchido pela auditoria, e remove toda contagem
escrita à mão do texto — hoje o documento afirma 26 capacidades, 4 com tela, 82 rotas e 4
consumidas, contra 90 rotas e 49 consumidas medidas.
**Where**: `README.md`
**Depends on**: T3
**Reuses**: a própria seção de status do README, que continua em prosa revisada por gente.
**Requirement**: DOCS-01, DOCS-02

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O bloco delimitado existe e está preenchido pela auditoria
- [ ] Nenhuma contagem de capacidade ou de rota permanece fora do bloco
- [ ] `pnpm --filter @arch-canvas/repo-tools run audit` roda e não altera o arquivo
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `docs(readme): replace hand-written counts with the generated block`

---

### T5: Quick start e deploy descrevem o caminho real

**What**: Reescreve o Quick start e a seção de deploy para descrever o primeiro acesso e a criação
do administrador inicial entregues em R19, sem afirmar nenhum passo que o gate não exercite. Hoje o
Quick start termina em "abre em `localhost:8080`" sem mencionar que não existe conta com que entrar.
**Where**: `README.md`
**Depends on**: T4
**Reuses**: a estrutura de seções já existente do documento.
**Requirement**: DOCS-09, DOCS-10, DOCS-11

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O Quick start descreve subir, criar o administrador inicial e abrir um diagrama
- [ ] A seção de deploy descreve o mesmo primeiro acesso numa instância remota
- [ ] Todo passo afirmado é exercitado pelo job de smoke do compose
- [ ] Gate check passes: `make ci`

**Tests**: none
**Gate**: build

**Commit**: `docs(readme): describe the real path from make up to a first diagram`

---

### T6: ADRs das decisões estruturais da onda

**What**: Registra uma ADR por decisão estrutural nova de F11: fonte única de prefixos de borda,
adoção de Tailwind v4 com tokens, primeiro acesso como rota pública autolimitada, e papel de
organização com efeito cross-workspace.
**Where**: `docs/adr/`
**Depends on**: T5
**Reuses**: `docs/adr/TEMPLATE.md`, o formato já usado por `0001..0009`.
**Requirement**: DOCS-12

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Existe uma ADR por decisão estrutural da onda, numerada em sequência
- [ ] Cada ADR nomeia contexto, decisão, trade-off e escopo
- [ ] Cada ADR corresponde a uma entrada na seção Decisions de `.specs/STATE.md`
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: none
**Gate**: full

**Commit**: `docs(adr): record the structural decisions of the F11 remediation wave`

---

### T7: Invariantes novas no `CLAUDE.md`

**What**: Acrescenta ao onboarding as invariantes que a onda introduziu — os prefixos de borda vêm
de uma fonte única, o estilo vem de tokens e utilitários, o primeiro acesso é a única rota pública
de criação de conta, e o papel de organização vale em todos os workspaces dela.
**Where**: `CLAUDE.md`
**Depends on**: T6
**Reuses**: a seção de invariantes de arquitetura já existente no arquivo.
**Requirement**: DOCS-13

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] Cada invariante nova aparece resumida e aponta para a ADR correspondente
- [ ] Nenhuma invariante existente foi removida
- [ ] Gate check passes: `make ci && pnpm --filter @arch-canvas/repo-tools run audit`

**Tests**: none
**Gate**: build

**Commit**: `docs: record the F11 invariants in the agent onboarding`
