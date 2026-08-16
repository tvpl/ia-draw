# Platform Maturity — Design (Onda F8: Governança e contrato)

Design leve, escopado só a F8 (GOV-01..06, API-01..03). F6 e F7 não precisaram de Design formal
(convenção/config de baixo risco); F8 tem uma decisão de arquitetura real (API-01) e toca ~19
arquivos de `apps/server` — por isso passa pela fase antes de virar `tasks.md`.

---

## API-01/02: OpenAPI 3.1 a partir dos schemas Zod existentes

**Decisão** (confirmada com o usuário — três abordagens foram avaliadas: retrofit via
`schema` do Fastify, extração estática por regex/AST, e exportar um registro por módulo;
a terceira venceu por ter fidelidade real sem mudar comportamento de rota nenhuma):

Cada `routes.ts` passa a exportar uma constante `routeSchemas` — um registro `"MÉTODO path" →
{ query?, params?, body?, response? }` apontando para os mesmos objetos Zod que o handler já usa
em `.parse(...)`. Nenhuma rota muda de comportamento; é só um export novo por módulo.

```ts
// apps/server/src/modules/ai-provider/routes.ts (exemplo, T-shape)
export const routeSchemas: RouteSchemaMap = {
  'GET /admin/ai-providers': { query: listQuerySchema },
  'POST /admin/ai-providers': { body: createBodySchema },
  'PATCH /admin/ai-providers/:id': { params: idParamsSchema, body: updateBodySchema },
  // ...
};
```

`RouteSchemaMap` (tipo) e a função geradora vivem em `tools/repo-tools` (já é o lar do extrator
de rotas por regex — `extractServerRoutes` — que dá method+path; o gerador OpenAPI cruza essa
lista com os `routeSchemas` importados de cada módulo). Conversão Zod→JSON Schema usa
`z.toJSONSchema()` — nativo do Zod 4 (`^4.1.12` já é a versão instalada), zero dependência nova.

**Módulo piloto**: `ai-provider` (já lido nesta sessão, schemas simples, bom caso de prova).
**Cobertura obrigatória**: os 17 `routes.ts` sob `apps/server/src/modules/*/routes.ts`.

**Arquivo gerado**: `docs/openapi.json` (OpenAPI 3.1, `openapi: "3.1.0"`), regenerado por
`pnpm --filter @arch-canvas/repo-tools run openapi` (mesmo padrão do `run audit`, mesma lição
L-022 aplicada — usar `run` desde o início).

**API-02 (CI gate — rota divergente)**: mesmo padrão que TRU-03/UIX-01 já usam (capability-audit):
um job de CI regenera `docs/openapi.json` e falha com `git diff --exit-code` nomeando o arquivo
divergente se o commitado não bater com o gerado. Reusa o job `capability-audit` existente
(adiciona um step) em vez de criar um workflow novo — mesma superfície, mesmo padrão.

**Rotas sem schema exportado**: o gerador falha citando a rota exata (mesmo padrão de erro do
`capabilityMap.ts` — nunca "N rotas com problema", sempre a lista). Isso cobre o Edge Case do
spec.md ("IF a geração do OpenAPI produzir um documento sem nenhuma rota THEN o CI SHALL falhar").

---

## API-03: limiar de sucesso dos evals do ai-engine

`apps/server/src/modules/ai-engine/evals/evals.spec.ts` já existe (10 casos determinísticos,
T57) mas roda dentro do `test:unit` genérico — uma falha ali não é distinguível de qualquer outra
falha de teste, e não há noção de "limiar" (é binário: os 10 casos passam ou o job todo fica
vermelho).

**Decisão**: os evals continuam sendo o mesmo arquivo Vitest (não vale reescrever a suíte —
"Out of Scope" do spec.md proíbe isso), mas passam a rodar como um step de CI nomeado
("AI evals") que declara o limiar explicitamente (constante `EVAL_SUCCESS_THRESHOLD = 1.0` — 100%
é o valor correto hoje porque a suíte é 100% determinística, provider mockado, sem chamada de
rede real; o mecanismo existe pronto para quando `AIG`-provider real entrar em uma onda futura e
os casos deixarem de ser 100% determinísticos). Um pequeno reporter/wrapper conta
passed/total e falha explicitamente citando "X/Y evals passed, limiar Z%" se abaixo do limiar —
em vez de deixar o Vitest genérico fazer isso implicitamente sem declarar o número.

---

## GOV-01: CODEOWNERS

Ownership por fronteira de pastas (já é a fronteira real do monorepo, por AD confirmada em
spec.md): `apps/server/`, `apps/web/`, `packages/`, `infra/`, `.github/`, `docs/`, `.specs/`.
Dono único hoje: `@tvpl` (confirmado via `gh api user`/`gh api repos/tvpl/ia-draw/collaborators`
— único colaborador real do repo agora). Nenhum time inventado; quando squads existirem de
verdade, o `CODEOWNERS` troca `@tvpl` pelo time real linha a linha — decisão já registrada no
spec.md's Assumptions table.

## GOV-02: PR template

`.github/PULL_REQUEST_TEMPLATE.md` — campos obrigatórios: IDs de requisito afetados, link pra
spec, checklist "gate rodou" (`/gate`, reforça F7).

## GOV-03: Changesets

Todo `packages/*` é `"private": true` (nenhum publicado no npm) — Changesets aqui serve só pra
changelog interno coordenado entre squads, nunca `changeset publish` de verdade. `@changesets/cli`
(`.changeset/config.json` com `"access": "restricted"`, sem npm registry real) + um step de CI
que falha nomeando o package se um PR alterar `packages/<nome>/src/**` sem um arquivo novo em
`.changeset/`.

## GOV-04: uma spec por domínio

Já é verdade estruturalmente (`ai-dock/spec.md` existe como exemplar desde F6, prefixo `DOCK`
próprio). Este item não pede código novo — só confirmação/nota no `README.md`/`CLAUDE.md` de que
o padrão é "uma spec por domínio", não uma tarefa de implementação isolada. Task 1 linha do
`CLAUDE.md`.

## GOV-05: template de ADR

`docs/adr/0001..0009` já seguem o mesmo formato (Status/Contexto/Decisão/Consequências) sem um
template explícito documentado. Cria `docs/adr/TEMPLATE.md` extraindo esse formato já usado (não
inventa um novo), referenciado no `CLAUDE.md`.

## GOV-06: `STATE.md` por frente

Hoje `## Handoff` é um bloco único. Formato novo: `## Handoffs` (plural) com uma subseção
`### <feature-slug> (branch: ...)` por frente ativa — permite duas frentes paralelas sem colidir
no merge (Edge Case do spec.md: "WHEN dois squads editarem STATE.md na mesma janela THEN o
formato por frente SHALL permitir merge sem perda de contexto de nenhuma das frentes" — subseções
por frente resolvem isso via merge de Markdown normal, sem lock nem ferramenta nova). Migra o
Handoff atual (só uma frente: `platform-maturity`) pro novo formato como prova de que funciona
com 1 frente e comporta N.

---

## Riscos e limites (disclosed, não bloqueantes)

- `z.toJSONSchema()` no Zod 4 não cobre 100% dos refinamentos customizados (`.refine()`,
  `.transform()`) com a mesma fidelidade de um schema simples — quando um `routes.ts` usar
  `.refine()`, o campo correspondente no OpenAPI vira o schema base sem a regra de refinamento
  (documentado no JSON Schema gerado como está, não fingido). Nenhum dos schemas lidos até agora
  usa `.refine()`, mas o gerador não deve quebrar se encontrar um.
- Changesets sem publish real é um uso levemente não-canônico da ferramenta — mas é exatamente o
  que a AC pede (changelog interno, não publicação), e é um padrão documentado da própria
  ferramenta (`privatePackages` / uso apenas para `version`).
