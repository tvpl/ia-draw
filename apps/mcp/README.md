# `@arch-canvas/mcp`

MCP (Model Context Protocol) server that exposes arch-canvas diagrams as
context for AI agents — read-only by default, with an opt-in write path.
It never touches the database directly: every call is a thin HTTP request
to the arch-canvas REST API, authenticated with an MCP token.

## What it exposes

- `diagrams://{workspaceId}` — lists the diagrams in a workspace
- `diagram://{diagramId}` — the diagram's `diagram-ir/v1` structure (nodes,
  containers, edges, metadata) — never a rendered image
- `component://{diagramId}/{stableKey}` — a component's metadata plus its
  inbound/outbound relations
- `set_component_metadata` tool — only registered when write mode is on
  (see below)

## Configure Claude Code

Add an entry under `mcpServers` in Claude Code's MCP config:

```json
{
  "mcpServers": {
    "arch-canvas": {
      "command": "npx",
      "args": ["-y", "@arch-canvas/mcp"],
      "env": {
        "ARCH_CANVAS_API_URL": "https://your-arch-canvas-server.example.com",
        "ARCH_CANVAS_MCP_TOKEN": "<paste your MCP token here>"
      }
    }
  }
}
```

## Configure Cursor

Same shape, in Cursor's `mcp.json`:

```json
{
  "mcpServers": {
    "arch-canvas": {
      "command": "npx",
      "args": ["-y", "@arch-canvas/mcp"],
      "env": {
        "ARCH_CANVAS_API_URL": "https://your-arch-canvas-server.example.com",
        "ARCH_CANVAS_MCP_TOKEN": "<paste your MCP token here>"
      }
    }
  }
}
```

Both snippets are copy-pasteable as-is — the only edits needed are the
API URL and the token value.

## Getting a token

There is no UI for this yet. Tokens are minted by calling the REST API
directly, with a real logged-in session (not an MCP token):

```
POST /workspaces/:id/mcp-tokens
```

This route requires an authenticated session (`requireSession`) and
workspace-admin permissions — only a `workspace_admin` or `org_admin`
member can issue a token. See
`apps/server/src/modules/mcp/routes.ts` for the exact request/response
shape. The response includes the plaintext token exactly once, at
creation time — it is never recoverable afterward, so copy it into
`ARCH_CANVAS_MCP_TOKEN` immediately.

## Write mode

Write access (the `set_component_metadata` tool and the server-side
`POST /diagrams/:id/mcp-patch` route) is off by default. Setting
`MCP_WRITE_ENABLED=true` in the arch-canvas server's environment unlocks
it — with the flag off, the write route and the tool simply don't exist.
