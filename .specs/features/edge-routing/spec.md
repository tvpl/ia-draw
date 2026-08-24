# Contrato de roteamento de borda Specification

## Problem Statement

O `Caddyfile` do compose encaminha ao servidor apenas `/api/*`, `/ws*` e `/health/*`, mas nenhuma
das 90 rotas de `apps/server` está registrada sob `/api` — elas são `/auth`, `/me`, `/workspaces`,
`/projects`, `/diagrams`, `/ai`, `/libraries`, `/share`, `/admin`, `/presentations`,
`/users:lookup` e `/mcp-tokens`. No stack do Docker toda chamada de API cai no catch-all, chega ao
nginx e recebe a SPA de volta; `POST /auth/login` responde 405. O proxy de desenvolvimento do Vite
já tinha detectado a divergência (`SPEC_DEVIATION` em `apps/web/vite.config.ts`) e corrigiu apenas
a si mesmo, deixando o Caddy errado e a própria lista de prefixos incompleta em 7 entradas. Não
existe nada que force as duas bordas a concordarem com as rotas realmente registradas.

## Goals

- [ ] Toda rota registrada em `apps/server` é alcançável pelo Caddy do compose e pelo proxy do Vite
- [ ] A lista de prefixos tem uma única fonte de verdade, derivada das rotas registradas
- [ ] Um prefixo de rota novo que não seja roteado pelas duas bordas reprova o gate

## Out of Scope

| Feature | Reason |
| ------- | ------- |
| Prefixar as rotas do servidor com `/api` | Mudança de contrato público de 90 rotas e do `docs/openapi.json`; o custo não se justifica para resolver roteamento de borda |
| Trocar Caddy ou nginx por outra tecnologia | O defeito é de configuração, não de escolha de proxy |
| TLS/HTTPS no compose local | `README.md` já documenta a rota de HTTPS via Dokploy; local segue em HTTP |
| Rate limiting na borda | Já existe no servidor (SEC-02); duplicar na borda é decisão separada |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Fonte de verdade dos prefixos | Um módulo em `packages/shared-contracts` exportando a lista, consumido pelo Vite e verificado contra as rotas registradas | Já é o pacote onde contratos compartilhados entre server e web vivem; evita inventar lugar novo |  y |
| Como o Caddy consome a lista | `Caddyfile` escrito à mão, e um teste que falha quando ele diverge da lista | Caddy não lê JS; gerar o arquivo no build acrescentaria um passo de build a `infra/`. Um teste de paridade dá a mesma garantia sem gerar arquivo |  y |
| Forma do teste de paridade | Teste unitário em `tools/repo-tools` que extrai prefixos das rotas registradas, do `Caddyfile` e do `vite.config.ts` e exige igualdade de conjuntos | `repo-tools` já extrai rotas e consumidores; é o lugar onde a extração existe |  y |
| Rotas com dois-pontos (`/users:lookup`) | Tratadas como prefixo literal `/users` no roteamento de borda | Caddy e Vite casam por prefixo de caminho; `/users` cobre a rota sem enumerar o sufixo |  y |
| `/metrics` e `/health` | Roteados ao servidor como hoje | Já funcionam e são a única parte do stack provada em CI; nada muda |  y |
| Divergência descoberta com rota nova | O teste falha nomeando o prefixo e as duas bordas | Mensagem que nomeia o que falta é o que torna o gate acionável em vez de irritante |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: A API é alcançável pelo proxy público ⭐ MVP

**User Story**: Como pessoa subindo a instância com `make up`, quero que o frontend em
`localhost:8080` fale com o backend, para conseguir usar o produto.

**Why P1**: Sem isso, o caminho documentado como Quick start no README não permite nem autenticar.

**Acceptance Criteria**:

1. WHEN uma requisição chega ao proxy público com um caminho cujo prefixo está na lista de prefixos do servidor THEN o sistema SHALL encaminhá-la ao serviço `server`
2. WHEN uma requisição chega ao proxy público com um caminho que não corresponde a nenhum prefixo do servidor THEN o sistema SHALL encaminhá-la ao serviço `web`
3. WHEN `POST /auth/login` é feito através da porta pública com credenciais válidas THEN o sistema SHALL responder com o JSON do servidor e o cookie de sessão, nunca com HTML
4. WHEN um upgrade de WebSocket para `/ws/diagrams/:id` passa pelo proxy público THEN o sistema SHALL estabelecer a conexão com o serviço `server`
5. The `Caddyfile` SHALL não conter nenhuma regra para `/api`

**Independent Test**: com o stack de pé, `curl -i -X POST localhost:8080/auth/login` devolve JSON do
servidor (401 ou 200), nunca `text/html`.

---

### P1: O proxy de desenvolvimento cobre as mesmas rotas ⭐ MVP

**User Story**: Como quem desenvolve com `make web-dev`, quero que toda chamada de API funcione,
para não descobrir só em produção que um painel inteiro estava recebendo HTML.

**Why P1**: Hoje o dock de IA, biblioteca, admin de providers, apresentações, share links e o
lookup de usuário do convite falham silenciosamente em desenvolvimento.

**Acceptance Criteria**:

1. The proxy do servidor de desenvolvimento SHALL encaminhar todos os prefixos da lista de prefixos do servidor
2. WHEN uma rota do servidor sob um prefixo previamente não coberto é chamada em desenvolvimento THEN o sistema SHALL devolver a resposta do servidor, nunca `index.html`
3. WHERE a rota é um upgrade de WebSocket o proxy de desenvolvimento SHALL encaminhá-la com suporte a upgrade

**Independent Test**: `make web-dev` com o servidor de pé; `GET /users:lookup?email=…` devolve JSON.

---

### P2: A divergência não volta

**User Story**: Como quem mantém o repositório, quero que adicionar um prefixo de rota novo sem
roteá-lo nas duas bordas reprove o gate.

**Why P2**: É o que impede a próxima recaída da mesma classe; não é necessário para destravar hoje.

**Acceptance Criteria**:

1. The lista de prefixos de rota do servidor SHALL existir em exatamente um módulo versionado
2. WHEN o conjunto de prefixos extraído das rotas registradas difere do conjunto roteado pelo `Caddyfile` THEN o gate SHALL falhar nomeando cada prefixo em falta
3. WHEN o conjunto de prefixos extraído das rotas registradas difere do conjunto roteado pelo proxy de desenvolvimento THEN o gate SHALL falhar nomeando cada prefixo em falta
4. IF o `Caddyfile` não puder ser lido ou interpretado THEN o gate SHALL falhar, nunca passar por omissão

**Independent Test**: registrar uma rota sob um prefixo novo e ver o teste de paridade reprovar.

---

## Edge Cases

- WHEN uma rota do servidor é registrada sob um prefixo que colide com uma rota do SPA THEN o gate SHALL falhar nomeando a colisão
- IF o `Caddyfile` roteia um prefixo que não corresponde a nenhuma rota registrada THEN o gate SHALL falhar, para que regra morta não se acumule
- WHEN o servidor não está de pé e o proxy de desenvolvimento recebe uma chamada de API THEN o sistema SHALL devolver o erro do proxy, nunca `index.html`
- WHEN o caminho contém dois-pontos (`/users:lookup`) THEN o roteamento SHALL casá-lo pelo prefixo literal antes do dois-pontos

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| EDGE-01 | P1: A API é alcançável pelo proxy público | Design | Pending |
| EDGE-02 | P1: A API é alcançável pelo proxy público | Design | Pending |
| EDGE-03 | P1: A API é alcançável pelo proxy público | Design | Pending |
| EDGE-04 | P1: A API é alcançável pelo proxy público | Design | Pending |
| EDGE-05 | P1: A API é alcançável pelo proxy público | Design | Pending |
| EDGE-06 | P1: O proxy de desenvolvimento cobre as mesmas rotas | Design | Pending |
| EDGE-07 | P1: O proxy de desenvolvimento cobre as mesmas rotas | Design | Pending |
| EDGE-08 | P1: O proxy de desenvolvimento cobre as mesmas rotas | Design | Pending |
| EDGE-09 | P2: A divergência não volta | Implementing | Implementing (T1) |
| EDGE-10 | P2: A divergência não volta | Design | Pending |
| EDGE-11 | P2: A divergência não volta | Design | Pending |
| EDGE-12 | P2: A divergência não volta | Design | Pending |

**Coverage:** 12 total, 12 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] Login pela porta pública do compose funciona e devolve JSON
- [ ] Nenhum painel de `apps/web` recebe `index.html` no lugar de JSON, em dev ou no compose
- [ ] Um prefixo novo não roteado reprova `make ci`
