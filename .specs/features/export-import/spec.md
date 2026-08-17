# Export, bundle e import — Especificação

Sétima fatia vertical do roadmap de produto (entrada R7 de
`.specs/features/platform-maturity/ui-roadmap.md`). Entrega o menu de export de um diagrama (4
formatos), o bundle `.zip` de projeto/workspace, e o import de `.excalidraw` com prévia.

## Problem Statement

O backend de export/bundle/import está implementado e verificado (`export.int.spec.ts`,
`import.spec.ts`, requisitos `EXP-01..04` de `architecture-canvas/spec.md`). Nada disso tem
interface. Três características do contrato existente moldam o desenho desta fatia:

1. **`POST /diagrams/:id/exports` gera os 4 formatos de uma vez só** (`.excalidraw`, SVG, PNG,
   PDF) — não existe parâmetro de formato; a resposta já vem com uma URL assinada (TTL de 1h) por
   formato. Um "menu de export" nesta API é uma única chamada seguida de 4 links de download, não
   4 chamadas independentes.
2. **`POST /projects/:id/import` é preview-then-confirm no mesmo endpoint**: sem `confirm: true`
   só valida e devolve a prévia (`elementCount`, `appState`), sem criar nada; com `confirm: true` +
   `title`, cria o diagrama. Limite server-side de 20.000 elementos (`MAX_IMPORT_ELEMENTS`),
   rejeitado com `400`.
3. **`POST /workspaces/:id/bundles` é fire-and-forget**: enfileira um job (`bulk-workspace-bundle`)
   e devolve só `{jobId, status: 'queued'}` — **não existe nenhuma rota pra consultar o status do
   job ou obter uma URL de download quando ele terminar.** Cada bundle de diagrama fica salvo num
   caminho fixo no storage (`workspaces/{id}/bulk-bundles/{diagramId}.zip`), sem rota que o exponha
   por HTTP. Isso não é uma lacuna que esta fatia resolve — é documentado como limitação real do
   contrato atual (mesma categoria dos itens `backend-only` já registrados em `ui-roadmap.md`), e a
   UI desta fatia só confirma que o job foi solicitado, nunca que terminou.

## Goals

- [ ] Uma pessoa com acesso de leitura ao diagrama gera os 4 formatos de export e baixa qualquer
      um deles.
- [ ] Uma pessoa com acesso de leitura ao diagrama baixa um bundle `.zip` daquele diagrama.
- [ ] Uma pessoa com permissão de escrita no projeto importa um arquivo `.excalidraw`, vê quantos
      elementos serão criados antes de confirmar, e chega ao editor do diagrama recém-criado.
- [ ] Um admin do workspace solicita o bundle de todos os diagramas do workspace, sabendo
      explicitamente que o resultado não é entregue por esta UI (Problem Statement, item 3).

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Consultar status ou baixar o resultado do bundle de workspace | Não existe rota — ver Problem Statement item 3. Documentado como limitação do backend, não implementável nesta fatia |
| Exportar um formato individual sem gerar os outros três | A rota sempre gera os 4 juntos; não há como pedir só SVG, por exemplo |
| Editar/anotar o arquivo antes de importar | Import é tudo-ou-nada: prévia mostra só a contagem de elementos, nunca um editor de pré-visualização |
| Importar Mermaid/Structurizr | R8, endpoint diferente (`POST /projects/:id/import:format`) |
| Histórico de exports/bundles gerados anteriormente | Cada geração é efêmera (URL expira em 1h) e a API não lista gerações passadas — nenhuma tela promete um histórico que não existe |
| Bundle de projeto inteiro (todos os diagramas de um projeto) | A rota de bundle existente é por diagrama (`/diagrams/:id/bundle`) ou por workspace inteiro (`/workspaces/:id/bundles`) — não existe rota intermediária por projeto |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde o menu de export/bundle de diagrama vive | Dropdown no toolbar de `DiagramEditorPage` | Roadmap descreve "menu de export"; é uma ação sobre o diagrama aberto, mesmo lugar natural que R5/R6 já ocupam como painéis do editor | y |
| Comportamento do clique em "gerar exports" | Uma chamada a `POST .../exports` por clique no menu (não uma por formato); os 4 links de download aparecem juntos assim que a resposta volta | Único jeito consistente com o contrato (item 1 do Problem Statement); evitar quatro cliques gerando quatro respostas redundantes | y |
| Onde a ação de bundle de projeto/import vivem | `ProjectListPage` (R3) ganha duas ações novas: "importar diagrama" (abre o fluxo de preview→confirm) e nenhuma ação de bundle própria — bundle de diagrama fica no editor, bundle de workspace fica na lista de workspaces | Import cria um diagrama dentro de um projeto (`POST /projects/:id/import`), então pertence à tela de projeto; bundle de diagrama já tem dono natural (o editor) | y |
| Onde a ação de bundle de workspace vive | `WorkspaceListPage` (R3), por linha, visível só quando o `role` daquele item for `org_admin`/`workspace_admin` | A rota exige `workspace:manage_members`, a mesma checagem de papel que R4 já usa — reaproveita o campo `role` que R3 já devolve por item | y |
| Texto exibido depois de solicitar o bundle de workspace | Confirmação explícita: "solicitado — este produto não mostra quando termina ou onde baixar; item de acompanhamento operacional" (i18n key própria) | Nunca fingir uma barra de progresso ou um link que a API não oferece (Problem Statement item 3) | y |
| Formato de `fileContent` no import | Cliente lê o arquivo `.excalidraw` selecionado com `File.text()` e envia a string crua como `fileContent` | `previewImport(fileContent: string)` faz `JSON.parse` direto — o backend espera texto, não base64/multipart | y |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Exportar um diagrama em 4 formatos ⭐ MVP

**User Story**: Como pessoa com acesso ao diagrama, quero gerar e baixar o export em
`.excalidraw`, SVG, PNG ou PDF, para usar fora do produto.

**Why P1**: É o caso de uso mais comum de "salvar localmente".

**Acceptance Criteria**:

1. WHEN a pessoa abrir o menu de export e confirmar THEN o sistema SHALL enviar `POST /diagrams/:id/exports` uma única vez e, na resposta `200`, exibir os 4 links de download (`.excalidraw`, SVG, PNG, PDF), cada um com seu `sizeBytes` formatado.
2. WHEN a pessoa clicar num link de download THEN o sistema SHALL abrir a `url` assinada retornada, sem passar pelo próprio servidor do produto de novo.
3. IF a resposta for `429` (limite de taxa excedido — 30 gerações/minuto) THEN o sistema SHALL exibir uma mensagem pedindo para aguardar, sem travar o resto do editor.
4. WHILE a geração estiver em andamento THE sistema SHALL desabilitar o botão de gerar (evita múltiplos cliques disparando gerações redundantes).

**Independent Test**: Abrir um diagrama com pelo menos um elemento, gerar exports, baixar o PNG e confirmar que o arquivo abre como imagem válida.

---

### P1: Baixar um bundle `.zip` do diagrama

**User Story**: Como pessoa com acesso ao diagrama, quero baixar um `.zip` com tudo que compõe o
diagrama, para arquivar ou compartilhar fora do produto.

**Why P1**: Complementa o export de formato único com um pacote completo — mesmo nível de
prioridade, contrato igualmente simples (uma chamada, uma URL).

**Acceptance Criteria**:

1. WHEN a pessoa clicar em "baixar bundle" THEN o sistema SHALL enviar `POST /diagrams/:id/bundle` e, na resposta `200`, abrir a `url` assinada retornada.
2. WHILE a geração estiver em andamento THE sistema SHALL exibir um indicador de carregamento no botão.

**Independent Test**: Baixar o bundle de um diagrama e confirmar que o `.zip` contém o `manifest` descrito na resposta.

---

### P1: Importar um `.excalidraw` com prévia

**User Story**: Como pessoa com permissão de escrita num projeto, quero importar um arquivo
`.excalidraw` existente, ver quantos elementos ele tem antes de confirmar, e abrir o diagrama
criado, para trazer conteúdo de fora do produto sem risco de importar algo errado sem querer.

**Why P1**: É a única forma de trazer conteúdo externo para dentro do produto nesta fatia — sem
ela, R7 só exporta, nunca importa.

**Acceptance Criteria**:

1. WHEN a pessoa selecionar um arquivo `.excalidraw` THEN o sistema SHALL ler o conteúdo como texto e enviar `POST /projects/:id/import` sem `confirm`, exibindo a prévia (`elementCount`) devolvida.
2. IF o arquivo não for um JSON válido ou não for uma cena `.excalidraw` reconhecível THEN o sistema SHALL exibir a mensagem de erro `400` sem permitir prosseguir para confirmação.
3. IF o arquivo exceder 20.000 elementos THEN o sistema SHALL exibir a mensagem de erro `400` do servidor, nunca truncar e importar parcialmente.
4. WHEN a pessoa preencher um título e confirmar a prévia THEN o sistema SHALL reenviar `POST /projects/:id/import` com `confirm: true` e aquele `title`, e navegar direto para `/w/:workspaceId/d/:diagramId` do diagrama criado (`201`).
5. IF a pessoa tentar confirmar sem preencher título THEN o sistema SHALL não emitir a requisição de confirmação (validação client-side, evita o `400` "title is required" do servidor).
6. IF `role` não conceder `diagram:write` no projeto THEN o sistema SHALL não exibir a ação de importar.

**Independent Test**: Selecionar um `.excalidraw` válido com 3 elementos, ver "3 elementos serão importados", preencher um título, confirmar, e chegar no editor do diagrama recém-criado com os 3 elementos presentes.

---

### P2: Solicitar bundle de todos os diagramas do workspace

**User Story**: Como admin do workspace, quero solicitar um bundle de todos os diagramas do
workspace, sabendo que o acompanhamento é operacional e fora desta UI.

**Why P2**: É uma ação de admin, menos frequente que exportar um diagrama único, e sua utilidade
prática hoje é limitada pela ausência de rota de acompanhamento (Problem Statement item 3) — ainda
assim, vale expor o gatilho, já que a rota existe e é a única forma de disparar o job.

**Acceptance Criteria**:

1. IF `role` do usuário for `org_admin` ou `workspace_admin` naquele workspace THEN o sistema SHALL exibir a ação "solicitar bundle do workspace" na linha daquele item em `WorkspaceListPage`.
2. WHEN a pessoa confirmar a solicitação THEN o sistema SHALL enviar `POST /workspaces/:id/bundles` e, na resposta `200`, exibir a mensagem de confirmação com o texto explícito de que não há acompanhamento nesta UI (Assumptions).
3. IF a resposta for `503` (fila de jobs indisponível) THEN o sistema SHALL exibir que a funcionalidade está temporariamente indisponível, sem sugerir tentar de novo automaticamente.

**Independent Test**: Como `workspace_admin`, solicitar o bundle do workspace, confirmar que a mensagem de "job enfileirado" aparece e que a ação não existe para um item onde o papel é `editor`.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero exportar, baixar bundle e
importar sem mouse.

**Why P2**: Mesmo padrão já estabelecido por `ai-dock`, `sso-sign-in`, `workspace-navigation` e
`workspace-members` nesta frente.

**Acceptance Criteria**:

1. The toda ação desta spec (abrir menu de export, gerar, baixar, selecionar arquivo de import, confirmar, solicitar bundle de workspace) SHALL ser alcançável só por teclado.
2. WHEN uma geração de export/bundle ou uma confirmação de import completar (sucesso ou falha) THEN o sistema SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Gerar um export e importar um arquivo usando só Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF a pessoa navegar para fora da página de export enquanto uma geração está em andamento THEN o sistema SHALL simplesmente descartar a resposta quando ela chegar (a geração já aconteceu no servidor e o arquivo já está salvo; só a UI de download é perdida — a pessoa gera de novo se precisar).
- IF o arquivo selecionado para import não tiver extensão `.excalidraw` mas o conteúdo for JSON válido no formato esperado THEN o sistema SHALL aceitar mesmo assim — a validação é pelo conteúdo (`previewImport`), nunca pela extensão do nome do arquivo.
- WHEN a lista de workspaces não tiver nenhum item onde a pessoa seja admin THEN a ação de bundle de workspace SHALL simplesmente nunca aparecer, sem uma seção vazia dedicada a ela.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| XPRT-01 | P1: Exportar 4 formatos | Tasks | ✅ Verified |
| XPRT-02 | P1: Exportar 4 formatos | Tasks | ✅ Verified |
| XPRT-03 | P1: Exportar 4 formatos | Tasks | ✅ Verified |
| XPRT-04 | P1: Exportar 4 formatos | Tasks | ✅ Verified |
| XPRT-05 | P1: Bundle de diagrama | Tasks | ✅ Verified |
| XPRT-06 | P1: Bundle de diagrama | Tasks | ✅ Verified |
| XPRT-07 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-08 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-09 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-10 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-11 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-12 | P1: Importar com prévia | Tasks | ✅ Verified |
| XPRT-13 | P2: Bundle de workspace | Tasks | ✅ Verified |
| XPRT-14 | P2: Bundle de workspace | Tasks | ✅ Verified |
| XPRT-15 | P2: Bundle de workspace | Tasks | ✅ Verified |
| XPRT-16 | P2: Teclado e idioma | Tasks | ✅ Verified |
| XPRT-17 | P2: Teclado e idioma | Tasks | ✅ Verified |
| XPRT-18 | P2: Teclado e idioma | Tasks | ✅ Verified |

**ID format:** `XPRT-NN` (fatia de frontend distinta de `EXP-NN`, que já nomeia os requisitos de
backend em `architecture-canvas/spec.md`).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 18 total, 18 mapped to tasks (T1-T7), 0 unmapped

---

## Rotas consumidas

`POST /diagrams/:id/exports`, `POST /diagrams/:id/bundle`, `POST /projects/:id/import`,
`POST /workspaces/:id/bundles` — todas já implementadas e verificadas (`export.int.spec.ts`,
`import.spec.ts`); nenhuma mudança de servidor nesta fatia.

---

## Success Criteria

- [ ] Uma pessoa exporta e baixa qualquer um dos 4 formatos em menos de 2 cliques a partir do
      editor aberto.
- [ ] Uma importação nunca cria um diagrama sem a pessoa ver a contagem de elementos primeiro.
- [ ] Nenhuma tela desta fatia promete acompanhamento do bundle de workspace além do que a API
      oferece.
