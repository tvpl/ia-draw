# Apresentação e protótipos navegáveis — Especificação

Entrada R12 do roadmap de produto (`.specs/features/platform-maturity/ui-roadmap.md`). Montar uma
apresentação a partir de frames do diagrama, reordenar, modo apresentador em tela cheia, publicar
um link imutável, exportar PDF, e navegação de protótipo entre frames. Depende de R11
(`share-links`, fechada) — o link publicado é um link de compartilhamento.

Sessão autônoma, sem humano disponível para confirmar em tempo real. Toda decisão de produto
abaixo foi tomada pelo próprio agente, com o precedente de R7/R9/R11 como guia, e está marcada como
tal na tabela de Assumptions — a única exceção genuinamente sem default razoável está sinalizada em
destaque no final desta seção.

## Problem Statement

O backend de apresentação está inteiro e verificado (`apps/server/src/modules/presentation/`): as
8 rotas de CRUD/reorder (`routes.ts`, T65) e as 3 de publish/read-only-link/PDF-export
(`publishRoutes.ts`, T66) existem, têm testes de integração reais via PGlite
(`presentation.int.spec.ts`, `publish.int.spec.ts`), e aplicam RBAC/IDOR/redação de notas
consistentes com o resto da base. Nada disso tem interface — nenhum arquivo de `apps/web` chama
qualquer uma das 8 rotas do módulo `presentation`, e as 4 superfícies do roadmap (editor de
apresentação, modo presenter, visão publicada, navegação de protótipo) não existem.

R11 já deixou o terreno preparado: `SharedResourcePage` (`/share/:token`, pública, sem sessão) trata
`resourceType: 'presentation'` com um placeholder explícito ("visualização ainda não disponível") em
vez de quebrar — essa é exatamente a lacuna que esta spec fecha, substituindo o placeholder por um
visualizador real quando a apresentação estiver publicada, e preservando o placeholder,
inalterado, quando não estiver (SHR-27/28 continuam válidos como estão).

**Lacuna de protocolo encontrada nesta pesquisa (decidida por este agente, ver Assumptions):**
`GET /share/:token` devolve, para uma apresentação, `{resourceType, role, presentation, frames}` —
nunca a cena. Sem a cena não há o que desenhar num visualizador público: um "visualizador de
frames" de verdade precisa do conteúdo geométrico de cada frame, não só de metadados de posição.
Como o próprio roadmap descreve esta rota como devolvendo "link imutável" e o dado imutável já
existe (`presentations.publishedSnapshotId` → `diagram_snapshots`, criado por `:publish`), a
correção mínima e consistente com o resto do contrato é: quando a apresentação já foi publicada, a
mesma rota pública passa a incluir também `scene` (a cena CONGELADA do snapshot publicado, nunca a
live) e `published: true`; quando não foi publicada, o formato de hoje continua idêntico
(`scene` ausente, sem `published`), preservando os testes de R11 byte a byte. Esta é uma mudança de
backend pequena, no mesmo padrão dos fixes já feitos em R2/R4/R10/R11/R15, e entra em commit próprio
(ver Design).

## Goals

- [ ] Quem pode editar o diagrama cria uma apresentação, monta seus frames a partir de frames reais
      do canvas (ou de um rótulo lógico), reordena, anota, e liga frames entre si por navegação de
      protótipo.
- [ ] Publicar congela a cena atual como um snapshot imutável, e um link de compartilhamento
      (reaproveitando R11) dá acesso público, somente-leitura, a esse conteúdo congelado.
- [ ] Qualquer membro do workspace com `diagram:read` pode abrir um modo apresentador em tela cheia
      dentro do app, navegando frame a frame (teclado ou clique) sobre a cena viva.
- [ ] Exportar a apresentação publicada como PDF, uma página por frame.
- [ ] A visão pública e o modo apresentador compartilham a mesma navegação de protótipo (links de
      frame para frame) e o mesmo rótulo de frame, sem duas implementações divergentes.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Arrastar para reordenar (drag-and-drop) | Botões "mover para cima/baixo" cobrem o mesmo resultado (`PATCH .../frames` em lote), são navegáveis por teclado por padrão, e não adicionam biblioteca de DnD nova. Ver Assumptions |
| Editor de canvas embutido no editor de apresentação (desenhar/mover elementos) | A apresentação referencia frames do diagrama; editar o CONTEÚDO de um frame continua sendo `DiagramEditorPage`. Um mini-canvas duplicaria `EditorSurface` fora do padrão AD-010 |
| Seletor de frame por clique direto no canvas (apontar uma região) | O editor de apresentação lista os elementos `type: 'frame'` da cena viva (via bootstrap) num `<select>`; não existe um segundo canvas interativo só para escolher `elementId`. Ver Assumptions |
| Hotspots de navegação desenhados sobre uma região arbitrária do frame | `navLinksJson` já é `{targetFrameId}[]` — vínculo frame-a-frame. Um hotspot geométrico livre exigiria um novo campo/tabela no servidor, fora do escopo desta fatia |
| Editar `settingsJson.expiresAt` da apresentação (o campo que expira `GET /presentations/:id/published`) | O mecanismo de distribuição pública desta fatia é o link de compartilhamento (R11, com seu próprio `expiresAt`/revogação). Expor os dois mecanismos de expiração juntos confundiria mais do que ajudaria; `settingsJson` fica editável só via o servidor, sem controle de UI |
| Progresso assíncrono / polling da exportação de PDF | `publish.int.spec.ts` prova que `:export-pdf` responde `200` síncrono com `{url, sizeBytes, pageCount}` — não há job nem status a consultar. A UI trata como uma requisição síncrona com estado de carregamento |
| Colaboração em tempo real no editor de apresentação (dois editores montando frames ao mesmo tempo) | Nenhuma infraestrutura de presença/WS cobre `presentation_frames` hoje; fora do escopo desta fatia (poderia ser uma R futura, mesmo padrão de F4) |
| Modo apresentador espelhado/sincronizado entre viewers ("seguir o apresentador") | O roadmap pede "modo presenter em tela cheia" para quem apresenta, não um canal de broadcast entre audiência. Fora de escopo — ver Assumptions |
| Listar apresentações de todos os diagramas de um workspace num único lugar | `GET /presentations` exige `diagramId` na query — não existe rota de listagem cross-diagrama. A lista vive dentro do diagrama, mesmo padrão de `LibraryPanel`/`HistoryPanel` |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde o editor de apresentação vive nas rotas | Duas rotas novas, irmãs de `/inventory` (mesmo padrão T8/component-library): `/w/:workspaceId/d/:diagramId/present` (lista + criar) e `/w/:workspaceId/d/:diagramId/present/:presentationId` (editor de frames) | `DiagramEditorPage` já é o arquivo mais contestado desta rodada (aviso explícito do orquestrador) — uma rota nova e pequena, análoga a `/inventory`, mantém o diff nesse arquivo mínimo (um link a mais), em vez de inflar o layout de 3 colunas existente | agente |
| Onde o modo apresentador vive | Rota própria, `/w/:workspaceId/d/:diagramId/present/:presentationId/presenter`, autenticada (`ProtectedRoute`), fora do layout de 3 colunas — tela cheia de verdade | "Tela cheia" no roadmap decidiu isto: um modo dentro do editor de apresentação nunca fica genuinamente cheio enquanto a barra lateral/`AppShell` existem. Uma rota própria, sem `AppShell`, resolve sem CSS de overlay frágil | agente |
| Fonte do `elementId` ao adicionar um frame | Um `<select>` alimentado pelos elementos `type: 'frame'` da cena viva do diagrama (buscada 1x via o mesmo `DiagramSyncClient.bootstrap()` já usado por `DiagramEditorPage`), com uma opção alternativa de texto livre que vira `frameId` (rótulo lógico, sem `elementId`) | O schema (`packages/database/src/schema.ts:558-567`) já documenta esse par: `elementId` referencia um frame real do Excalidraw (usado por `exportPdf.ts` pra recortar a cena), `frameId` é um rótulo lógico livre para quando não há frame geométrico. A UI espelha exatamente essa dualidade em vez de inventar um terceiro conceito | agente |
| Reorder por botão em vez de arrastar | Botões "▲"/"▼" por linha, cada clique emite o PATCH de lote imediatamente (sem estado "salvar" separado) | Ver Out of Scope. Menor superfície de teste, acessível por teclado sem trabalho extra, e usa a MESMA rota (`PATCH .../frames`, bulk) que um DnD usaria de qualquer forma | agente |
| Notas de frame na interface | Sempre passadas adiante exatamente como o servidor devolveu — nunca uma segunda checagem de papel no cliente. Quando o servidor já redigiu (`notes: null`), o campo de notas simplesmente não aparece (nunca um campo vazio enganoso) | O servidor já é a autoridade de redação (PRS-01/03, testado em `presentation.int.spec.ts`); duplicar a checagem no cliente arriscaria os dois lados divergirem. Mesmo princípio que `ShareLinkPanel` já segue para papel/permissão | agente |
| Gate de "criar link de compartilhamento" antes de publicar | Soft gate: o botão de criar link fica desabilitado com uma frase explicando o motivo até a primeira publicação bem-sucedida; o servidor não impõe essa ordem (`POST /presentations/:id/share-links` não checa `publishedSnapshotId`) | Distribuir um link para uma apresentação nunca publicada só mostraria o placeholder "ainda não disponível" pro visitante — pedir a publicação primeiro evita esse resultado confuso sem inventar uma regra no servidor que não existe | agente |
| **Republicar troca o conteúdo por trás de um link já distribuído?** | **Sim, silenciosamente — e a interface avisa isso explicitamente antes de confirmar uma republicação.** Todo link de compartilhamento aponta para `resourceId = presentationId`, nunca para um `snapshotId` específico (`shareLinks.resourceId` é polimórfico só por `resourceType`, `share/routes.ts:74-82`); a rota pública sempre lê `presentation.publishedSnapshotId` — o ponteiro MAIS RECENTE — no momento do acesso. Não há, no contrato atual, como fixar um link a um snapshot histórico específico sem uma coluna nova em `share_links` (mudança de schema, além do que esta fatia trata como "pequena adição") | Escolhido para não expandir o contrato do servidor; a interface compensa tornando o comportamento visível (rótulo "Republicado em: ..." + aviso) em vez de escondê-lo. **Sinalizado no relatório final como decisão que merece confirmação humana** — um produto de apresentações poderia razoavelmente esperar o oposto (link = versão congelada no momento em que foi CRIADO) | **não — flagged** |
| Papel exigido pra abrir o modo apresentador | `diagram:read` (qualquer membro do workspace, igual `GET /presentations/:id`) — não exige `diagram:mutate` | Um `viewer`/`reviewer` já pode ler a apresentação (`presentation.int.spec.ts` prova GET 200 pra reviewer); apresentar para um público interno é um caso de uso de leitura, não de edição. Notas de frame continuam redigidas pelo servidor pra quem não edita, então não há vazamento | agente |
| Rótulo de um frame sem título (schema não tem campo de título) | `t('presentation.frameLabel', {position})` → "Frame {{position}}" (1-based) como base; quando o frame tem `frameId` (rótulo lógico), o rótulo lógico é mostrado entre parênteses. Mesmo rótulo nos dois lugares que precisam nomear um frame (editor, presenter, visão pública) | `FrameRow` não tem `title` (mesma constatação que R11 já registrou). Um componente de rótulo único (`frameLabel.ts`) evita duas strings divergentes | agente |
| PDF exige apresentação publicada | Sim — reflete o servidor (`exportPresentationPdf` chama `getPublishedPresentation` por baixo, 404 se não publicado). O botão de exportar fica desabilitado com essa explicação até a primeira publicação | Não há novo contrato aqui — só refletir o que `publish.int.spec.ts` já prova (`:export-pdf antes de :publish` → 404) | agente |
| Como o modo apresentador ajusta o viewport por frame | Novo método aditivo no handle imperativo `EditorSurfaceHandle` (AD-010): `scrollToFrame(elementId: string \| null)`, que filtra a cena local pelos mesmos critérios de `exportPdf.ts` (`frameId === elementId \|\| id === elementId`) e chama a API real de viewport do Excalidraw (`scrollToContent`) sobre esse subconjunto; frame lógico (sem `elementId`) é no-op (mesmo fallback documentado no servidor: mostra a cena inteira) | Seguir AD-010 ao pé da letra: estender o handle existente, nunca montar um segundo `<Excalidraw/>` ou duplicar lógica de recorte — a MESMA regra de "quais elementos pertencem a este frame" já vive no servidor (`exportPdf.ts`), replicada aqui só para decidir viewport, nunca para decidir o que é exportado | agente |
| Navegação de protótipo por clique | Cada frame com `navLinksJson` não vazio mostra um botão por link ("Ir para: {{label do frame alvo}}") tanto no presenter quanto na visão pública publicada; clicar pula direto pro frame alvo (fora da sequência anterior/próximo) | É a interpretação mais direta de `navLinksJson: {targetFrameId}[]` — o campo já existe e já é validado no servidor (`InvalidNavLinkError`); a interface só precisa oferecê-lo como afordance clicável | agente |

**Open questions:** uma sinalizada para decisão humana — a semântica de "republicar troca o link" acima —
ver linha em negrito. O agente seguiu o contrato do servidor como está (nenhuma mudança de schema),
mas o produto poderia preferir versões pinadas por link; isso exigiria uma coluna
`share_links.pinned_snapshot_id` (ou equivalente) fora do escopo desta fatia.

---

## User Stories

### P1: Criar uma apresentação e montar seus frames ⭐ MVP

**User Story**: Como pessoa que pode editar o diagrama, quero criar uma apresentação e escolher
quais frames do canvas entram nela, para montar um roteiro a partir do que já desenhei.

**Why P1**: Sem isto não existe apresentação nenhuma — é a base de todo o resto da fatia.

**Acceptance Criteria**:
1. The rota `/w/:workspaceId/d/:diagramId/present` SHALL listar as apresentações do diagrama (`GET /presentations?diagramId=`) para qualquer papel com `diagram:read`.
2. The controle de criar apresentação SHALL aparecer somente quando `mutatePermissions.allowed` do bootstrap for verdadeiro.
3. WHEN o usuário confirmar o formulário de criação com um nome THEN a tela SHALL emitir `POST /presentations` com `{diagramId, name}`.
4. WHEN a resposta for `201` THEN a tela SHALL navegar para `/w/:workspaceId/d/:diagramId/present/:presentationId` da apresentação recém-criada.
5. The editor de apresentação SHALL listar os frames existentes (`GET /presentations/:id`) em ordem de `position`.
6. WHEN o usuário adicionar um frame escolhendo um elemento `type: 'frame'` da cena viva OU digitando um rótulo lógico THEN a tela SHALL emitir `POST /presentations/:id/frames` com `elementId` OU `frameId` preenchido (nunca os dois) e `position` igual ao tamanho atual da lista.
7. IF nem um frame do canvas for escolhido nem um rótulo lógico for digitado THEN a tela SHALL bloquear o envio, sem emitir `POST /presentations/:id/frames`.
8. WHEN a resposta de adicionar frame for `201` THEN a tela SHALL inserir o novo frame ao final da lista exibida.
9. WHEN o usuário editar as notas de um frame (papel com `diagram:mutate`) e salvar THEN a tela SHALL emitir `PATCH /presentations/:id/frames/:frameId` com `{notes}`.
10. WHEN o usuário remover um frame e confirmar THEN a tela SHALL emitir `DELETE /presentations/:id/frames/:frameId`, e SHALL retirá-lo da lista somente após `204`.
11. IF qualquer uma das chamadas de criar/editar/remover frame falhar (403/404/400) THEN a tela SHALL exibir uma mensagem de erro e SHALL manter a lista exibida inalterada.
12. The campo de notas SHALL não aparecer para um papel sem `diagram:mutate` — nunca um campo vazio no lugar de um campo redigido.

**Independent Test**: Como `editor`, criar uma apresentação, adicionar um frame lógico
("Visão geral") e um frame referenciando um `frame` real do canvas, e confirmar que ambos aparecem
na ordem de criação com a fonte correta preservada no corpo da requisição.

---

### P1: Reordenar frames

**User Story**: Como pessoa que monta a apresentação, quero mudar a ordem dos frames, para contar a
história na sequência certa.

**Why P1**: A ordem É o roteiro — sem reordenar, a apresentação fica presa à ordem de criação.

**Acceptance Criteria**:
13. The lista de frames SHALL oferecer um controle "mover para cima" e um "mover para baixo" por linha, cada um alcançável só por teclado.
14. WHEN o usuário mover um frame THEN a tela SHALL emitir `PATCH /presentations/:id/frames` com o array completo `{id, position}` recalculado para refletir a nova ordem.
15. IF o frame já estiver na primeira posição THEN o controle "mover para cima" SHALL ficar desabilitado (e o simétrico para "mover para baixo" na última posição).
16. WHEN a resposta do reorder for `200` THEN a tela SHALL renderizar a lista na ordem devolvida pelo servidor.
17. IF a resposta do reorder falhar THEN a tela SHALL reverter a ordem exibida para a última ordem confirmada pelo servidor.

**Independent Test**: Com 3 frames, mover o último para o topo e confirmar que o corpo do PATCH
contém as 3 posições recalculadas, não só a do frame movido.

---

### P1: Configurar navegação de protótipo entre frames

**User Story**: Como pessoa que monta a apresentação, quero ligar um frame a outro por um clique, para
simular um fluxo navegável (protótipo), não só uma sequência linear.

**Why P1**: É o que separa "apresentação" de "slideshow linear" — o roadmap chama isto de
"protótipos navegáveis" explicitamente.

**Acceptance Criteria**:
18. The editor de cada frame SHALL oferecer a escolha de 0 ou mais OUTROS frames da mesma apresentação como alvo de navegação.
19. WHEN o usuário salvar os links de navegação de um frame THEN a tela SHALL emitir `PATCH /presentations/:id/frames/:frameId` com `{navLinksJson: [{targetFrameId}, ...]}`.
20. IF a resposta for `400` (link para um frame que não existe mais na apresentação) THEN a tela SHALL exibir o erro e SHALL manter os links previamente salvos exibidos, sem os descartar.
21. The lista de alvos disponíveis SHALL nunca incluir o próprio frame que está sendo editado.

**Independent Test**: Configurar um link do frame 1 para o frame 3, remover o frame 3, e confirmar
que a interface segue mostrando o vínculo salvo até uma nova tentativa de salvar apontar o erro
`400` do servidor.

---

### P1: Publicar a apresentação como link imutável

**User Story**: Como pessoa que pode editar o diagrama, quero publicar a apresentação e obter um
link público, para compartilhar um roteiro fechado com alguém de fora do workspace.

**Why P1**: É o mecanismo de distribuição — sem publicar, a apresentação nunca sai do workspace.

**Acceptance Criteria**:
22. The controle de publicar SHALL aparecer somente quando `diagram:mutate` for verdadeiro.
23. WHEN o usuário confirmar publicar THEN a tela SHALL emitir `POST /presentations/:id:publish`.
24. WHEN a resposta for `200` THEN a tela SHALL exibir um estado "publicado" (com `publishedSnapshotId` presente) e o botão SHALL passar a ler "republicar".
25. WHEN o usuário republicar uma apresentação já publicada THEN a tela SHALL exibir um aviso explícito, antes de confirmar, de que qualquer link de compartilhamento já distribuído passará a mostrar o novo conteúdo.
26. WHEN a apresentação estiver publicada (`publishedSnapshotId` presente) THEN o controle de criar link de compartilhamento (reaproveitando o padrão de `ShareLinkPanel`, mas contra `POST /presentations/:id/share-links`) SHALL ficar habilitado; SHALL ficar desabilitado, com texto explicando o motivo, antes da primeira publicação.
27. WHEN o usuário criar um link de compartilhamento de apresentação com papel e expiração válidos THEN a tela SHALL emitir `POST /presentations/:id/share-links` com `{role, expiresAt}` e, em `201`, SHALL exibir a URL completa (`${origin}/share/${token}`) exatamente uma vez, com o mesmo aviso de revelação única de R11.
28. IF a resposta de criar link de apresentação for `403` THEN a tela SHALL informar que o papel pedido excede o próprio papel do usuário, mesma mensagem de R11.

**Independent Test**: Publicar uma apresentação vazia (0 frames), confirmar que o botão de publicar
funciona mesmo assim (o servidor permite), e que o botão de exportar PDF permanece desabilitado
com uma explicação (0 frames).

---

### P1: A visão pública mostra os frames publicados

**User Story**: Como pessoa que recebeu um link público de apresentação, quero navegar pelos frames
publicados sem conta nenhuma, para ver o roteiro que me foi compartilhado.

**Why P1**: É o outro lado do link — publicar sem um visualizador público não entrega nada a quem
recebe o link.

**Acceptance Criteria**:
29. WHEN `GET /share/:token` responder `200` com `resourceType: 'presentation'` e `scene` presente (apresentação publicada) THEN `/share/:token` SHALL renderizar o visualizador de frames: um frame por vez, recortado da cena congelada, num `EditorSurface` com `viewModeEnabled` sempre `true`.
30. IF `scene` estiver ausente (apresentação ainda não publicada) THEN `/share/:token` SHALL continuar exibindo exatamente o placeholder existente de R11 ("visualização ainda não disponível"), sem nenhuma mudança visível.
31. The visualizador público SHALL oferecer navegação anterior/próximo entre frames e SHALL indicar a posição atual (ex.: "Frame 2 de 5").
32. The visualizador público SHALL nunca renderizar `notes` de frame nenhum, mesmo quando presentes na resposta (mantém SHR-28).
33. WHEN o usuário clicar num link de navegação de protótipo (frame com `navLinksJson`) THEN o visualizador SHALL pular diretamente para o frame alvo.
34. The navegação inteira dentro do visualizador público (trocar de frame, seguir um link de protótipo) SHALL não emitir nenhuma requisição de rede adicional além da `GET /share/:token` já feita no mount (mesmo princípio de SHR-21).

**Independent Test**: Responder `GET /share/:token` com uma apresentação publicada de 3 frames e um
`navLinksJson` do frame 1 para o frame 3; clicar no link de protótipo e confirmar que o frame 3
aparece sem nenhuma chamada de rede nova.

---

### P1: Modo apresentador em tela cheia

**User Story**: Como pessoa com acesso de leitura ao diagrama, quero abrir um modo de apresentação em
tela cheia dentro do app, para apresentar o roteiro ao vivo sem sair pro link público.

**Why P1**: É a superfície interna equivalente ao link público — o roadmap pede explicitamente
"modo presenter em tela cheia" como capacidade distinta de "publicar".

**Acceptance Criteria**:
35. The rota `/w/:workspaceId/d/:diagramId/present/:presentationId/presenter` SHALL exigir sessão (`ProtectedRoute`) e `diagram:read`, sem exigir `diagram:mutate`.
36. WHEN o modo apresentador montar THEN a tela SHALL carregar a cena VIVA do diagrama (não a publicada) via o mesmo bootstrap já usado por `DiagramEditorPage`, e SHALL montar `EditorSurface` com `viewModeEnabled` sempre `true`.
37. WHEN o modo apresentador exibir um frame THEN a tela SHALL ajustar o viewport do canvas para aquele frame via o novo método `scrollToFrame` do handle `EditorSurfaceHandle` (AD-010).
38. The modo apresentador SHALL responder às teclas de seta direita/`PageDown`/`Space` (próximo) e seta esquerda/`PageUp` (anterior), além de controles em tela equivalentes por clique.
39. WHEN a tecla `Escape` for pressionada OU o controle de sair for clicado THEN a tela SHALL navegar de volta para `/w/:workspaceId/d/:diagramId/present/:presentationId`.
40. IF o frame atual tiver `navLinksJson` THEN o modo apresentador SHALL oferecer um controle por link, e clicar nele SHALL pular direto para o frame alvo (fora da sequência anterior/próximo).
41. IF a apresentação tiver 0 frames THEN o controle de abrir o modo apresentador SHALL ficar desabilitado, com texto explicando o motivo.

**Independent Test**: Abrir o modo apresentador de uma apresentação de 4 frames como `viewer`,
navegar até o último frame só de teclado, confirmar que "próximo" fica desabilitado, e sair com
`Escape`.

---

### P2: Exportar PDF

**User Story**: Como pessoa que pode editar o diagrama, quero exportar a apresentação publicada como
PDF, para levar o roteiro para fora do produto (impressão, anexo de e-mail).

**Why P2**: Depende de publicar já ter acontecido; não é o caminho crítico da fatia, mas é escopo
explícito do roadmap.

**Acceptance Criteria**:
42. The controle de exportar PDF SHALL ficar desabilitado, com texto explicando o motivo, quando a apresentação não estiver publicada OU tiver 0 frames.
43. WHEN o usuário confirmar exportar (apresentação publicada, ≥1 frame) THEN a tela SHALL emitir `POST /presentations/:id:export-pdf` e SHALL exibir um estado de carregamento até a resposta.
44. WHEN a resposta for `200` THEN a tela SHALL exibir um link para `url` (abre em nova aba) junto de `pageCount`, sem iniciar download nenhum por conta própria.
45. IF a resposta for `400`/`404`/erro genérico THEN a tela SHALL exibir uma mensagem específica por caso, sem deixar o controle preso em carregamento.

**Independent Test**: Publicar uma apresentação de 3 frames, exportar, e confirmar que o link exibido
aponta para a `url` devolvida e que `pageCount` mostrado é 3.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero montar, publicar, apresentar
e navegar a apresentação sem mouse.

**Why P2**: Mesmo padrão estabelecido por toda fatia anterior desta frente (R9/R10/R11).

**Acceptance Criteria**:
46. The toda ação desta spec (criar/editar/remover/reordenar frame, configurar navegação de protótipo, publicar, criar link, exportar, navegar no presenter e na visão pública) SHALL ser alcançável só por teclado.
47. WHEN uma ação assíncrona desta spec completar, com sucesso ou falha (criar/editar/remover frame, reorder, publicar, exportar, criar/revogar link de apresentação) THEN a tela SHALL anunciar o resultado numa região `aria-live="polite"` — asserido pelo atributo `aria-live` presente no DOM, não só pelo texto renderizado.
48. The todo texto visível desta spec, nas 4 superfícies, SHALL vir de chaves de i18n nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Montar uma apresentação de 2 frames, publicar, e navegar o modo apresentador
inteiro usando só Tab/Enter/setas, com o locale trocado para `en`.

---

## Edge Cases

- IF `POST /presentations` falhar (rede ou status inesperado) THEN a tela de criar apresentação SHALL exibir erro genérico, sem navegar para rota nenhuma.
- WHILE uma requisição de criar/editar/remover frame estiver em andamento, um segundo envio do MESMO formulário SHALL não emitir uma segunda requisição.
- IF o mesmo link de compartilhamento de apresentação for revogado duas vezes THEN a segunda revogação SHALL ser tratada como sucesso (rota idempotente), mesmo comportamento de R11.
- WHEN a apresentação tiver exatamente 1 frame THEN o modo apresentador e a visão pública SHALL desabilitar tanto "anterior" quanto "próximo" (nada para onde navegar linearmente), mas SHALL continuar respeitando links de navegação de protótipo se existirem.
- IF `GET /presentations/:id` (editor) ou `GET /share/:token` (visão pública) falhar por erro de rede THEN a tela SHALL exibir mensagem de falha genérica, sem retry automático.
- WHEN um frame referenciar um `elementId` que não existe mais na cena viva (frame do canvas apagado depois) THEN o modo apresentador SHALL cair no mesmo fallback documentado do servidor (mostrar a cena inteira) em vez de travar ou mostrar um erro.
- IF a apresentação publicada tiver `scene: []` (diagrama vazio) THEN a visão pública SHALL renderizar o canvas vazio para cada frame, nunca a mensagem de link inválido.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| PRZ-01 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-02 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-03 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-04 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-05 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-06 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-07 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-08 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-09 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-10 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-11 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-12 | P1: Criar apresentação e montar frames | F12 | ✅ Verified |
| PRZ-13 | P1: Reordenar frames | F12 | ✅ Verified |
| PRZ-14 | P1: Reordenar frames | F12 | ✅ Verified |
| PRZ-15 | P1: Reordenar frames | F12 | ✅ Verified |
| PRZ-16 | P1: Reordenar frames | F12 | ✅ Verified |
| PRZ-17 | P1: Reordenar frames | F12 | ✅ Verified |
| PRZ-18 | P1: Navegação de protótipo (configuração) | F12 | ✅ Verified |
| PRZ-19 | P1: Navegação de protótipo (configuração) | F12 | ✅ Verified |
| PRZ-20 | P1: Navegação de protótipo (configuração) | F12 | ✅ Verified |
| PRZ-21 | P1: Navegação de protótipo (configuração) | F12 | ✅ Verified |
| PRZ-22 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-23 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-24 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-25 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-26 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-27 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-28 | P1: Publicar link imutável | F12 | ✅ Verified |
| PRZ-29 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-30 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-31 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-32 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-33 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-34 | P1: Visão pública dos frames | F12 | ✅ Verified |
| PRZ-35 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-36 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-37 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-38 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-39 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-40 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-41 | P1: Modo apresentador em tela cheia | F12 | ✅ Verified |
| PRZ-42 | P2: Exportar PDF | F12 | ✅ Verified |
| PRZ-43 | P2: Exportar PDF | F12 | ✅ Verified |
| PRZ-44 | P2: Exportar PDF | F12 | ✅ Verified |
| PRZ-45 | P2: Exportar PDF | F12 | ✅ Verified |
| PRZ-46 | P2: Teclado e idioma | F12 | ✅ Verified |
| PRZ-47 | P2: Teclado e idioma | F12 | ✅ Verified |
| PRZ-48 | P2: Teclado e idioma | F12 | ✅ Verified |

**ID format:** `[CATEGORY]-[NUMBER]`

O prefixo `PRZ` não colide com nenhum já usado no repositório (verificado por busca): AAC, AGT, AIC,
AIE, AIG, API, AUTH, CIQ, CLB, CLIB, CMT, DOC, DOCK, DR, EDT, EXP, EXT, FND, GOV, LIB, LNT, MCP, MEM,
NAV, OBS, OIDC, OPS, PERF, **PRS** (já usado pelo backend em `architecture-canvas/spec.md` — por
isso esta spec NÃO reusa `PRS`), REC, SEC, SNAP, SSO, TRU, UIX, VER, XPRT.

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 48 requisitos, mapeados 1:1 às 48 acceptance criteria das oito histórias.

---

## Rotas consumidas

| Rota | Uso | Mudança nesta spec |
| --- | --- | --- |
| `POST /presentations` | criar apresentação | Nenhuma |
| `GET /presentations` | listar apresentações do diagrama | Nenhuma |
| `GET /presentations/:id` | editor de apresentação, presenter (permissões/frames) | Nenhuma |
| `PATCH /presentations/:id` | (reservado — sem controle de UI nesta fatia, ver Out of Scope) | Nenhuma, **não consumida** por esta fatia |
| `POST /presentations/:id/frames` | adicionar frame | Nenhuma |
| `PATCH /presentations/:id/frames` | reorder em lote | Nenhuma |
| `PATCH /presentations/:id/frames/:frameId` | editar notas/navLinksJson de um frame | Nenhuma |
| `DELETE /presentations/:id/frames/:frameId` | remover frame | Nenhuma |
| `POST /presentations/:id:publish` | publicar/republicar | Nenhuma |
| `GET /presentations/:id/published` | (reservado — a visão pública usa `GET /share/:token`, não esta rota autenticada; ver Design) | Nenhuma, **não consumida** por esta fatia |
| `POST /presentations/:id:export-pdf` | exportar PDF | Nenhuma |
| `POST /presentations/:id/share-links` | criar link público de apresentação | Nenhuma |
| `GET /share/:token` | resolver link público (diagrama OU apresentação) | **Ramo `resourceType: 'presentation'` ganha `scene`/`published` quando publicada — mudança de backend desta fatia, ver Problem Statement/Design** |

O roadmap lista 7 rotas para R12; esta spec consome 8 rotas existentes do backend (7 do roadmap +
`POST /presentations/:id/share-links`, que R11 documentou como "fica com R12"), mais uma mudança de
contrato pequena e aditiva na rota pública de R11. `GET /presentations/:id/published` (rota
autenticada) fica sem consumidor nesta fatia — a visão pública usa a rota pública de R11, e o
editor/presenter usam a cena VIVA (`GET /presentations/:id` + bootstrap do diagrama), nunca essa
rota; documentado como decisão de Design.

---

## Success Criteria

- [ ] Uma pessoa com `diagram:mutate` cria uma apresentação, monta e reordena frames, e publica —
      provado por teste de integração ponta a ponta na tela (não só por chamada de cliente isolada).
- [ ] Um link de apresentação publicado abre em `/share/:token` sem sessão nenhuma e mostra o
      frame correto, navegável, sem vazar `notes` — provado sem `AuthProvider` montado.
- [ ] O modo apresentador abre para um `viewer`, navega por teclado, e nunca emite uma mutação
      (nenhuma chamada de escrita partindo dessa rota).
- [ ] `repo-tools audit` deixa de classificar as 8 rotas do módulo `presentation` (mais
      `POST /presentations/:id/share-links`) como `pending-product`.
- [ ] Toda a fatia é percorrível só com teclado, nos dois locales.
