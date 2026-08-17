# Administração do provider de IA — Especificação

Entrada R15 de `.specs/features/platform-maturity/ui-roadmap.md`. Tela de administração para
cadastrar endpoint e chave do provider de IA, testar a conexão e alternar qual configuração está
ativa. Depende de R1 (`ai-dock`, quem consome o provider) e R4 (`workspace-members`, que
estabeleceu a convenção de tela administrativa por papel) — ambas fechadas e verificadas.

## Problem Statement

O backend de provider de IA está implementado e verificado (`ai-provider.int.spec.ts`: autorização
por papel, proteção SSRF, token cifrado que nunca volta em resposta, "testar conexão" com limite de
taxa). Nada disso tem interface. Hoje a única forma de cadastrar um provider é escrever direto no
banco, e o dock de IA (R1) admite isso na própria mensagem de erro: "Nenhum provider de IA está
configurado. Isso é feito fora do produto hoje."

Uma lacuna real de corretude no servidor, descoberta na pesquisa desta spec, entra no escopo desta
onda: `ai_provider_configs` não tem nenhuma restrição impedindo duas linhas com `enabled = true` no
mesmo `scope`, e `resolveProviderConfig` (`apps/server/src/modules/ai-engine/resolveProvider.ts`)
lê a primeira linha habilitada sem `ORDER BY` e sem `LIMIT`. Com mais de uma habilitada no mesmo
escopo, qual provider atende um run é o que o Postgres devolver primeiro — indefinido. Como
"alternar qual está ativo" é literalmente o núcleo desta tela, essa indefinição não pode
sobreviver à onda: o servidor passa a garantir, na mesma transação da escrita, que no máximo uma
configuração fica habilitada por escopo.

## Goals

- [ ] Um administrador cadastra endpoint, modelo e chave de um provider pela interface, sem tocar
      no banco.
- [ ] Um administrador testa a conexão e vê o resultado real (sucesso, modelo disponível, suporte a
      tool calling, ou o erro devolvido pelo provider).
- [ ] Um administrador alterna qual configuração está ativa, e o resultado é determinístico: no
      máximo uma habilitada por escopo, garantido pelo servidor.
- [ ] A chave nunca volta para a tela, em nenhuma forma, e editar uma configuração não obriga a
      redigitá-la.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Excluir uma configuração de provider | Não existe rota de `DELETE` em `/admin/ai-providers/:id`; adicionar uma é decisão de servidor fora do orçamento desta fatia. Desabilitar cobre o caso de uso real ("parar de usar esta") |
| Índice único parcial no banco (`UNIQUE ... WHERE enabled`) | A exclusividade é garantida na escrita, dentro de transação (ver design.md). Um índice único transformaria "alternar" em erro de constraint em vez de troca, e exigiria migração — decidido contra, com a razão registrada |
| Escolher provider por diagrama ou por run | O modelo de resolução é por escopo (`workspaceId` sobrepõe `global`); expor escolha por run mudaria `resolveProviderConfig` e o pipeline de IA, muito além desta tela |
| Exibir, mascarar ou recuperar a chave cadastrada | `ProviderConfigPublic` não inclui o token, nem cifrado; a tela não inventa substituto nenhum (nem máscara, nem indicador `hasKey`) |
| Orçamento e limite de uso de IA por workspace | É AIC-04, registrado como `⚠️ Partial` disclosed no roadmap original — dimensão de custo, não de configuração de endpoint |
| Criar configuração de um workspace a partir da tela global | Cada escopo é administrado na sua própria rota; a tela global só administra `scope = "global"` |
| Página administrativa genérica ("área de admin") com menu próprio | Esta onda entrega uma superfície, alcançável por dois links diretos; um shell administrativo é decisão de navegação que nenhuma outra tela pede hoje |

---

## Assumptions & Open Questions

Toda ambiguidade está resolvida ou registrada aqui.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Onde a tela vive, já que o escopo global não tem workspace na URL? | Duas rotas, um único componente parametrizado pelo escopo: `/admin/ai-providers` (escopo `global`, primeira rota autenticada do app fora de `/w/:workspaceId/...`) e `/w/:workspaceId/admin/ai-providers` (escopo do workspace), irmã de `/w/:workspaceId/members` | O escopo é a fronteira de autorização do servidor (`assertProviderAdmin`), então ele pertence à URL: link direto é significativo, o 403/404 do servidor casa com a rota, e a metade de workspace fica exatamente onde `workspace-members` já ensinou o usuário a procurar. Uma tela única com seletor de escopo esconderia a fronteira de autorização dentro de um estado de componente (ver design.md, Approach exploration) | y |
| Como a tela sabe se o usuário é `org_admin` em algum lugar (gate da metade global)? | Deriva de `GET /workspaces`, que desde R3 devolve `role` por workspace: existe algum item com `role === 'org_admin'` | Reusa dado já carregado por `WorkspaceListPage`, sem nenhuma rota nova. Uma rota de capacidade dedicada seria superfície nova para responder o que a lista já responde | y |
| Cliente HTTP dedicado ou o `resourceClient` genérico de `workspace-navigation`? | Dedicado: `apps/web/src/nav/aiProviderClient.ts` | Mesmo raciocínio já registrado em `workspace-members`: o corpo de criação tem cinco campos, o `PATCH` tem semântica de omissão (token ausente = manter), e `:test` é um verbo com forma de resposta própria — nada disso encaixa em `create(name)`/`rename(name)`. Todas as chamadas usam `fetchImpl(...)` literal, para o extrator estático do `repo-tools audit` reconhecer as rotas como consumidas | y |
| Como editar sem redigitar a chave? | Campo de chave vazio no formulário de edição = `PATCH` emitido sem a propriedade `token` | Comportamento já implementado no servidor (`updateProviderConfig` só cifra e grava quando `body.token` existe); nenhuma capacidade nova de backend é necessária | y |
| Exclusividade de "ativo" — onde é garantida? | No servidor, na mesma transação da escrita (`POST` e `PATCH`): ao gravar uma linha com `enabled` verdadeiro, toda outra linha do mesmo `scope` recebe `enabled = false` | Decidido com o usuário antes do Specify. É onde a garantia é real: qualquer cliente (esta tela, `curl`, um script) fica sujeito à mesma regra, e `resolveProviderConfig` deixa de depender da ordem de retorno do Postgres | y |
| E as linhas já habilitadas antes desta onda? | Nenhuma migração de dados. A exclusividade vale a partir da primeira escrita em cada escopo; ativar qualquer configuração de um escopo com várias habilitadas converge o escopo para exatamente uma | Migração de dados exigiria escolher arbitrariamente qual sobrevive; a primeira ação do administrador na tela resolve isso com intenção explícita. Registrado em design.md's Risks & Concerns | y |
| A mensagem de erro do dock (`no_provider_configured`) ganha link para a tela? | Não — só o texto muda, nomeando a tela de administração de provider de IA. Sem link | O dock não tem sinal nenhum do papel administrativo do usuário: `GET /diagrams/:id/bootstrap` devolve `permissions`/`mutatePermissions` de diagrama, não papel de workspace. Um link que leva a maioria dos usuários a um 403 é pior que uma frase que diz onde a configuração acontece; buscar o papel só para decidir isso seria plumbing novo fora do escopo desta fatia | y |
| Qual escopo a tela oferece ao cadastrar? | Exatamente o escopo da rota: `global` na rota global, `:workspaceId` na rota do workspace. O campo de escopo não é editável | `scope` é texto livre no banco (polimórfico, sem FK — mesmo padrão de `share_links.resourceId`); deixar o usuário digitar convidaria a criar um escopo que nada resolve | y |
| Ordenação da lista de configurações | Ordem devolvida pelo servidor, sem reordenação no cliente | `listProviderConfigs` não define ordem e esta spec não adiciona uma; a lista de um escopo é curta por natureza (a rigor, uma ativa e algumas inativas) e a tela marca claramente qual está ativa | y |
| Capacidades (`capabilitiesJson`) são editáveis na tela? | Não nesta onda; o `POST` é emitido sem `capabilitiesJson`, e o servidor aplica seu padrão (`{}`) | O campo é um JSON livre sem consumidor definido na UI; expor um editor de JSON cru numa tela administrativa é superfície sem requisito. Registrado aqui em vez de silenciosamente omitido | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ver as configurações de um escopo ⭐ MVP

**User Story**: Como administrador, quero ver quais providers estão cadastrados no escopo que
administro e qual deles está ativo, para saber o que a IA está usando.

**Why P1**: É a base de tudo o mais nesta spec — sem lista, não há o que testar, editar ou alternar.

**Acceptance Criteria**:

1. WHEN o usuário acessar `/admin/ai-providers` THEN a tela SHALL emitir `GET /admin/ai-providers?scope=global` e listar cada configuração devolvida com `baseUrl`, `model` e seu estado ativo/inativo.
2. WHEN o usuário acessar `/w/:workspaceId/admin/ai-providers` THEN a tela SHALL emitir `GET /admin/ai-providers?scope=<workspaceId>` e listar cada configuração devolvida com `baseUrl`, `model` e seu estado ativo/inativo.
3. The tela SHALL nunca exibir a chave do provider em nenhuma forma — nem em claro, nem cifrada, nem mascarada, nem como indicador derivado do valor.
4. IF `GET /admin/ai-providers` responder `403` ou `404` THEN a tela SHALL tratar como "não existe ou sem acesso", mesma convenção IDOR de `workspace-navigation`, sem listar configuração nenhuma.

**Independent Test**: Acessar `/admin/ai-providers` com duas configurações cadastradas no escopo
global e confirmar que ambas aparecem com endpoint e modelo, uma marcada como ativa, e que a
resposta serializada da rota não contém nenhum campo de token.

---

### P1: Alcançar a tela a partir da navegação ⭐ MVP

**User Story**: Como administrador, quero chegar na tela pela navegação do produto, sem decorar
URL.

**Why P1**: Uma tela sem ponto de entrada é a mesma coisa que nenhuma tela — é exatamente o gap que
esta onda existe para fechar.

**Acceptance Criteria**:

1. WHILE pelo menos um workspace devolvido por `GET /workspaces` tiver `role === 'org_admin'`, `WorkspaceListPage` SHALL exibir um link para `/admin/ai-providers`.
2. IF nenhum workspace devolvido por `GET /workspaces` tiver `role === 'org_admin'` THEN `WorkspaceListPage` SHALL omitir o link para `/admin/ai-providers`.
3. The link para `/w/:workspaceId/admin/ai-providers` SHALL aparecer em `ProjectListPage` somente quando o papel do usuário nesse workspace conceder `workspace:manage_members`.

**Independent Test**: Renderizar `WorkspaceListPage` com uma lista onde nenhum item tem
`role === 'org_admin'` e confirmar que o link global não existe; repetir com um item `org_admin` e
confirmar que existe.

---

### P1: Cadastrar um provider ⭐ MVP

**User Story**: Como administrador, quero cadastrar endpoint, modelo e chave de um provider pela
interface, para não precisar de acesso ao banco.

**Why P1**: É a razão de existir da tela.

**Acceptance Criteria**:

1. The formulário de cadastro SHALL exigir `baseUrl`, `model` e chave não vazios antes de permitir o envio.
2. WHEN o usuário enviar o formulário de cadastro THEN a tela SHALL emitir `POST /admin/ai-providers` com `{scope, baseUrl, model, token}`, onde `scope` vem da rota e nunca de um campo digitado.
3. WHEN `POST /admin/ai-providers` responder `201` THEN a tela SHALL adicionar a configuração à lista sem recarregar a página e limpar o campo de chave.
4. The campo de chave SHALL ser um campo de senha (`type="password"`) com `autoComplete="off"`.
5. IF `POST /admin/ai-providers` responder `400` THEN a tela SHALL informar que a URL do provider foi rejeitada e manter os valores digitados no formulário.

**Independent Test**: Cadastrar um provider com uma `baseUrl` que o servidor rejeita por SSRF
(`http://169.254.169.254/v1`), confirmar a mensagem de rejeição e que os campos continuam
preenchidos.

---

### P1: Editar sem redigitar a chave ⭐ MVP

**User Story**: Como administrador, quero corrigir o endpoint ou o modelo de uma configuração sem
ter que redigitar a chave, que eu não tenho mais em mãos.

**Why P1**: A chave nunca volta do servidor. Sem essa semântica, toda edição trivial obrigaria uma
rotação de segredo.

**Acceptance Criteria**:

1. WHEN o usuário salvar a edição com o campo de chave vazio THEN a tela SHALL emitir `PATCH /admin/ai-providers/:id` sem a propriedade `token` no corpo.
2. WHEN o usuário salvar a edição com o campo de chave preenchido THEN a tela SHALL emitir `PATCH /admin/ai-providers/:id` incluindo `token` com o valor digitado.
3. The formulário de edição SHALL exibir texto informando que deixar a chave em branco mantém a chave atual.
4. IF `PATCH /admin/ai-providers/:id` responder um status diferente de `200` THEN a tela SHALL informar a falha e manter na lista os valores anteriores da configuração.

**Independent Test**: Editar só o modelo de uma configuração, com o campo de chave vazio, e
confirmar que o corpo do `PATCH` emitido não tem a propriedade `token`.

---

### P1: Testar a conexão ⭐ MVP

**User Story**: Como administrador, quero testar a conexão antes de confiar numa configuração, para
descobrir uma chave errada na tela e não num run de IA falhando.

**Why P1**: É metade do valor da tela — cadastrar sem verificar só move o problema.

**Acceptance Criteria**:

1. WHEN o usuário acionar "Testar conexão" numa configuração THEN a tela SHALL emitir `POST /admin/ai-providers/:id:test`.
2. IF a resposta for `200` com `success: true` THEN a tela SHALL exibir o resultado como sucesso, citando `modelAvailable` e `toolCallingSupported`.
3. IF a resposta for `200` com `success: false` THEN a tela SHALL exibir o resultado como falha, incluindo o texto do campo `error`, e nunca como sucesso.
4. IF a resposta for `429` THEN a tela SHALL informar que o limite de testes de conexão (10 por 60 segundos) foi atingido.

**Independent Test**: Testar uma configuração cujo provider responde erro de autenticação e
confirmar que a tela mostra falha, apesar do HTTP `200` — este é o caso que um teste de status HTTP
sozinho passaria errado.

---

### P1: Alternar qual configuração está ativa ⭐ MVP

**User Story**: Como administrador, quero ativar uma configuração e ter certeza de que ela, e só
ela, é a que a IA vai usar naquele escopo.

**Why P1**: É o núcleo declarado da entrada R15 e o ponto onde o backend hoje é indeterminado.

**Acceptance Criteria**:

1. WHEN o usuário ativar uma configuração THEN a tela SHALL emitir `PATCH /admin/ai-providers/:id` com `{enabled: true}`.
2. WHEN esse `PATCH` responder `200` THEN a tela SHALL marcar essa configuração como ativa e toda outra configuração do mesmo escopo como inativa, sem recarregar a página.
3. WHEN uma escrita em `PATCH /admin/ai-providers/:id` deixar a configuração com `enabled = true` THEN o servidor SHALL, na mesma transação, definir `enabled = false` em toda outra linha de `ai_provider_configs` com o mesmo `scope`.
4. WHEN `POST /admin/ai-providers` criar uma configuração com `enabled = true` (explícito ou pelo padrão da coluna) THEN o servidor SHALL, na mesma transação, definir `enabled = false` em toda outra linha de `ai_provider_configs` com o mesmo `scope`.
5. The servidor SHALL nunca alterar o `enabled` de uma linha cujo `scope` seja diferente do `scope` da configuração escrita.
6. WHEN o usuário desativar a configuração ativa THEN a tela SHALL emitir `PATCH /admin/ai-providers/:id` com `{enabled: false}` e o escopo SHALL ficar sem nenhuma configuração ativa.

**Independent Test**: Com duas configurações habilitadas no mesmo escopo (estado hoje possível),
ativar a segunda pela rota `PATCH` e confirmar, lendo a tabela direto, que a primeira ficou
`enabled = false` e que uma configuração de outro escopo continua intocada.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero administrar o provider sem
mouse.

**Why P2**: Mesmo padrão já estabelecido por todas as fatias anteriores desta frente.

**Acceptance Criteria**:

1. The toda ação desta spec (cadastrar, editar, testar, ativar, desativar) SHALL ser alcançável só por teclado.
2. WHEN uma ação de cadastro, edição, teste ou alternância completar (sucesso ou falha) THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível da tela SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Cadastrar, testar e ativar uma configuração usando só Tab/Shift+Tab/Enter,
com o locale trocado para `en` no meio do caminho.

---

### P2: O dock de IA aponta para a tela

**User Story**: Como usuário que recebeu "nenhum provider configurado" no dock, quero saber onde
isso se resolve, agora que existe uma tela para isso.

**Why P2**: Não é MVP da tela em si, mas é o que liga as duas ondas — a mensagem atual afirma algo
que deixa de ser verdade nesta onda.

**Acceptance Criteria**:

1. WHEN o dock de IA exibir o erro `no_provider_configured` THEN a mensagem SHALL nomear a tela de administração de provider de IA como o lugar onde a configuração é feita, em vez de afirmar que isso acontece fora do produto.

**Independent Test**: Renderizar o dock em estado de erro `no_provider_configured` nos dois locales
e confirmar que nenhuma das duas mensagens diz que a configuração é feita fora do produto.

---

## Edge Cases

- IF o escopo não tiver nenhuma configuração THEN a tela SHALL exibir um estado vazio explícito junto do formulário de cadastro, não uma lista vazia silenciosa.
- IF um escopo já tiver duas ou mais configurações com `enabled = true` (dado escrito antes desta onda) THEN ativar qualquer uma delas SHALL deixar exatamente uma habilitada nesse escopo.
- WHILE um teste de conexão estiver em andamento para uma configuração, um segundo acionamento do mesmo botão SHALL não emitir uma segunda requisição.
- IF `POST /admin/ai-providers/:id:test` falhar por erro de rede (sem resposta HTTP) THEN a tela SHALL informar falha genérica sem quebrar a tela nem travar o botão em estado de carregamento.
- IF o usuário perder o papel administrativo enquanto a tela está aberta THEN uma ação subsequente que falhe com `403` SHALL ser tratada como qualquer outra falha, sem quebrar a tela.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| PROV-01 | P1: Ver configurações | F10 | Implementing |
| PROV-02 | P1: Ver configurações | F10 | Implementing |
| PROV-03 | P1: Ver configurações | F10 | Pending |
| PROV-04 | P1: Ver configurações | F10 | Pending |
| PROV-05 | P1: Alcançar a tela | F10 | Pending |
| PROV-06 | P1: Alcançar a tela | F10 | Pending |
| PROV-07 | P1: Alcançar a tela | F10 | Pending |
| PROV-08 | P1: Cadastrar | F10 | Pending |
| PROV-09 | P1: Cadastrar | F10 | Pending |
| PROV-10 | P1: Cadastrar | F10 | Pending |
| PROV-11 | P1: Cadastrar | F10 | Pending |
| PROV-12 | P1: Cadastrar | F10 | Pending |
| PROV-13 | P1: Editar sem redigitar a chave | F10 | Pending |
| PROV-14 | P1: Editar sem redigitar a chave | F10 | Pending |
| PROV-15 | P1: Editar sem redigitar a chave | F10 | Pending |
| PROV-16 | P1: Editar sem redigitar a chave | F10 | Pending |
| PROV-17 | P1: Testar a conexão | F10 | Pending |
| PROV-18 | P1: Testar a conexão | F10 | Pending |
| PROV-19 | P1: Testar a conexão | F10 | Pending |
| PROV-20 | P1: Testar a conexão | F10 | Pending |
| PROV-21 | P1: Alternar qual está ativa | F10 | Pending |
| PROV-22 | P1: Alternar qual está ativa | F10 | Pending |
| PROV-23 | P1: Alternar qual está ativa | F10 | Implementing |
| PROV-24 | P1: Alternar qual está ativa | F10 | Implementing |
| PROV-25 | P1: Alternar qual está ativa | F10 | Implementing |
| PROV-26 | P1: Alternar qual está ativa | F10 | Pending |
| PROV-27 | P2: Teclado e idiomas | F10 | Pending |
| PROV-28 | P2: Teclado e idiomas | F10 | Pending |
| PROV-29 | P2: Teclado e idiomas | F10 | Pending |
| PROV-30 | P2: Dock aponta para a tela | F10 | Pending |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `PROV` não colide com nenhum já usado nas specs deste repo: AAC, AGT, AIC, AIE, AIG, API,
AUTH, CIQ, CLB, CLIB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV, OBS,
OIDC, OPS, PERF, PRS, REC, SEC, SNAP, SSO, TRU, UIX, VER, XPRT.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 30 requisitos, mapeados 1:1 às 30 acceptance criteria das oito histórias.

**Numeração por história:** PROV-01..04 (ver), PROV-05..07 (alcançar), PROV-08..12 (cadastrar),
PROV-13..16 (editar), PROV-17..20 (testar), PROV-21..26 (alternar ativo), PROV-27..29 (teclado e
idiomas), PROV-30 (mensagem do dock).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| ---- | --- | ------------------ |
| `GET /admin/ai-providers?scope=` | lista de configurações do escopo | Nenhuma |
| `POST /admin/ai-providers` | cadastrar configuração | **Comportamento**: exclusividade de `enabled` por escopo, na mesma transação (PROV-24) |
| `PATCH /admin/ai-providers/:id` | editar, ativar, desativar | **Comportamento**: exclusividade de `enabled` por escopo, na mesma transação (PROV-23) |
| `POST /admin/ai-providers/:id:test` | testar conexão | Nenhuma |
| `GET /workspaces` | derivar se o usuário é `org_admin` em algum workspace | Nenhuma — já devolve `role` desde R3 |

Nenhuma rota nova. As duas mudanças são de comportamento dentro de rotas existentes, ambas
aditivas em espírito: nenhum contrato de requisição ou resposta muda, só a garantia sobre o estado
persistido.

---

## Success Criteria

- [ ] Um administrador cadastra, testa e ativa um provider pela interface, sem tocar no banco.
- [ ] Depois de qualquer escrita bem-sucedida, um escopo tem no máximo uma configuração
      `enabled = true` — provado por teste de integração que falha se a exclusividade for removida.
- [ ] Nenhuma resposta consumida pela tela contém o token, e a tela não exibe substituto derivado
      dele.
- [ ] Uma falha de conexão devolvida com HTTP `200` aparece como falha na tela, nunca como sucesso.
- [ ] `repo-tools audit` deixa de classificar as 4 rotas de `/admin/ai-providers` como
      `pending-product`.
- [ ] O fluxo inteiro é percorrível só com teclado, nos dois locales.
