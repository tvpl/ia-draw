# Fundações de UI Specification

## Problem Statement

O produto não tem camada de estilo. Uma varredura de `apps/web/src` encontra 0 arquivos CSS, 0 usos
de `className` e 9 estilos inline — todos em `DiagramEditorPage`, um layout flex cru. A única folha
de estilo carregada é a do Excalidraw (`main.tsx`), por isso a barra de ferramentas do canvas parece
pronta e todo o resto do produto é HTML nu: login, shell, listas de workspace/projeto/diagrama,
membros, painéis do editor. Links de navegação aparecem colados ("MembrosWebhooksProviders de IA"),
o painel lateral do editor sobrepõe o canvas e o rótulo do dock de IA cai por cima do próprio
campo. Não é gosto: é a ausência de qualquer sistema visual. Os 91 arquivos de teste de front —
inclusive os de acessibilidade com `jest-axe` — passam porque validam papel, rótulo e foco, nunca
aparência.

## Goals

- [ ] Um sistema de tokens e uma camada de estilo instalados, com uma única forma de estilizar
- [ ] Login, shell, listas e chrome do editor legíveis e alinhados, sem sobreposição
- [ ] Nenhuma regressão de acessibilidade: os testes `jest-axe` existentes continuam verdes

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Redesenho de fluxo ou informação nova nas telas | A onda corrige aparência do que já existe; mudar o que a tela diz é produto |
| Tema escuro | Decisão de produto com custo de tokens dobrado; entra depois que a paleta clara estiver estável |
| Componentes visuais do Excalidraw | O canvas traz o próprio CSS e não deve ser sobrescrito (EDT-07/AD-008) |
| Layout mobile abaixo de 1024px | O produto é uma ferramenta de diagramação em desktop; um piso menor exige repensar o canvas |
| Biblioteca de componentes publicada | Nada aqui é consumido fora de `apps/web` |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Camada de estilo | Tailwind CSS v4 via plugin do Vite, configuração CSS-first com `@theme` | Decidido na discussão. Sem arquivo JS de config, uma dependência de build, e dá consistência sem exigir que se invente um design system antes de estilizar a primeira tela |  y |
| Tokens | Definidos uma vez em `@theme` (cor, espaçamento, raio, tipografia, sombra) e consumidos só por utilitário | Um valor de cor escrito à mão dentro de um componente é o começo da divergência |  y |
| Escopo de estilização | As telas que existem hoje, sem criar nenhuma tela nova | Mantém a onda verificável: cada tela estilizada é uma AC |  y |
| Ordenação de classes | Sem plugin de ordenação; o Biome não ordena classes de Tailwind e nenhum outro linter será adicionado | Adicionar um segundo linter só para ordenar classe custa mais do que a inconsistência que resolve |  y |
| Como a regressão de aparência é evitada | Testes existentes continuam válidos; nenhum teste de snapshot visual é introduzido | Snapshot visual exige infraestrutura de imagem e vira ruído; a AC de layout é verificada por asserção de estrutura e por revisão |  y |
| Estilos inline atuais | Substituídos por utilitários; nenhum `style={{}}` remanescente em componente de produção | Dois mecanismos de layout no mesmo componente é como o painel lateral acabou sobrepondo o canvas |  y |
| Piso de largura | 1024px | Ver Out of Scope: abaixo disso o canvas precisa de outro desenho, que é produto |  y |
| Divisão do bundle | A rota do editor passa a ser carregada sob demanda | O chunk principal tem 1,6 MB e o segundo 1,8 MB; quem abre só o login carrega mermaid, cytoscape e katex hoje |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Uma camada de estilo instalada ⭐ MVP

**User Story**: Como quem vai estilizar qualquer tela, quero uma única forma de aplicar estilo com
tokens definidos, para que duas telas feitas por pessoas diferentes fiquem parecidas.

**Why P1**: Toda story seguinte depende disso existir.

**Acceptance Criteria**:

1. WHEN `apps/web` é construído THEN o sistema SHALL emitir uma folha de estilo gerada pela camada de estilo configurada
2. The conjunto de tokens de cor, espaçamento, raio, tipografia e sombra SHALL ser declarado em exatamente um arquivo
3. WHERE um componente de produção precisa de uma cor, ele SHALL referenciá-la por token, nunca por valor literal
4. WHEN o build de produção roda THEN o sistema SHALL não emitir nenhum aviso de configuração da camada de estilo
5. The suíte de testes existente de `apps/web` SHALL continuar passando sem alteração de asserção

**Independent Test**: construir `apps/web` e confirmar CSS emitido e tokens resolvidos.

---

### P1: As telas de entrada e navegação ficam legíveis ⭐ MVP

**User Story**: Como pessoa usando o produto, quero telas com hierarquia, espaçamento e controles
reconhecíveis, para conseguir operar sem adivinhar o que é clicável.

**Why P1**: É a queixa direta: login, gestão de projetos e de usuários sem nenhum desenho.

**Acceptance Criteria**:

1. WHEN a tela de login é renderizada THEN o sistema SHALL apresentar o formulário centrado, com rótulos associados, campos e ação primária distinguíveis
2. WHEN o shell da aplicação é renderizado THEN o sistema SHALL separar cabeçalho e conteúdo com espaçamento consistente e apresentar os links de navegação como elementos distintos entre si
3. WHEN uma lista de workspaces, projetos, diagramas ou membros é renderizada THEN o sistema SHALL apresentar cada item como uma linha delimitada, com ações alinhadas e estado vazio próprio
4. WHILE uma lista está carregando o sistema SHALL apresentar um estado de carregamento no lugar do conteúdo
5. IF uma lista falha ao carregar THEN o sistema SHALL apresentar a mensagem de erro e a ação de tentar novamente no lugar do conteúdo
6. The elementos interativos SHALL apresentar estado de foco visível com contraste suficiente para navegação por teclado
7. WHEN qualquer tela é renderizada em uma viewport de 1024px de largura THEN o sistema SHALL não produzir rolagem horizontal

**Independent Test**: percorrer login → workspaces → projetos → diagramas → membros e ver espaçamento,
delimitação e foco consistentes.

---

### P2: O chrome do editor para de atrapalhar o canvas

**User Story**: Como pessoa desenhando, quero que os painéis ao redor do canvas tenham largura
própria e não invadam a área de desenho, para desenhar sem obstrução.

**Why P2**: O canvas já monta depois de R17; isto é qualidade da moldura, não acesso.

**Acceptance Criteria**:

1. WHEN a rota do editor é renderizada THEN o sistema SHALL alocar ao painel lateral uma largura própria e SHALL não sobrepor a área do canvas
2. WHEN a rota do editor é renderizada THEN o sistema SHALL fazer o canvas ocupar toda a altura restante da viewport
3. The rótulos e campos do dock de IA SHALL ocupar linhas distintas, sem sobreposição
4. The seções recolhíveis do painel lateral SHALL apresentar affordance de expandir e recolher consistente entre si
5. WHEN o painel lateral está recolhido THEN o sistema SHALL devolver a largura ao canvas

**Independent Test**: abrir a rota do editor e confirmar canvas sem obstrução e painel com largura própria.

---

### P3: A rota do editor deixa de pesar no primeiro carregamento

**User Story**: Como pessoa que abre só o login, quero não baixar o motor de diagramação inteiro,
para a primeira tela abrir rápido.

**Why P3**: Melhora percebida, não bloqueio.

**Acceptance Criteria**:

1. WHEN a aplicação é construída THEN o sistema SHALL emitir o código da rota do editor em um chunk separado do chunk de entrada
2. WHILE a rota do editor está sendo carregada sob demanda o sistema SHALL apresentar um estado de carregamento
3. The chunk de entrada SHALL não conter o código do Excalidraw

**Independent Test**: construir e confirmar que o chunk de entrada não contém o motor de canvas.

---

## Edge Cases

- WHEN o texto de um item de lista é mais longo que a linha THEN o sistema SHALL truncá-lo preservando as ações visíveis
- IF um estado vazio e um estado de erro ocorrem juntos THEN o sistema SHALL apresentar o erro, nunca os dois
- WHEN a pessoa navega apenas por teclado THEN o sistema SHALL manter todos os controles alcançáveis na ordem visual
- WHEN o idioma muda para `en` THEN o sistema SHALL manter o layout sem quebra por variação de comprimento de texto
- IF a folha de estilo do Excalidraw e a da aplicação declaram o mesmo seletor THEN o sistema SHALL preservar o estilo do Excalidraw dentro do canvas

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| UIF-01 | P1: Uma camada de estilo instalada | Verified | ✅ Verified |
| UIF-02 | P1: Uma camada de estilo instalada | Verified | ✅ Verified |
| UIF-03 | P1: Uma camada de estilo instalada | Verified | ✅ Verified |
| UIF-04 | P1: Uma camada de estilo instalada | Verified | ✅ Verified |
| UIF-05 | P1: Uma camada de estilo instalada | Verified | ✅ Verified |
| UIF-06 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-07 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-08 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-09 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-10 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-11 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-12 | P1: As telas de entrada e navegação ficam legíveis | Verified | ✅ Verified |
| UIF-13 | P2: O chrome do editor para de atrapalhar o canvas | Verified | ✅ Verified |
| UIF-14 | P2: O chrome do editor para de atrapalhar o canvas | Verified | ✅ Verified |
| UIF-15 | P2: O chrome do editor para de atrapalhar o canvas | Verified | ✅ Verified |
| UIF-16 | P2: O chrome do editor para de atrapalhar o canvas | Verified | ✅ Verified |
| UIF-17 | P2: O chrome do editor para de atrapalhar o canvas | Verified | ✅ Verified |
| UIF-18 | P3: A rota do editor deixa de pesar no primeiro carregamento | Verified | ✅ Verified |
| UIF-19 | P3: A rota do editor deixa de pesar no primeiro carregamento | Verified | ✅ Verified |
| UIF-20 | P3: A rota do editor deixa de pesar no primeiro carregamento | Verified | ✅ Verified |

**Coverage:** 20 total, 20 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] Nenhum `style={{}}` remanescente em componente de produção de `apps/web`
- [ ] Login, shell, quatro listas e chrome do editor estilizados e sem sobreposição
- [ ] Testes `jest-axe` existentes continuam verdes
- [ ] O chunk de entrada não contém o motor de canvas
