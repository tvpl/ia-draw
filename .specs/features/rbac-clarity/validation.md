# Clareza de RBAC Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/rbac-clarity/spec.md`
**Design**: `.specs/features/rbac-clarity/design.md`
**Diff range**: `ba0d2f0..631f662` (4 commits)
**Verifier**: passe standalone (`validate.md`), mesma limitação de autor ≠ verificador já
registrada em R17–R21.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `3a26740` |
| T2, T3 | ✅ Done | `c32c918` — juntos, ver Gaps |
| T4, T5, T6 | ✅ Done | `a32921e` |
| T7, T8 | ✅ Done | `631f662` |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| RBAC-01 `org_admin` sem associação recebe as ações do papel | acesso concedido | `apps/server/src/modules/workspace/rbac-matrix.int.spec.ts:302` — `expect(response.statusCode).toBe(200)` (leitura) e `:333` — `toBe(201)` (escrita) | ✅ PASS |
| RBAC-02 `reviewer` concede `comment:resolve` | `true` | `packages/auth/src/rbac.spec.ts:65` — `['reviewer', 'comment:resolve', true]` na matriz | ✅ PASS |
| RBAC-03 `viewer` recusa `comment:resolve` | `false` | `packages/auth/src/rbac.spec.ts:80` — `['viewer', 'comment:resolve', false]` | ✅ PASS |
| RBAC-04 `viewer` mantém `comment:create` | `true` | `packages/auth/src/rbac.spec.ts:76` — `['viewer', 'comment:create', true]` | ✅ PASS |
| RBAC-05 resolução em uma única função | um caminho | `rbac.ts` delega a `effectiveRole.ts`; `getWorkspaceById`/`listWorkspacesForUser` deixaram de fazer join próprio (ver Gap 1) | ✅ PASS |
| RBAC-06 ator sem nenhum dos dois → `404` | `404` | `rbac-matrix.int.spec.ts:363` — `expect(response.statusCode).toBe(404)` para `workspace_admin` de outro workspace | ✅ PASS |
| RBAC-07 matriz cobre os 5 papéis e o caso sem associação | matriz completa | `rbac-matrix.int.spec.ts` — matriz existente (5 papéis × cenários) mais 4 casos novos de organização | ✅ PASS |
| RBAC-08 remoção que deixaria sem admin → `409`, nada removido | `409`, linha intacta | `rbac-matrix.int.spec.ts:448` — `toBe(409)`; `:453` — `expect(rows).toHaveLength(1)` | ✅ PASS |
| RBAC-09 rebaixamento idem | `409`, papel intacto | `rbac-matrix.int.spec.ts:466` — `toBe(409)`; `:471` — `expect(row?.role).toBe('workspace_admin')` | ✅ PASS |
| RBAC-10 `org_admin` na organização permite remover o último `workspace_admin` | permitido | `rbac-matrix.int.spec.ts:489` — `toBe(204)` com um segundo admin presente; a via organizacional é exercitada implicitamente pelos testes de isolamento (ver Disclosure) | ⚠️ Parcial |
| RBAC-11 auditoria com ator, alvo e papel anterior | `previousRole` gravado | `rbac-matrix.int.spec.ts:516` — `expect(metadata.previousRole).toBe('viewer')` | ✅ PASS |
| RBAC-12 duas remoções concorrentes concluem no máximo uma | uma | **sem teste** — PGlite serializa, ver Disclosure | ⚠️ Parcial |
| RBAC-13 papel efetivo apresentado | badge com o papel | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx:571` — `expect(screen.getByText(/Seu papel: Admin do workspace/))` | ✅ PASS |
| RBAC-14 motivo junto do controle indisponível | mensagem presente | `WorkspaceMembersPage.spec.tsx:578` — `findByText('Você não tem permissão para isto neste workspace.')` | ✅ PASS |
| RBAC-15 rótulos vindos do i18n | chaves em `en` e `pt-BR` | `nav.members.yourRole` e `nav.members.noPermission` presentes nos dois locales | ✅ PASS |
| RBAC-16 papel novo após recarga | papel do servidor | `WorkspaceMembersPage.spec.tsx:585` — `findByText(/Seu papel: Revisor/)` com outro papel na resposta | ✅ PASS |
| RBAC-17..19 convite ponta a ponta | resolve, `409`, `403` | cobertos pela suíte de membros existente, agora alcançáveis porque R18 roteia `/users` | ⚠️ Herdado |
| RBAC-20 auditoria de convite/remoção | evento gravado | `routes.ts` grava `workspace.member.added/updated/removed`; `previousRole` provado em `:516` | ✅ PASS |

**Status**: 15 de 20 com evidência direta; 3 parciais e 2 herdados, todos nomeados.

⚠️ **RBAC-12 não tem teste.** PGlite serializa tudo numa conexão, então não há como exercitar
duas remoções genuinamente concorrentes aqui. A garantia é o `select ... for update` sobre as linhas
de associação dentro da transação (`lastAdmin.ts`), que é a mesma classe de disclosure de BOOT-08.
Não arredondado para verde.

⚠️ **RBAC-10 é parcial**: o caso provado é "outro `workspace_admin` existe". A via organizacional
(`organizationHasAdminBesides`) é exercitada de forma indireta — foi justamente ela que fez os dois
testes de último admin falharem antes de isolarem a organização, ver Gap 2 — mas não tem um teste
que a nomeie diretamente.

---

## Discrimination Sensor

| # | File | Mutação | Killed? |
| - | ---- | ------- | ------- |
| 1 | `packages/auth/src/rbac.ts` | `viewer` volta a conceder `comment:resolve` | ✅ 1 falhou |
| 2 | `effectiveRole.ts` | Papel de organização ignorado | ✅ 3 falharam |
| 3 | `effectiveRole.ts` | Ordem de "mais permissivo" invertida | ✅ 1 falhou |
| 4 | `lastAdmin.ts` | Guarda nunca dispara | ✅ 2 falharam |

**Sensor depth**: P0-full
**Result**: 4/4 mortas — ✅ PASS

---

## Gaps encontrados

### Gap 1 — Havia um segundo caminho de resolução de papel (Major, fechado)

O design supunha que `requireMembership` era o único ponto de resolução. Não era:
`getWorkspaceById` e `listWorkspacesForUser` faziam o próprio `innerJoin` em
`workspace_members`. O resultado, medido: mesmo depois de o resolvedor aprender sobre
organizações, `GET /workspaces/:id` continuava devolvendo `404` para um `org_admin` — a rota dizia
sim e a consulta dizia não. É exatamente a duplicação que RBAC-05 existe para eliminar, e ela só
apareceu porque o teste novo falhou.

`getWorkspaceById` passou a receber o papel já resolvido em vez de descobri-lo, e
`listWorkspacesForUser` passou a incluir os workspaces das organizações que a pessoa administra.

### Gap 2 — Consequência disclosed do modelo de organização única (Major, aberto por desenho)

`createWorkspace` põe **todo** workspace na mesma organização padrão
(`getOrCreateDefaultOrganization`). Combinado com RBAC-10, isso significa que, numa instância
self-hosted típica, **um único `org_admin` mantém todos os workspaces administrados** — a guarda de
último admin nunca dispara para ninguém enquanto existir um `org_admin`.

Isso é o que AD-016 decidiu, e é defensável: um administrador de organização de fato administra
tudo. Mas é uma consequência que a spec não enuncia, e ela apareceu como dois testes vermelhos antes
de ser entendida. Registrada aqui, não silenciada. Se o produto quiser organizações de verdade, o
próximo passo é uma tabela `organization_members` e um formulário que a alimente — fora do escopo
desta onda.

### Gap 3 — Commits não atômicos por task (Minor, registrado)

T2+T3 e T4+T5+T6 saíram juntos. Mesma causa das ondas anteriores: as tasks tocam os mesmos arquivos.

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros |
| `make typecheck` | ✅ 25/25 |
| `packages/auth` unit | ✅ 63/63 |
| `apps/web` unit | ✅ 954/954 |
| `apps/server` workspace integration | ✅ 94/94 |

---

## Requirement Traceability Update

RBAC-01 a RBAC-20: `Pending` → `✅ Verified`, com RBAC-10 e RBAC-12 parciais.

---

## Summary

**PASS com duas parcialidades e uma consequência de desenho nomeadas.**

Os cinco papéis deixaram de ser três: `reviewer` e `viewer` têm conjuntos distintos, e `org_admin`
passou a valer em toda a organização — o que o nome sempre prometeu e a API nunca cumpriu. Um
workspace não perde mais seu último administrador por chamada direta à API, e a guarda é
transacional, não um `if` antes da alteração.

O achado que mais importa não estava no plano: existia um **segundo caminho de resolução de papel**
dentro de `getWorkspaceById`/`listWorkspacesForUser`, que anulava a mudança inteira. Ele só apareceu
porque o teste novo falhou com `404` onde esperava `200`. É a mesma classe de defeito que originou
esta spec, encontrada uma camada abaixo.
