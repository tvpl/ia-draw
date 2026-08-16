# Entrada no produto (login e SSO) — Validation

**Date**: 2026-08-16
**Spec**: `.specs/features/sso-sign-in/spec.md`
**Diff range**: `44c7ff9^..HEAD` scoped to `apps/server/src/modules/auth`, `apps/web/src/auth`,
`apps/web/src/App.tsx`, `apps/web/src/app-shell`, `apps/web/src/diagram/DiagramEditorPage.tsx`,
`apps/web/src/i18n` (the range also carries interleaved `ai-dock` commits from a concurrent wave —
those are out of scope here and were excluded from every count below)
**Verifier**: independent sub-agent (author ≠ verifier)

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 — `GET /auth/oidc/status` | ✅ Done | `apps/server/src/modules/auth/routes.ts:192-194`; both branches integration-tested |
| T2 — OIDC callback failure redirect | ✅ Done | 3 failure paths redirect (`routes.ts:237`, `:245`, `:346`); audit + metrics still fire before the redirect |
| T3 — `AuthProvider`/`useAuth` | ✅ Done | `apps/web/src/auth/AuthProvider.tsx`; all 3 status-transition branches tested |
| T4 — `ProtectedRoute` | ✅ Done | `apps/web/src/auth/ProtectedRoute.tsx`; all 3 states tested |
| T5 — `auth` i18n keys | ✅ Done | identical key sets in `en`/`pt-BR`, all 7 required keys plus `auth.submitting` |
| T6 — `LoginPage` | ✅ Done | `apps/web/src/auth/LoginPage.tsx`; 16 unit tests |
| T7 — `LoginPage` a11y | ✅ Done | idle + error states, zero serious/critical axe violations |
| T8 — wire into `App.tsx` + `DiagramEditorPage` | ⚠️ Partial (`[~]`, documented) | Audit-tooling residual only — see "Disclosed residual" below. **Re-verified independently: the disclosure is accurate.** |
| T9 — `AppShell` logout | ✅ Done | `apps/web/src/app-shell/AppShell.tsx:20-22`; click → `POST /auth/logout` → `anonymous` |

### Disclosed residual (T8 `[~]`) — verified accurate, not counted as a new gap

Ran `pnpm --filter @arch-canvas/repo-tools run audit` independently (89 routes, 8 consumed, 81
`pending-product`). `docs/route-inventory.md` confirms exactly the split T8 disclosed:

- consumed: `POST /auth/login` (`docs/route-inventory.md:16`), `GET /auth/oidc/status` (`:17`) — both
  via `LoginPage.tsx`'s literal `fetch(...)` call sites.
- still `pending-product`: `POST /auth/logout` (`:36`), `POST /auth/refresh` (`:37`), `GET /me`
  (`:38`), `GET /auth/oidc/login` (`:40`), `GET /auth/oidc/callback` (`:41`).

Cause is as documented: `tools/repo-tools/src/webConsumers.ts` matches literal `fetch(` /
`this.fetchImpl(` call sites, and `AuthProvider.tsx:52` routes every session call through a
locally-aliased `doFetch`. `GET /auth/oidc/login` is consumed by a real `<a href>` (SSO-09 forbids a
`fetch`) and `GET /auth/oidc/callback` is an IdP-reached redirect target — neither is detectable by
any static call-site scanner. Functionally the routes are consumed; the audit's static precision is
the limitation. **Consequence to record honestly:** spec.md's Success Criteria bullet 5 is therefore
only partially met by the tooling's own output, exactly as disclosed. Not re-flagged as a gap.

---

## Spec-Anchored Acceptance Criteria

Numbering follows spec.md's declared scheme (SSO-01..07 login local, SSO-08..12 SSO, SSO-13..18
sessão, SSO-19..21 teclado/idioma).

### P1: Entrar com credencial local

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-01 — `/login` sem sessão renderiza e-mail, senha, botão, alcançáveis por teclado | os 3 controles presentes, nativos/focáveis | `apps/web/src/auth/LoginPage.spec.tsx:94` — `screen.getByLabelText('Email')`, `:98` `expect(emailInput.tagName).toBe('INPUT')`, `:96` `getByRole('button', { name: 'Sign in' })` | ✅ PASS |
| SSO-02 — sessão válida em `/login` redireciona a `next` (ou `/`), sem formulário | navega a `next`; formulário nunca renderizado | `LoginPage.spec.tsx:112` — `expect(screen.getByText('landed:next')).toBeTruthy()`; `:113` `expect(screen.queryByLabelText('Email')).toBeNull()`; `:124` default `landed:root` | ✅ PASS |
| SSO-03 — submit emite `POST /auth/login {email,password}` e desabilita até a resposta | corpo exatamente `{email,password}`; botão `disabled` in-flight | `LoginPage.spec.tsx:169` — `expect(JSON.parse(String(init?.body))).toEqual({ email: 'a@b.com', password: 'secret' })`; `:183` `await waitFor(() => expect(submit.disabled).toBe(true))` | ✅ PASS |
| SSO-04 — `200` redireciona para `next` (ou `/`) | navegação real para o `next` sanitizado | `LoginPage.spec.tsx:208` — `expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1')`; `:191` `toHaveBeenCalledWith('/')` | ✅ PASS |
| SSO-05 — `401` → mensagem única e genérica, e-mail preservado, senha limpa, envio reabilitado; nunca distingue e-mail inexistente de senha errada | mensagem única `auth.invalidCredentials`; `email` mantido; `password` vazio | `LoginPage.spec.tsx:225` — `expect(screen.getByText('Invalid email or password.')).toBeTruthy()`; `:226` `expect(email.value).toBe('a@b.com')`; `:227` `expect(password.value).toBe('')`; `:236` re-enable após novo password. Contraparte servidor: `apps/server/src/modules/auth/auth.int.spec.ts:129` — `expect(wrongPassword.json()).toEqual(unknownEmail.json())` | ✅ PASS (mutante M4 morto) |
| SSO-06 — `400` tratado como `401` do ponto de vista do usuário | mesma mensagem genérica | `LoginPage.spec.tsx:273` — `expect(screen.getByText('Invalid email or password.')).toBeTruthy()` (stub devolve `400`, `:264`) | ✅ PASS |
| SSO-07 — campo vazio/só espaços → botão desabilitado, sem requisição | `disabled === true` até ambos não-vazios (trim) | `LoginPage.spec.tsx:148` — `expect(submit.disabled).toBe(true)` (só e-mail), `:151` idem com senha `'   '`, `:154` `toBe(false)` com senha real | ✅ PASS |

### P1: Entrar via SSO quando disponível

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-08 — `/login` consulta `GET /auth/oidc/status` ao montar | requisição emitida antes de decidir a visibilidade | `LoginPage.spec.tsx:315-317` — o stub só aceita `/auth/oidc/status` e lança `unexpected fetch` em qualquer outra URL; `:322` `await screen.findByRole('link', ...)` só resolve se a chamada aconteceu | ✅ PASS |
| SSO-09 — `{configured:true}` → botão de SSO como link de navegação real | `<a href="/auth/oidc/login">`, nunca `fetch` | `LoginPage.spec.tsx:322` — `findByRole('link', { name: 'Sign in with SSO' })`; `:323` `expect(link.getAttribute('href')).toBe('/auth/oidc/login')`. Servidor: `auth.int.spec.ts:467` — `expect(response.json()).toEqual({ configured: true })` | ✅ PASS |
| SSO-10 — `{configured:false}` ou falha da chamada → botão nunca aparece | link ausente do DOM em ambos os casos | `LoginPage.spec.tsx:337` — `expect(screen.queryByRole('link', { name: 'Sign in with SSO' })).toBeNull()` (`configured:false`); `:350` idem com `Promise.reject`. Servidor: `auth.int.spec.ts:449` — `expect(response.json()).toEqual({ configured: false })` | ✅ PASS (mutante M2 morto) |
| SSO-11 — retorno em `/login?error=oidc_failed` → mensagem genérica, sem detalhe do IdP, formulário e SSO continuam | mensagem `auth.ssoFailed`; form + link ainda presentes | `LoginPage.spec.tsx:363` — `expect(screen.getByText('Corporate sign-in failed. Please try again.')).toBeTruthy()`; `:364-366` form + `findByRole('link')`. Servidor: `oidc.int.spec.ts:484`, `:500`, `:526` — `expect(response.headers.location).toBe(`${PUBLIC_URL}/login?error=oidc_failed`)` nos 3 caminhos de falha | ✅ PASS (mutante M7 morto) |
| SSO-12 — fluxo OIDC com sucesso → usuário autenticado na raiz (comportamento existente, inalterado) | redirect 3xx + sessão válida; caminho de sucesso intocado | `oidc.int.spec.ts:340` — `expect(result.statusCode).toBe(302)`; `:339` cookie de sessão definido; `:350` `expect(me.statusCode).toBe(200)`. Código: `routes.ts:325` `reply.redirect(config.publicUrl)` — confirmado inalterado no diff | ✅ PASS (evidência parcial: o valor do header `Location` do sucesso não é asserido — ver Observações) |

### P1: Sessão renovada ou redirecionamento para login

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-13 — app monta em rota protegida → `AuthProvider` chama `GET /me` antes de renderizar | `/me` emitido; rota não renderiza enquanto `loading` | `apps/web/src/auth/AuthProvider.spec.tsx:54` — `expect(screen.getByTestId('status').textContent).toBe('loading')`; `apps/web/src/auth/ProtectedRoute.spec.tsx:48` `expect(container.textContent).toBe('')`; `apps/web/src/App.spec.tsx:181` `expect(meCalls).toBe(1)` | ✅ PASS |
| SSO-14 — `200` → expõe `{id,email,displayName}` no contexto; rota renderiza | exatamente 3 campos, nada mais | `AuthProvider.spec.tsx:58` — `expect(user).toEqual({ id: 'user-1', email: 'alice@example.com', displayName: 'Alice' })` (o body do stub carrega um `role: 'admin'` extra, `:34`, que a asserção prova ser descartado); `ProtectedRoute.spec.tsx:57` `getByText('Protected content')` | ✅ PASS |
| SSO-15 — `401` → tenta `POST /auth/refresh` exatamente uma vez | sequência exata de chamadas | `AuthProvider.spec.tsx:82` — `expect(calls).toEqual(['/me', '/auth/refresh', '/me'])` | ✅ PASS |
| SSO-16 — refresh `200` → repete `GET /me` uma vez e segue o fluxo de sucesso | `authenticated` + usuário populado | `AuthProvider.spec.tsx:81` — `expect(status).toBe('authenticated')` após `['/me','/auth/refresh','/me']`; `:84` usuário completo | ✅ PASS (mutante M3 morto) |
| SSO-17 — refresh ≠ `200`, ou segundo `/me` falha → redireciona `/login?next=<rota atual>` | `anonymous` e navegação para `/login?next=` com o caminho atual | `AuthProvider.spec.tsx:100` — `expect(status).toBe('anonymous')` (refresh 401); `:119-121` idem com refresh 200 + segundo `/me` 401; `ProtectedRoute.spec.tsx:66` `getByText('Login page (next=/w/ws-1?foo=bar)')`; `App.spec.tsx:85-87` `expect(location.textContent).toBe('/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1')` | ✅ PASS |
| SSO-18 — `DiagramEditorPage` lê o usuário do contexto para `setActorId`, sem chamar `GET /me` | exatamente 1 chamada a `/me` no boot inteiro | `App.spec.tsx:181` — `expect(meCalls).toBe(1)`, reconfirmado após um tick em `:183`. Código: `DiagramEditorPage.tsx:45` `const { user } = useAuth()`, `:70` `client.setActorId(user.id)` | ✅ PASS |

### P2: Operável por teclado e nos dois idiomas

| Criterion (WHEN X THEN Y) | Spec-defined outcome | `file:line` + assertion | Result |
| --- | --- | --- | --- |
| SSO-19 — tela operável só por teclado em todas as ações | focar e-mail, focar senha, submeter, ativar SSO | `LoginPage.spec.tsx:98-99` — `expect(emailInput.tagName).toBe('INPUT')` / idem senha (controles nativos, focáveis por construção); `:301` `fireEvent.submit(form)` (caminho do Enter, sem clique); `:323` SSO é `<a href>` (ativável por Enter); `LoginPage.a11y.spec.tsx:80` `expect(seriousOrCriticalViolations(results)).toEqual([])`. Contraparte já asserida por foco explícito no shell: `AppShell.spec.tsx:52-53` `button.focus(); expect(document.activeElement).toBe(button)` | ✅ PASS (evidência estrutural, não uma varredura literal de tab-order — ver Observações) |
| SSO-20 — mudança de status de submissão (enviando, erro) anunciada em região `aria-live="polite"` | o texto de status/erro vive dentro de um container `aria-live="polite"` | **nenhuma asserção cita a região**: os testes só afirmam que o texto renderiza (`LoginPage.spec.tsx:184` `getByText('Signing in…')`, `:225` `getByText('Invalid email or password.')`); `jest-axe` não tem regra que exija `aria-live`. Implementação existe em `LoginPage.tsx:115` mas nada a protege | ❌ GAP (mutante M5 sobreviveu) |
| SSO-21 — todo texto visível vem de chaves i18n, em `pt-BR` e `en`, sem literal no componente | mesmas telas asseridas nos dois locales | `LoginPage.spec.tsx:12` fixa `en` e assere strings inglesas (`:94` `'Email'`, `:96` `'Sign in'`, `:225` `'Invalid email or password.'`); `App.spec.tsx:132-135` assere as strings `pt-BR` (`'E-mail'`, `'Senha'`, `'Entrar'`) na mesma tela — um literal hard-coded quebraria um dos dois lados. Chaves espelhadas em `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` | ✅ PASS |

**Status**: ❌ Gaps present — 20/21 ACs com evidência discriminante; SSO-20 sem evidência
(evidence-or-zero) e comprovadamente não-discriminante (mutante sobrevivente).

---

## Discrimination Sensor

**Sensor depth**: P0-full (auth é caminho crítico → ≥5 mutações manuais cobrindo todos os ramos).
Scratch isolado via `git worktree add <scratch> HEAD` (nunca `git stash`); `node_modules` do repo
real ligados por symlink; worktree removido com `--force` ao final.
Baseline pré-sensor: `git status --porcelain` vazio — reconfirmado idêntico após a limpeza.

Baseline verde no scratch antes de qualquer mutação: 33 testes / 6 arquivos
(`src/auth`, `src/App.spec.tsx`, `src/app-shell`), mais `auth.int.spec.ts` (16) e
`oidc.int.spec.ts` (8) no servidor.

| Mutação | File:line | Descrição | Killed? |
| --- | --- | --- | --- |
| M1 | `apps/web/src/auth/LoginPage.tsx:15-17` | Removida a guarda de open-redirect em `sanitizeNext` (passa a devolver `raw` sempre) | ✅ Killed (1 falha) |
| M2 | `apps/web/src/auth/LoginPage.tsx:55` | `setSsoConfigured(body?.configured === true)` → `setSsoConfigured(true)` (botão de SSO incondicional) | ✅ Killed (1 falha) |
| M3 | `apps/web/src/auth/AuthProvider.tsx:67` | `if (refreshed.ok)` → `if (!refreshed.ok)` (inverte o retry-once pós-refresh) | ✅ Killed (2 falhas) |
| M4 | `apps/web/src/auth/LoginPage.tsx:103` | Anti-enumeração quebrada: `401` passa a exibir `'No account with that email'` em vez da mensagem genérica | ✅ Killed (1 falha) |
| M5 | `apps/web/src/auth/LoginPage.tsx:115` | `<div aria-live="polite">` → `<div>` (região de anúncio removida) | ❌ **Survived** (33/33 continuaram passando) |
| M6 | `apps/server/src/modules/auth/routes.ts:193` | `{ configured: config.oidc !== undefined }` → `{ configured: true }` | ✅ Killed (1 falha) |
| M7 | `apps/server/src/modules/auth/routes.ts:346` | Redirect do `catch` do callback → `config.publicUrl` (perde `?error=oidc_failed`) | ✅ Killed (1 falha) |

**Result**: 6/7 killed — ❌ FAIL (M5 sobreviveu → fix task abaixo)

---

## Interactive UAT Results

Não executada nesta rodada (validação automatizada do Verifier). A tela é user-facing; UAT
interativa fica a critério do orquestrador/usuário após o fix de SSO-20.

---

## Code Quality

| Principle | Status |
| --------- | ------ |
| Minimum code | ✅ `AuthProvider` 114 linhas, `ProtectedRoute` 28, `LoginPage` 143, `AppShell` +9 — nenhuma abstração especulativa |
| Surgical changes | ✅ `routes.ts` toca só a rota nova e os 3 caminhos de falha do callback; caminho de sucesso literalmente inalterado |
| No scope creep | ✅ nada de retry em `syncClient`, nada de tela de cadastro, nada de menu de conta — todos os itens de Out of Scope respeitados |
| Matches patterns | ✅ `fetchImpl` injetável (`syncClient.ts`), bloco i18n por feature (`aiDock`), `seriousOrCriticalViolations` (`shell.a11y.spec.tsx`), `routeSchemas` do módulo auth |
| Spec-anchored outcome check (valores asseridos batem com o spec) | ⚠️ 20/21 — SSO-20 sem asserção sobre a região `aria-live` |
| Per-layer Coverage Expectation met (domain 1:1 ACs; routes happy+edge+error) | ✅ rota nova: ambos os ramos; callback: 3 ramos de falha + sucesso; nenhuma rota da matriz sem teste |
| Every test maps to a spec requirement — no unclaimed tests | ✅ com 2 extras defensivos declarados: `AuthProvider.spec.tsx:150` (`useAuth()` fora do provider lança — contrato de design.md) e `LoginPage.spec.tsx:241` (rejeição de rede no login recebe o mesmo tratamento genérico — extensão coerente de SSO-05/06) |
| Documented guidelines followed | ✅ `CLAUDE.md` (Node 22, comandos, AD-003/007/008); AD-011 do design respeitado — `useAuth()` é o único ponto de verdade de sessão, e `DiagramEditorPage` deixou de chamar `/me` |
| Would a senior engineer approve? | ✅ com a ressalva de SSO-20 (asserção faltando, não código errado) |

### Observações não bloqueantes

1. **`resolveSession` sem `try/catch`** (`AuthProvider.tsx:58-77`): uma rejeição de rede em `/me`
   (offline no boot, não um `401`) deixa `status` preso em `'loading'` para sempre — tela em branco,
   mais uma unhandled rejection. Nenhuma AC ou Edge Case da spec cobre esse caso (a lista de Edge
   Cases só trata falha de rede em `/auth/oidc/status`, que é tratada em `LoginPage.tsx:57`), então
   não conta como gap desta feature — registrado para uma próxima rodada decidir.
2. **SSO-12 com evidência parcial**: o teste de sucesso do OIDC assere `302` + cookie de sessão
   válido em `/me`, mas não o valor do header `Location`. A AC declara explicitamente
   "comportamento existente do servidor, inalterado por esta spec", e o diff confirma
   `routes.ts:325` intocado — por isso PASS, não GAP. Uma asserção de `Location` no teste de
   sucesso fecharia a última folga.
3. **Anotação de requisito desalinhada em `tasks.md`**: os IDs citados nas tasks da história de SSO
   estão deslocados em +1 frente à numeração declarada na spec (`tasks.md:80` cita SSO-09/11 para a
   rota de status, que pela spec é SSO-08..10; `tasks.md:105` e `:219` citam SSO-12 para o
   `?error=oidc_failed`, que pela spec é SSO-11). Só a anotação está errada — a cobertura foi
   re-derivada aqui pelo texto das ACs e está completa. Vale corrigir os rótulos para não
   contaminar rastreabilidade futura.
4. **SSO-19 com evidência estrutural**: operabilidade por teclado é provada por controles nativos
   (`INPUT`/`button`/`<a href>`), submit via `fireEvent.submit` e axe sem violações serious/critical
   — não por uma varredura literal de tab-order. Aceito como PASS (o repo já usa exatamente esse
   padrão em `shell.a11y.spec.tsx`), registrado por transparência.

---

## Edge Cases

- [x] **`next` apontando para outra origem é ignorado, cai para `/`** — `LoginPage.tsx:15-17`;
      `LoginPage.spec.tsx:133-135` (`next=https://evil.example/steal` → `landed:root`); mutante M1
      morto.
- [x] **`GET /auth/oidc/status` lento/falho é tratado como "não configurado"** —
      `LoginPage.tsx:57-59`; `LoginPage.spec.tsx:343-350` (`Promise.reject` → link ausente, tela não
      trava); mutante M2 morto.
- [x] **Segundo clique durante submissão não emite segunda requisição** — `LoginPage.tsx:76,80`;
      `LoginPage.spec.tsx:304` `expect(loginCalls).toBe(1)` após dois `fireEvent.submit`.
- [x] **Após redirect por sessão morta, login bem-sucedido leva ao `next` original** —
      `App.spec.tsx:144` `expect(assignMock).toHaveBeenCalledWith('/w/ws-1/d/diag-1')`, partindo do
      `/login?next=%2Fw%2Fws-1%2Fd%2Fdiag-1` que o próprio guard produziu.
- [x] **401 pós-boot em `DiagramSyncClient` segue sem tratamento (herdado, documentado)** —
      confirmado que nada no diff altera `apps/web/src/sync/syncClient.ts`; risco permanece
      registrado em `design.md:209` e em Out of Scope da spec.

---

## Gate Check

- **Gate command**: `make lint && make typecheck && make test-unit` (Build gate da tasks.md;
  `make test-integration` rodado adicionalmente, ver abaixo)
- **Result**: lint exit 0 (6 warnings pré-existentes, nenhum nos arquivos desta feature),
  typecheck exit 0 (25/25 tasks), test-unit exit 0 — **927 passed, 0 failed, 0 skipped** em 101
  arquivos (`apps/web`: 122 testes / 15 arquivos)
- **Integração (servidor, escopo desta feature)**: `auth.int.spec.ts` + `oidc.int.spec.ts` —
  **24 passed, 0 failed** (2 arquivos)
- **`make test-integration` completo**: exit 2, com falhas **exclusivamente** em
  `@arch-canvas/backup` (`Error: spawnSync pg_lsclusters ENOENT` — a limitação de sandbox já
  documentada em `CLAUDE.md`) e 6 testes skipped em `ws-gateway/presenceBroadcaster.int.spec.ts`
  (sem Redis, degrade explícito de AD-009). Nenhuma relação com `sso-sign-in`.
- **Testes adicionados por esta feature**: +33 unitários em `apps/web`
  (`AuthProvider.spec.tsx` 6, `ProtectedRoute.spec.tsx` 3, `LoginPage.spec.tsx` 16,
  `LoginPage.a11y.spec.tsx` 2, `App.spec.tsx` 4, `AppShell.spec.tsx` 2) e +5 de integração no
  servidor (2 em `auth.int.spec.ts` para `/auth/oidc/status`, 3 em `oidc.int.spec.ts` para os
  redirects de falha do callback). Nenhum teste removido; nenhuma asserção enfraquecida — as 3
  asserções de falha do callback foram *fortalecidas* de "erro lançado" para "`Location` exatamente
  igual a `${publicUrl}/login?error=oidc_failed`".
- **Skipped**: nenhum no gate unitário.
- **Failures**: nenhuma no gate unitário nem nos testes de integração desta feature.

---

## Fix Plans

### Fix 1: SSO-20 sem asserção sobre a região `aria-live="polite"`

- **Root cause**: a implementação está correta (`LoginPage.tsx:115`), mas nenhum teste assere o
  container: `getByText(...)` encontra o texto onde quer que ele esteja. O mutante M5 (remover o
  atributo) passou por todos os 33 testes. Uma regressão que mova a mensagem para fora da região —
  ou apague o atributo — ship silenciosamente, e é exatamente o que a história P2 existe para
  proteger.
- **Fix task**: em `apps/web/src/auth/LoginPage.spec.tsx`, asserir a região, não só o texto — nos
  dois estados que a AC nomeia (enviando e erro). Ex.:
  `expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe('Signing in…')` no
  teste de submit in-flight (`:184`) e `.toBe('Invalid email or password.')` no teste de `401`
  (`:225`). Critério de aceite do fix: reintroduzir M5 no scratch faz o teste falhar.
- **Where**: `apps/web/src/auth/LoginPage.spec.tsx` (só teste; nenhuma mudança de produção).
- **Priority**: Minor (código correto, asserção ausente — mas AC P2 sem rede de proteção).

---

## Requirement Traceability Update

| Requirement | Previous Status | New Status |
| ----------- | --------------- | ---------- |
| SSO-01..19 | Pending | ✅ Verified |
| SSO-20 | Pending | ❌ Needs Fix |
| SSO-21 | Pending | ✅ Verified |

---

## Summary

**Overall**: ⚠️ Issues — uma única lacuna, de teste, escopo mínimo

**Spec-anchored check**: 20/21 ACs com evidência que bate com o outcome definido na spec; 1 AC
(SSO-20) sem evidência
**Sensor**: 6/7 mutantes mortos (M5 sobreviveu)
**Gate**: 927 unitários passed, 0 failed, 0 skipped; +24 de integração do módulo auth

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

**Issues found**:
- SSO-20: a região `aria-live="polite"` não é asserida por nenhum teste (mutante M5 sobrevivente) —
  ver Fix 1, correção de uma linha por estado.

**Next steps**: rotear o Fix 1 para um implementador, re-verificar (rodada 2 de no máximo 3), e só
então marcar a feature como done. Nada mais bloqueia.
