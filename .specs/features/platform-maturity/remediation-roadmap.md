# Roadmap de remediação — onda F11

Índice da onda F11. Ao contrário de `ui-roadmap.md` (que decompunha capacidade *ausente*), este
documento decompõe **defeito confirmado**: cada entrada sai de um achado reproduzido na análise de
2026-08-24, não de uma lacuna de mapa.

**Este documento não entrega correção e não é uma spec.** Cada entrada vira uma spec própria em
`.specs/features/<slug>/`, com seus requisitos em EARS, seu design quando couber e suas tasks.

## Fonte

Cada entrada cita a evidência que a originou. Nenhuma entrada existe por suspeita.

| Evidência | Como foi obtida |
| --------- | --------------- |
| `PAGEERROR: Maximum update depth exceeded` na rota do editor | Playwright contra o harness `e2e/support/runTestServer.ts` deste repo |
| Causa raiz do loop confirmada por patch experimental (crash some) | mesmo harness, `EditorSurface.tsx` com guarda de estabilidade de seleção |
| `Caddyfile` roteia `/api/*`; nenhuma das 90 rotas usa `/api` | leitura de `infra/compose/Caddyfile` + varredura de `apps/server/src/modules/**/routes.ts` |
| `createLocalAccount` sem caller de produção | varredura de `apps/server`, `packages`, `tools` |
| 0 arquivos CSS, 0 `className` em `apps/web/src` | varredura do repo |
| `make test-unit` sai 1 (`webConsumers.spec.ts`: esperado 4, obtido 53) | execução local |
| 5/5 execuções do CI em `main` falharam | GitHub Actions API, workflow `ci.yaml` |
| `repo-tools audit` → 90 rotas, 49 consumidas | execução local, contra README que afirma 82/4 |

## Ordem proposta

A ordem é de execução. Toda dependência aponta para uma entrada anterior; nenhuma aponta para frente.

| # | Entrada | Spec | Prefixo | Depende de | Ondas |
| - | ------- | ---- | ------- | ---------- | ----- |
| R17 | Estabilidade do editor | `editor-stability` | `ESTB` | — | 1 |
| R18 | Contrato de roteamento de borda | `edge-routing` | `EDGE` | — | 1 |
| R19 | Bootstrap de instância | `instance-bootstrap` | `BOOT` | R18 | 1 |
| R20 | Gate verde | `green-gate` | `GATE` | R17, R18, R19 | 1 |
| R21 | Fundações de UI | `ui-foundations` | `UIF` | R17 | 1,5 |
| R22 | Clareza de RBAC | `rbac-clarity` | `RBAC` | R18, R19 | 1 |
| R23 | Documentação verdadeira | `docs-truth` | `DOCS` | R20, R21, R22 | 0,5 |
| R24 | Bug real de navegação entre frames | `shared-resource-frame-fix` | `SRF` | R17 | 1 |
| R25 | Recolher o painel do editor | `editor-panel-collapse` | `EPC` | R21 | 1 |
| R26 | Tentar novamente nas listas | `list-retry-action` | `LRA` | R21 | 1 |
| R27 | Prova de concorrência real | `concurrency-proof` | `CCP` | R22, R19 | 1 |
| R28 | Administradores de organização | `organization-admins` | `ORG` | R22 | 1 |

R17 e R18 são independentes e podem correr em paralelo; tudo o mais é sequencial pela coluna
`Depende de`. R24–R28 fecham a dívida deixada aberta em "Descoberto durante a execução" e no handoff
de `.specs/STATE.md` — nenhuma delas foi pedida pela análise original de 2026-08-24, mas todas saem
de um achado ou de uma consequência de desenho já registrada por uma onda anterior, nunca de
suspeita nova. R24–R27 são independentes entre si; R28 depende só de R22 (RBAC-clarity), já fechada.

## Por que esta ordem

R17 e R18 primeiro porque **nada é observável enquanto o editor não abre e a API não é alcançável
pelo proxy** — qualquer verificação de UI, RBAC ou documentação feita antes disso mede o ambiente
errado. R19 depois de R18 porque o first-run precisa de uma rota alcançável. R20 depois dos três
porque o gate só pode ser declarado verde quando os testes que ele roda exercitam o produto real.
R21 depois de R17 porque estilizar a rota do editor exige que ela monte. R23 por último porque a
documentação só pode afirmar números depois que eles pararem de mudar.

## Descoberto durante a execução

| Achado | Onde apareceu | Estado |
| ------ | ------------- | ------ |
| `SharedResourcePage` navega entre frames trocando `initialElements`, mas o `<Excalidraw/>` real lê `initialData` só no mount. O mock do teste relê a prop a cada render, então PRZ-33 passa no teste e não funciona no produto. | Verifier de R17, `editor-stability/validation.md` Gap 3 | Fechado por R24 (`shared-resource-frame-fix`) |
| UIF-17 marcado `✅ Verified` na tabela de rastreabilidade de `ui-foundations/spec.md` apesar de `validation.md` documentar "não implementado" — a tabela e o relatório do Verifier divergiam. | Discuss de R24–R28 | Fechado por R25: tabela corrigida junto da implementação |
| `/share` é um prefixo de rota do servidor (`routePrefixes.ts`, AD-013) — o proxy do Vite E o `Caddyfile` encaminham QUALQUER requisição sob `/share*` para `apps/server`, sem distinguir navegação de página inteira de XHR. `GET /share/:token` (a rota pública, sem sessão) sempre devolve o JSON cru da API nesse caso — a SPA (`SharedResourcePage`, a mesma rota client-side) nunca é servida para uma visita fria a essa URL exata, em dev (Vite) e no stack Docker (Caddy) igualmente. Confirmado empiricamente: `goto('/share/:token')` renderiza o corpo JSON verbatim, sem `.excalidraw` em lugar nenhum. Ortogonal ao bug de R24 (aquele é sobre o CONTEÚDO trocar após o mount; este é sobre a página nunca montar via navegação direta). | Execução de R24 (T3, `shared-resource-frame-fix`), ao escrever o e2e contra o `<Excalidraw/>` real | Aberto, sem dono — corrigir exige tocar `vite.config.ts`/`Caddyfile`/`routePrefixes.ts`, fora do escopo de `shared-resource-frame-fix` |

## Fora do escopo da onda

| Item | Razão |
| ---- | ----- |
| Redesenho de produto (novos fluxos, IA no dock, onboarding) | F11 corrige o que está quebrado e o que está feio; não muda o que o produto faz |
| Piloto com times reais | atividade organizacional, nunca item de código (mesma exclusão do marco F0–F5) |
| Split de `apps/server` | AD-003 continua ativa |
