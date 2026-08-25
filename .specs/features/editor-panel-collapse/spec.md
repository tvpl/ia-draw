# Recolher o painel do editor Specification

## Problem Statement

`ui-foundations` (R21) deu ao painel lateral do editor uma largura própria (`w-96`) e parou de
deixá-lo invadir o canvas, mas UIF-17 — "recolher o painel devolve a largura ao canvas" — nunca
teve uma task que o carregasse no `Done when`. Nenhuma seção interna nem controle inteiro existe
para isso hoje; a spec pede e o produto não entrega. Pior: `ui-foundations/spec.md`'s tabela de
rastreabilidade marca UIF-17 como `✅ Verified`, enquanto `ui-foundations/validation.md` documenta
corretamente "⚠️ Não implementado" — as duas fontes divergem, o mesmo defeito de integridade
documental que a onda `docs-truth` existiu para varrer, só que numa spec que `docs-truth` não olhou.

## Goals

- [ ] Um controle recolhe o painel lateral inteiro (IA/Comentários/Lint) e devolve sua largura ao canvas
- [ ] O mesmo controle expande o painel de volta, sem perder o que estava selecionado nas abas internas
- [ ] `ui-foundations/spec.md`'s tabela de rastreabilidade para UIF-17 é corrigida para bater com o que existe

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Persistir o estado recolhido entre recarregamentos (localStorage) | A AC pede que recolher devolva a largura; não pede que a escolha sobreviva a um reload. Escopo mínimo, ver Assumptions. |
| Recolher/expandir por atalho de teclado | Nenhum requisito pede; a spec já cobre foco visível (UIF-11) e navegação por teclado nos controles existentes, um atalho novo é feature nova, não conclusão de UIF-17. |
| Redesenhar as seções internas (`<details>`) do painel | UIF-16 (affordance consistente das seções internas) já está feito; este item é só o controle do painel inteiro. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Persistência do estado | Nenhuma — reseta expandido a cada mount da rota | A AC (UIF-17) só pede que recolher devolva a largura; não pede sobrevivência a reload. Adicionar localStorage aqui seria escopo além do pedido. | y |
| Onde o controle mora quando o painel está recolhido | Uma faixa estreita no lugar do `<aside>`, mesma posição na árvore (`row.children[1]`), com um botão "Expandir painel" | Mantém a estrutura de duas colunas que o teste existente já assume (`row.children[1]` é sempre o segundo filho), e dá ao visitante um alvo fixo para reabrir sem precisar lembrar de outro lugar na tela | y |
| Rótulos i18n | `diagram.panel.collapse` / `diagram.panel.expand`, em `en` e `pt-BR` | Mesma convenção de todo rótulo novo desta sessão — a spec de `en` está pinada pelos testes existentes | y |

**Open questions:** none — resolvidas acima.

---

## User Stories

### P1: Recolher o painel devolve a largura ao canvas ⭐ MVP

**User Story**: Como pessoa desenhando, quero recolher o painel lateral quando não preciso dele,
para ter mais espaço de canvas sem perder o que estava vendo nas abas quando reabrir.

**Why P1**: É a AC5 de `ui-foundations` (UIF-17) que nenhuma task carregou — dívida nomeada, não
lacuna nova.

**Acceptance Criteria**:

1. WHEN a pessoa aciona o controle de recolher THEN o sistema SHALL deixar de renderizar o painel
   lateral com sua largura própria e SHALL o canvas ocupar o espaço liberado
2. WHILE o painel está recolhido o sistema SHALL apresentar um controle visível e alcançável por
   teclado para expandi-lo de volta
3. WHEN a pessoa aciona o controle de expandir THEN o sistema SHALL renderizar o painel lateral de
   volta com a mesma largura de antes (`w-96`)
4. WHEN o painel é expandido de volta THEN o sistema SHALL preservar a aba interna que estava ativa
   antes de recolher (IA, Comentários ou Lint) — recolher não reseta a seleção de aba
5. The controle de recolher/expandir SHALL apresentar rótulo acessível distinto para cada estado
   (nunca o mesmo texto "recolher" enquanto já recolhido)

**Independent Test**: abrir a rota do editor, recolher o painel, ver o canvas expandir, expandir de
volta e ver a mesma aba de antes ainda selecionada.

---

## Edge Cases

- IF a pessoa recolhe o painel enquanto o Dock de IA está no meio de um run THEN o sistema SHALL
  continuar o run normalmente — recolher é só apresentação, nunca cancela trabalho em andamento
- WHEN a viewport é redimensionada enquanto o painel está recolhido THEN o sistema SHALL manter o
  canvas ocupando o espaço liberado, sem religar o painel sozinho

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| EPC-01 | P1: Recolher o painel devolve a largura ao canvas | Tasks | Pending |
| EPC-02 | P1: Recolher o painel devolve a largura ao canvas | Tasks | Pending |
| EPC-03 | P1: Recolher o painel devolve a largura ao canvas | Tasks | Pending |
| EPC-04 | P1: Recolher o painel devolve a largura ao canvas | Tasks | Pending |
| EPC-05 | P1: Recolher o painel devolve a largura ao canvas | Tasks | Pending |

**Coverage:** 5 total, 5 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] Recolher some com a largura do painel; o canvas cresce
- [ ] Expandir devolve o painel com a mesma aba que estava ativa
- [ ] `ui-foundations/spec.md`'s linha de UIF-17 na tabela de rastreabilidade bate com `validation.md`
- [ ] `make ci` passa
