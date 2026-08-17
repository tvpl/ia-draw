# Histórico, snapshots e diff — Especificação

Sexta fatia vertical do roadmap de produto (entrada R6 de
`.specs/features/platform-maturity/ui-roadmap.md`). Entrega a linha do tempo de um diagrama dentro
do próprio editor: ver snapshots, criar um nomeado, comparar duas revisões e restaurar como
revisão nova — sem apagar nada do que veio depois.

## Problem Statement

O backend de versionamento está implementado e verificado (`snapshot.int.spec.ts`,
`restore.int.spec.ts`, requisitos `VER-01..04` de `architecture-canvas/spec.md`): snapshots
automáticos (`auto`), nomeados (`named`), de pré-IA (`pre_ai`, imutável) e de ponto de restauração
(`restore_point`) já existem em `diagram_snapshots`; `POST .../:snapshotId:restore` sempre cria uma
revisão nova (nunca sobrescreve o que veio depois); `GET .../diff` compara duas revisões ou
snapshots por id estruturalmente (`added`/`removed`/`moved`/`modified`, por `elementId`). Nada
disso tem interface — a única forma hoje de ver ou restaurar uma revisão anterior é uma chamada de
API manual.

Uma decisão de desenho, não uma lacuna do servidor: como `POST .../:snapshotId:restore` aplica a
mudança à mesma sessão de diagrama que pode estar aberta no editor agora, e o editor já expõe
`EditorSurfaceHandle.applyRemoteScene` (AD-010, o mesmo mecanismo que `AiDock` usa pra aprovar uma
edição de IA sem descartar trabalho local em andamento), **esta fatia vive como um painel lateral
dentro de `DiagramEditorPage`** — não uma rota separada — para poder refletir o resultado de um
restore direto no canvas aberto, em vez de exigir um reload de página.

## Goals

- [ ] Uma pessoa com acesso de leitura vê a linha do tempo completa de snapshots de um diagrama,
      distinguindo os automáticos dos nomeados e dos de pré-IA.
- [ ] Uma pessoa com permissão de escrita cria um snapshot nomeado a qualquer momento.
- [ ] Uma pessoa com permissão de escrita restaura qualquer revisão anterior como uma revisão
      nova, com aviso claro de que é uma ação que aparece na própria linha do tempo (nunca
      apagando histórico).
- [ ] Uma pessoa vê, em texto simples, o que mudou entre duas revisões antes de decidir restaurar.

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Apagar/arquivar um snapshot | Não existe rota `DELETE` para snapshot — só `POST` (criar/restaurar) e `GET` (listar/diff) |
| Editar o `name` de um snapshot já criado | Não existe rota `PATCH` para snapshot |
| Diff visual (renderizar as duas cenas lado a lado no canvas) | `GET .../diff` devolve só ids categorizados (`added`/`removed`/`moved`/`modified`), sem geometria comparativa — um diff visual pixel-a-pixel exigiria renderizar duas cenas simultâneas, fora do orçamento desta fatia |
| Comparar snapshots de diagramas diferentes | A rota compara duas revisões/snapshots do mesmo `diagramId` |
| Publicar snapshot (`kind: 'published'`) pela UI | Nenhuma rota de escrita expõe `kind` como parâmetro — `POST .../snapshots` sempre cria `kind: 'named'` (`createSnapshotBodySchema` só aceita `name`) |
| Rollback automático/agendado | Toda restauração desta fatia é uma ação explícita da pessoa, nunca automática |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde o painel vive | Dentro de `DiagramEditorPage`, como painel lateral (mesmo padrão de `AiDock`/`CLIB`), não rota própria | Restore precisa refletir no canvas aberto via `applyRemoteScene` (AD-010); uma rota separada exigiria um reload ou um segundo mecanismo de sincronização | y (decisão técnica — grounded em AD-010, não produto) |
| Rótulo de cada `kind` de snapshot na lista | `auto` → "Automático", `named` → nome escolhido pela pessoa (ou "Snapshot sem nome" se `name` for `null`), `pre_ai` → "Antes da edição por IA", `restore_point` → "Ponto de restauração", `published` → "Publicado" | Todos os 5 `kind`s aparecem misturados na mesma lista (`listSnapshots` não filtra por kind); a pessoa precisa distinguir a origem de cada entrada sem ler código | y |
| `clientMutationId` do restore | Gerado uma vez no cliente por tentativa de restore (`crypto.randomUUID()`) e reenviado como o mesmo valor se a pessoa clicar de novo antes da resposta anterior voltar | A rota aceita `clientMutationId` opcional pra idempotência; reenviar o mesmo valor numa dupla-submissão evita duas restaurações da mesma intenção — mesmo padrão de proteção contra duplo-clique já implícito no design do backend | y |
| Depois de um restore bem-sucedido | Painel mostra confirmação com o novo número de revisão (`currentRevision` da resposta) e a lista de snapshots recarrega (a própria restauração pode ter criado um `restore_point` novo, dependendo do backend) | O backend é a fonte de verdade de quando um `restore_point` é criado; o cliente não assume, só relista | y |
| Elemento referenciado num diff que não existe em nenhuma das duas cenas legíveis pela UI (ex. removido em ambas há mais tempo) | Nunca acontece por construção — `added`/`removed`/`moved`/`modified` só listam ids presentes em pelo menos uma das duas cenas comparadas — não é um caso a tratar | n/a — resolvido por leitura do código (`structuralDiff.ts`), não é uma decisão de produto | y |

**Open questions:** none — todas resolvidas ou registradas acima.

---

## User Stories

### P1: Ver a linha do tempo e criar um snapshot nomeado ⭐ MVP

**User Story**: Como pessoa com acesso ao diagrama, quero ver o histórico de snapshots e criar um
com nome quando eu quiser marcar um ponto importante, para poder voltar a ele depois.

**Why P1**: Sem visão da linha do tempo, restaurar e comparar não têm de onde partir.

**Acceptance Criteria**:

1. WHEN o painel de histórico abrir THEN o sistema SHALL listar via `GET /diagrams/:id/snapshots` cada snapshot com seu rótulo de `kind` (Assumptions), `name` quando houver, e data de criação, ordenados do mais recente pro mais antigo.
2. IF `role` do usuário conceder `diagram:mutate` THEN o sistema SHALL exibir a ação "criar snapshot nomeado", oculta para quem só tem `diagram:read`.
3. WHEN a pessoa criar um snapshot com um nome preenchido THEN o sistema SHALL enviar `POST /diagrams/:id/snapshots` com aquele `name` e inserir o novo snapshot no topo da lista a partir da resposta (`201`), sem esperar um novo `GET`.
4. WHEN a pessoa criar um snapshot sem preencher nome THEN o sistema SHALL enviar a requisição sem o campo `name` (o servidor aceita `name` ausente).
5. IF a lista estiver vazia (diagrama sem nenhum snapshot ainda) THEN o sistema SHALL exibir um estado vazio explicando que snapshots automáticos aparecem conforme o diagrama é editado.

**Independent Test**: Abrir um diagrama com pelo menos um snapshot automático existente, ver a linha do tempo, criar um snapshot nomeado "checkpoint", confirmar que ele aparece no topo com esse nome.

---

### P1: Restaurar uma revisão anterior

**User Story**: Como pessoa com permissão de escrita, quero restaurar um snapshot anterior sem
perder o trabalho feito depois dele, para poder corrigir um erro sem medo de destruir histórico.

**Why P1**: É o valor central da fatia — ver histórico sem poder agir sobre ele é só um log.

**Acceptance Criteria**:

1. WHEN a pessoa clicar em "restaurar" num snapshot THEN o sistema SHALL exibir um diálogo de confirmação nomeando explicitamente que a ação cria uma revisão nova (nunca apaga as revisões intermediárias) — mesmo padrão nativo de `<dialog>` já usado por `ConfirmArchiveDialog` (R3).
2. WHEN a confirmação for aceita THEN o sistema SHALL enviar `POST .../:snapshotId:restore` com um `clientMutationId` gerado no cliente (Assumptions).
3. IF a resposta for `200` THEN o sistema SHALL aplicar a cena restaurada ao canvas aberto via `EditorSurfaceHandle.applyRemoteScene` e exibir a nova `currentRevision`.
4. IF a resposta for `404` (snapshot inexistente — ex. outra aba já teve uma condição de corrida) THEN o sistema SHALL informar que o snapshot não existe mais e atualizar a lista.
5. IF `role` não conceder `diagram:mutate` THEN o sistema SHALL não exibir a ação de restaurar, só a de visualizar/diff.

**Independent Test**: Criar um snapshot nomeado, editar o diagrama (adicionar um elemento), restaurar o snapshot nomeado, confirmar que o canvas volta ao estado anterior e que uma nova entrada de revisão aparece na linha do tempo — sem que o elemento adicionado (agora "no futuro" da restauração) tenha sido apagado do histórico.

---

### P2: Comparar duas revisões

**User Story**: Como pessoa com acesso de leitura, quero ver o que mudou entre duas revisões antes
de decidir restaurar, para não restaurar às cegas.

**Why P2**: Enriquece a decisão de restaurar, mas o fluxo P1 já funciona sem diff — é possível
restaurar direto pelo nome/data do snapshot.

**Acceptance Criteria**:

1. WHEN a pessoa selecionar dois pontos da linha do tempo (revisão ou snapshot) e pedir "comparar" THEN o sistema SHALL chamar `GET /diagrams/:id/diff?from=&to=` e exibir os elementos agrupados em quatro listas: adicionados, removidos, movidos, modificados — cada item pelo seu `elementId`.
2. IF as quatro listas vierem vazias THEN o sistema SHALL exibir "nenhuma mudança estrutural entre essas duas revisões", nunca uma tela em branco sem explicação.
3. IF `from`/`to` resolver para um valor que não é nem revisão nem snapshot conhecido THEN o sistema SHALL exibir a mensagem de erro devolvida pelo `404` sem quebrar o painel.

**Independent Test**: Comparar a revisão inicial de um diagrama com a atual após duas edições, confirmar que os elementos adicionados aparecem na lista correta.

---

### P2: Operável por teclado e nos dois idiomas

**User Story**: Como pessoa que usa leitor de tela ou só teclado, quero abrir o histórico, criar,
restaurar e comparar sem mouse.

**Why P2**: Mesmo padrão já estabelecido por `ai-dock`, `sso-sign-in` e `workspace-navigation`
nesta frente.

**Acceptance Criteria**:

1. The toda ação desta spec (abrir painel, criar snapshot, restaurar, confirmar, comparar) SHALL ser alcançável só por teclado.
2. WHEN uma criação ou restauração completar (sucesso ou falha) THEN o painel SHALL anunciar o resultado numa região `aria-live="polite"`.
3. The todo texto visível SHALL vir de chaves de i18n, nos locales `pt-BR` e `en`, sem literal no componente.

**Independent Test**: Criar e restaurar um snapshot usando só Tab/Shift+Tab/Enter, com o locale trocado para `en` no meio do caminho.

---

## Edge Cases

- IF duas pessoas restaurarem snapshots diferentes do mesmo diagrama quase ao mesmo tempo THEN o sistema SHALL confiar na resposta do servidor (a revisão vencedora é a que o servidor persistiu) e nunca sobrescrever o resultado exibido com um estado otimista antigo.
- IF o painel de histórico estiver aberto e o restore de outra aba/pessoa mudar a cena enquanto a pessoa está com o formulário de "criar snapshot" preenchido THEN o sistema SHALL preservar o texto do nome não salvo (não é uma ação destrutiva, não precisa descartar).
- WHEN o diagrama não tiver nenhuma revisão além da inicial (diagrama recém-criado) THEN a ação de "comparar" SHALL ficar desabilitada com uma explicação, em vez de permitir escolher a mesma revisão duas vezes.
- IF `restoreSnapshot` falhar com qualquer erro diferente de `404` (ex. `403` por papel revogado no meio da sessão) THEN o sistema SHALL exibir a falha sem aplicar nada ao canvas — nunca uma aplicação parcial.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --------------- | ----- | ----- | ------ |
| SNAP-01 | P1: Linha do tempo e criar | T1/T2 | ✅ Verified |
| SNAP-02 | P1: Linha do tempo e criar | T2 | ✅ Verified |
| SNAP-03 | P1: Linha do tempo e criar | T1/T2 | ✅ Verified |
| SNAP-04 | P1: Linha do tempo e criar | T2 | ✅ Verified |
| SNAP-05 | P1: Linha do tempo e criar | T2 | ✅ Verified |
| SNAP-06 | P1: Restaurar | T1/T3 | ✅ Verified |
| SNAP-07 | P1: Restaurar | T3 | ✅ Verified |
| SNAP-08 | P1: Restaurar | T3 | ✅ Verified |
| SNAP-09 | P1: Restaurar | T3 | ✅ Verified |
| SNAP-10 | P1: Restaurar | T3 | ✅ Verified |
| SNAP-11 | P2: Comparar | T1/T4 | ✅ Verified |
| SNAP-12 | P2: Comparar | T4 | ✅ Verified |
| SNAP-13 | P2: Comparar | T4 | ✅ Verified |
| SNAP-14 | P2: Teclado e idioma | T6 | ✅ Verified |
| SNAP-15 | P2: Teclado e idioma | T6 | ✅ Verified |
| SNAP-16 | P2: Teclado e idioma | T5/T6 | ✅ Verified |

**ID format:** `SNAP-NN` (fatia de frontend distinta de `VER-NN`, que já nomeia os requisitos de
backend em `architecture-canvas/spec.md`).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 16 total, 16 mapped to tasks (`tasks.md` T1..T6), 0 unmapped. Verifier PASS
(`validation.md`), 16/16 acceptance criteria with `file:line` evidence.

---

## Rotas consumidas

`GET /diagrams/:id/snapshots`, `POST /diagrams/:id/snapshots`,
`POST /diagrams/:id/snapshots/:snapshotId:restore`, `GET /diagrams/:id/diff` — todas já
implementadas e verificadas (`snapshot.int.spec.ts`, `restore.int.spec.ts`); nenhuma mudança de
servidor nesta fatia.

---

## Success Criteria

- [ ] Uma pessoa restaura uma revisão anterior e confirma visualmente, no mesmo editor aberto, que
      o canvas reflete o estado restaurado sem reload de página.
- [ ] Nenhuma revisão intermediária desaparece da linha do tempo depois de um restore.
- [ ] Uma pessoa sem `diagram:mutate` nunca vê os botões de criar/restaurar, só a linha do tempo e
      o diff.
