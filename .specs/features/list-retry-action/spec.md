# Tentar novamente nas listas Specification

## Problem Statement

`ui-foundations`'s AC5 (UIF-10) pede que uma lista que falha ao carregar apresente "a ação de
tentar novamente", não só a mensagem de erro. Nenhuma das quatro páginas de lista
(`WorkspaceListPage`, `ProjectListPage`, `DiagramListPage`, `WorkspaceMembersPage`) oferece essa
ação hoje — `validation.md` da própria onda já registrou isso como dívida (`⚠️ Parcial`). Uma
pessoa cuja lista falha por uma falha transitória de rede fica sem saída além de recarregar a
página inteira.

## Goals

- [ ] As quatro páginas de lista oferecem um botão "Tentar novamente" quando a carga falha
- [ ] Acionar o botão refaz exatamente a mesma requisição, sem efeito colateral novo
- [ ] `WorkspaceMembersPage` ganha a mesma ação sem enfraquecer a convenção MEM-03 (falha de
      carga = "não encontrado", nunca revela se o motivo foi rede ou acesso)

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Retry automático com backoff | A AC pede uma ação da pessoa, não um mecanismo automático — automatizar aqui seria inventar requisito não pedido |
| Distinguir erro de rede de erro de permissão em `WorkspaceMembersPage` | Mudaria a garantia de IDOR que MEM-03 documenta deliberadamente; fora do escopo desta correção pontual |
| Extrair um hook `useResourceList` compartilhado | Cada página já é dona do seu próprio efeito de carga; a correção mínima nomeia a função existente e a reusa no botão, sem criar uma abstração nova sobre quatro arquivos que uma sessão futura precisaria entender |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Onde o botão aparece nas três páginas com `resourceListStore` | Ao lado da mensagem em `css.errorBox`, só quando `status === 'error'` | É exatamente a AC5: a ação SHALL aparecer "no lugar do conteúdo" junto da mensagem de erro | y |
| Onde o botão aparece em `WorkspaceMembersPage` | Na ramificação `notFound`, não em `listStatus === 'error'` | Essa página funde toda falha de carga em `notFound` (MEM-03) — `listStatus === 'error'` nunca é alcançado nela hoje; o botão precisa estar onde a falha realmente aparece | y |
| Estado durante o retry | Nenhum indicador dedicado de "tentando de novo" — a mensagem de erro permanece até a nova tentativa resolver | A AC pede a ação, não um estado de carregamento distinto; adicionar um terceiro estado visual seria requisito não pedido | y |

**Open questions:** none — resolvidas acima.

---

## User Stories

### P1: Uma lista que falhou pode ser recarregada sem sair da página ⭐ MVP

**User Story**: Como pessoa usando o produto, quero tentar de novo quando uma lista falha ao
carregar, para não precisar recarregar a página inteira por uma falha transitória.

**Why P1**: É a AC5 de `ui-foundations` (UIF-10) que ficou parcial — a mensagem existe, a ação não.

**Acceptance Criteria**:

1. IF a carga de workspaces, projetos ou diagramas falha THEN o sistema SHALL apresentar, junto da
   mensagem de erro, um botão "Tentar novamente"
2. WHEN a pessoa aciona "Tentar novamente" THEN o sistema SHALL refazer a mesma requisição de lista
   que falhou, usando o mesmo cliente e os mesmos parâmetros
3. WHEN a nova tentativa é bem-sucedida THEN o sistema SHALL substituir a mensagem de erro pela
   lista carregada, exatamente como uma carga inicial bem-sucedida
4. IF a carga de membros do workspace falha THEN o sistema SHALL apresentar a mesma ação de tentar
   novamente na tela de "não encontrado", sem revelar se a causa foi rede, permissão ou inexistência
5. WHEN a nova tentativa falha de novo THEN o sistema SHALL manter a mesma mensagem de erro e o
   mesmo botão, sem acumular mensagens duplicadas

**Independent Test**: forçar uma resposta de erro na lista, ver o botão, forçar sucesso na próxima
chamada, acionar o botão, ver a lista aparecer.

---

## Edge Cases

- IF a pessoa aciona "Tentar novamente" várias vezes em sequência rápida THEN o sistema SHALL
  disparar uma requisição por clique, sem travar o botão nem impedir cliques novos — a mesma
  garantia de idempotência que a requisição original já tem (uma lista é sempre segura de repetir)
- WHEN a página é desmontada com uma nova tentativa em voo THEN o sistema SHALL descartar o
  resultado sem atualizar estado de um componente que não existe mais — a mesma guarda `cancelled`
  que a carga inicial já usa

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| LRA-01 | P1: Uma lista que falhou pode ser recarregada sem sair da página | Tasks | Pending |
| LRA-02 | P1: Uma lista que falhou pode ser recarregada sem sair da página | Tasks | Pending |
| LRA-03 | P1: Uma lista que falhou pode ser recarregada sem sair da página | Tasks | Pending |
| LRA-04 | P1: Uma lista que falhou pode ser recarregada sem sair da página | Tasks | Pending |
| LRA-05 | P1: Uma lista que falhou pode ser recarregada sem sair da página | Tasks | Pending |

**Coverage:** 5 total, 5 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] As quatro páginas oferecem "Tentar novamente" no estado de erro
- [ ] O botão refaz a mesma requisição e recupera a lista quando ela volta a funcionar
- [ ] `WorkspaceMembersPage` não passou a distinguir motivo de falha
- [ ] `make ci` passa
