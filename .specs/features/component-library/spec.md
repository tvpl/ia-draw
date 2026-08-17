# Biblioteca de componentes e metadados — Especificação

Quinta fatia vertical do roadmap de produto (entrada R5 de
`.specs/features/platform-maturity/ui-roadmap.md`). Entrega três telas que hoje não existem em
`apps/web`: um painel de biblioteca dentro do editor (inserir componentes no canvas), um painel de
metadados semânticos do elemento selecionado, e uma visão de inventário do diagrama.

## Problem Statement

O backend de biblioteca está implementado e verificado (`library.int.spec.ts`, requisitos
`LIB-01..04` de `architecture-canvas/spec.md`): `GET /libraries` lista a biblioteca global (seed
`@arch-canvas/library-content`, 12 categorias do documento-fonte + `wireframe`) mais bibliotecas
por workspace; `GET|PATCH /diagrams/:id/elements/:elementId/metadata` lê/escreve `semanticType` e
`metadataJson` por elemento; `GET /diagrams/:id/inventory` agrega os elementos com metadata de um
diagrama. Nada disso tem interface — a IA (F2, `compile(ir, library)`) já resolve `stableKey` contra
a biblioteca para gerar diagramas, mas uma pessoa não consegue navegar a biblioteca, inserir um
componente manualmente, nem ver/editar a classificação semântica de um elemento que já está no
canvas.

Uma lacuna real, descoberta na pesquisa desta spec, molda o desenho: **nenhum item de biblioteca
tem geometria de cena própria hoje** — `library_items.scene_json` é seedado como `{}` por
`seedGlobalLibrary`. O único lugar que transforma um `stableKey` num elemento visual é
`compile()` em `packages/diagram-ir`, que sempre gera um retângulo + label colorido por
`item.color`, ignorando `item.icon` (SVG inline ou referência externa). Decidido com o usuário
antes desta spec: **o painel de biblioteca desta fatia renderiza o SVG do ícone de verdade ao
inserir** (não só o retângulo colorido que `compile()` produz) — capacidade nova, não um mero
consumo de API existente, e por isso esta spec é seguida de uma fase de Design própria antes das
tasks.

## Goals

- [ ] Uma pessoa com `diagram:write` abre o painel de biblioteca dentro do editor, navega por
      categoria/busca, e insere um componente no canvas — como um elemento com o ícone real do
      item, não um placeholder genérico.
- [ ] Uma pessoa com `diagram:write` classifica semanticamente qualquer elemento selecionado
      (tipo semântico + metadata livre), e essa classificação é visível a quem só tem
      `diagram:read`.
- [ ] Uma pessoa com `diagram:read` vê o inventário completo de elementos classificados de um
      diagrama, e pode exportar como CSV.

## Out of Scope

Explicitamente excluído. Documentado para prevenir scope creep.

| Feature | Reason |
| ------- | ------ |
| Criar/editar bibliotecas (upload de manifesto novo) | Não existe rota de escrita em `libraries`/`library_items` — só seed via migration. Fora do orçamento desta fatia de frontend |
| Edição da geometria/estilo do item inserido além do que o Excalidraw já oferece nativamente | O item vira um elemento comum do canvas após inserido; edição subsequente usa as ferramentas normais do editor, não uma tela desta spec |
| Reclassificação em lote (multi-seleção → metadata) | `PATCH` é por `elementId` único; lote é uma otimização de UX fora desta fatia |
| Sincronização em tempo real do painel de metadados entre colaboradores | Depende de R10 (WebSocket); esta fatia lê/escreve via REST, revalidando ao selecionar |
| Filtro/paginação do inventário | `GET /diagrams/:id/inventory` devolve tudo; nenhuma rota pagina hoje (mesma decisão já registrada em `workspace-navigation`) |
| Renderizar ícones `external` (AWS) embutidos no canvas | Ver Assumptions — licença + sem egress de rede no ambiente; fallback documentado, não implementado como "embed real" |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Item com `icon.kind === 'external'` (hoje só os itens AWS) inserido no canvas | Fallback para retângulo + label colorido (o comportamento de `compile()`), nunca tenta buscar `sourceUrl` no cliente | `sourceUrl` é um link autoritativo de download, não uma imagem hotlink-ável por licença (CC-BY-ND, "não derivar"); mesmo se fosse, o ambiente de sandbox não tem egress de rede confirmado. Embutir por hotlink arriscaria tanto quebra visual (offline/CORS) quanto uma leitura duvidosa da licença | y (decisão técnica, não produto — resolvida via Knowledge Verification Chain) |
| Onde o painel de biblioteca vive | Painel lateral dentro do editor de diagrama (`DiagramEditorPage`), não uma rota própria | O roadmap (`ui-roadmap.md`'s R5) descreve "seletor de biblioteca no editor"; inserir um componente só faz sentido com um canvas aberto | y |
| Posição do elemento inserido no canvas | Centro do viewport visível atual (mesma convenção que o Excalidraw usa para paste), não a posição do cursor do mouse | Evita depender de rastrear a posição do mouse fora de um evento de drag nativo; drag-and-drop real (arrastar do painel pro canvas) é uma melhoria futura, esta fatia entrega "clicar para inserir" | y |
| Painel de metadados quando nada está selecionado | Estado vazio explicando "selecione um elemento", painel continua visível (não desaparece) | Consistente com o padrão de `AiDock` (painel persistente, conteúdo reage à seleção via `onSelectionChange`, já exposto por `EditorSurface` desde R1) | y |
| Elemento sem metadata ainda (`GET .../metadata` devolve `404`) | Painel mostra formulário vazio pronto pra preencher, não um erro | `404` aqui é "não classificado ainda", não uma falha — mesma leitura que `getElementMetadata` retornando `null` já documenta no código | y |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Navegar e inserir um componente da biblioteca ⭐ MVP

**User Story**: Como pessoa com permissão de escrita no diagrama, quero abrir a biblioteca de
componentes e inserir um no canvas, para não precisar desenhar do zero ou depender só da IA.

**Why P1**: É o valor central da fatia — sem inserção, o painel é só uma vitrine.

**Acceptance Criteria**:

1. WHEN o painel de biblioteca abrir THEN o sistema SHALL listar os itens da biblioteca global mais os da biblioteca do workspace atual (via `GET /libraries?workspaceId=`), agrupados por categoria.
2. WHEN a pessoa digitar num campo de busca THEN o sistema SHALL filtrar os itens visíveis por `name`, `aliases` ou `tags` contendo o texto, sem nova chamada de rede (filtro client-side sobre o payload já carregado).
3. WHEN a pessoa clicar em "inserir" num item com `icon.kind === 'inline'` THEN o sistema SHALL adicionar ao canvas um elemento de imagem renderizando aquele SVG, posicionado no centro do viewport visível, com o `name` do item como label associado.
4. IF o item clicado tiver `icon.kind === 'external'` THEN o sistema SHALL inserir o retângulo + label colorido de fallback (Assumptions) em vez de tentar carregar `sourceUrl`.
5. IF `role` do usuário não conceder `diagram:write` THEN o sistema SHALL exibir o painel em modo somente-leitura (navegar e ver detalhe, sem botão de inserir).
6. WHILE `GET /libraries` estiver carregando THE sistema SHALL exibir um estado de carregamento, nunca uma lista vazia que pareça "sem itens".
7. IF `GET /libraries` falhar THEN o sistema SHALL exibir uma mensagem de erro com opção de tentar novamente, sem quebrar o resto do editor.

**Independent Test**: Autenticado como `editor`, abrir um diagrama, abrir o painel de biblioteca, buscar por um termo conhecido, inserir um item com ícone inline, confirmar que o elemento aparece no canvas com o SVG correto.

---

### P1: Classificar semanticamente um elemento

**User Story**: Como pessoa com permissão de escrita, quero atribuir um tipo semântico e metadata
a um elemento do canvas, para que documentação/lint/IA (F3, R13, R14) tenham algo pra ler.

**Why P1**: É o dado que toda a "visão completa" documentada em `architecture-canvas/spec.md`
(docgen, lint, IA) consome — sem uma forma manual de escrever, só a IA classifica.

**Acceptance Criteria**:

1. WHEN um elemento for selecionado no canvas THEN o sistema SHALL buscar sua metadata via `GET /diagrams/:id/elements/:elementId/metadata` e exibir num painel lateral.
2. IF a busca devolver `404` THEN o sistema SHALL exibir um formulário vazio (Assumptions), nunca uma mensagem de erro.
3. WHEN a pessoa salvar o formulário (tipo semântico e/ou metadata livre) THEN o sistema SHALL enviar `PATCH .../metadata` e refletir o valor salvo devolvido pelo servidor (nunca otimista).
4. IF `PATCH` devolver `403` (papel `reviewer` ou menor) THEN o sistema SHALL não exibir o formulário de edição, só leitura — o painel já sabe o `role` efetivo via o mesmo mecanismo de R3/R4.
5. WHEN nenhum elemento estiver selecionado THEN o sistema SHALL exibir o estado vazio "selecione um elemento" (Assumptions), painel permanece montado.
6. WHEN a seleção mudar para outro elemento enquanto o formulário tem alterações não salvas THEN o sistema SHALL descartar a edição não salva sem confirmação — mesma convenção de "servidor é a fonte de verdade" já usada no restante do produto, e evita um dialog de confirmação a cada troca de seleção.

**Independent Test**: Selecionar um elemento sem metadata, ver formulário vazio, salvar um tipo semântico, trocar seleção e voltar, confirmar que o valor salvo persiste.

---

### P2: Ver o inventário do diagrama

**User Story**: Como pessoa com acesso de leitura, quero ver todos os elementos classificados de um
diagrama numa lista, para auditar a cobertura semântica sem clicar elemento por elemento.

**Why P2**: Útil, mas não bloqueia o valor central (inserir + classificar); é uma visão agregada
de dados que P1 já produz.

**Acceptance Criteria**:

1. WHEN a pessoa abrir a visão de inventário THEN o sistema SHALL listar via `GET /diagrams/:id/inventory` cada elemento com `elementType`, `semanticType` e `revision`.
2. IF um elemento listado não existir mais na cena atual (`elementType: null`) THEN o sistema SHALL marcá-lo visualmente como "removido do canvas", não escondê-lo.
3. WHEN a pessoa clicar em "exportar CSV" THEN o sistema SHALL chamar `GET /diagrams/:id/inventory?format=csv` e disparar o download do arquivo retornado.
4. IF a lista estiver vazia (nenhum elemento classificado ainda) THEN o sistema SHALL exibir um estado vazio explicando que nenhum elemento foi classificado, sem tratar como erro.

**Independent Test**: Classificar dois elementos, um deles depois apagado do canvas; abrir o inventário, confirmar as duas linhas com o removido marcado; exportar CSV e conferir o conteúdo.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero navegar a biblioteca,
inserir um item, classificar um elemento e ver o inventário sem mouse.

**Why P2**: Mesmo padrão já estabelecido por `ai-dock`, `sso-sign-in`, `workspace-navigation` e
`workspace-members` nesta frente.

**Acceptance Criteria**:

1. The toda ação desta spec (abrir painel, buscar, inserir, selecionar elemento, salvar metadata, abrir inventário, exportar CSV) SHALL ser alcançável só por teclado.
2. WHEN uma inserção ou um salvamento de metadata completar (sucesso ou falha) THEN o sistema SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Inserir um item da biblioteca e classificar um elemento usando só Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF a busca no painel de biblioteca não encontrar nenhum item THEN o sistema SHALL exibir um estado vazio de busca (não confundir com "biblioteca vazia").
- IF o mesmo `stableKey` existir em mais de uma biblioteca visível (global + workspace) THEN o sistema SHALL listar ambos os itens separadamente, sem deduplicar — cada `libraries.id` é uma biblioteca distinta, mesmo com item de mesmo `stableKey`.
- WHEN o painel de metadados estiver aberto e o elemento selecionado for apagado do canvas THEN o sistema SHALL voltar ao estado "selecione um elemento", nunca manter um formulário órfão.
- IF `metadataJson` salvo não for um objeto JSON válido (entrada livre da pessoa) THEN o sistema SHALL validar no cliente antes de enviar, mostrando erro de formato sem chamar a rota.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| CLIB-01 | P1: Navegar e inserir | Design | Pending |
| CLIB-02 | P1: Navegar e inserir | Design | Pending |
| CLIB-03 | P1: Navegar e inserir | Tasks | Implementing |
| CLIB-04 | P1: Navegar e inserir | Tasks | Implementing |
| CLIB-05 | P1: Navegar e inserir | Design | Pending |
| CLIB-06 | P1: Navegar e inserir | Design | Pending |
| CLIB-07 | P1: Navegar e inserir | Design | Pending |
| CLIB-08 | P1: Classificar elemento | Design | Pending |
| CLIB-09 | P1: Classificar elemento | Design | Pending |
| CLIB-10 | P1: Classificar elemento | Design | Pending |
| CLIB-11 | P1: Classificar elemento | Design | Pending |
| CLIB-12 | P1: Classificar elemento | Design | Pending |
| CLIB-13 | P1: Classificar elemento | Design | Pending |
| CLIB-14 | P2: Inventário | Design | Pending |
| CLIB-15 | P2: Inventário | Design | Pending |
| CLIB-16 | P2: Inventário | Design | Pending |
| CLIB-17 | P2: Inventário | Design | Pending |
| CLIB-18 | P2: Teclado e idioma | Design | Pending |
| CLIB-19 | P2: Teclado e idioma | Design | Pending |
| CLIB-20 | P2: Teclado e idioma | Design | Pending |

**ID format:** `CLIB-NN` (Component LIBrary — fatia de frontend distinta de `LIB-NN`, que já
nomeia os requisitos de backend em `architecture-canvas/spec.md`).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 20 total, 0 mapped to tasks yet, 20 unmapped ⚠️ (aguardando Design + Tasks)

---

## Rotas consumidas

`GET /libraries`, `GET /diagrams/:id/elements/:elementId/metadata`,
`PATCH /diagrams/:id/elements/:elementId/metadata`, `GET /diagrams/:id/inventory` — todas já
implementadas e verificadas (`library.int.spec.ts`); nenhuma mudança de servidor nesta fatia.

---

## Success Criteria

- [ ] Uma pessoa insere um componente com ícone real no canvas em menos de 3 cliques a partir do
      editor aberto.
- [ ] Todo elemento classificado por esta UI aparece corretamente no inventário e é consumível
      pelas fatias futuras que leem `diagram_elements_meta` (docgen R13, lint R14).
- [ ] Zero chamada de rede para `sourceUrl` de ícone externo a partir do cliente (verificável por
      teste que nenhum `fetch`/`<img src="https://...">` aponta pra fora do domínio do próprio
      produto ao inserir um item AWS).
