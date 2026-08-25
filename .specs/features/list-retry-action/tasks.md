# Tentar novamente nas listas Tasks

## Execution Protocol (MANDATORY — do not skip)

Implement these tasks with the `tlc-spec-driven` skill: **activate it by name and follow its
Execute flow and Critical Rules.**

---

**Design**: skipped — nomear a função de carga já existente e chamá-la de dois lugares (efeito +
botão), sem decisão arquitetural nova.
**Status**: Draft

---

## Test Coverage Matrix

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------- | --------------------- | ----------------- | ------------ |
| Retry em `WorkspaceListPage`/`ProjectListPage`/`DiagramListPage` | unit | LRA-01..03, LRA-05: botão aparece só em erro, refaz a mesma requisição, sucesso substitui a mensagem, sem duplicar em cliques repetidos | `apps/web/src/nav/WorkspaceListPage.spec.tsx`, `ProjectListPage.spec.tsx`, `DiagramListPage.spec.tsx` | `pnpm -w test:unit` |
| Retry em `WorkspaceMembersPage` | unit | LRA-04: botão na ramificação `notFound`, refaz a mesma chamada, não distingue motivo de falha | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx` | `pnpm -w test:unit` |

## Gate Check Commands

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | Depois de cada task | `pnpm -w test:unit` |
| Full | Depois de cada task | `make lint && make typecheck && make test-unit` |
| Build | Depois da última task | `make ci` |

---

## Execution Plan

### Phase 1: As três páginas com `resourceListStore`

```
T1
```

### Phase 2: A página de membros

```
T1 -> T2
```

---

## Task Breakdown

### T1: Retry em workspaces, projetos e diagramas

**What**: Em cada uma das três páginas, extrai o corpo assíncrono do `useEffect` de carga (hoje
`client.list().then(setItems, setError)` ou equivalente `async`) para uma função nomeada chamável
tanto pelo efeito quanto por um novo botão. Renderiza o botão "Tentar novamente" (`nav.error.retry`)
ao lado de `css.errorBox` quando `status === 'error'`, chamando a mesma função.
**Where**: `apps/web/src/nav/WorkspaceListPage.tsx`, `apps/web/src/nav/ProjectListPage.tsx`,
`apps/web/src/nav/DiagramListPage.tsx`
**Depends on**: None
**Reuses**: `resourceListStore`'s `setItems`/`setError` já existentes, `css.errorBox`,
`css.buttonSecondary`.
**Requirement**: LRA-01, LRA-02, LRA-03, LRA-05

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O botão aparece só quando `status === 'error'`, nunca em `loading`/`ready`
- [ ] Acioná-lo refaz a mesma chamada de `client.list(...)` com os mesmos parâmetros
- [ ] Sucesso na nova tentativa substitui a mensagem de erro pela lista, como uma carga inicial
- [ ] A guarda `cancelled` já existente no efeito também protege a chamada disparada pelo botão
- [ ] Cliques repetidos disparam uma requisição por clique, sem acumular mensagens
- [ ] `nav.error.retry` existe em `en` e `pt-BR`
- [ ] Gate check passes: `make lint && make typecheck && make test-unit`

**Tests**: unit
**Gate**: full

**Commit**: `feat(web): add a retry action to the workspace, project and diagram lists`

---

### T2: Retry em `WorkspaceMembersPage`

**What**: A mesma ação, mas na ramificação `notFound` (é onde toda falha de carga desta página cai
hoje — MEM-03 funde rede/permissão/inexistência de propósito). O botão refaz `client.list
(workspaceId)`; sucesso popula a lista e reseta `notFound` para `false`; falha mantém a mesma tela,
sem revelar o motivo.
**Where**: `apps/web/src/nav/WorkspaceMembersPage.tsx`
**Depends on**: T1
**Reuses**: `nav.error.retry` (T1).
**Requirement**: LRA-04

**Tools**:

- MCP: NONE
- Skill: NONE

**Done when**:

- [ ] O botão aparece na tela de "não encontrado" desta página
- [ ] Acioná-lo refaz a mesma chamada de `client.list(workspaceId)`
- [ ] Sucesso populacional some com a tela de "não encontrado" e mostra a lista de membros
- [ ] Falha repetida mantém a mesma mensagem, sem novo texto revelando a causa
- [ ] Gate check passes: `make ci`

**Tests**: unit
**Gate**: build

**Commit**: `feat(web): add a retry action to the workspace members page`
