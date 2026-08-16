---
"@arch-canvas/database": patch
"@arch-canvas/diagram-ir": patch
---

Adds the `mcp_tokens` table (F9, MCP-04) and the `decompile()` reverse compiler from a saved scene back to `diagram-ir/v1` (F9, MCP-02) — the first scene→IR conversion in the project, closing the round-trip debt noted in ADR-0004.
