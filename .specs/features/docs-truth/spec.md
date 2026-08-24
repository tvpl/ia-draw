# Documentação verdadeira Specification

## Problem Statement

O `README.md` afirma que das 26 capacidades 4 têm tela e das 82 rotas REST 4 são consumidas pela
interface. A execução de `repo-tools audit` em 2026-08-24 devolve 90 rotas, 49 consumidas e 41
pendentes; o `capability-map.yaml` tem 27 entradas, 6 com `ui_surface` declarada, e ainda marca
"Workspaces, projetos e RBAC" como `backend-only` embora `WorkspaceMembersPage.tsx` exista com três
arquivos de teste. O gate de auditoria só verifica mapa → código (o arquivo declarado existe), nunca
código → mapa, então criar uma tela nova nunca obriga a atualizar o mapa e a documentação envelhece
sempre na mesma direção. Ao mesmo tempo o README promete um Quick start (`make up` →
`localhost:8080`) que, antes desta onda, não permitia nem criar usuário nem autenticar, e documenta
em detalhe um deploy Dokploy sobre esse mesmo caminho.

## Goals

- [ ] Nenhum número afirmado na documentação é escrito à mão
- [ ] Uma tela nova sem entrada no mapa reprova o gate
- [ ] O Quick start descreve o caminho que a onda F11 deixou funcionando

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Reescrever a visão de produto do README | O problema é veracidade factual, não posicionamento |
| Documentação de usuário final (guia, tutorial) | Superfície nova de conteúdo; nada nesta onda a exige |
| Gerar o README inteiro por ferramenta | Prosa gerada envelhece pior do que prosa revisada; só os números são gerados |
| Traduzir a documentação para inglês | Decisão de produto separada |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Como os números entram no README | Um bloco delimitado por marcadores, reescrito por `repo-tools audit`, com o resto da prosa intocado | Gerar só o bloco preserva a prosa revisada por gente e elimina exatamente a parte que envelhece |  y |
| Direção nova da auditoria | O audit passa a falhar quando existe componente em `apps/web/src` consumindo rotas de uma capacidade marcada `backend-only` | É a direção que faltava; sem ela o mapa só pode subdimensionar |  y |
| Como o audit reconhece a superfície | Pelo consumidor de rota já extraído por `webConsumers`, associando rota consumida à capacidade que a declara | Reusa o extrator existente em vez de introduzir um segundo mecanismo de detecção |  y |
| O que fazer com entradas erradas hoje | Corrigidas na mesma onda, antes de o gate novo ser ligado | Ligar um gate sobre dados errados produz um vermelho que ninguém consegue resolver |  y |
| Escopo do Quick start | Descreve first-run, login e primeiro diagrama, e nada além | O que a onda F11 tornou verdadeiro é exatamente isso |  y |
| ADRs desta onda | Uma ADR por decisão estrutural nova, no formato de `docs/adr/TEMPLATE.md` | É a convenção já registrada em `CLAUDE.md` |  y |
| Verificação da prosa | Nenhuma: só os números e o mapa são verificados por ferramenta; a prosa continua sob revisão humana | Já é o que o README declara hoje sobre seu próprio portão, e continua correto |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: Os números param de mentir ⭐ MVP

**User Story**: Como pessoa avaliando o projeto, quero que as contagens de capacidade e rota no
README correspondam ao código, para poder confiar no resto do documento.

**Why P1**: É o defeito factual; todo o resto do documento herda a desconfiança.

**Acceptance Criteria**:

1. WHEN `repo-tools audit` roda THEN o sistema SHALL reescrever o bloco delimitado de números do README com as contagens medidas
2. The README SHALL não conter nenhuma contagem de capacidade ou de rota fora desse bloco
3. WHEN o bloco de números do README diverge da saída do audit THEN o gate SHALL falhar
4. The `capability-map.yaml` SHALL declarar `ui_surface` para toda capacidade que hoje tem componente correspondente em `apps/web/src`

**Independent Test**: rodar `repo-tools audit` e confirmar que o README não muda; alterar um número
à mão e ver o gate reprovar.

---

### P1: O mapa não pode mais subdimensionar ⭐ MVP

**User Story**: Como quem mantém o repositório, quero que criar uma tela sem atualizar o mapa
reprove o gate, para que a documentação pare de envelhecer numa direção só.

**Why P1**: Sem a direção reversa, a correção de hoje volta a envelhecer na próxima feature.

**Acceptance Criteria**:

1. IF uma capacidade está marcada `backend-only` e alguma de suas rotas tem consumidor em `apps/web/src` THEN o gate SHALL falhar nomeando a capacidade e o consumidor
2. The gate SHALL continuar falhando quando uma `ui_surface` declarada não existir como arquivo
3. WHEN uma capacidade nova é adicionada ao mapa sem `ui_surface` e sem `status` THEN o gate SHALL falhar exigindo um dos dois
4. WHEN o gate reprova por qualquer uma dessas causas THEN o sistema SHALL nomear o arquivo e a capacidade envolvidos

**Independent Test**: marcar uma capacidade com tela como `backend-only` e ver o audit reprovar.

---

### P2: O Quick start descreve o que existe

**User Story**: Como pessoa instalando o produto, quero que a documentação descreva os passos reais
até o primeiro diagrama, para não descobrir sozinha que falta criar usuário.

**Why P2**: Depende de R19 e R20 terem fechado; sem eles a prosa nova também seria falsa.

**Acceptance Criteria**:

1. The seção de Quick start SHALL descrever o primeiro acesso e a criação do administrador inicial
2. The seção de deploy SHALL descrever o mesmo primeiro acesso no contexto de uma instância remota
3. The documentação SHALL não afirmar nenhum passo que o gate não exercite
4. WHEN a onda registra uma decisão estrutural nova THEN o sistema SHALL ter uma ADR correspondente em `docs/adr/`
5. The `CLAUDE.md` SHALL listar as invariantes novas introduzidas pela onda

**Independent Test**: seguir o Quick start literalmente numa máquina limpa e chegar a um diagrama aberto.

---

## Edge Cases

- IF o audit não conseguir ler o README THEN o sistema SHALL falhar, nunca passar por omissão
- WHEN o bloco delimitado de números não existe no README THEN o audit SHALL falhar pedindo o bloco
- IF uma capacidade declara uma rota que não existe mais THEN o gate SHALL falhar nomeando a rota
- WHEN uma tela é removida e a capacidade volta a ser `backend-only` THEN o gate SHALL aceitar a mudança sem intervenção manual

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| DOCS-01 | P1: Os números param de mentir | Tasks | Pending |
| DOCS-02 | P1: Os números param de mentir | Tasks | Pending |
| DOCS-03 | P1: Os números param de mentir | Tasks | Pending |
| DOCS-04 | P1: Os números param de mentir | Tasks | Pending |
| DOCS-05 | P1: O mapa não pode mais subdimensionar | Tasks | Pending |
| DOCS-06 | P1: O mapa não pode mais subdimensionar | Tasks | Pending |
| DOCS-07 | P1: O mapa não pode mais subdimensionar | Tasks | Pending |
| DOCS-08 | P1: O mapa não pode mais subdimensionar | Tasks | Pending |
| DOCS-09 | P2: O Quick start descreve o que existe | Tasks | Pending |
| DOCS-10 | P2: O Quick start descreve o que existe | Tasks | Pending |
| DOCS-11 | P2: O Quick start descreve o que existe | Tasks | Pending |
| DOCS-12 | P2: O Quick start descreve o que existe | Tasks | Pending |
| DOCS-13 | P2: O Quick start descreve o que existe | Tasks | Pending |

**Coverage:** 13 total, 13 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `repo-tools audit` roda e não altera o README
- [ ] Marcar uma capacidade com tela como `backend-only` reprova o gate
- [ ] O Quick start, seguido literalmente, chega a um diagrama aberto
