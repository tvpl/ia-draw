# Interop Mermaid/Structurizr no painel de export/import — Especificação

Oitava fatia vertical do roadmap de produto (entrada R8 de
`.specs/features/platform-maturity/ui-roadmap.md`). Adiciona export e import de Mermaid e
Structurizr DSL ao MESMO painel que R7 (`export-import`) já entregou — nenhuma rota nova de UI,
nenhum componente novo: `ExportMenu.tsx` ganha dois botões, `ImportDialog.tsx` ganha um seletor de
formato.

## Problem Statement

O backend de interop Mermaid/Structurizr está implementado e verificado
(`apps/server/src/modules/interop/routes.ts`, `interop.int.spec.ts`, requisitos `AAC-01/02` de
`architecture-canvas/spec.md`). Nada disso tem interface. Três características do contrato real —
diferentes das do R7 — moldam esta fatia:

1. **As rotas reais são `POST /projects/:id/import:mermaid` / `:structurizr`** (não
   `/projects/:id/import:format` — isso é o path registrado no find-my-way, que o
   `docs/route-inventory.md` mostra com o parâmetro `:format` não resolvido; o handler despacha
   por sufixo literal `:mermaid`/`:structurizr`, documentado no próprio `routes.ts`) e
   `POST /diagrams/:id/export:mermaid` / `:structurizr`. Corpo do import: `{ dsl: string, title?:
   string }`. Corpo do export: nenhum.
2. **Import de DSL cria o diagrama diretamente — não existe preview-then-confirm para Mermaid/
   Structurizr**, ao contrário do fluxo `.excalidraw` do R7. A resposta é sempre `201` com
   `{ diagramId, diagram, limitations }` numa única chamada; `limitations` é sempre um array
   (nunca omitido), reportando toda perda semântica do round-trip, mas o diagrama já foi
   persistido quando a resposta chega. Não há endpoint de dry-run: o próprio `routes.ts` documenta
   por que o import de `.excalidraw` e o de DSL têm formas diferentes (o segundo nunca teve rota
   de preview cogitada — `AAC-01` só promete "editable layout" + "limitations", nunca uma prévia
   server-side).
3. **Export de DSL devolve o texto pronto, não uma URL assinada** — `{ dsl: string, limitations:
   string[] }`, sempre `200`. Diferente das 4 rotas do R7 (que sempre devolvem link assinado para
   storage), aqui o cliente já tem o conteúdo final em mãos e precisa apenas oferecer o download,
   sem round-trip nenhum a mais.

## Goals

- [ ] Uma pessoa com acesso de leitura ao diagrama exporta a cena atual como Mermaid ou
      Structurizr DSL e baixa o arquivo resultante, vendo qualquer limitação de round-trip
      relatada pelo servidor.
- [ ] Uma pessoa com permissão de escrita no projeto importa um arquivo Mermaid ou Structurizr,
      revisa o conteúdo lido antes de confirmar, e chega ao editor do diagrama recém-criado vendo
      as limitações que o servidor relatou.
- [ ] Nenhuma tela desta fatia finge uma prévia server-validada (contagem de elementos, por
      exemplo) que a rota de DSL não oferece — a prévia é honesta sobre o que é: revisão do texto
      lido, feita inteiramente no cliente, antes da chamada que já cria o diagrama.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Prévia server-validada (contagem de nós/edges) antes de criar o diagrama Mermaid/Structurizr | A rota não tem modo dry-run — só existe create direto (Problem Statement item 2). Fingir uma contagem pré-validada exigiria mudar o contrato já implementado e verificado (`AAC-01`), fora do escopo desta fatia de UI |
| Colar o DSL direto num textarea (sem selecionar arquivo) | Mantém a mesma affordance que o `.excalidraw` do R7 já usa (seleção de arquivo); ver Assumptions |
| Edição do DSL antes de importar (syntax highlighting, reparse ao vivo) | A prévia é somente leitura — mostra exatamente o que será enviado, nunca um editor |
| Detecção automática do formato pelo conteúdo do arquivo | A pessoa escolhe Mermaid ou Structurizr explicitamente no seletor; nenhuma heurística de conteúdo |
| Copiar o DSL exportado para a área de transferência (Clipboard API) | Download via Blob já resolve "levar o conteúdo para fora do produto"; escopo mínimo, mesmo padrão do CSV de `InventoryView` |
| Round-trip sem perdas | `limitations` já existe no backend para documentar perdas; esta fatia só exibe o array, nunca tenta eliminá-lo |
| Qualquer mudança no menu de bundle (`BundleButton`) ou nas 4 rotas de export do R7 | Fora do escopo — R8 é aditivo aos dois componentes citados no Problem Statement, nunca aos já entregues por R7 |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde os controles de Mermaid/Structurizr vivem | Dentro do MESMO `<details>` de `ExportMenu` (dois botões novos) e do MESMO `<dialog>` de `ImportDialog` (um seletor de formato novo) | Roadmap R8: "0 superfície nova"; `Depende de R7 — reusa o painel, não cria um segundo" | y |
| Formato padrão do seletor de import ao abrir o diálogo | `.excalidraw` (comportamento do R7 inalterado) | Preserva 100% do comportamento existente para quem nunca usa Mermaid/Structurizr; menor surpresa | y |
| Significado de "prévia" para import Mermaid/Structurizr | Revisão client-side, somente leitura, do texto lido do arquivo (`File.text()`) ANTES da chamada que já cria o diagrama — nunca uma prévia validada pelo servidor | A rota `/projects/:id/import:mermaid`/`:structurizr` não tem modo dry-run (Problem Statement item 2); fingir uma contagem de elementos pré-criação seria inventar um contrato que o backend não tem | y |
| Affordance de seleção de conteúdo DSL | Input de arquivo (`accept=".mmd,.txt"` para Mermaid, `.dsl,.txt"` para Structurizr), lido via `File.text()` — igual ao padrão já usado para `.excalidraw` | Mesma affordance do R7, menor superfície nova; validação é sempre por conteúdo, nunca por extensão (mesmo princípio do Edge Case do R7) | y |
| Exigência de título no confirm de import Mermaid/Structurizr | Opcional — o botão de confirmar fica habilitado com título vazio | O corpo `{ dsl, title? }` da rota marca `title` como opcional (server usa um default por formato quando omitido); exigir título aqui seria uma regra client-side sem lastro no contrato, diferente do `.excalidraw`, cujo `title` É obrigatório no corpo | y |
| Entrega do DSL exportado ao usuário | Download client-side via `Blob`/`URL.createObjectURL` (mesmo padrão de `InventoryView.tsx`'s CSV export), nome de arquivo `diagram-<id>.mmd` / `diagram-<id>.dsl` | A rota devolve o texto pronto, não uma URL assinada (Problem Statement item 3) — o precedente mais próximo no próprio código é exatamente esse | y |
| Onde as limitações (`limitations[]`) aparecem | Export: lista de texto ao lado do botão de download, dentro do mesmo `<details>`. Import: lista de texto na região `aria-live` de confirmação, antes/durante a navegação para o diagrama criado | `limitations` é sempre retornado (mesmo vazio) pelas duas rotas; nunca esconder, mesma disciplina do R7 com mensagens de erro | y |
| Botão de confirmar da prévia DSL reusa o texto `import.confirm` ("Confirmar import") do R7 | Sim, mesmo texto para as 3 formatos | Reduz chaves i18n novas; a ação é semanticamente idêntica (confirmar a criação do diagrama a partir do que foi lido) nos 3 casos | y |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Exportar a cena como Mermaid ou Structurizr DSL ⭐ MVP

**User Story**: Como pessoa com acesso ao diagrama, quero exportar a cena atual como Mermaid ou
Structurizr DSL e baixar o arquivo, para levar o diagrama para um fluxo de documentação-como-
código.

**Why P1**: É o caso de uso central do roadmap R8 — arquitetura-como-código.

**Acceptance Criteria**:

1. WHEN a pessoa clicar em "Exportar Mermaid" dentro do menu de export THEN o sistema SHALL enviar `POST /diagrams/:id/export:mermaid` exatamente uma vez e, na resposta `200`, disparar o download client-side (`Blob`/`URL.createObjectURL`) do `dsl` retornado como `diagram-<id>.mmd`.
2. WHEN a pessoa clicar em "Exportar Structurizr" THEN o sistema SHALL enviar `POST /diagrams/:id/export:structurizr` exatamente uma vez e, na resposta `200`, disparar o download do `dsl` retornado como `diagram-<id>.dsl`.
3. WHEN a resposta trouxer `limitations` não-vazio THEN o sistema SHALL exibir cada mensagem de limitação em texto visível junto ao botão daquele formato, nunca escondida.
4. IF a resposta de qualquer um dos dois exports não for `200` THEN o sistema SHALL exibir uma mensagem de erro genérica na mesma região `aria-live` que `ExportMenu` já usa, sem travar o restante da página.
5. WHILE um export Mermaid ou Structurizr estiver em andamento THE sistema SHALL desabilitar o botão daquele formato especificamente — independente do estado do botão "Gerar exports" dos 4 formatos do R7.

**Independent Test**: Abrir um diagrama com pelo menos 2 elementos conectados, clicar "Exportar Mermaid", confirmar que um arquivo `.mmd` é baixado contendo os rótulos dos elementos.

---

### P1: Importar um arquivo Mermaid ou Structurizr com prévia

**User Story**: Como pessoa com permissão de escrita num projeto, quero importar um arquivo
Mermaid ou Structurizr, revisar o conteúdo antes de confirmar, e abrir o diagrama criado com as
limitações relatadas visíveis, para trazer arquitetura-como-código existente para dentro do
produto sem surpresas.

**Why P1**: Fecha o ciclo de round-trip que a exportação abre — sem isso R8 só exporta, nunca
importa.

**Acceptance Criteria**:

1. WHEN a pessoa abrir o diálogo de import THEN o sistema SHALL exibir um seletor de formato com três opções (`.excalidraw`, Mermaid, Structurizr), padrão `.excalidraw` selecionado (comportamento do R7 inalterado).
2. WHEN a pessoa selecionar "Mermaid" ou "Structurizr" no seletor THEN o sistema SHALL trocar o `accept` do input de arquivo (`.mmd,.txt` para Mermaid; `.dsl,.txt` para Structurizr) e limpar qualquer prévia/arquivo previamente selecionado sob outro formato.
3. WHEN a pessoa selecionar um arquivo com o formato Mermaid ou Structurizr ativo THEN o sistema SHALL ler o conteúdo como texto (`File.text()`) e exibi-lo verbatim, somente leitura, como prévia — sem nenhuma chamada ao servidor nesse passo (não existe rota de dry-run para estes dois formatos).
4. WHEN a pessoa confirmar a prévia (com ou sem título preenchido) THEN o sistema SHALL enviar `POST /projects/:id/import:mermaid` ou `/projects/:id/import:structurizr` (conforme o formato ativo) com `{ dsl, title }` (`title` omitido do corpo quando vazio) exatamente uma vez.
5. WHEN a resposta da confirmação for `201` THEN o sistema SHALL exibir as `limitations` retornadas (mesmo array vazio, com uma mensagem "nenhuma limitação" nesse caso) e navegar para `/w/:workspaceId/d/:diagramId` do diagrama criado.
6. IF a resposta da confirmação for `400` THEN o sistema SHALL exibir a mensagem do servidor e SHALL NOT navegar para nenhum diagrama.
7. IF a resposta da confirmação for qualquer outro status não-`201` THEN o sistema SHALL exibir uma mensagem de erro genérica e SHALL NOT navegar para nenhum diagrama.
8. IF o arquivo Mermaid/Structurizr selecionado tiver conteúdo vazio (0 caracteres) THEN o sistema SHALL manter o botão de confirmar desabilitado, sem enviar a requisição.
9. The sistema SHALL permitir confirmar um import Mermaid/Structurizr com o campo de título vazio (diferente do `.excalidraw`, cujo título é obrigatório no cliente) — reflete `title` ser opcional no corpo dessas duas rotas.
10. IF `role` não conceder `diagram:write` no projeto THEN o sistema SHALL não exibir o gatilho de import para NENHUM dos três formatos (reusa o mesmo gate `canImport` que já esconde o diálogo inteiro no R7).

**Independent Test**: Selecionar Mermaid no seletor, escolher um arquivo `.mmd` com um flowchart de 3 nós, ver o conteúdo lido na prévia, confirmar sem preencher título, e chegar no editor do diagrama recém-criado.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero exportar e importar Mermaid/
Structurizr sem mouse, nos dois idiomas do produto.

**Why P2**: Mesmo padrão já estabelecido por `export-import` (R7) e toda fatia anterior desta
frente.

**Acceptance Criteria**:

1. The seletor de formato de import, os dois botões de export Mermaid/Structurizr, a área de prévia somente-leitura e o botão de confirmar SHALL ser alcançáveis só por teclado (Tab/Shift+Tab/Enter/setas para o `radiogroup`).
2. The todo texto novo visível introduzido por esta fatia SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Selecionar o formato Structurizr, escolher um arquivo, confirmar o import e exportar de volta como Mermaid — tudo usando só o teclado, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF a pessoa trocar o formato do seletor de import depois de já ter selecionado um arquivo (ex.: de Mermaid para Structurizr) THEN o sistema SHALL descartar a prévia/arquivo anterior — nunca enviar o conteúdo lido sob o formato errado.
- IF a pessoa navegar para fora da página enquanto um export Mermaid/Structurizr está em andamento THEN o sistema SHALL simplesmente descartar a resposta quando ela chegar (mesmo princípio já registrado no Edge Cases do R7 para os 4 formatos e o bundle).
- WHEN o array `limitations` de uma resposta de export ou import vier vazio THEN o sistema SHALL mostrar uma confirmação explícita de "nenhuma limitação relatada", nunca omitir a seção inteira (evita a pessoa se perguntar se a checagem rodou).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| INT-01 | P1: Exportar Mermaid/Structurizr | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-02 | P1: Exportar Mermaid/Structurizr | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-03 | P1: Exportar Mermaid/Structurizr | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-04 | P1: Exportar Mermaid/Structurizr | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-05 | P1: Exportar Mermaid/Structurizr | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-06 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-07 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-08 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-09 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-10 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-11 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-12 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-13 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-14 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-15 | P1: Importar com prévia | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-16 | P2: Teclado e idioma | Tasks | Implementing (T1-T3 done, aguarda Verifier) |
| INT-17 | P2: Teclado e idioma | Tasks | Implementing (T1-T3 done, aguarda Verifier) |

**ID format:** `INT-NN` (INTerop — fatia de frontend distinta de `AAC-NN`, que já nomeia os
requisitos de backend em `architecture-canvas/spec.md`; sem colisão com nenhum prefixo existente
em `.specs/features/*/spec.md`).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 17 total, 17 mapped to tasks (T1-T3), 0 unmapped

---

## Rotas consumidas

`POST /diagrams/:id/export:mermaid`, `POST /diagrams/:id/export:structurizr`,
`POST /projects/:id/import:mermaid`, `POST /projects/:id/import:structurizr` — todas já
implementadas e verificadas (`apps/server/src/modules/interop/interop.int.spec.ts`, requisitos
`AAC-01/02`); nenhuma mudança de servidor nesta fatia.

---

## Success Criteria

- [ ] Uma pessoa exporta a cena atual como Mermaid ou Structurizr e baixa o arquivo em menos de 2
      cliques a partir do menu de export já existente.
- [ ] Um import Mermaid/Structurizr nunca cria um diagrama sem a pessoa ver o conteúdo do arquivo
      primeiro, mesmo sem prévia server-validada.
- [ ] Nenhuma tela desta fatia esconde uma limitação de round-trip que o servidor relatou.
