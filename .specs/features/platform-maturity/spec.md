# Platform Maturity — Especificação

Programa de melhorias que torna o Architecture Canvas **profissional** (o que a documentação promete é o que se pode abrir), **agêntico** (os diagramas viram contexto de arquitetura consumível por agentes) e **gerenciável por squads** (domínios com dono, specs paralelizáveis, portões automáticos).

## Problem Statement

O roadmap F0–F5 entregou um backend profundo e bem testado — 21 módulos, 251 arquivos-fonte, 48 rotas REST, 124 arquivos de teste — mas o produto não é utilizável por um usuário final: `apps/web` tem 5 componentes React, 2 rotas, e consome 4 endpoints. O `AppShell` é `<main />` vazio com o comentário `"nav/search/admin land here in F1+"`, e F1 a F5 fecharam sem que isso acontecesse. O dock de IA — o diferencial declarado do produto — não tem nenhum componente. Mesmo assim, o README e a landing afirmam "roadmap completo — 92/92 requisitos verificados"; a qualificação honesta ("contrato de backend verificado; metade de UI pendente") existe dentro de `validation.md`, mas não sobreviveu até a documentação que as pessoas leem.

O mesmo padrão aparece na infraestrutura: o CI builda as três imagens Docker mas nunca sobe o stack nem roda o Playwright — foi por isso que três bugs reais (dependências nativas do `canvas` em Alpine, healthchecks resolvendo `localhost` para IPv6, `/health/*` roteado para o SPA em vez do servidor) chegaram até uma verificação manual em vez de falhar num pull request. E o repositório, construído por agentes de ponta a ponta, não tem `CLAUDE.md`, `settings.json`, subagents ou comandos versionados: cada sessão redescobre as mesmas armadilhas.

## Goals

- [ ] Toda afirmação de capacidade na documentação de produto tem superfície verificável ou é explicitamente marcada como contrato de backend — checado por CI, não por disciplina.
- [ ] O CI prova o sistema de pé (stack real + e2e), de forma que a classe de bug encontrada manualmente hoje falhe antes do merge.
- [ ] Um agente externo (Cursor, Claude Code) consulta a arquitetura do sistema pelos diagramas via MCP, com RBAC real e sem acesso ao banco.
- [ ] Um desenvolvedor ou agente novo roda build, testes e stack local a partir de um único documento de onboarding.
- [ ] Dois ou mais squads trabalham em domínios distintos em paralelo sem colisão de ownership, de specs ou de release.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Implementação da UI dos módulos sem superfície (dock de IA, apresentação, comentários, biblioteca, histórico, docgen) | Decisão do usuário: esta spec entrega o roadmap decomposto em specs próprias (UIX-*); a implementação são features seguintes, cada uma dimensionada por squad |
| Multi-tenancy / oferta SaaS hospedada | O produto é self-hosted por decisão de arquitetura; nada neste programa muda isso |
| Revisitar ou reabrir os 92 requisitos de F0–F5 | Este programa adiciona uma camada de maturidade sobre o roadmap entregue; não reclassifica trabalho já verificado |
| Split do monólito modular em serviços separados | AD-003 segue ativa e não é questionada aqui |
| Refatoração dos testes existentes | O portão de cobertura é ratchet sobre o valor medido atual, nunca uma reescrita da suíte |
| Escolha de provider de IA, modelos ou orçamento de custo | Configuração de operador, não deliverable de engenharia |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui — nada fica silenciosamente indefinido.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Esta spec entrega a UI ou o plano da UI? | Entrega o inventário e as specs decompostas (UIX-*); a implementação vira features próprias em ondas seguintes | Escolha explícita do usuário ("UI como roadmap faseado com specs próprias"); mantém este programa executável em semanas em vez de meses | y |
| Escrita via MCP entra junto com leitura? | Leitura é P1; escrita é P2 atrás de flag, reusando o caminho de aprovação e snapshot `pre_ai` já existente | O valor declarado é entendimento de arquitetura por agentes, que é puramente leitura; escrita carrega risco maior e não deve bloquear o valor principal | y |
| Onde vive o servidor MCP? | Novo `apps/mcp`, processo stdio distribuível via `npx`, falando com a API REST existente por token | Clientes locais (Cursor, Claude Code) esperam stdio; manter fora do `apps/server` preserva AD-003 e não mistura superfície pública de agente com a aplicação | n |
| Limiar de cobertura de testes | Limiar declarado por package, iniciado no valor medido hoje e travado como piso (ratchet) | Evita um PR gigante de cobertura e ainda assim impede regressão silenciosa | n |
| Como os squads são mapeados? | Ownership pela fronteira de pastas que já existe (módulos do server, packages, infra, web); nomes de time entram no `CODEOWNERS` quando os times existirem de fato | A estrutura do monorepo já é a fronteira real de domínio; inventar organograma antes do time seria ficção | n |
| O que fazer com a afirmação "92/92 verificados"? | Reescrever como "92/92 com contrato de backend verificado por Verifier independente; superfície de produto rastreada à parte no mapa de capacidades" | Preserva o mérito real do trabalho entregue sem prometer uma UI que não existe | y |
| Node 22 continua obrigatório? | Sim, permanece travado em 22.x e passa a ser verificado no onboarding agêntico | Node 24 quebra o `AbortSignal` cross-realm sob jsdom nos testes do `callProvider`; é armadilha conhecida e reprodutível | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Documentação que não promete o que não existe ⭐ F6

**User Story**: Como pessoa avaliando ou adotando o projeto, quero que a documentação distinga capacidade entregue de contrato de backend, para que eu decida com base no que existe de verdade.

**Why P1**: É a maior distância entre percepção e realidade hoje, é barata de fechar, e sem ela toda outra melhoria é construída sobre uma promessa falsa.

**Acceptance Criteria**:
1. The system SHALL manter um mapa de capacidades versionado que, para cada capacidade anunciada, registre a evidência de backend e o caminho da superfície de UI que a expõe ao usuário final.
2. IF uma capacidade tiver evidência de backend e nenhuma superfície de UI THEN o mapa SHALL classificá-la como `backend-only` e a documentação de produto SHALL apresentá-la nessa condição, nunca como entregue ao usuário.
3. WHEN o CI executar THEN ele SHALL falhar se qualquer entrada do mapa declarar um caminho de UI que não exista em `apps/web/src`.
4. The README e a landing `docs/architecture-overview.html` SHALL declarar o número de requisitos como contrato de backend verificado, acompanhado da contagem de capacidades ainda sem superfície de produto.

**Independent Test**: Alterar uma entrada do mapa para apontar a um componente inexistente e confirmar que o CI falha nomeando a entrada.

---

### P1: CI que prova o sistema de pé ⭐ F6

**User Story**: Como pessoa fazendo merge, quero que o CI suba o sistema de verdade, para que bugs de runtime falhem no pull request em vez de na máquina de alguém.

**Why P1**: Os três bugs de Docker corrigidos manualmente hoje passaram por um CI verde. Um portão que não sobe o sistema não prova que o sistema sobe.

**Acceptance Criteria**:
1. WHEN o CI rodar em um pull request THEN ele SHALL subir o stack completo via `docker compose up --build` e falhar se qualquer serviço não atingir estado `healthy` dentro de 5 minutos.
2. WHEN o stack estiver de pé no CI THEN ele SHALL requisitar `GET /health/ready` pela porta pública e falhar se a resposta não for HTTP 200 com `status` igual a `ok` e a dependência `postgres` em `up`.
3. WHEN o CI rodar THEN ele SHALL executar a suíte Playwright de `apps/web` contra o stack real e falhar se qualquer teste falhar.
4. IF a cobertura de um package cair abaixo do piso declarado para aquele package THEN o CI SHALL falhar nomeando o package, o piso e o valor medido.
5. WHEN um pull request for aberto THEN o CI SHALL validar cada mensagem de commit contra Conventional Commits e falhar identificando a primeira mensagem não conforme.
6. IF o runner do CI não tiver daemon Docker disponível THEN o job de stack SHALL falhar explicitamente em vez de ser pulado como sucesso.
7. The system SHALL manter atualização automatizada de dependências com pull requests agrupados por ecossistema, cada um sujeito à suíte completa antes do merge.

**Independent Test**: Reverter qualquer um dos três fixes de Docker de hoje em um branch e confirmar que o CI fica vermelho.

---

### P1: Inventário e decomposição do gap de produto ⭐ F6

**User Story**: Como pessoa planejando o roadmap, quero saber exatamente quais capacidades de backend não têm superfície, para transformar cada uma em trabalho dimensionado por squad.

**Why P1**: Sem o inventário, o gap de produto continua invisível no planejamento e o backend segue crescendo sem consumidor.

**Acceptance Criteria**:
1. The system SHALL manter um inventário que mapeie cada rota REST registrada à superfície de UI que a consome, marcando explicitamente as rotas sem consumidor.
2. WHEN o inventário identificar uma capacidade sem superfície THEN essa capacidade SHALL entrar no roadmap de produto como spec própria em `.specs/features/`, dimensionada para execução por um único squad.
3. The system SHALL especificar o dock de IA como a primeira fatia vertical do roadmap de produto, por ser a capacidade que o produto declara como diferencial e que hoje não tem nenhum componente.
4. WHEN uma nova rota REST for registrada sem consumidor de UI THEN o inventário SHALL registrá-la como pendente de produto em vez de deixá-la sem classificação.

**Independent Test**: Conferir que a soma de rotas consumidas e rotas pendentes no inventário iguala o total de rotas registradas no servidor.

---

### P1: Onboarding e loop agêntico versionados ⭐ F7

**User Story**: Como agente ou pessoa entrando no repositório, quero um único documento que me dê comandos, invariantes e armadilhas, para produzir trabalho correto na primeira tentativa.

**Why P1**: O repositório é construído por agentes e não tem nenhum artefato de onboarding; cada sessão redescobre as mesmas armadilhas (Node 22, corepack, AD-008, caminho do compose).

**Acceptance Criteria**:
1. The system SHALL manter um `CLAUDE.md` na raiz declarando os comandos de build, teste e stack local, os invariantes de arquitetura não-óbvios e as armadilhas conhecidas do ambiente.
2. WHEN um agente seguir apenas o `CLAUDE.md` THEN ele SHALL conseguir rodar lint, typecheck, testes unitários, testes de integração e o stack local sem consultar nenhum outro arquivo.
3. The `CLAUDE.md` SHALL declarar explicitamente a restrição de Node 22.x, a necessidade de `corepack enable`, e a proibição de importar `@excalidraw/excalidraw` por valor em código server-side.
4. The system SHALL versionar `.claude/settings.json` com as permissões de ferramenta e os hooks que o fluxo de trabalho exige.
5. WHERE um fluxo se repetir a cada onda de desenvolvimento, o repositório SHALL expô-lo como subagent ou slash command versionado em vez de instrução repetida em prosa.

**Independent Test**: Uma sessão nova, sem contexto, executa os cinco comandos do `CLAUDE.md` com sucesso.

---

### P1: Diagramas como contexto de arquitetura para agentes (MCP) ⭐ F9

**User Story**: Como pessoa desenvolvendo no Cursor ou no Claude Code, quero que meu agente consulte os diagramas de arquitetura da empresa, para que ele entenda o sistema real antes de propor mudanças.

**Why P1**: É o maior salto de valor disponível a menor custo: o `diagram-ir/v1`, os metadados semânticos e o docgen já existem no backend — falta a camada que os entrega a agentes. Converte os diagramas de documentação passiva em contexto ativo de engenharia.

**Acceptance Criteria**:
1. The system SHALL expor um servidor MCP que permita a um agente externo autenticado buscar diagramas de um workspace e ler o conteúdo de um diagrama específico.
2. WHEN um agente ler um diagrama pelo MCP THEN o servidor SHALL responder com a representação semântica `diagram-ir/v1` — nós, containers, edges e metadados — e nunca apenas uma imagem renderizada.
3. WHEN um agente consultar um componente pelo seu `stable_key` THEN o servidor SHALL retornar os metadados semânticos registrados e as relações de entrada e de saída daquele componente.
4. The system SHALL resolver toda autorização do servidor MCP pela mesma função `can(actor, action, resource)` usada pelas rotas REST, nunca por uma checagem paralela.
5. IF o token apresentado não tiver permissão sobre o diagrama solicitado THEN o servidor MCP SHALL negar a chamada sem revelar se o recurso existe.
6. The system SHALL marcar todo texto originado do canvas — labels, descrições, metadados e comentários — como dado não-confiável na resposta MCP, nunca como instrução ao agente chamador.
7. WHERE a escrita via MCP estiver habilitada, a ferramenta de mutação SHALL passar pelo mesmo limiar de aprovação e gravar o mesmo snapshot `pre_ai` das mutações do agente interno.
8. WHEN o servidor MCP for distribuído THEN a documentação SHALL trazer a configuração de instalação pronta para Claude Code e para Cursor.

**Independent Test**: Configurar o MCP em um cliente real e obter resposta correta para "quais componentes dependem do banco de produção neste diagrama", sem que o cliente tenha acesso ao PostgreSQL.

---

### P2: Governança para múltiplos squads — F8

**User Story**: Como líder técnico com mais de um squad, quero ownership, templates e processo de release explícitos, para que times trabalhem em paralelo sem pisar uns nos outros.

**Why P2**: Necessário para escalar o time, mas não bloqueia o valor dos itens P1 e só produz efeito real quando os squads existirem de fato.

**Acceptance Criteria**:
1. The system SHALL declarar ownership de cada domínio de primeiro nível — módulos do servidor, packages, infra e web — em um arquivo `CODEOWNERS`, sem nenhum domínio sem dono.
2. WHEN um pull request for aberto THEN o template SHALL exigir os IDs de requisito afetados e o link para a spec correspondente.
3. IF um pull request alterar qualquer package publicável sem declarar um changeset THEN o CI SHALL falhar nomeando o package alterado.
4. WHILE mais de um squad trabalhar em paralelo, o diretório `.specs/features/` SHALL manter uma spec por domínio, com IDs próprios, em vez de uma única spec monolítica.
5. WHEN uma decisão arquitetural nova for tomada THEN ela SHALL ser registrada como ADR numerado contendo decisão, motivo, trade-off e escopo, no mesmo formato dos ADR-0001 a ADR-0009.
6. WHILE duas ou mais frentes de trabalho estiverem ativas, o handoff em `STATE.md` SHALL registrar cada frente separadamente com seu branch e escopo, em vez de um único snapshot global.

**Independent Test**: Dois branches tocando domínios diferentes abrem pull requests simultâneos e recebem revisores distintos automaticamente, sem conflito em `.specs/`.

---

### P2: Contrato de API para consumo automatizado — F8

**User Story**: Como integrador ou agente, quero um contrato de API versionado e sempre atualizado, para consumir a plataforma sem ler o código-fonte.

**Why P2**: Multiplica o valor do MCP e de qualquer integração, mas o MCP pode ser entregue antes dele.

**Acceptance Criteria**:
1. The system SHALL publicar um documento OpenAPI 3.1 gerado a partir dos schemas Zod já existentes, cobrindo toda rota REST registrada.
2. IF uma rota for adicionada ou alterada sem que o documento seja regenerado THEN o CI SHALL falhar apontando a rota divergente.
3. WHEN a suíte de evals do `ai-engine` rodar no CI THEN ela SHALL falhar o build se a taxa de sucesso ficar abaixo do limiar declarado.

**Independent Test**: Adicionar uma rota sem regenerar o contrato e confirmar que o CI falha nomeando-a.

---

## Edge Cases

- IF o mapa de capacidades apontar para um componente de UI removido em um refactor THEN o CI SHALL falhar em vez de degradar para uma afirmação silenciosamente falsa.
- IF o stack do CI subir mas um healthcheck ficar oscilando entre saudável e não saudável THEN o job SHALL tratar o estado final após o timeout como falha.
- IF o servidor MCP receber um token válido de outro workspace THEN ele SHALL negar sem distinguir "não existe" de "sem permissão".
- IF a geração do OpenAPI produzir um documento sem nenhuma rota THEN o CI SHALL falhar em vez de publicar um contrato vazio.
- WHEN dois squads editarem `STATE.md` na mesma janela THEN o formato por frente SHALL permitir merge sem perda de contexto de nenhuma das frentes.
- IF um package novo entrar no monorepo sem piso de cobertura declarado THEN o CI SHALL falhar exigindo a declaração.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| TRU-01 | P1: Documentação honesta | F6 | Pending |
| TRU-02 | P1: Documentação honesta | F6 | Pending |
| TRU-03 | P1: Documentação honesta | F6 | Pending |
| TRU-04 | P1: Documentação honesta | F6 | Pending |
| CIQ-01 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-02 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-03 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-04 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-05 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-06 | P1: CI que prova o sistema | F6 | Pending |
| CIQ-07 | P1: CI que prova o sistema | F6 | Pending |
| UIX-01 | P1: Inventário do gap de produto | F6 | Pending |
| UIX-02 | P1: Inventário do gap de produto | F6 | Pending |
| UIX-03 | P1: Inventário do gap de produto | F6 | Pending |
| UIX-04 | P1: Inventário do gap de produto | F6 | Pending |
| AGT-01 | P1: Onboarding e loop agêntico | F7 | Pending |
| AGT-02 | P1: Onboarding e loop agêntico | F7 | Pending |
| AGT-03 | P1: Onboarding e loop agêntico | F7 | Pending |
| AGT-04 | P1: Onboarding e loop agêntico | F7 | Pending |
| AGT-05 | P1: Onboarding e loop agêntico | F7 | Pending |
| GOV-01 | P2: Governança para squads | F8 | Pending |
| GOV-02 | P2: Governança para squads | F8 | Pending |
| GOV-03 | P2: Governança para squads | F8 | Pending |
| GOV-04 | P2: Governança para squads | F8 | Pending |
| GOV-05 | P2: Governança para squads | F8 | Pending |
| GOV-06 | P2: Governança para squads | F8 | Pending |
| API-01 | P2: Contrato de API | F8 | Pending |
| API-02 | P2: Contrato de API | F8 | Pending |
| API-03 | P2: Contrato de API | F8 | Pending |
| MCP-01 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-02 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-03 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-04 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-05 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-06 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-07 | P1: Diagramas como contexto (MCP) | F9 | Pending |
| MCP-08 | P1: Diagramas como contexto (MCP) | F9 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 37 total, 0 mapped to tasks, 37 unmapped (nenhuma onda iniciada).

---

## Ondas de entrega

As ondas F6 a F8 tocam superfícies disjuntas e são deliberadamente paralelizáveis por squads distintos; F9 depende de F6 apenas para o inventário.

| Onda | Escopo | Requisitos | Superfície tocada | Paralelizável com |
| ---- | ------ | ---------- | ----------------- | ----------------- |
| F6 | Verdade e portões | TRU-01..04, CIQ-01..07, UIX-01..04 | `README.md`, `docs/`, `.github/workflows/`, `.specs/` | — (base das demais) |
| F7 | Loop agêntico | AGT-01..05 | `CLAUDE.md`, `.claude/` | F8 |
| F8 | Governança e contrato | GOV-01..06, API-01..03 | `CODEOWNERS`, `.github/`, `apps/server` (schemas) | F7 |
| F9 | MCP — diagramas como contexto | MCP-01..08 | `apps/mcp` (novo), `packages/diagram-ir` | F7, F8 |
| F10+ | Produto (UI) | specs geradas por UIX-02 | `apps/web` | após F6 |

---

## Success Criteria

- [ ] Reverter qualquer um dos três fixes de Docker de hoje deixa o CI vermelho antes do merge.
- [ ] Nenhuma afirmação de capacidade no README ou na landing existe sem entrada correspondente no mapa de capacidades, verificado por CI.
- [ ] Uma sessão nova roda lint, typecheck, testes e stack local usando apenas o `CLAUDE.md`, sem perguntar nada.
- [ ] Um agente no Cursor responde corretamente qual componente depende de qual, lendo diagramas via MCP, sem nenhum acesso ao banco de dados.
- [ ] Dois squads entregam em domínios distintos por uma semana sem conflito de merge em `.specs/` nem revisor ambíguo.
- [ ] A soma de rotas com consumidor e rotas pendentes no inventário iguala o total de rotas registradas, sem rota não classificada.
