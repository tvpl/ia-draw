# Documentação verdadeira Validation

**Date**: 2026-08-25
**Spec**: `.specs/features/docs-truth/spec.md`
**Design**: pulado por decisão registrada em `tasks.md` (a ferramenta já existia; as escolhas com
alternativa real estão nas Assumptions da spec).
**Diff range**: `06b5e7b..7168466` (6 commits)
**Verifier**: passe standalone (`validate.md`), mesma limitação de autor ≠ verificador já registrada
em R17–R22.

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `e83f43e` |
| T2, T3 | ✅ Done | `02d9ecf` — juntos, ver Gap 3 |
| T4, T5 | ✅ Done | `55bcc91` — juntos, ver Gap 3 |
| T6 | ✅ Done | `cd3c5c8` |
| T7 | ✅ Done | `7168466` |
| — | ✅ Done | `daac3f6`, fora do plano: o vermelho de R22 que `make ci` revelou aqui (ver Gap 1) |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| DOCS-01 contagem do README vem da medição | bloco reescrito a partir do medido | `tools/repo-tools/src/routeInventory.spec.ts:128` — `expect(block).toContain('- **Capacidades:** 27 no total, 21 com tela, 6 ainda sem superfície.')`; `tools/repo-tools/src/cli.spec.ts:137` — `expect(result.exitCode).toBe(1)` e `expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain(CLEAN_README_BLOCK)` | ✅ PASS |
| DOCS-02 nenhuma contagem à mão fora do bloco | zero ocorrências | `README.md:13`–`README.md:19` — as duas únicas linhas com número de capacidade ou de rota estão dentro dos delimitadores | ✅ PASS |
| DOCS-03 rodar com o README correto não altera nada | sem escrita, sem violação | `tools/repo-tools/src/routeInventory.spec.ts:152` — `expect(violations).toEqual([])` e `expect(writes).toEqual([])`; `tools/repo-tools/src/cli.spec.ts:156` — `expect(readFileSync(join(root, 'README.md'), 'utf8')).toBe(afterFirst)` | ✅ PASS |
| DOCS-04 capacidade com componente declara `ui_surface` | 21 de 27 | `docs/capability-map.yaml` — 21 entradas com `ui_surface`, 6 `backend-only`; `pnpm --filter @arch-canvas/repo-tools run audit` sai 0 | ✅ PASS |
| DOCS-05 `backend-only` com consumidor reprova | reprova nomeando os dois | `tools/repo-tools/src/capabilityMap.spec.ts:196` — `expect(violations[0]?.problem).toContain('apps/server/src/modules/lint/routes.ts')` e `.toContain('apps/web/src/lint/lintClient.ts')`; mensagem em `tools/repo-tools/src/capabilityMap.ts:107` | ✅ PASS |
| DOCS-06 `ui_surface` inexistente reprova | reprova | `tools/repo-tools/src/capabilityMap.spec.ts:30` — caso pré-existente, mantido verde | ✅ PASS |
| DOCS-07 capacidade sem `ui_surface` e sem `status` reprova | reprova exigindo um dos dois | `tools/repo-tools/src/capabilityMap.spec.ts:153` — `expect(violations[0]?.problem).toContain('backend-only')` | ✅ PASS |
| DOCS-08 remover a tela volta a ser aceito sem intervenção | aceito | `tools/repo-tools/src/capabilityMap.spec.ts:221` — `expect(violations).toEqual([])` com o mesmo mapa que reprova em `:196`, só sem o consumidor | ✅ PASS |
| DOCS-09 Quick start descreve subir, criar admin, abrir diagrama | os três passos | `README.md:72` "### Primeiro acesso"; cada passo exercitado por `.github/workflows/ci.yaml:348` — `assert_json` sobre `/auth/first-run` (`:372`), `/auth/login` (`:384`) e `/workspaces` (`:393`) | ✅ PASS |
| DOCS-10 deploy descreve o mesmo primeiro acesso | seção presente | `README.md:122` — "### 2b. Primeiro acesso na instância remota" | ✅ PASS |
| DOCS-11 nenhum passo afirmado sem exercício no gate | zero | os passos de `README.md:72` correspondem 1:1 aos de `.github/workflows/ci.yaml:348`; nenhum passo novo foi afirmado | ✅ PASS |
| DOCS-12 uma ADR por decisão estrutural | 4 ADRs | `docs/adr/0013-edge-route-prefix-contract.md:1`, `docs/adr/0014-tailwind-tokens-for-web.md:1`, `docs/adr/0015-first-run-public-bootstrap.md:1`, `docs/adr/0016-org-role-crosses-workspaces.md:1` — formato Status/Data/Contexto/Decisão/Consequências, uma entrada AD-013..AD-016 cada em `.specs/STATE.md:101`–`:132` | ✅ PASS |
| DOCS-13 invariantes novas no onboarding | 4 entradas apontando ADR | `CLAUDE.md:96`–`CLAUDE.md:119` — AD-013..AD-016, cada uma citando o arquivo da sua ADR; nenhuma invariante anterior removida (o diff só acrescenta) | ✅ PASS |

**Status**: 13 de 13 com evidência direta.

---

## Discrimination Sensor

Sete mutações, todas mortas.

| # | Mutação | Quem pega | Resultado |
| - | ------- | --------- | --------- |
| M1 | Marcar "Lint arquitetural" como `backend-only` no mapa real | `repo-tools audit` | ☠️ morta — `exit=1`, mensagem nomeia `apps/server/src/modules/lint/routes.ts` e `apps/web/src/lint/lintClient.ts` |
| M2 | Trocar `92 registradas, 67 consumidas` por `82, 4` no README | `repo-tools audit` | ☠️ morta — `exit=1`, "counts block did not match the measured values" |
| M3 | Remover o bloco delimitado inteiro do README | `repo-tools audit` | ☠️ morta — `exit=1`, "missing the … block" |
| M4 | Reverter o extrator para `(?:fetch\|fetchImpl)\(` | `repo-tools` unit + audit | ☠️ morta — 3 testes falham; auditoria mede 51 consumidas e reprova |
| M5 | `normalizeParams` devolve o segmento sem normalizar | `repo-tools` unit | ☠️ morta — 1 teste falha (`export:format`) |
| M6 | Extrator deixa de absorver o `:` antes de uma interpolação | `repo-tools` unit | ☠️ morta — 16 testes falham |
| M7 | Guarda da direção reversa desativada (`if (false && …)`) | `repo-tools` unit | ☠️ morta — `capabilityMap.spec.ts:196` falha |

M4 merece nota: a mutação que reintroduz a cegueira do extrator não é pega por um teste de contagem
— é pega por três testes que nomeiam bindings concretos (`doFetch`, `adminFetch`, `rawFetchImpl`) e
por um que exige que `fetchContentFor` **não** seja contado. É a diferença entre travar um número e
travar o comportamento.

---

## Gaps

### Gap 1 — `make ci` estava vermelho por um resíduo de R22 (Major, corrigido aqui)

`comment.int.spec.ts` afirmava que um `viewer` resolvia um comentário — o contrato que AD-016
removeu deliberadamente. R22 fechou com o gate verde porque a suíte de integração do módulo de
comentários estava em cache do turbo; este passe rodou `make ci` num estado sem cache e o vermelho
apareceu. Corrigido em `daac3f6`, com o teste agora fixando os **dois** lados da fronteira.

A lição transcende o caso: um gate que passa por cache não é um gate que passou. Registrada.

### Gap 2 — O extrator subdimensionava em 24% (Major, corrigido aqui)

Descoberto ao ligar a direção reversa: a capacidade "Lint arquitetural" continuava passando como
`backend-only` mesmo com `LintPanel` chamando a rota, porque `lintClient.ts` usa `doFetch` e o
extrator só reconhecia dois nomes literais. A correção subiu a medição de 51 para 67 rotas
consumidas. O mesmo passe encontrou o casamento de rota falhando em `/diagrams/:id/export:format`.

Consequência honesta: os números que R23 documentou até `55bcc91` (65 consumidas) estavam errados
por baixo, e só a direção reversa os expôs. Um gate que só verifica uma direção não descobre o que
ele próprio não mede.

### Gap 3 — O flake que R20 declarou resolvido não estava (Major, corrigido aqui)

`make ci` passava ~3 corridas em 4. Diagnóstico completo, correção e evidência estão na Emenda de
2026-08-25 em `.specs/features/green-gate/validation.md`; commit `20f57fc`. Registrado aqui porque
foi este fechamento que o expôs: a mesma classe de erro do Gap 1 — um verde observado uma vez
tratado como um verde estável.

### Gap 4 — Commits não atômicos por task (Minor, registrado)

T2+T3 e T4+T5 saíram juntos: T2 e T3 tocam ambos `cli.ts`, e T4/T5 tocam ambos `README.md`. Mesma
causa das ondas anteriores.

### Gap 5 — Um `git checkout --` destruiu trabalho não commitado (Minor, recuperado)

Durante o sensor de discriminação, reverter uma mutação com `git checkout -- routeInventory.ts`
descartou também as alterações não commitadas do próprio T3 no mesmo arquivo. Recuperado a partir do
conteúdo em contexto; nenhuma perda no resultado final. É a recorrência de L-024 numa forma nova —
a lição falava de `git stash`, e a mesma armadilha existe em `git checkout --`. Registrada.

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros |
| `make typecheck` | ✅ 25/25 |
| `make test-unit` | ✅ 24/24 pacotes |
| `make test-integration` | ✅ 13/13 |
| `make ci` | ✅ exit 0, inclusive com `TURBO_FORCE=true` (0 tasks de cache) |
| `pnpm --filter @arch-canvas/repo-tools run audit` | ✅ exit 0, idempotente na segunda corrida |

---

## Requirement Traceability Update

DOCS-01 a DOCS-13: `Pending` → `✅ Verified`.

---

## Summary

**PASS.**

A documentação parou de ser uma afirmação e passou a ser uma medição: os números do README são
escritos pelo auditor, e o gate reprova quando o texto e a medição divergem. O mapa de capacidades
agora é checado nas duas direções — entregar uma tela obriga a atualizar o mapa, o que antes nunca
acontecia e era exatamente por isso que a documentação só podia subdimensionar.

O achado que mais importa é o mesmo padrão de R22 uma camada abaixo: a ferramenta que existia para
medir a verdade tinha ela própria um ponto cego, e o ponto cego só apareceu quando se pediu que ela
verificasse a direção contrária. Vinte e quatro por cento da interface era invisível para o
instrumento que devia contá-la.
