# Entrada no produto (login e SSO) — Especificação

Segunda fatia vertical do roadmap de produto (entrada R2 de
`.specs/features/platform-maturity/ui-roadmap.md`). Entrega a única porta de entrada que
`apps/web` ainda não tem: hoje o editor assume uma sessão já existente (`fetch('/me')` sem
tratamento de falha) — não existe tela de login, nem local, nem SSO, em lugar nenhum do produto.

## Problem Statement

O backend de autenticação está implementado e verificado (F5, requisitos `AUTH-01..04` e
`OIDC-01..03`): login local por e-mail/senha com Argon2id, sessão por cookie opaco `httpOnly`
(nunca JWT decodificável no cliente), rotação de sessão via `POST /auth/refresh`, e um fluxo OIDC
completo com PKCE que autoprovisiona o usuário no primeiro login. Nada disso tem interface: o único
lugar em `apps/web` que chama `/me` é `DiagramEditorPage.tsx`, sem checar o status da resposta —
uma sessão expirada faz `me.user.id` resolver `undefined` silenciosamente, sem redirecionar para
lugar nenhum. Não existe `AuthContext`, `ProtectedRoute` ou qualquer redirecionamento em `App.tsx`.

Duas lacunas reais do backend, descobertas durante a pesquisa desta spec, também fazem parte do
escopo (ambas pequenas, aditivas, decididas com o usuário antes de escrever esta spec):

1. Não existe hoje um jeito do frontend saber se OIDC está configurado no deploy sem tentar o fluxo
   e receber `503` no meio de uma navegação de página inteira.
2. Uma falha no callback OIDC (`GET /auth/oidc/callback`) hoje devolve `application/problem+json`
   cru no navegador, sem redirecionar de volta para o SPA — o usuário fica preso numa página de
   erro JSON sem caminho de volta.

## Goals

- [ ] Um usuário com credencial local entra com e-mail/senha e chega à página que pretendia
      acessar, sem passo intermediário desnecessário.
- [ ] Um usuário entra via SSO quando o deploy tem OIDC configurado, e o botão simplesmente não
      aparece quando não tem — nunca um botão que sempre falha.
- [ ] Uma sessão que expira durante o uso é renovada silenciosamente quando possível, e manda o
      usuário para o login quando não é, sem perder para onde ele estava indo.
- [ ] A tela inteira é operável por teclado e anuncia erro para leitor de tela.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Tela de cadastro / criação de conta local | Não existe rota pública de registro no backend (`createLocalAccount` é uma função de biblioteca usada só por seed/fixtures, nunca exposta como rota) — provisionamento continua fora do produto (admin/seed) ou via autoprovisionamento OIDC no primeiro login |
| Menu de conta, troca de senha, perfil do usuário | Fora do escopo desta fatia — só entrada e saída da sessão |
| Seletor de workspace no login | R3 (`workspace-navigation`) consome `GET /workspaces` depois que a sessão existe; login não devolve workspaces |
| Retry automático de chamadas de `DiagramSyncClient`/futuro `AiDockClient` num 401 no meio do uso | Esta spec só cobre o guard de entrada de rota (checagem no boot do app) e a renovação da própria sessão; não retrofita os outros clientes HTTP existentes para reagir a 401 — risco residual documentado em Edge Cases |
| Página de detalhe do erro OIDC (motivo exato da falha do IdP) | O redirecionamento de falha do callback carrega só um código genérico (`oidc_failed`), nunca o erro interno do IdP — evita vazar detalhe de protocolo na URL |
| Rate limiting / lockout em `POST /auth/login` | Backend não tem hoje (achado da pesquisa) — fora do escopo desta fatia, que é só frontend sobre o contrato existente; sinalizado como risco herdado, não uma regressão introduzida aqui |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui — nada fica silenciosamente indefinido.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde vive a tela de login? | Rota própria `/login` em `App.tsx`, fora do `AppShell` atual | O login precisa existir antes de qualquer sessão — não pode depender do shell autenticado | y |
| Como o SPA decide redirecionar para `/login`? | Um `AuthProvider` novo, montado uma vez no topo de `App.tsx`, chama `GET /me` ao montar; sem sessão válida (401), redireciona para `/login?next=<rota original>`; com sessão, expõe o usuário via contexto | É o único ponto de entrada do app hoje — `DiagramEditorPage` passa a ler o usuário do contexto em vez de chamar `/me` de novo, fechando a lacuna real hoje (401 silenciosamente vira `undefined`) | y |
| O SPA renova a sessão sozinho quando ela expira? | Sim, mas só reativamente e só no guard do `AuthProvider`: um 401 em `GET /me` tenta `POST /auth/refresh` uma vez; se funcionar, tenta `/me` de novo; se falhar, vai para `/login` preservando `next` | Sessão dura 30 dias e é só um cookie opaco — não há campo de expiração legível pelo cliente para justificar um refresh proativo por timer; reativo é suficiente e mais simples | y |
| Outros clientes (`DiagramSyncClient`) ganham o mesmo retry automático nesta fatia? | Não | Está fora do orçamento desta onda (roadmap: "5 rotas, 2 superfícies, 1 onda"); retrofitar todo cliente HTTP existente é uma mudança maior, registrada como risco em Edge Cases, não silenciosamente resolvida | y |
| Como o botão de SSO sabe se deve aparecer? | Nova rota `GET /auth/oidc/status` no servidor, devolvendo `{ configured: boolean }` — sem segredo, sem detalhe de provider | Decidido com o usuário: evita depender de duas configurações sincronizadas manualmente (env do backend + env de build do frontend) e evita a pior opção (clique que pode terminar em erro cru) | y |
| O que acontece numa falha do callback OIDC? | `GET /auth/oidc/callback` passa a redirecionar para `${publicUrl}/login?error=oidc_failed` em vez de lançar o erro cru; o SPA em `/login` lê `error` da query string e mostra uma mensagem tratada | Decidido com o usuário: pequena mudança de comportamento numa rota já existente, troca uma tela de erro JSON crua por uma mensagem tratada no próprio SPA | y |
| O redirecionamento de sucesso do OIDC muda nesta fatia? | Não — continua `reply.redirect(config.publicUrl)`, aterrissando em `/` | Fora do escopo decidido com o usuário (só a falha muda); `/` hoje é o `AppShell` stub, que R3 preenche depois — não é problema desta fatia resolver | y |
| Existe link de "criar conta" na tela de login? | Não | Não existe rota pública de registro (ver Out of Scope) — oferecer um link que não leva a lugar nenhum é pior que não oferecer | y |
| Onde vive o controle de logout? | Um botão único, sem menu, dentro do `AppShell` atual (`apps/web/src/app-shell/AppShell.tsx`) | O shell já existe como stub; um controle de conta completo é escopo de R3/futuro — aqui só precisa existir um jeito de encerrar a sessão | y |
| Validação client-side de e-mail/senha no login | Só "campo não vazio" nos dois campos, espelhando exatamente `z.string().min(1)` do servidor — nenhuma regra adicional (formato de e-mail, tamanho mínimo de senha) | O servidor não impõe nenhuma regra além de não-vazio no login (é login, não criação de conta) — impor mais no cliente criaria uma UX que rejeita localmente o que o servidor aceitaria | y |
| A mensagem de erro de login distingue e-mail inexistente de senha errada? | Não — mensagem única, genérica | O servidor já devolve a mesma resposta `401` para os dois casos deliberadamente (AUTH-01, anti-enumeração) — uma mensagem diferente no cliente reintroduziria a distinção que o servidor apaga de propósito | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Entrar com credencial local

**User Story**: Como pessoa com conta local, quero entrar com e-mail e senha, para acessar meu
workspace sem sair do produto.

**Why P1**: É o caminho de entrada que sempre existe, independente de qualquer configuração de
deploy — sem ele, ninguém entra no produto de jeito nenhum.

**Acceptance Criteria**:
1. WHEN o usuário acessar `/login` sem sessão válida THEN a tela SHALL renderizar os campos de
   e-mail e senha e o botão de entrar, alcançáveis por teclado.
2. IF o usuário já tiver sessão válida THEN acessar `/login` SHALL redirecionar imediatamente para
   `next` (ou `/` quando `next` não estiver presente), sem mostrar o formulário.
3. WHEN o usuário submeter e-mail e senha não vazios THEN a tela SHALL emitir
   `POST /auth/login` com `{ email, password }` e desabilitar o botão de envio até a resposta.
4. IF a resposta for `200` THEN a tela SHALL redirecionar para `next` (ou `/` quando ausente).
5. IF a resposta for `401` THEN a tela SHALL exibir uma mensagem única e genérica de credencial
   inválida, preservar o e-mail digitado, limpar a senha, e reabilitar o envio — nunca distinguindo
   e-mail inexistente de senha errada.
6. IF a resposta for `400` (payload malformado) THEN a tela SHALL tratar como o mesmo caso de
   `401` do ponto de vista do usuário (mensagem genérica) — a distinção é só técnica.
7. IF o campo de e-mail ou senha estiver vazio ou só espaços THEN o botão de envio SHALL
   permanecer desabilitado, sem emitir requisição.

**Independent Test**: Submeter uma senha errada para um e-mail existente e confirmar que a mensagem
é idêntica à submetida para um e-mail que não existe, e que nenhuma delas revela qual dos dois
campos estava errado.

---

### P1: Entrar via SSO quando disponível

**User Story**: Como pessoa cujo workspace usa um provedor de identidade corporativo, quero entrar
com um clique via SSO, sem gerenciar outra senha.

**Why P1**: É o caminho de entrada que a organização realmente usa quando tem OIDC configurado —
sem ele, o produto força credencial local mesmo em deploys que já resolveram identidade
centralizada.

**Acceptance Criteria**:
1. WHEN a tela `/login` montar THEN ela SHALL consultar `GET /auth/oidc/status` antes de decidir
   se mostra o botão de SSO.
2. IF `GET /auth/oidc/status` devolver `{ configured: true }` THEN a tela SHALL mostrar o botão de SSO como um link de navegação real (`<a href="/auth/oidc/login">`, não uma chamada `fetch`) — o fluxo OIDC é uma sequência de navegações de página inteira, não uma chamada assíncrona.
3. IF `GET /auth/oidc/status` devolver `{ configured: false }`, ou a chamada falhar, THEN a tela SHALL não mostrar o botão de SSO — nunca um botão que sempre leva a `503`.
4. WHEN o navegador retornar em `/login` com `?error=oidc_failed` na query string THEN a tela SHALL
   exibir uma mensagem genérica de falha no login corporativo, sem detalhe do erro do provedor, e
   SHALL continuar oferecendo o formulário local e (se configurado) o botão de SSO de novo.
5. WHEN o fluxo OIDC completar com sucesso THEN o usuário SHALL chegar autenticado à raiz do
   produto (comportamento existente do servidor, inalterado por esta spec).

**Independent Test**: Com OIDC configurado, acessar `/login`, confirmar que o botão de SSO aparece
e é um link real (não desabilita nem faz `fetch`); com OIDC não configurado, confirmar que o botão
não aparece em lugar nenhum do DOM.

---

### P1: Sessão renovada ou redirecionamento para login

**User Story**: Como pessoa já autenticada, quero que uma sessão perto de expirar seja renovada
sem eu perceber, e que uma sessão realmente morta me leve de volta ao login sem eu perder o que eu
estava fazendo.

**Why P1**: É o que fecha a lacuna real encontrada na pesquisa — hoje uma sessão expirada faz
`DiagramEditorPage` seguir adiante com um `user.id` `undefined`, sem nunca levar o usuário para
lugar nenhum.

**Acceptance Criteria**:
1. WHEN o app montar em qualquer rota protegida THEN o `AuthProvider` SHALL chamar `GET /me` antes
   de renderizar a rota.
2. IF `GET /me` responder `200` THEN o `AuthProvider` SHALL expor o usuário (`id`, `email`,
   `displayName`) via contexto para toda a árvore, e a rota protegida SHALL renderizar
   normalmente.
3. IF `GET /me` responder `401` THEN o `AuthProvider` SHALL tentar `POST /auth/refresh` exatamente
   uma vez antes de desistir.
4. IF `POST /auth/refresh` responder `200` THEN o `AuthProvider` SHALL repetir `GET /me` uma vez e
   seguir o fluxo de sucesso (AC2).
5. IF `POST /auth/refresh` responder qualquer coisa diferente de `200`, ou o segundo `GET /me` também falhar, THEN o `AuthProvider` SHALL redirecionar para `/login?next=<rota atual>`.
6. The `DiagramEditorPage` SHALL ler o usuário (para `setActorId`) do contexto do `AuthProvider`, e não mais chamar `GET /me` diretamente.

**Independent Test**: Com uma sessão cujo cookie foi apagado manualmente, acessar
`/w/x/d/y`, confirmar que o app tenta `/me` (401), tenta `/auth/refresh` (falha, sem cookie),
e redireciona para `/login?next=%2Fw%2Fx%2Fd%2Fy`.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero operar a tela de login
inteira sem mouse.

**Why P2**: Não bloqueia o valor do fluxo, mas o repositório já tem `A11Y-01` verificado no shell e
regredir nisso seria contradição direta.

**Acceptance Criteria**:
1. The tela de login SHALL ser operável somente por teclado em todas as suas ações: focar e-mail,
   focar senha, submeter, ativar SSO quando presente.
2. WHEN o status de submissão mudar (enviando, erro) THEN a tela SHALL anunciar em uma região
   `aria-live="polite"`.
3. The tela SHALL obter todo texto visível das chaves de i18n, nos locales `pt-BR` e `en`, sem
   literal de texto no componente.

**Independent Test**: Percorrer o fluxo inteiro — focar e-mail, focar senha, submeter, ler o erro —
usando apenas Tab e Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o usuário acessar `/login` já com `?next=` apontando para uma URL de outra origem (não relativa
  ao produto) THEN a tela SHALL ignorar o `next` e redirecionar para `/` após o login — nunca
  redirecionar para uma URL externa vinda de query string (open-redirect).
- IF `GET /auth/oidc/status` demorar ou falhar por erro de rede (não um `200`/`503` explícito) THEN
  a tela SHALL tratar como "não configurado" (esconder o botão) em vez de travar a tela de login.
- WHILE uma submissão de login local estiver em andamento, um segundo clique no botão SHALL não
  emitir uma segunda requisição.
- IF o `AuthProvider` já redirecionou para `/login` por uma sessão morta, e o usuário faz login de
  novo com sucesso THEN o app SHALL levá-lo para o `next` original, não para `/`.
- Um 401 que aconteça DEPOIS do boot, durante o uso normal de `DiagramSyncClient` ou de um futuro
  cliente de IA (não durante o guard inicial do `AuthProvider`), continua sem tratamento automático
  nesta fatia — comportamento herdado, documentado em Out of Scope, não uma regressão desta spec.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| SSO-01 | P1: Login local | F10 | Pending |
| SSO-02 | P1: Login local | F10 | Pending |
| SSO-03 | P1: Login local | F10 | Pending |
| SSO-04 | P1: Login local | F10 | Pending |
| SSO-05 | P1: Login local | F10 | Pending |
| SSO-06 | P1: Login local | F10 | Pending |
| SSO-07 | P1: Login local | F10 | Pending |
| SSO-08 | P1: SSO quando disponível | F10 | Pending |
| SSO-09 | P1: SSO quando disponível | F10 | Pending |
| SSO-10 | P1: SSO quando disponível | F10 | Pending |
| SSO-11 | P1: SSO quando disponível | F10 | Pending |
| SSO-12 | P1: SSO quando disponível | F10 | Pending |
| SSO-13 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-14 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-15 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-16 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-17 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-18 | P1: Sessão renovada ou redirecionamento | F10 | Pending |
| SSO-19 | P2: Teclado e idioma | F10 | Pending |
| SSO-20 | P2: Teclado e idioma | F10 | Pending |
| SSO-21 | P2: Teclado e idioma | F10 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `SSO` não colide com nenhum já usado no repositório: A11Y, AAC, AIC, AIE, AIG, API, AUTH,
CIQ, CLB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, OBS, OIDC, OPS, PERF, PRS,
REC, SEC, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 21 requisitos, mapeados 1:1 às 21 acceptance criteria das quatro histórias. Nenhum
mapeado a task ainda — o breakdown é a rodada de Tasks desta feature.

**Numeração por história:** SSO-01..07 (login local), SSO-08..12 (SSO), SSO-13..18 (sessão),
SSO-19..21 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Origem | Mudança nesta spec |
| --- | --- | --- | --- |
| `POST /auth/login` | autentica credencial local, seta cookie de sessão | `apps/server/src/modules/auth/routes.ts` | Nenhuma |
| `POST /auth/logout` | revoga a sessão corrente | `apps/server/src/modules/auth/routes.ts` | Nenhuma |
| `POST /auth/refresh` | rotaciona o token de sessão | `apps/server/src/modules/auth/routes.ts` | Nenhuma |
| `GET /me` | devolve o usuário da sessão corrente, ou `401` | `apps/server/src/modules/auth/routes.ts` | Nenhuma |
| `GET /auth/oidc/login` | inicia o handshake OIDC (navegação de página inteira) | `apps/server/src/modules/auth/routes.ts` | Nenhuma |
| `GET /auth/oidc/callback` | conclui o handshake, seta cookie de sessão | `apps/server/src/modules/auth/routes.ts` | **Sim** — numa falha, passa a redirecionar para `${publicUrl}/login?error=oidc_failed` em vez de lançar o erro `problem+json` cru |
| `GET /auth/oidc/status` | devolve `{ configured: boolean }` | **Nova**, `apps/server/src/modules/auth/routes.ts` | **Rota nova**, aditiva |

O roadmap original (`ui-roadmap.md`) listava 5 rotas para R2; a contagem real é 7 — `GET /me` já
existia e foi omitida da lista original, e `GET /auth/oidc/status` é nova, decidida com o usuário
durante esta rodada de Specify. A entrada do roadmap será atualizada para refletir isso quando esta
spec fechar.

---

## Success Criteria

- [ ] Uma pessoa com credencial local entra e chega exatamente onde pretendia ir, sem tela
      intermediária desnecessária.
- [ ] O botão de SSO nunca aparece num deploy sem OIDC configurado, provado por teste que falha se
      ele voltar a aparecer incondicionalmente.
- [ ] Uma sessão morta redireciona para `/login` preservando o destino original, verificado sem
      depender de nenhum estado de UI intermediário.
- [ ] Uma falha de callback OIDC nunca mais mostra JSON cru no navegador.
- [ ] `repo-tools audit` deixa de classificar `POST /auth/login`, `POST /auth/logout`,
      `POST /auth/refresh`, `GET /me`, `GET /auth/oidc/login` e `GET /auth/oidc/callback` como
      `pending-product`, e `GET /auth/oidc/status` aparece no inventário como rota nova, já
      consumida.
- [ ] O fluxo inteiro é percorrível só com teclado, nos dois locales.
