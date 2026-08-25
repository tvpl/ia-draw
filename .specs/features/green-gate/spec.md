# Gate verde Specification

## Problem Statement

`make ci` não passa e nunca passou: as 5 execuções do workflow `ci.yaml` em `main` falharam, desde o
primeiro merge. Hoje reprovam três jobs — `Unit tests`, `Integration tests` e `End-to-end`. A falha
de unidade é um teste petrificado num número (`tools/repo-tools/src/webConsumers.spec.ts` afirma
"exatamente as 4 rotas que a web consome hoje"; são 53). A de integração é `infra/backup` exigindo
um cluster Postgres real, contrariando a promessa da ADR-0007 de que integração roda em PGlite sem
Docker. A de e2e é o editor quebrado. Com o gate permanentemente vermelho, ele deixou de informar:
o commit de topo de `main` registra explicitamente um merge feito sem passe do Verifier. E o job
`Compose stack smoke`, que passa, só verifica `/health/ready` — exatamente o único caminho que o
proxy roteia certo, o que produz confiança falsa.

## Goals

- [ ] `make ci` sai 0 num checkout limpo, sem nenhum teste desativado para chegar lá
- [ ] O CI em `main` fica verde e volta a ser sinal
- [ ] O smoke do compose exercita o produto (first-run, login, listar workspaces), não só liveness

## Out of Scope

| Feature | Reason |
| ------- | ------ |
| Corrigir o editor e o roteamento | São `editor-stability` (R17) e `edge-routing` (R18); esta spec depende deles, não os duplica |
| Aumentar pisos de cobertura | O piso atual foi calibrado deliberadamente em F8; mexer nele é decisão separada |
| Migrar de Turborepo/Vitest | O gate é o problema, não a ferramenta |
| Paralelizar o CI para reduzir tempo | Otimização; o objetivo aqui é veracidade do sinal |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| Como corrigir o teste petrificado | Derivar a expectativa do próprio código: asserta invariantes do extrator (formato, ausência de duplicata, todo consumidor aponta a rota registrada), nunca uma contagem | Uma contagem literal volta a quebrar no próximo componente; a invariante não |  y |
| Onde ficam os testes de `infra/backup` | Alvo próprio (`test:integration:backup`), fora do `test:integration` padrão, rodado no CI onde há Postgres real | A ADR-0007 promete PGlite sem Docker; `backup` usa `pg_dump`/cluster real e nunca poderá cumprir essa promessa |  y |
| O que o smoke do compose passa a exercitar | first-run, login e `GET /workspaces` pela porta pública, além de `/health/ready` | São os três passos que a análise mostrou que o smoke atual não cobre e que estavam quebrados |  y |
| Tolerância a teste instável | Nenhuma: um teste que falha de forma intermitente é corrigido ou removido com justificativa, nunca marcado como tolerado | O handoff de F10 já registra flake de contenção sob execução paralela; tolerar formaliza o ruído |  y |
| Definição de "verde" | Todos os jobs de `ci.yaml` com conclusão `success` num push a `main` | Qualquer definição mais fraca reintroduz o vermelho normalizado |  y |
| Divergência de ADR-0007 | Registrada como emenda explícita na própria ADR, não como nota de rodapé em spec | A promessa "integração roda sem Docker" é lida como invariante do projeto; corrigir só a spec deixaria a ADR mentindo |  y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: O gate local passa ⭐ MVP

**User Story**: Como quem vai commitar, quero que `make ci` sai 0 num checkout limpo, para saber que
o vermelho que eu vir é meu.

**Why P1**: Um gate sempre vermelho não distingue regressão de estado herdado.

**Acceptance Criteria**:

1. WHEN `make test-unit` roda num checkout limpo THEN o sistema SHALL sair com código 0
2. The teste de consumidores de rota de `repo-tools` SHALL asseverar invariantes estruturais do extrator e SHALL não asseverar nenhuma contagem literal de rotas
3. WHEN `make test-integration` roda num ambiente sem cluster Postgres instalado THEN o sistema SHALL sair com código 0
4. WHEN `make ci` roda num checkout limpo com Node 22 THEN o sistema SHALL sair com código 0
5. The conjunto de testes executados pelo gate SHALL não ter nenhum teste marcado como pulado, desativado ou em quarentena introduzido por esta feature

**Independent Test**: clonar limpo, `make install && make ci`, observar código de saída 0.

---

### P1: O CI volta a ser sinal ⭐ MVP

**User Story**: Como quem revisa um pull request, quero que um CI vermelho signifique um problema
real, para poder bloquear o merge com base nele.

**Why P1**: Enquanto o vermelho for permanente, nenhum gate de merge é aplicável.

**Acceptance Criteria**:

1. WHEN o workflow `ci.yaml` roda num push para `main` THEN todos os jobs SHALL concluir com sucesso
2. WHERE `infra/backup` exige um cluster Postgres real, o CI SHALL executá-lo em um job próprio com o serviço Postgres disponível
3. IF um job do CI falha THEN o sistema SHALL falhar o workflow inteiro, sem `continue-on-error` em nenhum job de teste

**Independent Test**: abrir um pull request trivial e ver todos os jobs verdes.

---

### P2: O smoke do compose prova o produto

**User Story**: Como quem confia no job de smoke, quero que ele exercite autenticação e leitura de
dados pela porta pública, para que uma borda mal roteada não passe como saudável.

**Why P2**: Destrava confiança, não o produto — mas é o job que deu confiança falsa até agora.

**Acceptance Criteria**:

1. WHEN o job de smoke do compose roda THEN o sistema SHALL executar o first-run pela porta pública e receber `201`
2. WHEN o smoke autentica com as credenciais criadas THEN o sistema SHALL receber uma resposta JSON com cookie de sessão pela porta pública
3. WHEN o smoke consulta a lista de workspaces autenticado THEN o sistema SHALL receber JSON contendo o workspace criado no first-run
4. IF qualquer uma dessas respostas tiver `content-type` de HTML THEN o job SHALL falhar nomeando o caminho que respondeu HTML

**Independent Test**: quebrar deliberadamente uma regra do `Caddyfile` e ver o job de smoke reprovar.

---

## Edge Cases

- IF o extrator de consumidores de rota não encontrar nenhum consumidor THEN o teste SHALL falhar, porque zero é sinal de extrator quebrado, não de produto sem UI
- WHEN o gate roda numa máquina sem `pg_lsclusters` THEN o sistema SHALL executar a suíte de integração padrão inteira sem erro de spawn
- IF um teste do gate falhar de forma intermitente em execuções repetidas THEN o sistema SHALL tratá-lo como falha, nunca como tolerável
- WHEN o smoke do compose roda duas vezes contra o mesmo volume THEN o first-run SHALL responder `404` na segunda e o smoke SHALL usar as credenciais já criadas

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| GATE-01 | P1: O gate local passa | Implementing | Implementing (T1/T8/T9/T10) |
| GATE-02 | P1: O gate local passa | Implementing | Implementing (T1) |
| GATE-03 | P1: O gate local passa | Implementing | Implementing (T2/T6) |
| GATE-04 | P1: O gate local passa | Implementing | Implementing (T3) |
| GATE-05 | P1: O gate local passa | Implementing | Implementing (T2/T10) |
| GATE-06 | P1: O CI volta a ser sinal | Implementing | Implementing (T4) |
| GATE-07 | P1: O CI volta a ser sinal | Implementing | Implementing (T4) |
| GATE-08 | P1: O CI volta a ser sinal | Implementing | Implementing (T4) |
| GATE-09 | P2: O smoke do compose prova o produto | Implementing | Implementing (T5) |
| GATE-10 | P2: O smoke do compose prova o produto | Implementing | Implementing (T5) |
| GATE-11 | P2: O smoke do compose prova o produto | Implementing | Implementing (T5) |
| GATE-12 | P2: O smoke do compose prova o produto | Implementing | Implementing (T5) |

**Coverage:** 12 total, 12 mapeados para tasks, 0 sem mapeamento.

---

## Success Criteria

- [ ] `make ci` sai 0 num clone limpo
- [ ] Um push a `main` produz workflow inteiramente verde
- [ ] Uma regra de borda quebrada de propósito reprova o smoke do compose
