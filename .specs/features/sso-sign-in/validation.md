# Entrada no produto (login e SSO) — Validation

**Date**: 2026-08-16
**Spec**: `.specs/features/sso-sign-in/spec.md`
**Diff range**: `44c7ff9^..HEAD` (HEAD = `0ecd552`) scoped a `apps/server/src/modules/auth`,
`apps/web/src/auth`, `apps/web/src/App.tsx`, `apps/web/src/app-shell`,
`apps/web/src/diagram/DiagramEditorPage.tsx`, `apps/web/src/i18n` (o range também carrega commits
`ai-dock` intercalados de uma onda concorrente — fora de escopo aqui, excluídos de toda contagem)
**Verifier**: independent sub-agent (author ≠ verifier)
**Round**: 2 — **este relatório substitui integralmente a rodada 1** (FAIL, commit `6755a5d`)

> **Contexto da rodada.** A rodada 1 reprovou com exatamente uma lacuna: SSO-20 sem nenhuma
> evidência (`aria-live="polite"` não asserido por teste algum; mutante M5 sobreviveu). O fix
> chegou em `0ecd552` — **test-only, +6 linhas, nenhuma mudança de código de produção**
> (confirmado independentemente por `git show --stat 0ecd552`). Todas as 21 ACs foram re-derivadas
> do zero nesta rodada, não apenas SSO-20.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `GET /auth/oidc/status` | ✅ Done | `apps/server/src/modules/auth/routes.ts:192-194`; ambos os ramos com teste de integração |
| T2 — OIDC callback failure redirect | ✅ Done | 3 caminhos de falha redirecionam (`routes.ts:237`, `:245`, `:346`); auditoria + métrica ainda disparam antes do redirect |
| T3 — `AuthProvider`/`useAuth` | ✅ Done | `apps/web/src/auth/AuthProvider.tsx`; 3 transições de status testadas |
| T4 — `ProtectedRoute` | ✅ Done | `apps/web/src/auth/ProtectedRoute.tsx`; 3 estados testados |
| T5 — `auth` i18n keys | ✅ Done | conjuntos de chaves idênticos em `en`/`pt-BR` (re-conferido programaticamente: 8 chaves, `keys match: True`) |
| T6 — `LoginPage` | ✅ Done | `apps/web/src/auth/LoginPage.tsx`; 16 testes unitários |
| T7 — `LoginPage` a11y | ✅ Done | estados idle + erro, zero violações axe serious/critical |
| T8 — wire `App.tsx` + `DiagramEditorPage` | ⚠️ Partial (`[~]`, documentado) | Residual de tooling de auditoria apenas — ver abaixo. **Re-conferido nesta rodada: a divulgação continua exata, sem regressão.** |
| T9 — `AppShell` logout | ✅ Done | `apps/web/src/app-shell/AppShell.tsx:20-22`; clique → `POST /auth/logout` → `anonymous` |

### Disclosed residual (T8 `[~]`) — re-conferido, não contado como lacuna nova

`pnpm --filter @arch-canvas/repo-tools run audit` re-executado nesta rodada: **89 rotas, 8
consumidas, 81 `pending-product`** — números idênticos aos da rodada 1, sem regressão. A execução
deixou `docs/route-inventory.md` inalterado (`git status --porcelain` vazio depois), confirmando que
a saída é estável. O split é exatamente o divulgado por T8:

- consumidas: `POST /auth/login` (`docs/route-inventory.md:16`), `GET /auth/oidc/status` (`:17`) —
  ambas via `fetch(...)` literal em `LoginPage.tsx`.
- ainda `pending-product`: `POST /auth/logout` (`:36`), `POST /auth/refresh` (`:37`), `GET /me`,
  `GET /auth/oidc/login` (`:40`), `GET /auth/oidc/callback` (`:41`).

Causa inalterada: `tools/repo-tools/src/webConsumers.ts` casa apenas call sites literais `fetch(` /
`this.fetchImpl(`, e `AuthProvider.tsx:52` roteia toda chamada de sessão por um `doFetch` aliasado
localmente. `GET /auth/oidc/login` é consumida por um `<a href>` real (SSO-09 proíbe `fetch`) e
`GET /auth/oidc/callback` é alvo de redirect alcançado pelo IdP — nenhuma das duas é detectável por
scanner estático de call site. Funcionalmente as rotas estão consumidas; o limite é a precisão
estática da auditoria. **Consequência registrada honestamente:** o bullet 5 de Success Criteria da
spec permanece parcialmente atendido pela saída da própria ferramenta, exatamente como divulgado.

---

## Spec-Anchored Acceptance Criteria

Numeração conforme o esquema declarado na spec (SSO-01..07 login local, SSO-08..12 SSO,
SSO-13..18 sessão, SSO-19..21 teclado/idioma). Todas as citações `file:line` foram re-derivadas
nesta rodada contra `0ecd552` — as linhas de `LoginPage.spec.tsx` posteriores a `:186` deslocaram
+2/+6 em relação à rodada 1 por causa das asserções novas.

### P1: Entrar com credencial local

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-01 — `/login` sem sessão renderiza e-mail, senha, botão, alcançáveis por teclado | os 3 controles presentes, nativos/focáveis | `apps/web/src/auth/LoginPage.spec.tsx:94` — `screen.getByLabelText('Email')`; `:96` `getByRole('button', { name: 'Sign in' })`; `:98` `expect(emailInput.tagName).toBe('INPUT')` | ✅ PASS |
| SSO-02 — sessão válida em `/login` redireciona a `next` (ou `/`), sem formulário | navega a `next`; formulário nunca renderizado | `LoginPage.spec.tsx:112` — `expect(screen.getByText('landed:next')).toBeTruthy()`; `:113` `expect(screen.queryByLabelText('Email')).toBeNull()`; `:124` default `landed:root` | ✅ PASS |
| SSO-03 — submit emite `POST /auth/login {email,password}` e desabilita até a resposta | corpo exatamente `{email,password}`; botão `disabled` in-flight | `LoginPage.spec.tsx:169` — `expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.com', password: 'secret' })`; `:183` `await waitFor(() => expect(submit.disabled).toBe(true))` | ✅ PASS |
| SSO-04 — `200` redireciona para `next` (ou `/`) | navegação real para o `next` sanitizado | `LoginPage.spec.tsx:210` — `expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1')`; `:193` `toHaveBeenCalledWith('/')` | ✅ PASS |
| SSO-05 — `401` → mensagem única e genérica, e-mail preservado, senha limpa, envio reabilitado; nunca distingue e-mail inexistente de senha errada | mensagem única `auth.invalidCredentials`; `email` mantido; `password` vazio | `LoginPage.spec.tsx:227` — `expect(screen.getByText('Invalid email or password.')).toBeTruthy()`; `:232` `expect(email.value).toBe('a@b.com')`; `:233` `expect(password.value).toBe('')`; `:241-244` re-enable após nova senha. Contraparte servidor: `apps/server/src/modules/auth/auth.int.spec.ts:129` — `expect(wrongPassword.json()).toEqual(unknownEmail.json())` | ✅ PASS (mutante M4 morto) |
| SSO-06 — `400` tratado como `401` do ponto de vista do usuário | mesma mensagem genérica | `LoginPage.spec.tsx:279` — `expect(screen.getByText('Invalid email or password.')).toBeTruthy()` (stub devolve `400`, `:270`) | ✅ PASS |
| SSO-07 — campo vazio/só espaços → botão desabilitado, sem requisição | `disabled === true` até ambos não-vazios (trim) | `LoginPage.spec.tsx:148` — `expect(submit.disabled).toBe(true)` (só e-mail); `:151` idem com senha `'   '`; `:154` `toBe(false)` com senha real | ✅ PASS |

### P1: Entrar via SSO quando disponível

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-08 — `/login` consulta `GET /auth/oidc/status` ao montar | requisição emitida antes de decidir a visibilidade | `LoginPage.spec.tsx:320-323` — o stub só aceita `/auth/oidc/status` e lança `unexpected fetch` em qualquer outra URL; `:328` `await screen.findByRole('link', ...)` só resolve se a chamada aconteceu | ✅ PASS |
| SSO-09 — `{configured:true}` → botão de SSO como link de navegação real | `<a href="/auth/oidc/login">`, nunca `fetch` | `LoginPage.spec.tsx:328` — `findByRole('link', { name: 'Sign in with SSO' })`; `:329` `expect(link.getAttribute('href')).toBe('/auth/oidc/login')`. Servidor: `auth.int.spec.ts:467` — `expect(response.json()).toEqual({ configured: true })` | ✅ PASS |
| SSO-10 — `{configured:false}` ou falha da chamada → botão nunca aparece | link ausente do DOM em ambos os casos | `LoginPage.spec.tsx:343` — `expect(screen.queryByRole('link', { name: 'Sign in with SSO' })).toBeNull()` (`configured:false`); `:356` idem com `Promise.reject`. Servidor: `auth.int.spec.ts:449` — `expect(response.json()).toEqual({ configured: false })` | ✅ PASS |
| SSO-11 — retorno em `/login?error=oidc_failed` → mensagem genérica, sem detalhe do IdP, formulário e SSO continuam | mensagem `auth.ssoFailed`; form + link ainda presentes | `LoginPage.spec.tsx:369` — `expect(screen.getByText('Corporate sign-in failed. Please try again.')).toBeTruthy()`; `:370-372` form + `findByRole('link')`. Servidor: `oidc.int.spec.ts:484`, `:500`, `:526` — `expect(response.headers.location).toBe(`${PUBLIC_URL}/login?error=oidc_failed`)` nos 3 caminhos de falha | ✅ PASS (mutante round-1 M7 morto; código do servidor intocado desde) |
| SSO-12 — fluxo OIDC com sucesso → usuário autenticado na raiz (comportamento existente, inalterado) | redirect 3xx + sessão válida; caminho de sucesso intocado | `oidc.int.spec.ts:340` — `expect(result.statusCode).toBe(302)`; `:341` `expect(result.sessionToken).toBeDefined()`; `:351` `expect(me.statusCode).toBe(200)`. Código: `routes.ts:325` `reply.redirect(config.publicUrl)` — confirmado inalterado no diff | ✅ PASS (ver Observação 2) |

### P1: Sessão renovada ou redirecionamento para login

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-13 — app monta em rota protegida → `AuthProvider` chama `GET /me` antes de renderizar | `/me` emitido; rota não renderiza enquanto `loading` | `apps/web/src/auth/AuthProvider.spec.tsx:54` — `expect(screen.getByTestId('status').textContent).toBe('loading')`; `apps/web/src/auth/ProtectedRoute.spec.tsx:48` `expect(container.textContent).toBe('')`; `apps/web/src/App.spec.tsx:181` `expect(meCalls).toBe(1)` | ✅ PASS |
| SSO-14 — `200` → expõe `{id,email,displayName}` no contexto; rota renderiza | exatamente 3 campos, nada mais | `AuthProvider.spec.tsx:58` — `expect(user).toEqual({ id: 'user-1', email: 'alice@example.com', displayName: 'Alice' })` (o stub carrega um `role: 'admin'` extra, `:34`, que a asserção prova descartado); `ProtectedRoute.spec.tsx:57` `getByText('Protected content')` | ✅ PASS |
| SSO-15 — `401` → tenta `POST /auth/refresh` exatamente uma vez | sequência exata de chamadas | `AuthProvider.spec.tsx:82` — `expect(calls).toEqual(['/me', '/auth/refresh', '/me'])` | ✅ PASS |
| SSO-16 — refresh `200` → repete `GET /me` uma vez e segue o fluxo de sucesso | `authenticated` + usuário populado | `AuthProvider.spec.tsx:81` — `expect(status).toBe('authenticated')` após `['/me','/auth/refresh','/me']`; `:84` usuário completo | ✅ PASS (mutante M6 morto) |
| SSO-17 — refresh ≠ `200`, ou segundo `/me` falha → redireciona `/login?next=<rota atual>` | `anonymous` e navegação para `/login?next=` com o caminho atual | `AuthProvider.spec.tsx:100` — `expect(status).toBe('anonymous')` (refresh 401); `:119-121` idem com refresh 200 + segundo `/me` 401; `ProtectedRoute.spec.tsx:66` `getByText('Login page (next=/w/ws-1?foo=bar)')`; `App.spec.tsx:85-87` `expect(location.textContent).toBe('/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1')` | ✅ PASS |
| SSO-18 — `DiagramEditorPage` lê o usuário do contexto para `setActorId`, sem chamar `GET /me` | exatamente 1 chamada a `/me` no boot inteiro | `App.spec.tsx:181` — `expect(meCalls).toBe(1)`, reconfirmado após um tick em `:183`. Código: `DiagramEditorPage.tsx:45` `const { user } = useAuth()`, `:70` `client.setActorId(user.id)`; nenhum `fetch('/me')` restante no arquivo | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-19 — tela operável só por teclado em todas as ações | focar e-mail, focar senha, submeter, ativar SSO | `LoginPage.spec.tsx:98-99` — `expect(emailInput.tagName).toBe('INPUT')` / idem senha (controles nativos, focáveis por construção); `:307` `fireEvent.submit(form)` (caminho do Enter, sem clique); `:329` SSO é `<a href>` (ativável por Enter); `LoginPage.a11y.spec.tsx:80` `expect(seriousOrCriticalViolations(results)).toEqual([])`. Foco explícito asserido no shell: `AppShell.spec.tsx:52-53` `button.focus(); expect(document.activeElement).toBe(button)` | ✅ PASS (ver Observação 3) |
| SSO-20 — mudança de status de submissão (enviando, erro) anunciada em região `aria-live="polite"` | o texto de status/erro vive **dentro** de um container `aria-live="polite"`, nos dois estados que a AC nomeia | **Estado "enviando":** `LoginPage.spec.tsx:186` — `expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Signing in…')`. **Estado "erro":** `:229-231` — `expect(document.querySelector('[aria-live="polite"]')?.textContent).toBe('Invalid email or password.')`. Implementação: `LoginPage.tsx:115` | ✅ **PASS** (era ❌ GAP na rodada 1; mutantes M1/M2/M3 mortos — ver Sensor) |
| SSO-21 — todo texto visível vem de chaves i18n, em `pt-BR` e `en`, sem literal no componente | mesmas telas asseridas nos dois locales | `LoginPage.spec.tsx:12` fixa `en` e assere strings inglesas (`:94` `'Email'`, `:96` `'Sign in'`, `:227` `'Invalid email or password.'`); `App.spec.tsx:132-135` assere as strings `pt-BR` (`'E-mail'`, `'Senha'`, `'Entrar'`) na mesma tela — um literal hard-coded quebraria um dos dois lados. Conjuntos de chaves `auth` idênticos nos dois locales, re-conferidos programaticamente (8 chaves, `keys match: True`) | ✅ PASS |

**Status**: ✅ **All ACs covered** — 21/21 com evidência `file:line` que bate com o outcome definido
na spec. Nenhuma lacuna aberta.

### Auditoria específica do fix de SSO-20 (a lacuna da rodada 1)

A instrução desta rodada era não confiar na mensagem do commit. Três checagens independentes:

1. **A asserção alcança o nó DOM certo.** `document.querySelector('[aria-live="polite"]')` casa o
   `<div>` de `LoginPage.tsx:115`, único nó com esse atributo na árvore renderizada; o `cleanup()`
   em `afterEach` (`LoginPage.spec.tsx:72`) impede que um container de teste anterior contamine a
   busca global por `document`.
2. **Cobre os dois estados que a AC nomeia.** "enviando" (`:186`, dentro do teste de submit
   in-flight, depois do `waitFor` que confirma o botão desabilitado) e "erro" (`:229-231`, dentro do
   teste de `401`, depois do `waitFor` da mensagem). A AC nomeia exatamente esses dois.
3. **Falha de verdade se o atributo sumir — não passa por acidente.** Provado empiricamente por 3
   mutações (M1/M2/M3 abaixo), não por inspeção: remover o atributo faz `querySelector` devolver
   `null`, `?.textContent` devolver `undefined`, e o `toBe(...)` falhar. As duas asserções falham
   juntas, uma por estado.

---

## Discrimination Sensor

**Sensor depth**: P0-full (auth é caminho crítico → ≥5 mutações manuais cobrindo todos os ramos).
Scratch isolado via `git worktree add <scratch> HEAD` (nunca `git stash`); `node_modules` do repo
real ligados por symlink; worktree removido com `--force` ao final. Runner sob **Node 22.23.2**
(conforme `CLAUDE.md`).
Baseline pré-sensor: `git status --porcelain` **vazio** — reconfirmado idêntico (vazio) após a
limpeza do worktree e após a re-execução da auditoria.
Baseline verde no scratch antes de qualquer mutação: **33 testes / 6 arquivos**
(`src/auth`, `src/App.spec.tsx`, `src/app-shell`).

Mutações 1-3 miram especificamente o fix de SSO-20 — a exata behavior que a rodada 1 provou
não-discriminada. Mutações 4-6 re-confirmam as outras behaviors de alto risco.

| Mutação | File:line | Descrição | Killed? |
| --- | --- | --- | --- |
| M1 | `apps/web/src/auth/LoginPage.tsx:115` | **Alvo do fix**: `<div aria-live="polite">` → `<div>` (atributo removido — o mutante idêntico ao M5 sobrevivente da rodada 1) | ✅ **Killed** (2 falhas: in-flight + erro) |
| M2 | `apps/web/src/auth/LoginPage.tsx:115` | **Alvo do fix**: `aria-live="polite"` → `aria-live="assertive"` (região existe, mas com a polidez errada) | ✅ Killed (2 falhas) |
| M3 | `apps/web/src/auth/LoginPage.tsx:115` | **Alvo do fix**: texto de status movido para FORA da região (`<div aria-live="polite" />` vazio + texto num `<div>` irmão) | ✅ Killed (2 falhas) |
| M4 | `apps/web/src/auth/LoginPage.tsx:103` | Anti-enumeração quebrada: `401` passa a exibir `'No account with that email'` em vez da mensagem genérica | ✅ Killed (2 falhas) |
| M5 | `apps/web/src/auth/LoginPage.tsx:15-17` | Guarda de open-redirect removida de `sanitizeNext` (passa a devolver `raw` sempre) | ✅ Killed (1 falha) |
| M6 | `apps/web/src/auth/AuthProvider.tsx:67` | `if (refreshed.ok)` → `if (!refreshed.ok)` (inverte o retry-once pós-refresh) | ✅ Killed (2 falhas) |

**Result**: **6/6 killed** — ✅ PASS. Nenhum mutante sobrevivente.

M1 é o resultado decisivo desta rodada: o mesmo mutante que passou por 33 testes na rodada 1 agora
mata 2 testes. M2 e M3 provam que a asserção não é frouxa — ela exige o valor `polite` *e* que o
texto viva dentro da região, não apenas que um atributo `aria-live` qualquer exista em algum lugar.

**Nota sobre o servidor**: `git show --stat 0ecd552` confirma que o fix é test-only (+6 linhas em
`LoginPage.spec.tsx`, zero linhas de produção). Os mutantes de servidor da rodada 1 (rota
`/auth/oidc/status` e redirect de falha do callback, ambos mortos) continuam válidos — o código sob
mutação não mudou uma linha desde então.

---

## Interactive UAT Results

Não executada nesta rodada (validação automatizada do Verifier). A tela é user-facing; UAT
interativa fica a critério do orquestrador/usuário.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ `AuthProvider` 114 linhas, `ProtectedRoute` 28, `LoginPage` 143, `AppShell` +9 — nenhuma abstração especulativa |
| Surgical changes | ✅ `routes.ts` toca só a rota nova e os 3 caminhos de falha do callback; caminho de sucesso literalmente inalterado. O fix desta rodada tocou 1 arquivo de teste, +6 linhas, 0 de produção |
| No scope creep | ✅ nada de retry em `syncClient`, nada de tela de cadastro, nada de menu de conta — todos os itens de Out of Scope respeitados |
| Matches patterns | ✅ `fetchImpl` injetável (`syncClient.ts`), bloco i18n por feature (`aiDock`), `seriousOrCriticalViolations` (`shell.a11y.spec.tsx`), `routeSchemas` do módulo auth |
| Spec-anchored outcome check (valores asseridos batem com o spec) | ✅ **21/21** — SSO-20 fechado nesta rodada |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ rota nova: ambos os ramos; callback: 3 ramos de falha + sucesso; nenhuma rota da matriz sem teste |
| Every test maps to a spec requirement — no unclaimed tests | ✅ com 2 extras defensivos declarados: `AuthProvider.spec.tsx:150` (`useAuth()` fora do provider lança — contrato de design.md) e `LoginPage.spec.tsx:247` (rejeição de rede no login recebe o mesmo tratamento genérico — extensão coerente de SSO-05/06) |
| Documented guidelines followed | ✅ `CLAUDE.md` (Node 22, comandos, AD-003/007/008); AD-011 do design respeitado — `useAuth()` é o único ponto de verdade de sessão, e `DiagramEditorPage` deixou de chamar `/me` |
| Would a senior engineer approve? | ✅ sem ressalvas |

### Observações não bloqueantes (carregadas da rodada 1, re-conferidas — nenhuma é lacuna)

1. **`resolveSession` sem `try/catch`** (`AuthProvider.tsx:58-77`): uma rejeição de rede em `/me`
   (offline no boot, não um `401`) deixa `status` preso em `'loading'` para sempre — tela em branco,
   mais uma unhandled rejection. Nenhuma AC ou Edge Case da spec cobre esse caso (a lista de Edge
   Cases só trata falha de rede em `/auth/oidc/status`, tratada em `LoginPage.tsx:57`), então não
   conta como lacuna desta feature — registrado para uma próxima rodada decidir. **Informativo.**
2. **SSO-12 com evidência parcial**: o teste de sucesso do OIDC assere `302` + cookie de sessão
   válido em `/me`, mas não o valor do header `Location`. A AC declara explicitamente
   "comportamento existente do servidor, inalterado por esta spec", e o diff confirma `routes.ts:325`
   intocado — por isso PASS, não GAP. Uma asserção de `Location` no teste de sucesso fecharia a
   última folga. **Nota de precisão de spec, não lacuna.**
3. **SSO-19 com evidência estrutural**: operabilidade por teclado é provada por controles nativos
   (`INPUT`/`button`/`<a href>`), submit via `fireEvent.submit` e axe sem violações
   serious/critical — não por uma varredura literal de tab-order. Aceito como PASS (o repo já usa
   exatamente esse padrão em `shell.a11y.spec.tsx`), registrado por transparência.
4. **Anotação de requisito desalinhada em `tasks.md`**: os IDs citados nas tasks da história de SSO
   estão deslocados em +1 frente à numeração declarada na spec (`tasks.md:80` cita SSO-09/11 para a
   rota de status, que pela spec é SSO-08..10; `tasks.md:105` e `:219` citam SSO-12 para o
   `?error=oidc_failed`, que pela spec é SSO-11). Só a anotação está errada — a cobertura foi
   re-derivada aqui pelo texto das ACs e está completa. Vale corrigir os rótulos para não contaminar
   rastreabilidade futura. **Higiene documental, não lacuna.**

---

## Edge Cases

- [x] **`next` apontando para outra origem é ignorado, cai para `/`** — `LoginPage.tsx:15-17`;
      `LoginPage.spec.tsx:127-136` (`next=https://evil.example/steal` → `landed:root`); mutante M5
      morto.
- [x] **`GET /auth/oidc/status` lento/falho é tratado como "não configurado"** —
      `LoginPage.tsx:57-59`; `LoginPage.spec.tsx:346-357` (`Promise.reject` → link ausente, tela não
      trava).
- [x] **Segundo clique durante submissão não emite segunda requisição** — `LoginPage.tsx:76,80`;
      `LoginPage.spec.tsx:310` `expect(loginCalls).toBe(1)` após dois `fireEvent.submit`.
- [x] **Após redirect por sessão morta, login bem-sucedido leva ao `next` original** —
      `App.spec.tsx:144` `expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1')`, partindo do
      `/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1` que o próprio guard produziu.
- [x] **401 pós-boot em `DiagramSyncClient` segue sem tratamento (herdado, documentado)** —
      re-confirmado que nenhum commit de `sso-sign-in` altera `apps/web/src/sync/syncClient.ts` (a
      única mudança no arquivo no range vem de `576f29f`, commit da onda `ai-dock`, fora de escopo);
      risco permanece registrado em `design.md:209` e em Out of Scope da spec.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (Build gate da tasks.md)
- **Result**: **exit 0** — lint + typecheck 25/25 tasks successful; test-unit 24/24 tasks successful
- **Total**: **927 passed, 0 failed, 0 skipped** (`apps/web`: 122 testes / 15 arquivos;
  `apps/server`: 395 / 39; demais pacotes: 410)
- **Integração (escopo desta feature)**: `auth.int.spec.ts` + `oidc.int.spec.ts` inalterados desde a
  rodada 1 (nenhum commit tocou o servidor após `6755a5d`) — 24 passed, 0 failed naquela execução.
- **Test count antes da feature**: 894 · **depois**: 927 · **delta**: +33 unitários em `apps/web`
  (`AuthProvider.spec.tsx` 6, `ProtectedRoute.spec.tsx` 3, `LoginPage.spec.tsx` 16,
  `LoginPage.a11y.spec.tsx` 2, `App.spec.tsx` 4, `AppShell.spec.tsx` 2), mais +5 de integração no
  servidor.
- **Test Integrity Check**: contagem **inalterada** entre rodada 1 (927) e rodada 2 (927) — o fix
  `0ecd552` adicionou 2 *asserções* dentro de testes já existentes, não casos novos, então a
  contagem de casos não muda por construção. Nenhum teste removido. Nenhuma asserção enfraquecida —
  as duas novas **fortalecem** os testes de submit in-flight e de `401` (de "o texto renderiza em
  algum lugar" para "o texto vive dentro da região `aria-live=\"polite\"`").
- **Skipped**: nenhum no gate unitário.
- **Failures**: nenhuma.

---

## Fix Plans

Nenhum. A única lacuna da rodada 1 (SSO-20) está fechada e comprovada por mutação.

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SSO-01..19 | ✅ Verified (rodada 1) | ✅ Verified (inalterado — re-derivado nesta rodada) |
| SSO-20 | ❌ Needs Fix | ✅ **Verified** |
| SSO-21 | ✅ Verified (rodada 1) | ✅ Verified (inalterado — re-derivado nesta rodada) |

---

## Summary

**Overall**: ✅ **Ready**

**Spec-anchored check**: 21/21 ACs com evidência `file:line` que bate com o outcome definido na spec
**Sensor**: 6/6 mutantes mortos (3 deles mirando especificamente o fix de SSO-20)
**Gate**: 927 unitários passed, 0 failed, 0 skipped (exit 0)

**What works**:
- Login local completo: emissão, estados de botão, `401`/`400` genéricos e indistinguíveis,
  preservação de e-mail, limpeza de senha, guarda de open-redirect no `next`.
- Visibilidade do SSO governada pela rota nova `GET /auth/oidc/status`, com o fail-safe correto
  (qualquer não-`200` ou erro de rede → botão escondido) e link de navegação real, nunca `fetch`.
- Falha de callback OIDC nunca mais devolve `problem+json` cru: 3 caminhos redirecionam para
  `${publicUrl}/login?error=oidc_failed`, com auditoria e métrica preservadas antes do redirect.
- Guard de sessão: `/me` → um único `/auth/refresh` → um único retry → `/login?next=` preservando
  path+search; `DiagramEditorPage` passou a ler o ator do contexto (AD-011 cumprido) e o app inteiro
  faz exatamente uma chamada a `/me`.
- Logout no `AppShell`, i18n espelhado em `pt-BR`/`en`, zero violações axe serious/critical.
- **Novo nesta rodada**: a região `aria-live="polite"` tem rede de proteção real — remover o
  atributo, trocar sua polidez, ou mover a mensagem para fora dela quebra o build.

**Issues found**: nenhum bloqueante. Residuais divulgados e re-conferidos: T8 `[~]` (precisão do
scanner estático da auditoria, não funcionalidade) e as 4 observações não bloqueantes acima.

**Next steps**: feature pronta para fechar. Opcionalmente: UAT interativa (tela user-facing), e a
higiene documental da Observação 4 (rótulos de requisito em `tasks.md`).
