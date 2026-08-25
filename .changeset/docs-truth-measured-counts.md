---
"@arch-canvas/repo-tools": patch
---

O auditor passa a checar o mapa de capacidades nas duas direções (uma capacidade marcada `backend-only` cujo módulo já tem consumidor em `apps/web/src` reprova) e a gerar o bloco de contagens do `README.md` a partir da medição, falhando quando o que está escrito diverge do que ele mede. O extrator de consumidores reconhece qualquer binding de fetch injetado — `doFetch`, `adminFetch`, `rawFetchImpl` — em vez dos dois nomes literais que deixavam clientes inteiros invisíveis, e o casamento de rota normaliza parâmetro colado a texto literal (`/diagrams/:id/export:format`). Medição: 51 → 67 rotas consumidas (DOCS-01..05).
