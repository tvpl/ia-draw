# ADR-0013: Contrato único de prefixos de rota nas bordas HTTP

## Status

Aceita

## Data

2026-08-24

## Contexto

O produto tem duas bordas HTTP que decidem "isto é API ou é SPA?": o Caddy do compose
(`infra/compose/Caddyfile`) e o proxy de desenvolvimento do Vite (`apps/web/vite.config.ts`). Elas
respondiam de formas diferentes, e ambas erradas.

O `Caddyfile` encaminhava `/api/*` — um namespace que nenhuma das rotas registradas usa. Toda chamada
de API no stack do Docker caía no catch-all, chegava ao nginx e recebia a SPA de volta;
`POST /auth/login` respondia 405. O stack subia com todos os health checks verdes e ninguém
conseguia autenticar.

O proxy do Vite já tinha detectado a divergência e a documentado num comentário `SPEC_DEVIATION`,
corrigindo apenas a si mesmo — e ainda assim omitia sete prefixos, entre eles `/ai`, `/libraries`,
`/share` e `/users`. Nada em lugar nenhum obrigava as duas bordas a concordarem com as rotas
realmente registradas.

## Decisão

Os prefixos de caminho que pertencem a `apps/server` são declarados uma única vez, em
`packages/shared-contracts/src/routePrefixes.ts`. O proxy de desenvolvimento importa a lista. O
`Caddyfile` continua escrito à mão, porque Caddy não executa JavaScript, mas um teste de paridade em
`tools/repo-tools/src/edgeParity.ts` exige que as rotas registradas, o `Caddyfile` e o proxy de
desenvolvimento descrevam exatamente o mesmo conjunto — e falha nomeando o prefixo em falta e a borda
que o omitiu.

As rotas do servidor continuam **sem** prefixo `/api`.

## Consequências

- Uma mudança de prefixo exige editar dois arquivos, já que o `Caddyfile` não é gerado. Em troca ele
  continua legível e `infra/` não ganha passo de build.
- Prefixar as 90 rotas com `/api` foi descartado: quebraria `docs/openapi.json`, o módulo MCP e todo
  consumidor externo, custo desproporcional a um defeito de roteamento de borda.
- O extrator do `Caddyfile` falha quando não consegue interpretar o arquivo, nunca devolve conjunto
  vazio — passar por omissão é o modo de falha que este contrato existe para impedir.
- Regra morta também reprova: um `handle` sem rota correspondente falha o gate, que foi como `/api`
  sobreviveu por semanas.
