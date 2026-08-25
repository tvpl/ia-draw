---
"@arch-canvas/shared-contracts": patch
---

Adiciona `SERVER_ROUTE_PREFIXES` e `WS_ROUTE_PREFIX`: a declaração única de quais prefixos de caminho pertencem a `apps/server`, consumida pelo proxy de desenvolvimento e verificada contra o `Caddyfile` pelo teste de paridade de borda (EDGE-09).
