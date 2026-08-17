# Documentação viva — Especificação

Entrada R13 de `.specs/features/platform-maturity/ui-roadmap.md`. Entrega a superfície de produto
sobre a geração de spec em Markdown a partir do canvas: gerar um documento, ver as versões já
geradas, ler o conteúdo seção a seção (cada seção mostrando os elementos do diagrama que a
originaram) e regenerar uma única seção sem tocar nas outras.

## Problem Statement

O backend de docgen está implementado e verificado desde a onda F3
(`apps/server/src/modules/docgen/*.ts`, requisitos `DOC-01..04` de
`architecture-canvas/spec.md`, `docgen.int.spec.ts`, `regenerateSection.int.spec.ts`,
`sections.spec.ts`). As três rotas continuam `pending-product` em `docs/route-inventory.md`:
nenhuma tela do produto as chama. `POST /diagrams/:id/specs:generate` monta um Markdown
estruturado (`# título` + `## Visão Geral` / `## Componentes` / `## Fluxos` / `## Decisões`) a
partir da cena atual e dos metadados semânticos que R5 (`component-library`) deixa preencher por
elemento, e grava uma nova versão imutável em `spec_documents`. `GET /diagrams/:id/specs` lista as
versões (mais recente primeiro, paginação por cursor de `version`). `POST
/diagrams/:id/specs/:version:regenerate-section` recomputa exatamente uma seção contra o estado
atual da cena e grava uma versão nova cujo Markdown é byte-idêntico ao `baseVersion` exceto na
seção pedida.

Uma lacuna real, descoberta na pesquisa desta spec, molda o desenho: **nenhuma das três rotas
devolve o conteúdo Markdown gerado** — só a linha de `spec_documents` (`id`, `version`, `status`,
`sourceRevision`, `markdownKey`, `createdAt`), sendo `markdownKey` a chave de objeto no bucket de
armazenamento, nunca o texto em si. "Ver as versões geradas" e "cada seção linkada de volta ao
elemento" exigem o conteúdo dentro do app, não só metadados — esta spec inclui a pequena adição de
servidor documentada abaixo (Rotas consumidas) para fechar essa lacuna.

## Goals

- [ ] Uma pessoa com `diagram:read` abre o painel de documentação viva, vê a lista de versões já
      geradas (mais recente primeiro) e lê o conteúdo de qualquer uma delas, seção a seção.
- [ ] Uma pessoa com `diagram:mutate` gera uma versão nova a qualquer momento, a partir do estado
      atual do canvas.
- [ ] Uma pessoa com `diagram:mutate`, vendo a versão atual, regenera uma única seção sem afetar
      as outras três.
- [ ] Cada seção mostra, de forma legível, quais elementos do diagrama a originaram — e sinaliza
      quando um desses elementos não existe mais na cena carregada.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Selecionar/destacar no canvas o elemento referenciado por uma seção | Exigiria API imperativa nova no `EditorSurface` (`packages/editor-adapter`) — mesma decisão que `diagram-comments` já tomou para "selecionar elemento ao clicar num comentário ancorado" (spec.md daquela fatia, Out of Scope). O elemento referenciado é exibido como texto, não como controle clicável |
| Editar o Markdown gerado manualmente | Não existe rota `PATCH`/`PUT` sobre `spec_documents` — o único jeito de mudar o conteúdo é regenerar (seção ou documento inteiro) a partir da cena/metadados, nunca editar prosa solta |
| Apagar uma versão gerada | Não existe rota de delete; toda versão é permanente, mesmo `superseded` (mesma disciplina de `diagram_snapshots`) |
| Diff entre duas versões do documento | `history-snapshots` (R6) já tem `DiffView` para cena; um diff de Markdown é uma capacidade nova, fora do orçamento desta fatia (backend também não expõe rota de diff de specs) |
| Exportar o Markdown gerado (download `.md`) | `export-import` (R7) já cobre exportação de artefatos do diagrama; esta fatia é sobre visualizar e regenerar dentro do editor, não sobre um fluxo de download dedicado |
| Regenerar uma seção a partir de uma versão `superseded` | Ver Assumptions — só a versão `current` oferece os controles de regenerar |
| Traduzir o corpo do documento gerado | O backend escreve o corpo sempre em pt-BR, sem mecanismo de localização (`sections.ts`: `NOT_SPECIFIED`/`OPEN_QUESTION`/títulos de seção são literais fixos). Fora do orçamento desta fatia mudar esse contrato de backend |
| Notificação/tempo real quando outra pessoa gera uma versão nova | Esta fatia é REST puro, mesma limitação aceita e documentada em `diagram-comments` e `history-snapshots`; atualização é por recarregar/reabrir o painel |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde vive o painel no editor? | `<details>` colapsável ao lado de Biblioteca/Metadados/Compartilhamento (`apps/web/src/diagram/DiagramEditorPage.tsx`), não uma aba nova de `EditorSidePanel` | `EditorSidePanel` já hospeda IA e Comentários — as duas capacidades de uso constante durante uma sessão de edição. Documentação viva é consultada esporadicamente, igual a Biblioteca/Metadados/Compartilhamento, que já usam `<details>`. Adicionar uma terceira aba brigaria por espaço com as duas capacidades centrais sem necessidade | y |
| Quem pode gerar uma versão nova ou regenerar uma seção? | `diagram:mutate` (mesmo booleano `canMutate` que `HistoryPanel`/`ShareLinkPanel` já recebem) — os controles ficam ausentes, não desabilitados, sem essa permissão | Espelha exatamente o gate do servidor (`routes.ts`: `can({role}, 'diagram:mutate', ...)` tanto em `:generate` quanto em `:regenerate-section`) e o padrão já estabelecido por `HistoryPanel` (criar/restaurar escondidos sem `canMutate`) | y |
| Quem pode ver a lista e o conteúdo das versões já geradas? | Qualquer pessoa que chegue à página do editor (`diagram:read` já implícito em alcançar a rota, mesmo raciocínio documentado em `ExportMenu`/`export-import`) | O servidor gate de `GET /diagrams/:id/specs` é `diagram:read`, concedido a todos os 5 papéis que acessam um diagrama. Esconder a leitura seria mais restritivo que o próprio backend | y |
| As três rotas nunca devolvem o Markdown gerado — como o painel obtém o conteúdo para exibir e para achar as referências de elemento por seção? | Pequena adição de servidor: as três respostas (`spec` de `:generate`, cada item de `GET .../specs`, `spec` de `:regenerate-section`) ganham um campo aditivo `markdownUrl` — URL assinada de leitura (`storage.getSignedUrl(EXPORT_BUCKET, spec.markdownKey, 3600)`), mesmo TTL e exatamente o mesmo padrão que `POST /diagrams/:id/exports` já usa para os 4 formatos de export. O painel busca o conteúdo com `fetch(markdownUrl)` direto (sem passar pelo servidor do produto de novo) só quando uma versão é selecionada para leitura, nunca para todas as linhas da lista de uma vez | y — mudança de servidor pequena e aditiva (nenhum schema de request muda, nenhuma rota nova), documentada em "Rotas consumidas" |
| `ExportMenu` (XPRT-01) estabeleceu a convenção "nunca buscar o conteúdo de uma URL assinada no cliente, só oferecer como link de download" — por que esta fatia diverge? | Divergência deliberada, documentada aqui: exportação é um artefato terminal e binário (svg/png/pdf/excalidraw), pensado para ser baixado, não lido dentro do app. Documentação viva é texto, pensado para ser lido e navegado seção a seção dentro do editor — "linkar cada seção ao elemento que a originou" exige o conteúdo dentro do estado do app para ser parseado, o que um link `<a href>` não permite | y |
| Como o painel encontra, dentro do Markdown já montado, os elementos que originaram cada seção? | Módulo puro `parseSpecMarkdown.ts` no cliente: divide o texto pelos 4 cabeçalhos fixos que `assembleMarkdown`/`sectionHeading` sempre emitem (`## Visão Geral`, `## Componentes`, `## Fluxos`, `## Decisões`) e, dentro de Componentes/Fluxos/Decisões, extrai todo token entre crases (`` `elementId` ``) — o mesmo formato que `buildComponentsSection`/`buildFlowsSection`/`buildDecisionsSection` já usam para embutir `elementId`. `Visão Geral` nunca tem crases (só contagens), então nunca lista elementos referenciados | y |
| Um `elementId` referenciado por uma seção não existe mais na cena carregada — esconder? | Nunca esconder; exibido junto com um marcador de "elemento removido", mesma decisão que `diagram-comments` já tomou para âncora órfã (CMT2-10) | O documento gerado registra o estado do diagrama no momento da geração; um elemento apagado depois não invalida o registro histórico, só precisa ser sinalizado | y |
| Qual conjunto de ids conta como "cena atual" para essa checagem? | Os ids de `initialElements` que `DiagramEditorPage` já carrega no bootstrap desta sessão — o mesmo `liveElementIds` que `CommentsSidebar` já recebe, repassado também para este painel | É o único conjunto que a página já tem em mão sem plumbing novo com `EditorSurface`, exatamente a mesma decisão e a mesma limitação aceita (só atualiza no próximo carregamento) que `diagram-comments` documentou | y |
| Regenerar uma seção: a partir de qual versão? | Só a versão `current` (a mais recente) oferece o controle "Regenerar esta seção" por seção; ao visualizar uma versão `superseded`, o conteúdo é mostrado normalmente mas sem nenhum controle de regenerar | O servidor aceita tecnicamente qualquer `baseVersion` existente, mas regenerar a partir de uma versão antiga recuperaria as outras três seções daquele ponto no tempo, descartando qualquer atualização já capturada por gerações mais recentes — uma ressurreição de conteúdo obsoleto que o produto não pede em lugar nenhum do roadmap. Restringir ao `current` evita essa ambiguidade sem tirar nenhuma capacidade do backend (o histórico continua legível) | y |
| O que o painel faz assim que uma seção termina de regenerar (`201`)? | A nova versão é inserida no topo da lista local (a partir da própria resposta `201`, sem `GET` extra — mesma convenção de `HistoryPanel`/`CommentsSidebar`), a versão anterior marcada `current` na lista vira `superseded` só localmente (o servidor já fez isso), e o painel passa a exibir automaticamente essa versão nova | Mantém o painel consistente com o que o servidor acabou de fazer sem round-trip adicional, mesmo padrão que toda mutação já implementada nesta base segue |
| Paginação da lista (`GET` aceita `cursor`/`limit`) | Busca a primeira página com o `limit` default do servidor (20); se a resposta trouxer `nextCursor` não-nulo, um controle "Carregar mais" busca a página seguinte e acrescenta ao final da lista já exibida | Evita buscar potencialmente centenas de versões de uma vez num diagrama de vida longa, sem construir um scroll infinito que esta fatia não precisa | y |
| Onde vive o código novo? | `apps/web/src/docs/` (cliente HTTP, parser puro de Markdown, painel), no molde de pasta-por-capacidade já usado por `ai-dock`/`comments`/`history` | Segue a convenção já estabelecida pelo repositório | y |
| Chave de i18n | Novo bloco de topo `docs` em `en` e `pt-BR` | `comments`/`history`/`export` já são blocos de topo por capacidade; `docs` segue o mesmo padrão | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Ver as versões geradas e gerar uma nova ⭐ MVP

**User Story**: Como pessoa com acesso a um diagrama, quero ver as versões de documentação já
geradas e gerar uma nova a partir do estado atual, para ter sempre um registro Markdown legível do
que o canvas representa.

**Why P1**: Sem listar e gerar não há documentação viva nenhuma — é a base sobre a qual ler e
regenerar seção operam.

**Acceptance Criteria**:

1. WHEN o painel de documentação montar THEN ele SHALL emitir `GET /diagrams/:id/specs` uma única vez e exibir as versões devolvidas, mais recente primeiro.
2. WHILE o `GET` inicial estiver em andamento, o painel SHALL exibir a mensagem de carregando.
3. IF o `GET /diagrams/:id/specs` responder qualquer status diferente de `200` THEN o painel SHALL exibir a mensagem de erro genérica e manter a lista vazia.
4. WHEN a lista devolvida estiver vazia THEN o painel SHALL exibir o estado vazio, distinto do estado de carregando e do estado de erro.
5. WHERE a resposta trouxer `nextCursor` não-nulo, o painel SHALL oferecer o controle "Carregar mais"; ao acioná-lo, SHALL emitir um novo `GET` com esse `cursor` e acrescentar os itens devolvidos ao final da lista já exibida.
6. The controle "Gerar documento" SHALL aparecer somente quando o bootstrap reportar `mutatePermissions.allowed: true`.
7. WHEN o usuário acionar "Gerar documento" THEN o painel SHALL emitir `POST /diagrams/:id/specs:generate` sem corpo.
8. WHEN esse `POST` responder `201` THEN o painel SHALL inserir a versão devolvida no topo da lista local, sem emitir nenhum `GET` adicional, e selecioná-la para exibição.
9. IF esse `POST` responder `403` THEN o painel SHALL exibir a mensagem de permissão negada e não alterar a lista.
10. IF esse `POST` responder qualquer outro status de falha THEN o painel SHALL exibir a mensagem de erro genérica e não alterar a lista.
11. WHILE uma geração estiver em andamento, um segundo acionamento de "Gerar documento" SHALL não emitir uma segunda requisição.

**Independent Test**: Com o `GET` inicial devolvendo duas versões, confirmar a ordem (mais recente
primeiro); acionar "Gerar documento" com o servidor respondendo `201` e confirmar que a nova versão
aparece no topo sem um `GET` adicional ter sido emitido.

---

### P1: Ler o conteúdo de uma versão, seção a seção ⭐ MVP

**User Story**: Como pessoa com acesso a um diagrama, quero ler o conteúdo de uma versão gerada,
seção por seção, vendo quais elementos do diagrama originaram cada uma, para entender a
documentação sem precisar cruzar o Markdown com o canvas manualmente.

**Why P1**: Listar versões sem conseguir ler o conteúdo não entrega "documentação viva" nenhuma —
é o objetivo central desta fatia.

**Acceptance Criteria**:

1. WHEN o usuário selecionar uma versão na lista THEN o painel SHALL buscar o conteúdo em `spec.markdownUrl` com `fetch` direto (sem passar pela rota do produto).
2. WHILE essa busca estiver em andamento, o painel SHALL exibir a mensagem de carregando no lugar do conteúdo.
3. IF essa busca falhar (erro de rede ou resposta não-`ok`) THEN o painel SHALL exibir a mensagem de erro genérica de conteúdo, mantendo a versão selecionada na lista.
4. WHEN o conteúdo terminar de carregar THEN o painel SHALL dividi-lo nas 4 seções fixas (`Visão Geral`, `Componentes`, `Fluxos`, `Decisões`) e exibir cada uma sob seu próprio título.
5. WHERE uma seção de Componentes, Fluxos ou Decisões contiver ao menos um token entre crases, o painel SHALL listar, sob essa seção, os ids de elemento referenciados, sem duplicatas e na ordem em que aparecem no texto.
6. IF um id de elemento referenciado por uma seção não estiver entre os ids da cena carregada (`liveElementIds`) THEN o painel SHALL exibi-lo mesmo assim, marcado como elemento removido, nunca ocultando a referência.
7. The seção `Visão Geral` SHALL nunca exibir uma lista de elementos referenciados.
8. WHEN o usuário selecionar uma segunda versão antes da busca da primeira terminar THEN o painel SHALL descartar a resposta da primeira busca ao chegar, exibindo apenas o conteúdo da versão selecionada por último.

**Independent Test**: Selecionar uma versão cujo Markdown tem um id de elemento fora de
`liveElementIds` numa seção de Componentes e confirmar que a referência aparece marcada como
removida, não escondida; trocar de versão com a primeira busca ainda pendente e confirmar que só o
conteúdo da segunda é exibido.

---

### P1: Regenerar uma única seção ⭐ MVP

**User Story**: Como pessoa com permissão de editar o diagrama, quero regenerar só a seção que
ficou desatualizada, para não perder o texto já revisado nas outras três.

**Why P1**: É o que torna a documentação "viva" de fato — sem isso, qualquer mudança de metadata
exige gerar o documento inteiro de novo, mesmo quando só uma seção mudou.

**Acceptance Criteria**:

1. The controle "Regenerar esta seção" SHALL aparecer em cada uma das 4 seções somente quando a versão exibida for a `current` e o bootstrap reportar `mutatePermissions.allowed: true`.
2. WHILE a versão exibida for `superseded` ou `draft`, nenhum controle de regenerar SHALL aparecer em nenhuma seção.
3. WHEN o usuário acionar "Regenerar esta seção" numa seção THEN o painel SHALL emitir `POST /diagrams/:id/specs/:version:regenerate-section` com `{section: <nome-da-seção>}`, usando a versão `current` exibida como `:version`.
4. WHEN esse `POST` responder `201` THEN o painel SHALL inserir a versão devolvida no topo da lista local, marcar a versão anterior como `superseded` na lista local, e passar a exibi-la automaticamente.
5. IF esse `POST` responder `403` THEN o painel SHALL exibir a mensagem de permissão negada e manter a versão exibida inalterada.
6. IF esse `POST` responder `404` THEN o painel SHALL exibir a mensagem de "versão não encontrada" e manter a versão exibida inalterada.
7. IF esse `POST` responder qualquer outro status de falha THEN o painel SHALL exibir a mensagem de erro genérica e manter a versão exibida inalterada.
8. WHILE uma regeneração de seção estiver em andamento, um segundo acionamento do mesmo controle SHALL não emitir uma segunda requisição.

**Independent Test**: Com a versão `current` exibida, acionar "Regenerar esta seção" em
`Componentes` com o servidor respondendo `201`; confirmar que a nova versão passa a ser exibida
automaticamente e que a versão anterior aparece como `superseded` na lista, sem `GET` adicional.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero listar, ler, gerar e
regenerar sem mouse, no idioma que já escolhi para o produto.

**Why P2**: Mesmo padrão já estabelecido por `diagram-comments`/`history-snapshots`.

**Acceptance Criteria**:

1. The toda ação desta spec (selecionar versão, carregar mais, gerar, regenerar seção) SHALL ser alcançável só por teclado.
2. WHEN gerar ou regenerar terminar, com sucesso ou falha, THEN o painel SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível do chrome do painel (rótulos, botões, mensagens) SHALL vir de chaves de i18n presentes nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Percorrer seleção de versão → seção → "Regenerar esta seção" usando só
Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF o Markdown buscado não contiver um dos 4 cabeçalhos fixos esperados (documento corrompido ou de um formato futuro) THEN essa seção SHALL ser exibida vazia, nunca lançar um erro que derrube o painel inteiro.
- WHEN duas seções diferentes referenciam o mesmo `elementId` (ex.: um componente aparece em Componentes e também em um fluxo) THEN cada seção SHALL listar essa referência de forma independente — a lista de referências é por seção, não deduplicada entre seções.
- WHILE o diagrama não tiver nenhuma versão gerada, os controles de regenerar seção SHALL não aparecer em lugar nenhum (não há seção nenhuma para exibir).
- IF o corpo de uma seção for exatamente o placeholder `pergunta aberta` ou `não especificado` (o backend nunca inventa conteúdo — `sections.ts`) THEN o painel SHALL exibi-lo como texto normal, sem tratamento especial nem lista de elementos referenciados.
- WHEN o painel estiver fechado (`<details>` colapsado) e reaberto na mesma sessão THEN a versão previamente selecionada e seu conteúdo já buscado SHALL continuar exibidos, sem refazer o `fetch` do Markdown.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LDC-01 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-02 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-03 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-04 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-05 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-06 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-07 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-08 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-09 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-10 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-11 | P1: Ver versões e gerar | R13 | Implementing |
| LDC-12 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-13 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-14 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-15 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-16 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-17 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-18 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-19 | P1: Ler conteúdo e referências | R13 | Implementing |
| LDC-20 | P1: Regenerar seção | R13 | Implementing |
| LDC-21 | P1: Regenerar seção | R13 | Implementing |
| LDC-22 | P1: Regenerar seção | R13 | Implementing |
| LDC-23 | P1: Regenerar seção | R13 | Implementing |
| LDC-24 | P1: Regenerar seção | R13 | Implementing |
| LDC-25 | P1: Regenerar seção | R13 | Implementing |
| LDC-26 | P1: Regenerar seção | R13 | Implementing |
| LDC-27 | P1: Regenerar seção | R13 | Implementing |
| LDC-28 | P2: Teclado e idioma | R13 | Implementing |
| LDC-29 | P2: Teclado e idioma | R13 | Implementing |
| LDC-30 | P2: Teclado e idioma | R13 | Implementing |

**ID format:** `LDC-NN`. O prefixo é `LDC` (não `DOC`) porque `DOC-01..04` já nomeia os requisitos
de **backend** de docgen, em `.specs/features/architecture-canvas/spec.md`, verificados na onda F3
— mesma razão pela qual `diagram-comments` usa `CMT2` em vez de `CMT` (já tomado pelos requisitos
de backend de comentário). Esta spec é a superfície de produto sobre aquele backend. Prefixos já em
uso no repo: A11Y, AAC, AGT, AIC, AIE, AIG, API, AUTH, CIQ, CLB, CMT, CMT2, DOC, DOCK, DR, EDT, EXP,
EXT, FND, GOV, LIB, LNT, MCP, MEM, NAV, OBS, OIDC, OPS, PERF, PRS, REC, SEC, SSO, TRU, UIX, VER.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 30 requisitos, mapeados 1:1 às 30 acceptance criteria das quatro histórias.

**Numeração por história:** LDC-01..11 (ver versões e gerar), LDC-12..19 (ler conteúdo e
referências), LDC-20..27 (regenerar seção), LDC-28..30 (teclado e idioma).

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `POST /diagrams/:id/specs:generate` | gerar uma versão nova a partir da cena atual | Aditiva: a resposta `{spec}` ganha `spec.markdownUrl` (URL assinada de leitura, TTL 3600s) |
| `GET /diagrams/:id/specs` | listar as versões já geradas (cursor por `version`) | Aditiva: cada item de `{specs, nextCursor}` ganha `markdownUrl` |
| `POST /diagrams/:id/specs/:version:regenerate-section` | recomputar uma seção contra a cena atual | Aditiva: a resposta `{spec}` ganha `spec.markdownUrl` |

As três rotas são exatamente as que o roadmap listou para R13. A única mudança de servidor desta
fatia é a adição do campo `markdownUrl` — computado com `storage.getSignedUrl(EXPORT_BUCKET,
spec.markdownKey, 3600)`, o mesmo bucket e o mesmo padrão de TTL que `export/routes.ts` já usa
(`EXPORT_URL_TTL_SECONDS`). Nenhum schema de `params`/`query`/`body` muda, nenhuma rota nova é
criada, nenhum comportamento de escrita muda. `packages/database`/`drizzle` não são tocados —
`markdownUrl` nunca é persistido, só computado por requisição, exatamente como os `formats[...].url`
de `POST /diagrams/:id/exports`.

---

## Success Criteria

- [ ] Uma pessoa sem `diagram:mutate` (bootstrap com `mutatePermissions.allowed: false`) abre o
      painel, vê a lista e lê o conteúdo de qualquer versão, sem que "Gerar documento" ou
      "Regenerar esta seção" apareçam em lugar nenhum.
- [ ] Uma versão gerada com um elemento cujo id não está em `liveElementIds` continua visível na
      seção que a referencia, marcada como removida — provado por teste que falha se a referência
      órfã for filtrada.
- [ ] Regenerar uma seção nunca altera o texto das outras três — provado por teste que compara o
      Markdown da versão nova com o da versão base fora da seção regenerada.
- [ ] `repo-tools audit` passa a classificar as 3 rotas de docgen como `consumed`.
- [ ] O fluxo inteiro (listar, gerar, ler seção, regenerar seção) é percorrível só com teclado, nos
      dois locales, com zero violações sérias/críticas no axe.
