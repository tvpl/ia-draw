# Membros e papéis do workspace (`workspace-members`) Validation

**Date**: 2026-08-16
**Spec**: `.specs/features/workspace-members/spec.md`
**Diff range**: `7feb434..267a8b7` (9 commits, feature-exclusive — nothing else interleaved)
**Verifier**: independent sub-agent (author ≠ verifier)
**Round**: 1

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1: `GET /users:lookup` route | ✅ Done | `apps/server/src/modules/auth/routes.ts:180-188`; OpenAPI wired at `:92`; tests at `apps/server/src/modules/auth/users.int.spec.ts` (4 tests) |
| T2: `memberClient` | ✅ Done | `apps/web/src/nav/memberClient.ts` (139 lines); 18 unit tests, 100% line/branch coverage reported by the web coverage run |
| T3: `nav.members` i18n keys | ✅ Done | Identical key sets in `apps/web/src/i18n/locales/{en,pt-BR}/translation.json:84-108` |
| T4: `WorkspaceMembersPage` | ✅ Done | `apps/web/src/nav/WorkspaceMembersPage.tsx` (296 lines); 15 RTL tests |
| T5: a11y coverage | ✅ Done | `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx` (5 tests, 2 axe states + keyboard + live region + `en` locale) |
| T6: routing + `ProjectListPage` link | ✅ Done | `apps/web/src/App.tsx:47`, `apps/web/src/nav/ProjectListPage.tsx:246`; audit re-run confirms all 5 routes `consumed` |

All 6 tasks marked `[x]` in `tasks.md`; every "Done when" box independently re-derived below. No blocked or partial tasks.

---

## Spec-Anchored Acceptance Criteria

### P1: Ver os membros do workspace (MEM-01..03)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MEM-01: acessar `/w/:workspaceId/members` → lista de `GET /workspaces/:id/members` com e-mail, nome e papel | Cada membro renderiza e-mail + displayName + papel | `apps/web/src/nav/WorkspaceMembersPage.spec.tsx:94-97` — `expect(await screen.findByText('bob@example.com')).toBeTruthy()`, `getByText('Bob')`, `getByText('Editor')`, `getByText('Visualizador')`; route-level at `apps/web/src/App.spec.tsx:275-277` — `findByRole('heading', {name: 'Membros'})` + `getByText('a@b.com')` inside `AppShell` chrome | ✅ PASS |
| MEM-02: link em `ProjectListPage` para qualquer papel | Link visível mesmo para `viewer`, apontando a `/w/:id/members` | `apps/web/src/nav/ProjectListPage.spec.tsx:136-146` — `findByRole('link', {name: 'Membros'})` com `workspaceDetailResponse('viewer')`; `expect(membersLink).toHaveProperty('href', expect.stringContaining('/w/ws-1/members'))`. Código: `ProjectListPage.tsx:246` renderiza o link fora de qualquer guarda de papel | ✅ PASS |
| MEM-03: `404` em `GET .../members` → tratado como "não existe ou sem acesso" (convenção IDOR) | Mesma mensagem compartilhada `nav.notFound` | `WorkspaceMembersPage.spec.tsx:115-117` — `expect(await screen.findByText('Este item não existe ou você não tem acesso a ele.')).toBeTruthy()`. Código: `WorkspaceMembersPage.tsx:88-93` (`catch` → `setNotFound(true)`) | ✅ PASS |

### P1: Convidar um membro por e-mail (MEM-04..09)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MEM-04: convidar visível só com `workspace:manage_members` | Form ausente para papel sem a permissão; presente para admin | Negativo: `WorkspaceMembersPage.spec.tsx:101` — `expect(screen.queryByRole('button', {name: 'Convidar'})).toBeNull()` (papel `viewer`). Positivo: `:150-151` — `findByRole('button', {name: 'Convidar'})` + `getByLabelText('E-mail')` (papel `workspace_admin`). Código: `WorkspaceMembersPage.tsx:112-114` via `can(..., 'workspace:manage_members')` | ✅ PASS |
| MEM-05: e-mail + papel + confirmar → emitir `GET /users:lookup?email=` primeiro | Lookup é a primeira requisição do fluxo | `WorkspaceMembersPage.spec.tsx:158` — o mock só resolve `'/users:lookup?email=nobody%40example.com'`, qualquer outra URL lança; `:185` mesma prova no caminho 200 antes do `POST`. Código: `WorkspaceMembersPage.tsx:128` é o **único** call site de `lookupByEmail`, dentro de `handleInviteSubmit` | ✅ PASS |
| MEM-06: lookup `404` → "nenhuma conta encontrada", **sem** emitir `POST` | Mensagem `nav.members.notFound`; zero `POST` | `WorkspaceMembersPage.spec.tsx:170-178` — `expect(...textContent).toBe('Nenhuma conta encontrada com esse e-mail.')` **e** `expect(fetchImpl).not.toHaveBeenCalledWith(expect.stringContaining('/members'), expect.objectContaining({method: 'POST'}))`; reforçado por `:159` (`if (init?.method === 'POST') throw new Error('unexpected POST')`) | ✅ PASS |
| MEM-07: lookup `200` → `POST` com `{userId: <id resolvido>, role: <papel escolhido>}` | Corpo exato de dois campos | `WorkspaceMembersPage.spec.tsx:190` — `expect(JSON.parse(init.body as string)).toEqual({userId: 'user-3', role: 'reviewer'})` (o `userId` vem do lookup, não do form) | ✅ PASS |
| MEM-08: `POST` `409` → informar conflito, sem duplicata na lista | Mensagem `nav.members.alreadyMember`; nenhum item novo | `WorkspaceMembersPage.spec.tsx:240-245` — `expect(...textContent).toBe('Essa pessoa já é membro deste workspace.')` **e** `expect(screen.queryByText('Dupe')).toBeNull()` | ✅ PASS |
| MEM-09: `POST` `201` → adiciona à lista sem recarregar a página | Item aparece; nenhum segundo `GET .../members` | `WorkspaceMembersPage.spec.tsx:212-217` — `expect(await screen.findByText('Carol')).toBeTruthy()` **e** contagem explícita `expect(rawFetchImpl.mock.calls.filter(([url, init]) => url === '/workspaces/ws-1/members' && !init).length).toBe(1)` | ✅ PASS |

### P1: Trocar o papel de um membro (MEM-10..13)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MEM-10: trocar papel visível por membro só com `workspace:manage_members` | Nenhum `combobox` de papel para papel sem a permissão | `WorkspaceMembersPage.spec.tsx:102` — `expect(screen.queryByRole('combobox')).toBeNull()` (papel `viewer`); código `WorkspaceMembersPage.tsx:232-251` (`canManage ? <select/> : <span/>`) | ✅ PASS |
| MEM-11: escolher novo papel → `PATCH .../members/:userId` com `{role}`, refletir só após `200`, **nunca antes** | Corpo `{role}`; UI muda só no sucesso | Positivo: `WorkspaceMembersPage.spec.tsx:349` — `expect(JSON.parse(init.body as string)).toEqual({role: 'reviewer'})` e `:360-362` — select vale `'reviewer'` após `200`. "Nunca antes" provado pelo negativo em `:385` — `expect((...combobox).value).toBe('editor')` quando o `PATCH` falha. Código: `WorkspaceMembersPage.tsx:174-179` (`replaceItem` só em `status === 'ok'`) | ✅ PASS |
| MEM-12: troca na própria linha + único admin + novo papel não-admin → bloquear **antes** da requisição, explicando | Zero `PATCH`; mensagem `lastAdminBlock.selfDowngrade` | `WorkspaceMembersPage.spec.tsx:408-409` (mock lança em qualquer `PATCH`: `'unexpected PATCH — self-downgrade must be blocked client-side'`), `:418-422` — `expect(...textContent).toBe('Você não pode trocar seu próprio papel — você é o único admin deste workspace.')`, `:424-426` — select revertido a `'workspace_admin'`. Código: `WorkspaceMembersPage.tsx:169-172` — as **três** conjunções (`item.userId === user?.id && isSoleAdmin && !ADMIN_ROLES.includes(newRole)`) exatamente como a spec | ✅ PASS |
| MEM-13: `PATCH` `403` ou `404` → informar falha e manter o papel anterior | Falha anunciada; papel anterior preservado | `403` no componente: `WorkspaceMembersPage.spec.tsx:380-385` — `expect(...textContent).toBe('Algo deu errado. Tente novamente.')` **e** `expect((...combobox).value).toBe('editor')`. `404` no cliente: `apps/web/src/nav/memberClient.spec.ts:140-147` — `expect(client.changeRole('ws-1','missing','viewer')).resolves.toEqual({status:'error'})`, e o componente trata todo `status !== 'ok'` pelo mesmo ramo (`WorkspaceMembersPage.tsx:180`), logo o comportamento de `404` é o mesmo já asserido para `403` | ✅ PASS |

### P1: Remover um membro (MEM-14..18)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MEM-14: remover visível por membro só com `workspace:manage_members` | Nenhum botão "Remover" para papel sem a permissão | `WorkspaceMembersPage.spec.tsx:103` — `expect(screen.queryByRole('button', {name: 'Remover'})).toBeNull()` (papel `viewer`) | ✅ PASS |
| MEM-15: acionar remover → confirmação via `ConfirmArchiveDialog` citando o nome do membro | Diálogo reusado, `itemName` = displayName | `WorkspaceMembersPage.spec.tsx:463` — `expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Ann')`. Código: `WorkspaceMembersPage.tsx:286-293` reusa `ConfirmArchiveDialog` sem alteração no componente (diff não toca `ConfirmArchiveDialog.tsx`) | ✅ PASS |
| MEM-16: alvo é o próprio usuário **e** ele é o único admin → bloquear **antes** de abrir a confirmação | Diálogo nunca abre; mensagem `lastAdminBlock.selfRemove`; zero `DELETE` | `WorkspaceMembersPage.spec.tsx:513-514` (mock lança em qualquer `DELETE`), `:523-527` — `expect(...textContent).toBe('Você não pode se remover — você é o único admin deste workspace.')`, `:528` — `expect(screen.queryByTestId('confirm-archive-confirm')).toBeNull()` (o diálogo **nunca abriu**, não apenas fechou). Código: `WorkspaceMembersPage.tsx:184-188` — `return` antes de `setRemoveTarget` | ✅ PASS |
| MEM-16 (escopo — negativo, "Independent Test" da spec) | Um **segundo** admin removendo o primeiro admin **não** é bloqueado | `WorkspaceMembersPage.spec.tsx:531-553` — ator logado é `user-2`, alvo `user-1` (ambos admin); `:549` — `expect(screen.getByTestId('confirm-archive-item-name').textContent).toBe('Me')` (diálogo abre normalmente) e `:552` — o membro some após `204`. Confirmado empiricamente pela mutação 2 do sensor (guarda deliberadamente alargada → este teste falha) | ✅ PASS |
| MEM-17: confirmar → `DELETE .../members/:userId`, após `204` remove da lista sem recarregar | Item some; nenhum `GET` de recarga | `WorkspaceMembersPage.spec.tsx:465-467` — `fireEvent.click(getByTestId('confirm-archive-confirm'))` então `await waitFor(() => expect(screen.queryByText('Ann')).toBeNull())`. "Sem recarregar" é provado implicitamente: o mock (`:453`) responderia a um segundo `GET .../members` com a lista original de 2 membros, reintroduzindo "Ann" e derrubando a asserção | ✅ PASS |
| MEM-18: `DELETE` `403` ou `404` → informar falha e manter o membro na lista | Falha anunciada; item preservado | `403` no componente: `WorkspaceMembersPage.spec.tsx:485-490` — `expect(...textContent).toBe('Algo deu errado. Tente novamente.')` **e** `expect(screen.getByText('Ann')).toBeTruthy()`. `404` no cliente: `memberClient.spec.ts:179-184` — `resolves.toEqual({status: 'error'})`, mesmo ramo de tratamento no componente (`WorkspaceMembersPage.tsx:205`) | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas (MEM-19..21)

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| MEM-19: toda ação alcançável só por teclado | Cada controle recebe foco | `apps/web/src/nav/WorkspaceMembersPage.a11y.spec.tsx:163-202` — sete asserções `expect(document.activeElement).toBe(...)` cobrindo link voltar, select de papel por linha, botão remover, input de e-mail, select de papel do convite, botão convidar e o botão de confirmação do diálogo. Reforçado por `:103-161` (axe, dois estados, `expect(seriousOrCriticalViolations(results)).toEqual([])`) | ✅ PASS |
| MEM-20: resultado anunciado em região `aria-live="polite"` | Atributo correto + conteúdo do resultado | `WorkspaceMembersPage.a11y.spec.tsx:217` — `expect(liveRegion.getAttribute('aria-live')).toBe('polite')` e `:222` — `expect(liveRegion.textContent).toBe('Membro removido.')`. Sucesso e falha nos três fluxos: convite (`WorkspaceMembersPage.spec.tsx:171,241,268`), troca de papel (`:381,419`), remoção (`:486,524`) | ✅ PASS |
| MEM-21: todo texto visível de chaves i18n, em `pt-BR` e `en`, sem literal no componente | Ambos os locales renderizam | `WorkspaceMembersPage.a11y.spec.tsx:225-240` — após `i18n.changeLanguage('en')`: `findByRole('heading', {name: 'Members'})`, `getByRole('link', {name: 'Back'})`, `getByRole('button', {name: 'Invite'})`, `getByLabelText('Email')`, `getAllByRole('button', {name: 'Remove'})`; `pt-BR` coberto por todo `WorkspaceMembersPage.spec.tsx`. Ausência de literal verificada por leitura: cada string visível em `WorkspaceMembersPage.tsx` passa por `t(...)`; chaves paritárias em `en/translation.json:84-108` e `pt-BR/translation.json:84-108` | ✅ PASS |

**Status**: ✅ All 21 ACs covered — 21/21 asserções batem com o outcome definido na spec. Zero spec-precision gaps.

---

## Foco independente — superfície de segurança

Atenção dedicada aos pontos que um autor tende a auto-confirmar:

1. **Proteções de último admin (MEM-11..12, MEM-16..17)** — positivo **e** negativo cobertos. O positivo bloqueia com a conjunção exata da spec (`self && soleAdmin && !adminRole` para downgrade; `self && soleAdmin` para remoção), e o bloqueio acontece **antes** de qualquer I/O — provado por mocks que lançam em `PATCH`/`DELETE` inesperados, não apenas por contagem de chamadas. O negativo (`WorkspaceMembersPage.spec.tsx:531-553`) prova o escopo: a proteção é da própria linha do usuário logado, não de qualquer admin. Mutação 2 do sensor (guarda alargada para "qualquer admin") mata esse teste — a cobertura do negativo é real, não decorativa.
2. **MEM-08 / checagem client-side de já-membro** — a checagem contra a lista já carregada é genuinamente client-side e precede o `POST`: `WorkspaceMembersPage.tsx:141` (`items.some((item) => item.userId === lookup.user.id)`) com `return` antes de `client.add`. O teste em `WorkspaceMembersPage.spec.tsx:248-277` usa um mock que **lança** em qualquer `POST` (`:257`) e ainda assim asserta a mensagem "já é membro" — ou seja, não há dependência do `409` do servidor. O `409` continua tratado, mas como segunda linha (`:220-246`).
3. **`GET /users:lookup` (MEM-04..06)** — `apps/server/src/modules/auth/routes.ts:180` usa apenas `preHandler: requireSession(db)`, sem nenhuma checagem de workspace/papel — deliberado conforme a Assumptions table da spec. A projeção é explícita (`.select({id, email, displayName})`, `:182`), nunca `select()` completo. O teste em `users.int.spec.ts:64-66` usa `toEqual` de forma exata (`expect(body.user).toEqual({id, email, displayName})`), o que **quebra** se qualquer campo extra vazar — verificado empiricamente pela mutação 8 do sensor, que trocou a projeção por `select()` e fez o teste falhar exibindo o `passwordHash` argon2id. O `404` é limpo (`:187`, helper `notFound()` compartilhado, mesmo padrão de `webhook/snapshot/lint/asset`), e o `401` sem sessão está coberto (`users.int.spec.ts:114-124`). OpenAPI: registrado em `routeSchemas` (`routes.ts:92`) com o `userLookupQuerySchema` Zod; `pnpm --filter @arch-canvas/repo-tools run audit` re-executado de forma independente — saída `90 routes, 19 consumed, 71 pending-product`, `docs/openapi.json` contém `/users:lookup` com o parâmetro `email` (`required: true`, `minLength: 1`), e a árvore permaneceu limpa (audit idempotente, nada por regenerar).
4. **Risco de enumeração / rate-limiting no lookup** — a busca é genuinamente *submit-only*, não live-search. `lookupByEmail` tem **um único** call site em todo o componente (`WorkspaceMembersPage.tsx:128`), dentro de `handleInviteSubmit`; o `onChange` do input de e-mail (`:264`) faz apenas `setInviteEmail`, sem efeito de rede. Não há `useEffect` observando `inviteEmail`. O guard de concorrência `inviteInFlight` (`:120`, `:75`) impede um segundo submit durante a busca — asserido por contagem exata em `WorkspaceMembersPage.spec.tsx:301-305` (`toHaveLength(1)` após dois cliques) e morto pela mutação 6 do sensor. Nenhum rate-limit server-side foi adicionado, o que é consistente com o escopo declarado (a spec pede o *gating* no cliente); registrado como observação abaixo, não como gap de AC.

---

## Discrimination Sensor

**Scratch**: `git worktree add <scratch>/sensor HEAD` (worktree isolado; `node_modules` linkados por symlink). Nenhum `git stash`. Baseline `git status --porcelain` = vazio, capturado antes de qualquer mutação. Worktree removido com `git worktree remove --force`; `git status --porcelain` pós-sensor = vazio, idêntico ao baseline. Baseline verde confirmado no scratch antes de mutar: `Test Files 28 passed (28) / Tests 265 passed (265)`.

| # | File:line | Description | Killed? |
| --- | --- | --- | --- |
| 1 | `apps/web/src/nav/WorkspaceMembersPage.tsx:184` | Bloqueio de auto-remoção: `isSoleAdmin` → `!isSoleAdmin` (proteção desligada exatamente no caso perigoso) | ✅ Killed — 1 failed (MEM-16) |
| 2 | `apps/web/src/nav/WorkspaceMembersPage.tsx:184` | Guarda **alargada**: `item.userId === user?.id && isSoleAdmin` → `ADMIN_ROLES.includes(item.role)` (bloquearia qualquer remoção de admin) | ✅ Killed — 3 failed, incluindo o "Independent Test" do escopo (`:531`) e MEM-15/MEM-18 |
| 3 | `apps/web/src/nav/WorkspaceMembersPage.tsx:169` | Bloqueio de auto-rebaixamento: `isSoleAdmin` → `!isSoleAdmin` | ✅ Killed — 1 failed (MEM-12) |
| 4 | `apps/web/src/nav/WorkspaceMembersPage.tsx:112-114` | Gate de papel removido: `canManage = can(...).allowed` → `canManage = true` (convite/troca/remoção expostos a qualquer papel) | ✅ Killed — 1 failed (MEM-04/10/14, caso `viewer`) |
| 5 | `apps/web/src/nav/WorkspaceMembersPage.tsx:141` | Pré-checagem de já-membro desligada: `items.some(...)` → `false` | ✅ Killed — 1 failed (edge case "já é membro antes do POST") |
| 6 | `apps/web/src/nav/WorkspaceMembersPage.tsx:120` | Guard de concorrência removido: `if (inviteInFlight) return;` → `if (false) return;` | ✅ Killed — 1 failed (edge case duplo-submit) |
| 7 | `apps/server/src/modules/auth/routes.ts:187` | Ramo 404 do lookup: `if (!user) notFound();` → `if (user === null) notFound();` (nunca dispara; devolveria 200 com `user` indefinido) | ✅ Killed — 1 failed (`users.int.spec.ts` "returns 404") |
| 8 | `apps/server/src/modules/auth/routes.ts:181-183` | Vazamento de campo: projeção `.select({id, email, displayName})` → `.select()` (retorna todas as colunas de `users`) | ✅ Killed — 1 failed, diff do teste exibindo o `passwordHash` argon2id vazado |

**Sensor depth**: P0-full (8 mutações manuais, ≥5 exigidas — lógica adjacente a autorização: gating de papel, proteção de último admin, superfície de enumeração de contas)
**Result**: 8/8 killed — PASS ✅ (zero sobreviventes)

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ — `memberClient.ts` tem exatamente os 5 métodos que a tela usa; nenhum helper especulativo |
| No features beyond what was asked | ✅ — nada de convite assíncrono, criação de conta ou guarda server-side (todos explicitamente Out of Scope na spec) |
| No abstractions for single-use code | ✅ — `ROLE_KEY`/`ADMIN_ROLES`/`toMemberItem` são constantes locais mínimas, não uma camada |
| No unnecessary "flexibility" added | ✅ — `fetchImpl` injetável segue a convenção já existente (`resourceClient.ts`, `syncClient.ts`), não é nova |
| Surgical changes / only touched files required | ✅ — 17 arquivos, todos previstos pelas tasks; `ConfirmArchiveDialog.tsx` reusado **sem alteração**, como a spec decidiu |
| Didn't "improve" unrelated code | ✅ — `docs/openapi.json` e `docs/route-inventory.md` são artefatos gerados, regenerados pelos scripts do repo (audit re-executado: idempotente) |
| Matches existing patterns/style | ✅ — `notFound()` local igual a `webhook`/`snapshot`/`lint`/`asset`; `requireSession(db)` preHandler; shim de `<dialog>` do jsdom igual a `ProjectListPage.spec.tsx`; helper `seriousOrCriticalViolations` igual a `shell.a11y.spec.tsx` |
| Would senior engineer approve? | ✅ — comentários explicam o *porquê* não-óbvio (o de `memberClient.ts:52-56` documenta por que os call sites usam `fetchImpl(` literal: o extrator do route-inventory só reconhece a forma literal) |
| Tests map to ACs and are non-shallow | ✅ — spot-check em "Remover": os testes negativos usam mocks que **lançam** na requisição proibida, em vez de só contar chamadas |
| Spec-anchored outcome check | ✅ — 21/21; asserções de valor exato (`toEqual({userId, role})`, `toBe('Nenhuma conta encontrada com esse e-mail.')`, `toBe('workspace_admin')`), não meras verificações de existência |
| Per-layer Coverage Expectation met | ✅ — rota nova: happy (200 exato) + erro (404) + auth (401) + escopo (sessão sem membership); cliente: todo ramo de status documentado, 100% de cobertura reportada em `memberClient.ts`; componente: 1:1 com MEM-01..18 |
| Every test maps to a spec requirement — no unclaimed tests | ✅ — todo `it(...)` novo cita um MEM-NN ou "(edge case)" da seção Edge Cases da spec |
| Documented guidelines followed | ✅ — `CLAUDE.md` (Node 22, comandos, ADR-0007/PGlite); `.specs/features/workspace-members/tasks.md` (Test Coverage Matrix cumprida em todas as 6 linhas) |

**Observações (não são gaps de AC, nenhuma ação exigida nesta fatia):**

- `canManage` deriva da própria linha do usuário na lista de membros (`WorkspaceMembersPage.tsx:111-114`). Um `org_admin` que não seja linha de membership deste workspace veria a tela em modo leitura. Consistente com o que `GET /workspaces/:id/members` devolve e com o restante da frente; fora do escopo dos ACs.
- `handleRoleChange`/`confirmRemove` colapsam `forbidden` e `error` na mesma mensagem genérica. MEM-13/MEM-18 pedem apenas "informar a falha", então isso satisfaz a spec como escrita.
- Nenhum rate-limit server-side em `GET /users:lookup`. A spec trata a mitigação de enumeração como *gating* no cliente (Edge Case 1), cumprido; um limite server-side seria uma decisão nova, fora desta fatia.

---

## Edge Cases

- [x] **Lookup só no submit, nunca por tecla** — `lookupByEmail` tem um único call site (`WorkspaceMembersPage.tsx:128`) dentro de `handleInviteSubmit`; o `onChange` do input (`:264`) não faz rede e não há `useEffect` sobre `inviteEmail`. Contagem exata de chamadas em `WorkspaceMembersPage.spec.tsx:301-305`.
- [x] **E-mail já é membro → avisar antes do `POST`** — `WorkspaceMembersPage.tsx:141-146` (checagem contra a lista carregada, mensagem distinta de "não encontrado"); teste `WorkspaceMembersPage.spec.tsx:248-277`, com o mock lançando em qualquer `POST`. Mutação 5 do sensor mata.
- [x] **Papel revogado com a tela aberta → `403` tratado como qualquer falha, sem quebrar a tela** — `WorkspaceMembersPage.spec.tsx:365-386` (`PATCH` 403: anuncia e mantém o papel; a tela segue renderizada e a linha continua interativa) e `:470-491` (`DELETE` 403: anuncia e mantém o membro na lista).
- [x] **Segundo submit durante uma busca/adição em andamento → nenhuma segunda requisição** — `WorkspaceMembersPage.tsx:120` + `:75`; teste `WorkspaceMembersPage.spec.tsx:279-313` com lookup pendente e `toHaveLength(1)`. Mutação 6 do sensor mata.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (nível Build de `tasks.md`, adaptado ao gate substituto documentado em `CLAUDE.md` para este sandbox), mais `pnpm --filter @arch-canvas/server run test:integration` rodado à parte.
- **Result**: exit code **0**. Unit: **1070 passed, 0 failed, 0 skipped** em 114 arquivos de teste (13 pacotes). Lint e typecheck limpos.
  - `@arch-canvas/web`: 265 passed (28 files) · `@arch-canvas/server`: 395 passed (39 files) · `@arch-canvas/ai-tools` 70 · `@arch-canvas/diagram-ir` 68 · `@arch-canvas/auth` 63 · `@arch-canvas/editor-adapter` 60 · `@arch-canvas/repo-tools` 49 · `@arch-canvas/diagram-domain` 29 · `@arch-canvas/shared-contracts` 27 · `@arch-canvas/mcp` 20 · `@arch-canvas/library-content` 12 · `@arch-canvas/test-fixtures` 8 · `@arch-canvas/backup` 4.
- **Integração (servidor)**: `350 passed | 13 skipped (363)`, **zero falhas de teste**. Três arquivos abortam no *setup*, todos por binários ausentes neste sandbox e sem relação alguma com esta feature — `ws-gateway/presenceBroadcaster.int.spec.ts` (6 skipped) e `ws-gateway/crossInstancePresence.int.spec.ts` (2 skipped) por `spawn redis-server ENOENT`, e `backup/restoreTest.int.spec.ts` (5 skipped) pela mesma classe de lacuna de host — exatamente o cenário previsto em `CLAUDE.md`. O arquivo novo desta fatia foi executado isoladamente para confirmar: `pnpm exec vitest run -c vitest.integration.config.ts src/modules/auth/users.int.spec.ts` → **`Test Files 1 passed (1) / Tests 4 passed (4)`**.
- **Audit**: `pnpm --filter @arch-canvas/repo-tools run audit` → exit 0, `90 routes, 19 consumed, 71 pending-product`; as 4 rotas originais de membro **e** `GET /users:lookup` aparecem em `docs/route-inventory.md:17,29-32` com `apps/web/src/nav/memberClient.ts` como consumidor. A re-execução não sujou a árvore (artefato já commitado, geração idempotente).
- **Test count before feature**: 1030 unit (web 225) + 346 integration (derivado: 40 testes unitários novos em web, 4 de integração novos no servidor)
- **Test count after feature**: 1070 unit (web 265) + 350 integration
- **Delta**: **+40 unit, +4 integration** (nenhum teste apagado, nenhuma asserção enfraquecida — o diff só adiciona blocos `it(...)` em `App.spec.tsx` e `ProjectListPage.spec.tsx`, sem tocar os existentes)
- **Skipped tests**: 13, todos em suítes de integração pré-existentes fora do diff desta feature (não introduzidos aqui). Nenhum teste desta feature é `skip`.
- **Failures**: nenhuma.

**`// SPEC_DEVIATION` markers introduzidos**: um, em `apps/server/src/modules/auth/users.int.spec.ts:1` — PGlite em vez de testcontainers. **Não é um sinal novo**: é a convenção já codificada por ADR-0007 e presente no cabeçalho de todos os `*.int.spec.ts` do repositório (`ai-engine/*`, `auth/auth.int.spec.ts`, `asset`, `oidc`, ...). Copiar o marcador estabelecido é conformidade, não desvio; nenhuma lição é distilada a partir dele.

---

## Fix Plans

Nenhum. Nenhum gap encontrado.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| --- | --- | --- |
| MEM-01 | Implementing | ✅ Verified |
| MEM-02 | Implementing | ✅ Verified |
| MEM-03 | Implementing | ✅ Verified |
| MEM-04 | Implementing | ✅ Verified |
| MEM-05 | Implementing | ✅ Verified |
| MEM-06 | Implementing | ✅ Verified |
| MEM-07 | Implementing | ✅ Verified |
| MEM-08 | Implementing | ✅ Verified |
| MEM-09 | Implementing | ✅ Verified |
| MEM-10 | Implementing | ✅ Verified |
| MEM-11 | Implementing | ✅ Verified |
| MEM-12 | Implementing | ✅ Verified |
| MEM-13 | Implementing | ✅ Verified |
| MEM-14 | Implementing | ✅ Verified |
| MEM-15 | Implementing | ✅ Verified |
| MEM-16 | Implementing | ✅ Verified |
| MEM-17 | Implementing | ✅ Verified |
| MEM-18 | Implementing | ✅ Verified |
| MEM-19 | Implementing | ✅ Verified |
| MEM-20 | Implementing | ✅ Verified |
| MEM-21 | Implementing | ✅ Verified |

---

## Summary

**Overall**: ✅ Ready

**Spec-anchored check**: 21/21 ACs matched the spec-defined outcome — 0 spec-precision gaps
**Sensor**: 8/8 mutations killed (P0-full)
**Gate**: 1070 unit passed, 0 failed; 350 integration passed, 0 test failures (3 arquivos abortam por lacuna de sandbox não relacionada, documentada em `CLAUDE.md`); audit exit 0

**What works**:

- Lista de membros para qualquer papel, com a convenção IDOR de `404` já usada na frente de navegação.
- Convite por e-mail sem UUID: `GET /users:lookup` primeiro, `404` → mensagem sem `POST`, já-membro detectado client-side antes do `POST`, `409` tratado como segunda linha, `201` insere sem recarregar.
- Troca de papel via `PATCH`, refletida só após `200`, revertendo em falha.
- Remoção com `ConfirmArchiveDialog` reusado sem alteração, `204` removendo da lista.
- As duas proteções de último admin, com escopo correto: bloqueiam o auto-rebaixamento e a auto-remoção do único admin, e **não** bloqueiam um segundo admin agindo sobre o primeiro — cobertura do negativo comprovada pela mutação 2 do sensor.
- `GET /users:lookup` gateado só por sessão (deliberado), com projeção explícita de três campos comprovadamente à prova de vazamento (mutação 8), `404` limpo, `401` sem sessão, e wiring de OpenAPI/route-inventory verificado de forma independente.
- Fluxo inteiro alcançável por teclado, anúncios em `aria-live="polite"`, zero violações axe serious/critical, `pt-BR` e `en`.

**Issues found**: nenhum.

**Next steps**: fechar a onda. Atualizar a entrada R4 de `.specs/features/platform-maturity/ui-roadmap.md` para refletir a quinta rota (`GET /users:lookup`), como a própria spec antecipou na seção "Rotas consumidas". A lacuna server-side de zero-admins permanece registrada e deliberadamente não resolvida (Out of Scope), e continua sendo a candidata natural a virar uma decisão de autorização própria numa fatia futura.
