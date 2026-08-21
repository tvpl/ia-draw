# Lint arquitetural — Especificação

Décima quarta fatia vertical do roadmap de produto (entrada R14 de
`.specs/features/platform-maturity/ui-roadmap.md`). Entrega, dentro do editor, a única superfície
que hoje falta para o motor de lint já implementado e verificado no servidor: um painel de avisos,
sempre consultivo, com salto direto para o elemento apontado.

## Problem Statement

O motor de lint (`apps/server/src/modules/lint/engine.ts`) está implementado e verificado — F3
registra `LNT-01` (avisos estruturais: componente órfão, conector sem protocolo/direção clara,
SPOF heurístico, segredo em label, trust boundary ausente, ambientes misturados), `LNT-02`
(checagem suave de nível C4) e `LNT-03` (override por regra via `workspaces.settingsJson.lintRules`)
como `✅ Verified` em `architecture-canvas/spec.md`. A rota `GET /diagrams/:id/lint` está registrada
em `docs/route-inventory.md`, exige apenas `diagram:read` (nunca bloqueia por papel de leitura) e
sempre devolve HTTP 200 com `{ warnings: LintWarning[] }` — nunca um erro pelo diagrama ter
problemas, porque lint é aviso, não validação bloqueante.

Nada disso tem interface. `apps/web` não tem nenhum componente que chame essa rota — a capacidade
está marcada como pronta no backend e invisível no produto, na mesma situação em que `ai-dock` e
`component-library` estavam antes de suas próprias fatias de frontend.

## Goals

- [ ] Uma pessoa com acesso de leitura ao diagrama vê a lista de avisos de lint do estado atual do
      diagrama, sem sair do editor.
- [ ] Um aviso nunca impede nem restringe qualquer ação de desenho ou edição do canvas — o painel é
      puramente consultivo, exatamente como o motor server-side já garante.
- [ ] A partir de um aviso, a pessoa salta diretamente para o elemento apontado no canvas — ele fica
      selecionado e visível no viewport, sem precisar procurá-lo manualmente na cena.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Tela de configuração de regras por workspace (ligar/desligar cada `LintRuleName`) | `LNT-03` já expõe o override via `workspaces.settingsJson.lintRules`, mas nenhuma rota de escrita desse campo existe hoje (é editado fora do produto); o roadmap (R14) descreve só "painel de avisos... com salto para o elemento", não uma tela de administração de regras |
| Qualquer mudança em `engine.ts`, `routes.ts` ou nas 8 regras já verificadas do motor de lint | O backend está verificado (F3 Verifier); esta fatia é frontend sobre o contrato existente — `{ warnings: LintWarning[] }` |
| Atualização automática/em tempo real do painel quando outro colaborador edita o diagrama | O mesmo limite já documentado e aceito em `diagram-comments/spec.md` para `CommentsSidebar`: REST-only, sem WebSocket dedicado a esta fatia — reavalia só sob ação explícita (montagem do painel ou clique em "Atualizar") |
| Corrigir o problema apontado automaticamente (ex.: um botão que preenche `protocol` ausente) | O aviso só aponta o elemento; a correção usa as ferramentas normais do editor (canvas, painel de metadados de R5) — nenhuma rota de escrita nova nesta fatia |
| Traduzir/reformular a mensagem (`message`) que o servidor já monta em português com contagem | Ver Assumptions — a mensagem já vem pronta e correta do servidor; recompor client-side duplicaria a lógica de pluralização/contagem que `engine.ts` já centraliza |
| Ranquear/priorizar avisos por severidade | Todo `LintWarning.severity` é sempre `'warning'` — não existe hierarquia de severidade no motor hoje para ordenar por |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde o painel de lint vive | Uma terceira aba ("Lint") dentro de `EditorSidePanel`, ao lado de "IA" e "Comentários" | `EditorSidePanel` já é o container de abas do editor (R9); um quarto/quinto painel solto em `<details>` (como Biblioteca/Metadados) competiria por espaço sem necessidade — lint, como comentários, precisa ficar acessível a qualquer papel com `diagram:read`, o mesmo critério que já rege a aba "Comentários" | y |
| A aba "Lint" aparece para todo papel com acesso ao diagrama, ou só para quem pode mutar? | Para todo mundo — a rota exige só `diagram:read` (`routes.ts:66`, `can(..., 'diagram:read', ...)`), igual à aba "Comentários"; a aba "IA" é a única condicionada a `diagram:mutate` | O backend nunca checa `diagram:mutate` para este GET; esconder o painel de um `viewer`/`reviewer` recusaria acesso a algo que o servidor já concede | y |
| Quando o painel busca os avisos | Ao montar o painel (uma vez) e sob clique explícito em "Atualizar" — nunca em polling nem reagindo a cada `onDeltas` do canvas | Mesma convenção já aceita para `CommentsSidebar` (REST-only, `comments.refresh`); refazer o fetch a cada delta do canvas geraria uma chamada por tecla digitada, sem WebSocket dedicado a esta fatia para justificar o custo | y |
| Texto exibido para `message` de cada aviso | Renderizado verbatim, como veio do servidor (já uma frase em português com contagem, ex. "3 componente(s) sem nenhum edge conectado.") — não recomposto a partir de `rule` + chaves i18n | `engine.ts` já centraliza contagem/pluralização; duplicar essa lógica no cliente arrisca as duas fontes divergirem. É o mesmo tratamento que `CommentsSidebar` já dá ao `body` do comentário e `MetadataPanel` ao `metadataJson` salvo — conteúdo dinâmico do servidor não passa por i18n, só o texto de interface (título do painel, botão Atualizar, rótulo "Ir para elemento") passa | y |
| "Salto para o elemento" quando o `elementId` do aviso não existe mais na cena carregada | O controle de salto não é oferecido para aquele id — nenhum crash, nenhum estado de erro, o restante do aviso continua visível | Mesmo padrão que `CMT2-09/10` já resolve para âncora de comentário removida (`liveElementIds`); um `LintWarning.elementIds` pode citar um elemento apagado entre a última operação do lint no servidor e a leitura da cena local — a rota lê a cena mais recente do servidor, mas o cliente só sabe comparar contra o que `EditorSurface` já carregou nesta sessão | y |
| Um aviso com vários `elementIds` (ex. `orphan-component` com 3 ids) | Cada `elementId` ganha seu próprio controle de salto, listado individualmente — não um botão agregado "ir para o primeiro" | Um botão agregado esconderia informação (qual dos 3 é qual) sem ganhar nada em simplicidade — a lista já é pequena (nenhuma regra do motor produz uma contagem sem limite superior razoável para uma tela) | y |
| Como "salto para o elemento" se manifesta no canvas | Seleciona o elemento (`updateScene({appState:{selectedElementIds}}`) e centraliza/aproxima o viewport nele (`scrollToContent`), reaproveitando o mesmo handle imperativo `EditorSurfaceHandle` que AD-010 já estabelece — nenhum caminho novo até o canvas | Excalidraw não tem "foco" de elemento nativo fora de seleção+scroll; é a mesma dupla ação que a própria UI do Excalidraw já produz ao clicar num elemento na lista de camadas. Reusar o handle único (AD-010/EDT-07) evita um segundo caminho de mutação do estado do canvas | y |
| O painel some quando o diagrama não tem avisos | Não. Mostra um estado de sucesso explícito ("nenhum aviso") — o painel continua montado e a aba continua alcançável | Consistente com o padrão de estado vazio de `MetadataPanel`/`CommentsSidebar`: ausência de dado é um estado da tela, não a tela desaparecendo |
| Toggle de regras (`LNT-03`) tem alguma superfície nesta fatia? | Não — nenhuma tela cadastra/edita `workspaces.settingsJson.lintRules` (ver Out of Scope) | O roadmap (R14) não descreve essa tela; a rota de escrita desse campo simplesmente não existe hoje | y |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Ver os avisos de lint do diagrama aberto ⭐ MVP

**User Story**: Como pessoa com acesso ao diagrama, quero ver os avisos arquiteturais e de nível C4
do estado atual, sem sair do editor, para revisar a qualidade do desenho sem montar a chamada de
API na mão.

**Why P1**: É o valor central da fatia — sem a lista visível, o motor de lint verificado no
servidor continua tão inalcançável quanto estava antes desta onda.

**Acceptance Criteria**:

1. WHEN a aba "Lint" for aberta pela primeira vez THEN o sistema SHALL chamar `GET /diagrams/:id/lint` e exibir um estado de carregamento até a resposta chegar.
2. WHEN a resposta 200 trouxer `warnings` com ao menos 1 item THEN o sistema SHALL listar cada aviso com seu `rule` e seu `message` exatamente como veio do servidor.
3. IF `warnings` vier vazio THEN o sistema SHALL exibir um estado de sucesso explícito ("nenhum aviso"), nunca uma lista vazia ambígua nem um erro.
4. IF a chamada devolver um status diferente de 200, ou falhar por rede THEN o sistema SHALL exibir uma mensagem de erro com uma ação de tentar novamente, sem quebrar o resto do editor.
5. WHEN a pessoa clicar em "Atualizar" THEN o sistema SHALL refazer `GET /diagrams/:id/lint` e substituir a lista exibida pelo resultado mais recente.
6. The sistema SHALL exibir a aba "Lint" para qualquer papel que tenha acesso de leitura ao diagrama, independente de `diagram:mutate` — a mesma condição que já rege a aba "Comentários".
7. WHILE o diagrama tiver um ou mais avisos ativos THE sistema SHALL manter toda ferramenta de desenho e edição do canvas exatamente como estaria sem nenhum aviso — nenhum aviso desabilita, bloqueia ou confirma antes de qualquer ação de canvas.

**Independent Test**: Abrir um diagrama com um componente órfão e um conector sem protocolo, abrir a
aba "Lint", confirmar que os dois avisos aparecem com a mensagem do servidor, e confirmar que
desenhar/editar o canvas continua funcionando normalmente com os avisos visíveis.

---

### P1: Saltar do aviso para o elemento no canvas

**User Story**: Como pessoa revisando os avisos, quero clicar num elemento citado por um aviso e ser
levado até ele no canvas, para não precisar procurar manualmente entre dezenas de elementos.

**Why P1**: Sem o salto, o painel lista ids opacos (`elementId`) que não significam nada visualmente
— é a metade do valor descrita no próprio roadmap ("com salto para o elemento apontado").

**Acceptance Criteria**:

1. WHEN um aviso listar um ou mais `elementIds` THEN o sistema SHALL exibir um controle de "ir para o elemento" por `elementId`, individualmente.
2. WHEN a pessoa clicar num controle de "ir para o elemento" cujo id existe na cena carregada pelo editor THEN o sistema SHALL selecionar aquele elemento no canvas e centralizar o viewport nele, através do handle imperativo `EditorSurfaceHandle` (AD-010) — nunca por um caminho de estado paralelo.
3. IF o `elementId` de um aviso não existir mais na cena que o editor já carregou nesta sessão THEN o sistema SHALL não oferecer um controle de salto clicável para aquele id, sem lançar erro nem quebrar a exibição do restante do aviso.
4. WHEN um salto for concluído THEN o sistema SHALL anunciar o resultado numa região `aria-live="polite"`, para quem usa leitor de tela confirmar que o canvas mudou de foco sem precisar olhar.
5. The sistema SHALL nunca aplicar nenhuma mutação de cena (criação, remoção ou alteração de elemento) como efeito de um clique em "ir para o elemento" — o salto é puramente de navegação/seleção.

**Independent Test**: Com um aviso `orphan-component` citando 2 elementos vivos e 1 elemento já
apagado da cena, abrir o painel, confirmar 2 controles de salto clicáveis e 1 marcado como
indisponível; clicar num dos 2 clicáveis e confirmar que o elemento correspondente fica selecionado
no canvas.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero ver os avisos e saltar para
um elemento sem mouse, para ter o mesmo acesso que qualquer outro painel do editor já oferece.

**Why P2**: Mesmo padrão já estabelecido por `ai-dock`, `component-library` e `diagram-comments`
nesta frente — não é o valor central, mas regredir nisso contradiz o que o resto do editor já
garante.

**Acceptance Criteria**:

1. The painel de lint inteiro (abrir a aba, ler os avisos, acionar "Atualizar", acionar "ir para o elemento") SHALL ser alcançável só por teclado.
2. The todo texto de interface do painel (título, estado de carregamento, estado de sucesso, estado de erro, botão "Atualizar", rótulo "Ir para elemento", indicação de elemento indisponível) SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente — a única exceção documentada é o campo dinâmico `message` (ver Assumptions).

**Independent Test**: Abrir a aba "Lint" e completar um salto para um elemento usando só
Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF a rota devolver `warnings` com um `elementId` que aparece em mais de um aviso diferente THEN o sistema SHALL exibir um controle de salto em cada aviso onde o id aparece, sem deduplicar entre avisos — cada aviso é uma linha independente da lista.
- WHEN a pessoa navegar para outro diagrama (troca de rota) enquanto o painel de lint está montado THEN o sistema SHALL refazer a busca para o novo `diagramId`, nunca reaproveitar a lista do diagrama anterior.
- IF `GET /diagrams/:id/lint` devolver 404 (diagrama fora do workspace da pessoa, mesma convenção anti-IDOR do resto do backend) THEN o sistema SHALL tratar como o mesmo estado de erro genérico do AC P1-4, sem revelar se o diagrama existe.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| ALNT-01 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-02 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-03 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-04 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-05 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-06 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-07 | P1: Ver os avisos | Tasks | ✅ Verified |
| ALNT-08 | P1: Saltar para o elemento | Tasks | ✅ Verified |
| ALNT-09 | P1: Saltar para o elemento | Tasks | ✅ Verified |
| ALNT-10 | P1: Saltar para o elemento | Tasks | ✅ Verified |
| ALNT-11 | P1: Saltar para o elemento | Tasks | ✅ Verified |
| ALNT-12 | P1: Saltar para o elemento | Tasks | ✅ Verified |
| ALNT-13 | P2: Teclado e idioma | Tasks | ✅ Verified |
| ALNT-14 | P2: Teclado e idioma | Tasks | ✅ Verified |

**ID format:** `ALNT-NN` (Architecture LiNT panel — fatia de frontend distinta de `LNT-NN`, que já
nomeia os requisitos de backend em `architecture-canvas/spec.md`, mesma convenção que `CLIB` vs
`LIB`, `XPRT` vs `EXP` e `SNAP` vs `VER` já usam neste repositório).

O prefixo `ALNT` não colide com nenhum já usado no repositório: AAC, AD, AES, AGT, AIC, AIE, AIG,
API, AUTH, CIQ, CLB, CLIB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LIVE, LNT, MCP, MEM,
NAV, OBS, OIDC, OPS, PERF, PROV, PRS, REC, SEC, SHR, SNAP, SSO, TRU, UIX, VER, WHK, XPRT.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 14 requisitos, mapeados 1:1 às 14 acceptance criteria das três histórias. Nenhum
mapeado a task ainda — o breakdown é a rodada de Tasks desta feature.

**Numeração por história:** ALNT-01..07 (ver avisos), ALNT-08..12 (saltar para o elemento),
ALNT-13..14 (teclado e idioma).

---

## Rotas consumidas

Já registrada e verificada. Esta spec não altera nenhuma rota, schema ou regra do motor de lint.

| Rota | Uso | Origem |
| ---- | --- | ------ |
| `GET /diagrams/:id/lint` | devolve `{ warnings: LintWarning[] }` do estado atual do diagrama (`LintWarning = { rule, severity: 'warning', message, elementIds }`) | `apps/server/src/modules/lint/routes.ts` |
