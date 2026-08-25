# ADR-0015: Primeiro acesso como rota pública autolimitada

## Status

Aceita

## Data

2026-08-24

## Contexto

`createLocalAccount` não tinha nenhum chamador de produção — apenas testes e o harness e2e. Uma
instância recém-subida mostrava uma tela de login e não tinha conta nenhuma com que entrar. A única
saída documentável era `make shell-postgres` e inserir um hash Argon2 à mão. O README prometia um
Quick start que terminava em `http://localhost:8080` sem mencionar esse abismo.

## Decisão

A criação do administrador inicial é uma rota pública autolimitada: `GET`/`POST /auth/first-run`,
disponível apenas enquanto a tabela `users` está vazia, respondendo `404` em ambas as verbas assim
que deixa de estar.

A operação é transacional — conta, organização, workspace e associação `org_admin` numa única
transação — e a corrida é resolvida pelo banco, sob `pg_advisory_xact_lock`, não pela aplicação: a
perdedora recebe `409`. O papel nunca vem de parâmetro do cliente. A rota reusa o limitador de taxa
já aplicado às demais rotas de auth, com chave por IP, já que não há sessão para chavear.

## Consequências

- Uma superfície pública nova no módulo de auth, cuja segurança depende inteiramente da guarda de
  instância vazia. Por isso a guarda é do banco (não da aplicação), a resposta indisponível é `404`
  (não `403`, que confirmaria o estado da instância) e o papel é constante no código.
- Descartado: provisionar por variável de ambiente. Manteria segredo em variável persistida e
  duplicaria o caminho de criação de conta.
- Descartado: CLI executado via `make shell-server`. Exigiria passo manual em todo deploy novo e, no
  Dokploy, um exec no container.
- A garantia sob concorrência genuína não é exercitável com PGlite, que serializa conexões; o teste
  local prova o caminho de decisão e o CI, com Postgres real, prova o paralelismo.
