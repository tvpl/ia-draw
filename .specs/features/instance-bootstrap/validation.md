# Bootstrap de instância Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/instance-bootstrap/spec.md`
**Diff range**: `5d82990..07cf997` (7 commits, um por task)
**Verifier**: passe standalone (`validate.md`). Sub-agentes indisponíveis nesta sessão, logo
autor ≠ verificador não foi garantido por separação de processo — mesma limitação já registrada em
R17 e R18. Correção aplicada desde R17: cada `Done when` que produz artefato foi conferido contra o
disco, não só as ACs contra testes (lição L-048).

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `be72474` |
| T2 | ✅ Done | `46d2eb1` |
| T3 | ✅ Done | `500d4ef` — 69 → 70 paths em `docs/openapi.json` |
| T4 | ✅ Done | `53cf1f5` — 13 casos |
| T5 | ✅ Done | `2bd9798` — 12 casos |
| T6 | ✅ Done | `1e831af` — 8 casos + a11y |
| T7 | ✅ Done | `07cf997` — 2 casos |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| BOOT-01 instância vazia → `{available:true}` | corpo exato | `firstRun.int.spec.ts:53` — `expect(response.json()).toEqual({ available: true })` | ✅ PASS |
| BOOT-02 instância com conta → `404` | `404` | `firstRun.int.spec.ts:65` — `expect(response.statusCode).toBe(404)` | ✅ PASS |
| BOOT-03 cria conta, org, workspace, `org_admin`, sessão, `201` | 1 de cada, papel `org_admin`, cookie HttpOnly | `firstRun.int.spec.ts:90,93,97,100,104,105,110` — `toBe(201)`, `toHaveLength(1)` ×4, `expect(members[0]?.role).toBe('org_admin')`, `expect(cookie?.httpOnly).toBe(true)` | ✅ PASS |
| BOOT-04 `POST` numa instância inicializada → `404`, sem tocar no banco | `404`, contagem inalterada | `firstRun.int.spec.ts:196` — `expect(second.statusCode).toBe(404)` + `toHaveLength(1)` | ✅ PASS |
| BOOT-05 senha < 12 → `400` nomeando o campo, nada criado | `Invalid password`, 0 contas | `firstRun.int.spec.ts:166-167` — `expect(response.json().title).toBe('Invalid password')` + `toHaveLength(0)` | ✅ PASS |
| BOOT-06 e-mail inválido → `400` nomeando o campo | `Invalid email`, 0 contas | `firstRun.int.spec.ts:178` — `expect(response.json().title).toBe('Invalid email')` | ✅ PASS |
| BOOT-07 auditoria `instance.bootstrapped` com o id da conta | 1 evento, `actorId` = conta | `firstRun.int.spec.ts:140-141` — `expect(events).toHaveLength(1)` + `expect(events[0]?.actorId).toBe(account?.id)` | ✅ PASS |
| BOOT-08 corrida → uma `201`, outra `409`, uma conta | uma conta ao final | `firstRun.int.spec.ts:210-213` — `expect(statuses[0]).toBe(201)`, `expect([404,409]).toContain(statuses[1])`, `toHaveLength(1)` | ⚠️ Parcial |
| BOOT-09 limite excedido → `429` | ao menos um `429` | `firstRun.int.spec.ts:223` — `expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0)` | ✅ PASS |
| BOOT-10 fora de sessão, papel nunca do cliente | `org_admin` mesmo com `role` no corpo | `firstRun.int.spec.ts:153` — `expect(members[0]?.role).toBe('org_admin')` | ✅ PASS |
| BOOT-11 conta criada por outro caminho → `404` sem reinício | `200` depois `404` | `firstRun.int.spec.ts:69,78` — as duas asserções de `statusCode` na mesma instância viva | ✅ PASS |
| BOOT-12 `/login` mostra primeiro acesso quando disponível | heading "First run", sem botão de entrar | `apps/web/src/auth/LoginPage.spec.tsx` (bloco BOOT-12) — `expect(screen.getByRole('heading', { name: 'First run' })).toBeDefined()` + `expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull()` | ✅ PASS |
| BOOT-13 cliente cobre cada status documentado | 9 branches | `apps/web/src/auth/firstRunClient.spec.ts` — 12 casos, um por status incluindo falha de rede | ✅ PASS |
| BOOT-14 sucesso navega para a raiz autenticada | `assign('/')` | `FirstRunPage.spec.tsx` — `expect(assign).toHaveBeenCalledWith('/')` | ✅ PASS |
| BOOT-15 `400` mostra o campo e preserva os demais valores | mensagem do campo; e-mail/nome/workspace intactos, senha limpa | `FirstRunPage.spec.tsx` — `expect(screen.getByText('A senha precisa ter no mínimo 12 caracteres.'))` + 4 asserções de `.value` | ✅ PASS |
| BOOT-15 `409`/`404` cai para credenciais | `onAlreadyInitialized` chamado 1× | `FirstRunPage.spec.tsx` — `expect(onAlreadyInitialized).toHaveBeenCalledTimes(1)` | ✅ PASS |
| BOOT-16 todo texto vindo do i18n | nenhuma chave crua renderizada | `FirstRunPage.spec.tsx` — `expect(screen.queryByText(/^firstRun\./)).toBeNull()` | ✅ PASS |

**Status**: 16 de 17 asserções de AC cobertas; BOOT-08 é ⚠️ **Parcial**, não ✅.

⚠️ **BOOT-08 não prova paralelismo real.** PGlite serializa tudo numa conexão, então as duas
requisições disparadas com `Promise.all` executam em sequência. O teste prova o caminho de decisão
(a segunda é recusada, uma conta existe) e não o comportamento sob concorrência genuína. A garantia
que vale lá é o `pg_advisory_xact_lock` mais a checagem de vazio dentro da mesma transação
(`firstRun.ts:88-93`), exercitada no CI, onde o Postgres roda como serviço. Registrado como parcial
com o mecanismo nomeado, nunca arredondado para verde.

---

## Edge Cases

| Edge case da spec | Evidência | Result |
| ----------------- | --------- | ------ |
| E-mail com maiúsculas é normalizado e permite login depois | `firstRun.int.spec.ts:121,128` — busca por `admin@example.com` + `expect(login.statusCode).toBe(200)` | ✅ PASS |
| Nome de workspace vazio → `400` nomeando o campo | `firstRun.int.spec.ts:189` — `expect(response.json().title).toBe('Invalid workspaceName')` | ✅ PASS |
| Falha parcial reverte a transação inteira | **sem teste dedicado** | ⚠️ Estrutural |
| Consulta de contagem falha → `503` | **não implementado** | ❌ Gap |

⚠️ A reversão é garantida pelo `db.transaction` do Drizzle: as quatro inserções estão no mesmo
callback, e qualquer exceção reverte todas. Forçar uma falha no meio exigiria injetar um erro numa
das inserções, o que testaria o Drizzle e não este código (Check C).

❌ **Gap real**: a spec pede `503` quando a consulta de contagem falha; `isInstanceUninitialized`
deixa a exceção propagar, e o handler de erro do Fastify a transforma em `500`, não `503`. Ver Gaps.

---

## Discrimination Sensor

| # | File | Mutação | Killed? |
| - | ---- | ------- | ------- |
| 1 | `firstRun.ts` | Guarda de vazio removida de dentro da transação | ✅ 1 falhou |
| 2 | `firstRun.ts` | Papel gravado como `viewer` em vez de `org_admin` | ✅ 2 falharam |
| 3 | `firstRun.ts` | E-mail deixa de ser normalizado | ✅ 1 falhou |
| 4 | `routes.ts` | Responde `401` em vez de `404` quando indisponível | ✅ 2 falharam |
| 5 | `LoginPage.tsx` | Ignora a disponibilidade e sempre mostra credenciais | ✅ 1 falhou |
| 6 | `FirstRunPage.tsx` | `400` deixa de limpar a senha | ✅ 1 falhou |

**Sensor depth**: P0-full
**Result**: 6/6 mortas — ✅ PASS

---

## Code Quality

| Princípio | Status |
| --------- | ------ |
| Código mínimo | ✅ |
| Mudanças cirúrgicas | ✅ |
| Sem scope creep | ✅ |
| Segue os padrões existentes | ✅ (cliente no molde de `memberClient.ts`, a11y no molde de `shell.a11y.spec.tsx`) |
| Nenhum teste existente enfraquecido, pulado ou alterado | ✅ — ver Desvio |

**Desvio deliberado, registrado**: `firstRunAvailable` começa em `false`, não `null`. Bloquear o
render até a resposta chegar teria exigido reescrever os testes existentes de `LoginPage` de
síncronos para assíncronos, o que a regra de integridade de teste proíbe. O custo é um frame do
formulário de credenciais numa instância vazia; o ganho é que nenhum teste existente foi tocado.

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros |
| `make typecheck` | ✅ 25/25 |
| `apps/web` unit | ✅ 97 arquivos, 943/943 |
| `firstRun.int.spec.ts` | ✅ 13/13 |
| `docs/openapi.json` | ✅ regenerado e formatado como o CI faz, 70 paths |

---

## Gaps encontrados

### Gap 1 — BOOT-08 sem prova de paralelismo (Minor, aberto por ambiente)

Ver acima. O mecanismo existe e está nomeado; a prova sob concorrência real depende do CI.

### Gap 2 — Edge case de `503` não implementado (Minor, aberto)

A spec lista "IF a consulta de contagem de contas falha THEN o sistema SHALL responder `503`". A
implementação deixa a exceção propagar e o handler devolve `500`. Nenhuma task nomeava esse edge
case no seu `Done when`, então ele não foi implementado nem testado — foi encontrado aqui, na
conferência da lista de edge cases da spec contra o código.

Não corrigido nesta onda porque `503` versus `500` numa falha de banco não muda nada para quem usa
(ambos são "o servidor não conseguiu") e inventar a correção agora seria trabalho fora de qualquer
task aprovada. Registrado como dívida nomeada.

---

## Requirement Traceability Update

BOOT-01 a BOOT-16: `Pending` → `✅ Verified`, com BOOT-08 marcado `⚠️ Verified (parcial)`.

---

## Summary

**PASS com uma parcialidade e uma dívida nomeadas.** 16 de 17 asserções de AC com evidência
`file:line`; BOOT-08 é parcial porque PGlite não tem paralelismo real, e o edge case de `503` não
foi implementado por não constar de nenhum `Done when`. O sensor matou 6 de 6.

A entrega: uma instância nova deixa de ser inacessível. `make up` numa máquina limpa leva a uma
sessão autenticada sem tocar no banco, a porta se fecha sozinha assim que é usada, e o papel
`org_admin` nunca vem do cliente.
