# Biblioteca de componentes e metadados — Design

**Spec**: `.specs/features/component-library/spec.md`
**Decisions carregadas**: AD-001 (LWW por elemento), AD-008 (nunca importar `@excalidraw/excalidraw`
por valor server-side — irrelevante aqui, esta fatia é 100% client), AD-010 (todo consumidor que
precisa manipular o canvas via um caminho novo estende o handle imperativo único de
`EditorSurface`, nunca inventa um segundo ref).

---

## Approach exploration

A única decisão arquitetural real desta fatia é **como inserir o SVG de um ícone como elemento de
verdade no canvas**, já que nenhum item de biblioteca tem geometria própria (`spec.md`'s Problem
Statement).

**A — Estender `EditorSurfaceHandle` com `insertLibraryItem` (recomendado).** Novo método no
mesmo handle imperativo que já expõe `applyRemoteScene` (AD-010): registra o SVG como um arquivo
binário via `excalidrawAPI.addFiles([...])`, cria um elemento `image` referenciando aquele
`fileId`, e um elemento de texto vinculado com o `name` do item (mesmo padrão de
`buildLabelElement` em `packages/diagram-ir/src/compile.ts`, reimplementado localmente — este
pacote não importa `diagram-ir`, que é server-first). Todo o conhecimento de tipos internos do
Excalidraw (`image`, `fileId`, `addFiles`) fica dentro de `editor-adapter`, atrás da mesma fronteira
estrutural que `SceneElement`/`ExcalidrawSceneApi` já usam — nenhum novo import de subpath interno.
**Trade-off**: mais um método aditivo no handle, mas mantém a garantia de EDT-07 ("o único
componente que renderiza `<Excalidraw/>`") — a única forma de tocar a API real do Excalidraw
continua sendo dentro de `EditorSurface`.

**B — Componente próprio de biblioteca chama a API do Excalidraw diretamente (via um segundo
ref).** Rejeitada: quebra AD-010 e EDT-07 — criaria um segundo caminho pra mutar o canvas fora do
handle único, exatamente o padrão que AD-010 registrou como proibido.

**C — Renderizar só como rascunho DOM sobreposto ao canvas (não um elemento Excalidraw real).**
Rejeitada: não é "inserir no canvas" de verdade — o elemento não seria editável pelas ferramentas
nativas do Excalidraw depois, contradizendo a Acceptance Criteria CLIB-03.

**Escolha: A.**

---

## Architecture Overview

```
LibraryPanel (novo)              MetadataPanel (novo)          InventoryView (novo)
  libraryClient.list()             metadataClient.get/patch()    metadataClient.inventory()
        │                                  │                            │
        └──────────────┬───────────────────┘                            │
                        ▼                                                │
              DiagramEditorPage (estendido)                              │
                        │                                                │
                        ▼                                                │
         EditorSurfaceHandle.insertLibraryItem(item)  ◄── novo método    │
                        │                                                │
                        ▼                                                │
              EditorSurface (packages/editor-adapter, estendido)         │
                        │                                                │
               excalidrawAPI.addFiles + updateScene                      │
                                                                          ▼
                                                        rota própria acessível a partir do editor
```

`LibraryPanel` e `MetadataPanel` vivem dentro de `DiagramEditorPage`, como painéis alternáveis
(mesmo padrão de toggle que `AiDock` já estabeleceu). `InventoryView` é a única tela desta fatia
que não precisa do canvas montado — é uma leitura agregada — mas seu link de entrada vive na
mesma `DiagramEditorPage` (ex. um item de menu "ver inventário").

## Code Reuse Analysis

### Existing Components to Leverage

- `EditorSurfaceHandle`/`EditorSurface` (`packages/editor-adapter`) — estendido, não recriado.
- `onSelectionChange` (já exposto desde R1/`ai-dock`) — `MetadataPanel` reage à seleção sem
  nenhuma mudança em `EditorSurface` além da já existente.
- Padrão de cliente HTTP com injeção de `fetchImpl` (`aiDockClient.ts`, `syncClient.ts`,
  `memberClient.ts` de R4) — `libraryClient.ts`/`metadataClient.ts` seguem o mesmo formato.
- `role`/`can()` já resolvido por `ProjectListPage`/`DiagramListPage` (R3) — os três componentes
  novos recebem o `role` efetivo como prop em vez de resolver de novo.
- Estilo de estado vazio/carregamento/erro já estabelecido por `WorkspaceListPage` (R3) e `AiDock`.

### Integration Points

- `apps/web/src/nav/DiagramListPage.tsx` — nenhuma mudança (o editor é alcançado do mesmo jeito).
- `DiagramEditorPage.tsx` — ganha os dois painéis alternáveis + o link de inventário.
- `apps/web/src/i18n/locales/{en,pt-BR}/translation.json` — chaves novas sob `library`/`metadata`/`inventory`.

---

## Components

### `EditorSurfaceHandle.insertLibraryItem` (extensão, `packages/editor-adapter`)

```ts
export interface EditorSurfaceHandle {
  applyRemoteScene: (remote: readonly SceneElement[]) => void;
  /** Insere um item de biblioteca no centro do viewport visível: elemento de
   * imagem (SVG do ícone) + texto do `name` vinculado, ou o fallback
   * retângulo+label quando `icon.kind === 'external'` (spec.md Assumptions). */
  insertLibraryItem: (item: LibraryItem) => void;
}
```

Internamente: para `icon.kind === 'inline'`, monta um `data:image/svg+xml;base64,...` a partir de
`icon.svg`, chama `api.addFiles([{ id: fileId, dataURL, mimeType: 'image/svg+xml', created:
Date.now() }])`, monta um elemento `image` estruturalmente compatível (mesmo padrão de cast já
usado por `initialData`/`onChange`) posicionado no centro do viewport atual
(`api.getAppState().scrollX/scrollY/zoom`), e um elemento de texto vinculado com `item.name`. Para
`icon.kind === 'external'`, monta o par retângulo+texto (mesma forma que
`compile()`'s `buildRectangleElement`, reimplementado aqui sem importar `diagram-ir`).

### `libraryClient.ts` (`apps/web/src/library/`)

`list(workspaceId?: string): Promise<LibraryRow[]>` — `GET /libraries?workspaceId=`. Mesmo formato
de status-branching dos demais clients (200 sucesso, não-2xx erro genérico).

### `metadataClient.ts` (`apps/web/src/library/`)

`get(diagramId, elementId): Promise<ElementMetadata | null>` (`null` no `404`, nunca lança),
`patch(diagramId, elementId, body): Promise<ElementMetadata>`,
`inventory(diagramId, format): Promise<InventoryRow[] | string>` (`string` para `format: 'csv'`,
`InventoryRow[]` para `'json'`).

### `LibraryPanel` (componente)

Lista agrupada por categoria, campo de busca client-side (filtra sobre o payload já carregado —
CLIB-02), botão "inserir" por item chamando `insertLibraryItem` via o `ref` de `EditorSurface`
mantido em `DiagramEditorPage`. Modo somente-leitura quando `role` não concede `diagram:write`
(CLIB-05).

### `MetadataPanel` (componente)

Reage a `onSelectionChange`: com exatamente um id selecionado, busca via `metadataClient.get`;
formulário controlado (tipo semântico + textarea JSON validado client-side antes do `PATCH`);
estado vazio quando nada selecionado ou seleção múltipla (spec.md só define comportamento pra
seleção única — seleção múltipla ou vazia cai no mesmo estado "selecione um elemento").

### `InventoryView` (componente/rota)

Tabela simples a partir de `metadataClient.inventory(diagramId, 'json')`; botão de exportar CSV
que chama a mesma rota com `format=csv` e dispara `Blob`/`URL.createObjectURL` para download (sem
subir pelo servidor de novo).

---

## Data Models

### `LibraryItem` (cliente, espelha `packages/library-content/src/schema.ts`)

Reaproveitado via `@arch-canvas/library-content`'s tipo exportado (pacote puro, sem runtime
server-only) — `apps/web` ganha essa dependência de workspace, mesmo precedente de R3 importar
`@arch-canvas/auth`.

### `ElementMetadata` (cliente)

```ts
interface ElementMetadata {
  diagramId: string;
  elementId: string;
  semanticType: string | null;
  metadataJson: Record<string, unknown>;
  revision: number;
}
```

---

## Error Handling Strategy

- `GET /libraries` falha → `LibraryPanel` mostra erro com "tentar de novo" (CLIB-07), sem derrubar
  `DiagramEditorPage`.
- `GET .../metadata` → `404` mapeado para `null` dentro do client (nunca propaga como erro visível
  — é "não classificado ainda", spec.md Assumptions).
- `PATCH .../metadata` → `403` já é coberto pelo gate de `role` client-side (o formulário nem
  aparece), mas se o papel for revogado no meio da sessão o client trata o `403` da resposta como
  qualquer outro erro de escrita já tratado nas fatias anteriores (mensagem + nenhuma aplicação
  otimista).
- `insertLibraryItem` nunca falha de forma observável pelo usuário — é uma operação local síncrona
  sobre a API do Excalidraw, sem chamada de rede.

## Risks & Concerns

- **Risco**: `addFiles`/elemento `image` são parte da API pública do Excalidraw, mas este pacote
  nunca os usou antes (só `updateScene`/`onChange`/`excalidrawAPI` até agora) — mitigação: task
  dedicada de spike/teste unitário isolado em `editor-adapter` antes de integrar no painel, mesmo
  padrão de risco já mitigado por `applyRemoteScene` (AD-010) quando foi introduzido.
- **Risco**: SVGs grandes (`icon.svg` inline) infladas em base64 podem pesar a cena — mitigação:
  nenhuma nesta fatia (os SVGs do seed já são pequenos, autoria própria); um limite de tamanho fica
  como nota para uma fatia futura se algum dia a biblioteca aceitar upload.
- **Risco de teste**: `addFiles`/elementos `image` não são triviais de asserir num teste RTL sobre
  o Excalidraw real — mitigação: `EditorSurface.spec.tsx` testa `insertLibraryItem` via o mock já
  existente de `excalidrawAPI` (mesmo padrão usado para testar `applyRemoteScene`), não o
  Excalidraw real.

## Tech Decisions

- Nenhuma dependência nova de pacote — `addFiles`/elemento `image` já fazem parte da API pública
  do `@excalidraw/excalidraw` já instalado.
- `apps/web` ganha dependência de workspace em `@arch-canvas/library-content` (tipos apenas).

---

## Tasks preview (não vinculante)

1. `EditorSurfaceHandle.insertLibraryItem` + testes isolados em `editor-adapter`.
2. `libraryClient.ts` + testes.
3. `metadataClient.ts` + testes.
4. `LibraryPanel` + testes (incl. busca, somente-leitura, estados).
5. `MetadataPanel` + testes (incl. 404→formulário vazio, 403→somente-leitura).
6. `InventoryView` + testes (incl. elemento removido, export CSV).
7. i18n keys (`en`/`pt-BR`).
8. Integração em `DiagramEditorPage` + a11y.
