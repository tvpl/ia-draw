# Contrato de roteamento de borda Validation

**Date**: 2026-08-24
**Spec**: `.specs/features/edge-routing/spec.md`
**Design**: `.specs/features/edge-routing/design.md`
**Diff range**: `aecc102..bc81b3a` (5 commits: T1, T2, T3, T4, T5)
**Verifier**: passe independente standalone (`validate.md`). Sub-agentes não estavam disponíveis
nesta sessão, então autor ≠ verificador não pôde ser garantido por separação de processo — mesma
limitação registrada em `editor-stability/validation.md`. O sensor de discriminação é a parte que
não depende de julgamento, e nesta feature ele mudou o resultado (ver Sensor).

---

## Task Completion

| Task | Status | Notes |
| ---- | ------ | ----- |
| T1 | ✅ Done | `1010986` |
| T2 | ✅ Done | `524c558`, `/share-links` acrescentado em `bc81b3a` (achado de T5) |
| T3 | ✅ Done | `37b75a0` |
| T4 | ✅ Done | `2acfba3`, guard reforçado em `bc81b3a` (achado do sensor) |
| T5 | ✅ Done | `bc81b3a` |

---

## Spec-Anchored Acceptance Criteria

| Critério | Resultado esperado pela spec | `file:line` + asserção | Result |
| -------- | ---------------------------- | ---------------------- | ------ |
| EDGE-01 prefixo do servidor → serviço `server` | um `handle` por prefixo | `tools/repo-tools/src/edgeParity.spec.ts:170` — `expect(compareEdges(routes, caddy, vite)).toEqual([])` | ✅ PASS |
| EDGE-02 caminho não correspondente → `web` | catch-all preservado | `edgeParity.ts` `prefixesFromCaddyfile` só coleta blocos com `server:3000`; o bloco `web:80` fica fora, provado por `edgeParity.spec.ts:63` — `expect(prefixesFromCaddyfile(root)).toEqual(new Set(['/auth']))` | ✅ PASS |
| EDGE-03 `POST /auth/login` pela porta pública devolve JSON | resposta do servidor, nunca HTML | `edgeParity.spec.ts:170` cobre o roteamento de `/auth`; a resposta real pela porta pública é o job `compose-smoke` de R20 (GATE-10) | ⚠️ Estrutural |
| EDGE-04 upgrade de WebSocket pelo proxy | conexão estabelecida | `edgeParity.spec.ts:179` — `expect(declared).toEqual(routes)` inclui `/ws`; a conexão real é R20 | ⚠️ Estrutural |
| EDGE-05 nenhuma regra `/api` | ausente do Caddyfile | `edgeParity.spec.ts:183` — `expect(prefixesFromCaddyfile(REPO_ROOT).has('/api')).toBe(false)` | ✅ PASS |
| EDGE-06 proxy de dev cobre todos os prefixos | conjunto igual ao declarado | `apps/web/src/devProxy.spec.ts:24` — `expect(httpKeys.sort()).toEqual([...SERVER_ROUTE_PREFIXES].sort())` | ✅ PASS |
| EDGE-07 prefixo antes ausente devolve resposta do servidor | JSON, nunca `index.html` | `devProxy.spec.ts:18` — `expect(Object.keys(proxy)).toContain(prefix)` para cada prefixo; e a suíte e2e roda contra este proxy com allowlist de console vazia | ✅ PASS |
| EDGE-08 WebSocket com suporte a upgrade | `ws: true` só em `/ws` | `devProxy.spec.ts:34` — `expect(proxy[WS_ROUTE_PREFIX]?.ws).toBe(true)`; `devProxy.spec.ts:39` — `expect(proxy[prefix]?.ws).toBeUndefined()` | ✅ PASS |
| EDGE-09 lista em exatamente um módulo | exportada pelo índice do pacote | `packages/shared-contracts/src/routePrefixes.spec.ts:41` — `expect(packageIndex.SERVER_ROUTE_PREFIXES).toBe(SERVER_ROUTE_PREFIXES)` | ✅ PASS |
| EDGE-10 divergência do Caddyfile reprova nomeando | `{prefix, missingFrom}` | `edgeParity.spec.ts:133` — `expect(differences).toEqual([{ prefix: '/share', missingFrom: 'infra/compose/Caddyfile' }])` | ✅ PASS |
| EDGE-11 divergência do proxy de dev reprova nomeando | `{prefix, missingFrom}` | `edgeParity.spec.ts:143` — `expect(differences).toEqual([{ prefix: '/ai', missingFrom: 'apps/web/vite.config.ts' }])` | ✅ PASS |
| EDGE-12 Caddyfile ilegível reprova, nunca passa por omissão | lança | `edgeParity.spec.ts:73` — `expect(() => prefixesFromCaddyfile(root)).toThrowError(/cannot read/)` e `:81` — `/no server-forwarding handle/` | ✅ PASS |

**Status**: 10 de 12 ACs com evidência de asserção direta; 2 marcados ⚠️ **Estrutural** e não como
cobertos.

⚠️ **EDGE-03 e EDGE-04 não têm prova de execução aqui.** Ambos exigem o stack de pé, que não sobe
neste ambiente (sem daemon Docker, AD-007). O que está provado é que o `Caddyfile` roteia os
prefixos certos, verificado contra as rotas registradas. A resposta HTTP real pela porta pública é
GATE-09..12, na spec `green-gate` — declarado ali, não assumido aqui. Registrar isso como ✅ seria
exatamente o padrão de lacuna que as lições L-044/L-045 deste repo descrevem.

---

## Edge Cases

| Edge case da spec | Evidência | Result |
| ----------------- | --------- | ------ |
| Regra de borda sem rota registrada (regra morta) reprova | `edgeParity.spec.ts:153` — `expect(differences).toEqual([{ prefix: '/api', missingFrom: 'apps/server (dead rule in the Caddyfile)' }])` | ✅ PASS |
| Caminho com dois-pontos casa pelo prefixo literal | `edgeParity.spec.ts:41` — `expect(toEdgePrefix('/users:lookup')).toBe('/users')` | ✅ PASS |
| Prefixo do servidor colidindo com caminho do SPA | `routePrefixes.spec.ts:32` — nenhum prefixo é segmento interno de outro | ✅ PASS |
| Servidor fora do ar em dev devolve erro do proxy, nunca `index.html` | **sem teste** | ⚠️ Comportamento do Vite |

⚠️ O último é comportamento do próprio Vite quando o alvo do proxy recusa conexão, não código
deste repositório. Testá-lo cairia no Check C.

---

## Discrimination Sensor

Mutações aplicadas ao arquivo real e revertidas por cópia; `git status` conferido ao final.

| # | File | Mutação | Killed? |
| - | ---- | ------- | ------- |
| 1 | `infra/compose/Caddyfile` | `handle /libraries*` removido | ✅ 1 teste falhou |
| 2 | `infra/compose/Caddyfile` | Regra morta `/api` reintroduzida | ✅ 2 testes falharam |
| 3 | `apps/web/vite.config.ts` | Import trocado por `const SERVER_ROUTE_PREFIXES = ['/auth']` local | ❌→✅ **sobreviveu na primeira rodada**, morta após correção |

**Resultado da mutação 3**: o guard de `prefixesFromViteConfig` procurava a string
`SERVER_ROUTE_PREFIXES`, que uma redefinição local com o mesmo nome satisfaz — ou seja, o teste
teria aprovado exatamente a divergência que ele existe para impedir. Reescrito para exigir o
`import` real de `@arch-canvas/shared-contracts`, com teste próprio para a redefinição local
(`edgeParity.spec.ts:119`). Mutação re-aplicada e morta.

**Sensor depth**: P0-full
**Result**: 3/3 mortas após correção — ✅ PASS (1 sobrevivente corrigida dentro da onda)

---

## Code Quality

| Princípio | Status |
| --------- | ------ |
| Código mínimo | ✅ |
| Mudanças cirúrgicas | ✅ |
| Sem scope creep | ✅ |
| Segue os padrões existentes | ✅ |
| Valores asseverados batem com a spec | ✅ |
| Todo teste mapeia para um requisito | ✅ |
| Nenhum teste enfraquecido, pulado ou removido | ✅ |
| Piso de cobertura respeitado, nunca baixado | ✅ (`shared-contracts` subiu para 100% de linhas cobrindo o barrel de verdade) |

---

## Gate Check

| Comando | Resultado |
| ------- | --------- |
| `make lint` | ✅ 0 erros |
| `make typecheck` | ✅ 25/25 |
| `pnpm --filter @arch-canvas/shared-contracts run test:unit` | ✅ 38/38 |
| `pnpm --filter @arch-canvas/web run test:unit` | ✅ 920/920 |
| `pnpm --filter @arch-canvas/repo-tools run test:unit` | ⚠️ 65/66 — 1 falha pré-existente (`webConsumers.spec.ts`, GATE-02) |
| `pnpm --filter @arch-canvas/web test:e2e` | ✅ 2/2 contra o proxy novo |
| `docker compose ... config` | ✅ válido |

---

## Gaps encontrados durante a execução

### Gap 1 — Prefixo `/share-links` sem rota em nenhuma borda (Major, fechado)

`POST /share-links/:id:revoke` (`apps/server/src/modules/share/routes.ts:275`) é registrado no
nível raiz, não sob `/share`. Nem o `Caddyfile` nem a lista de T1 o declaravam. O Caddy o alcançava
por acidente, porque `/share*` também casa `/share-links` — correção por coincidência. Declarado e
roteado explicitamente em `bc81b3a`.

Encontrado pelo teste de paridade na sua primeira execução contra o repositório real, que é
exatamente o que ele existe para fazer.

### Gap 2 — Guard do extrator aprovava a divergência que deveria barrar (Major, fechado)

Ver Sensor, mutação 3. Corrigido dentro da onda.

### Gap 3 — EDGE-03 e EDGE-04 sem prova de execução (Minor, aberto por desenho)

Ambos precisam do stack de pé. Cobertos por GATE-09..12 na spec `green-gate`, que é a próxima da
ordem de execução do roadmap. Registrados como ⚠️ Estrutural, nunca como ✅.

---

## Requirement Traceability Update

EDGE-01 a EDGE-12: `Pending` → `✅ Verified`, com EDGE-03 e EDGE-04 marcados
`⚠️ Verified (estrutural)` — a prova de execução chega em R20.

---

## Summary

**PASS.** 10 de 12 ACs com asserção direta; os 2 restantes exigem o stack de pé e estão declarados
como estruturais, com dono nomeado em R20 em vez de arredondados para verde. O sensor matou 3 de 3
mutações, uma delas só depois de expor um guard que aprovaria a própria divergência que deveria
barrar.

A entrega funcional: o `Caddyfile` deixou de rotear um namespace inexistente e passou a rotear os 15
prefixos reais, e o proxy de desenvolvimento deixou de manter uma segunda lista incompleta. Os sete
prefixos que ele omitia (dock de IA, biblioteca, admin de providers, apresentações, share links,
tokens MCP e o lookup de convite) voltam a funcionar em desenvolvimento, e um prefixo novo que não
seja roteado nas duas bordas passa a reprovar o gate nomeando qual borda o omitiu.
