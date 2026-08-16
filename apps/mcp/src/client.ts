/**
 * Thin HTTP client over the arch-canvas REST API's MCP read routes (T5-T7).
 * `apps/mcp` never imports `@arch-canvas/diagram-domain`,
 * `@arch-canvas/diagram-ir`, or any other server-side package directly
 * (design.md, "Arquitetura: apps/mcp como cliente HTTP fino") — every
 * response shape below is declared locally, structurally matching what the
 * REST routes return, never imported from the packages that define them.
 * The only I/O primitive used is Node's native `fetch`; no HTTP library is
 * added as a dependency.
 */

/** Mirrors `diagram-ir/v1`'s `IrDocument` shape (`packages/diagram-ir/src/schema.ts`) structurally — never imported, per the module doc comment above. */
export interface IrNodeLike {
  id: string;
  label: string;
  componentKey?: string;
  semantics?: Record<string, string>;
}

export interface IrContainerLike {
  id: string;
  label: string;
  kind: string;
  children: string[];
}

export interface IrEdgeLike {
  from: string;
  to: string;
  semantics: {
    mode: string;
    direction: string;
    protocol?: string;
    label?: string;
  };
}

export interface IrDocumentLike {
  version: string;
  kind: string;
  nodes: IrNodeLike[];
  containers: IrContainerLike[];
  edges: IrEdgeLike[];
}

/** Mirrors `workspace/diagrams.ts`'s `Diagram` row, the shape `GET /workspaces/:id/diagrams` returns under `items`. */
export interface DiagramSummary {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors `library/metadata.ts`'s `ElementMetadataRow`, the shape `GET /diagrams/:id/components/:stableKey`'s `metadata` array carries. */
export interface ComponentMetadataLike {
  diagramId: string;
  elementId: string;
  semanticType: string | null;
  metadataJson: unknown;
  revision: number;
}

/** Mirrors `mcp/componentLookup.ts`'s `ComponentRelationEdge`. */
export interface ComponentRelationEdgeLike {
  from: string;
  to: string;
  label: string | null;
}

export interface ComponentLookupResult {
  metadata: ComponentMetadataLike[];
  inbound: ComponentRelationEdgeLike[];
  outbound: ComponentRelationEdgeLike[];
}

/** Mirrors `POST /diagrams/:id/mcp-patch`'s response shape (`mcp/routes.ts`, T14). */
export interface SetComponentMetadataResult {
  snapshotId: string;
  revision: number;
}

export interface SetComponentMetadataInput {
  sourceRevision: number;
  elementId: string;
  metadata: Record<string, unknown>;
}

/**
 * Thrown for any non-2xx response — the request never resolves to a
 * partial/best-effort object on failure, only ever this typed error or a
 * fully-formed success value.
 */
export class McpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
    public readonly body: string,
  ) {
    super(`MCP API request to ${url} failed with ${status}: ${body}`);
    this.name = 'McpApiError';
  }
}

export interface McpClientConfig {
  /** Defaults to `process.env.ARCH_CANVAS_API_URL`. */
  apiUrl?: string;
  /** Defaults to `process.env.ARCH_CANVAS_MCP_TOKEN`. */
  token?: string;
  /** Injectable for tests — defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function requireConfigValue(value: string | undefined, envVarName: string): string {
  if (!value) {
    throw new Error(`${envVarName} is not set — required to reach the arch-canvas API`);
  }
  return value;
}

/**
 * Reads `ARCH_CANVAS_API_URL`/`ARCH_CANVAS_MCP_TOKEN` from `process.env`
 * (or the constructor overrides) and injects `Authorization: Bearer
 * <token>` on every request — one method per REST route T5-T7 built.
 */
export class McpClient {
  private readonly apiUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: McpClientConfig = {}) {
    this.apiUrl = requireConfigValue(
      config.apiUrl ?? process.env.ARCH_CANVAS_API_URL,
      'ARCH_CANVAS_API_URL',
    ).replace(/\/+$/, '');
    this.token = requireConfigValue(
      config.token ?? process.env.ARCH_CANVAS_MCP_TOKEN,
      'ARCH_CANVAS_MCP_TOKEN',
    );
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private async request<T>(
    path: string,
    options: { method?: string; body?: string } = {},
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;
    const response = await this.fetchImpl(url, {
      method: options.method,
      body: options.body,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new McpApiError(response.status, url, body);
    }
    return (await response.json()) as T;
  }

  /** `GET /workspaces/:id/diagrams` (MCP-01). */
  async listDiagrams(workspaceId: string): Promise<DiagramSummary[]> {
    const { items } = await this.request<{ items: DiagramSummary[] }>(
      `/workspaces/${encodeURIComponent(workspaceId)}/diagrams`,
    );
    return items;
  }

  /** `GET /diagrams/:id/ir` (MCP-01/02). */
  async getDiagramIr(diagramId: string): Promise<IrDocumentLike> {
    return this.request<IrDocumentLike>(`/diagrams/${encodeURIComponent(diagramId)}/ir`);
  }

  /** `GET /diagrams/:id/components/:stableKey` (MCP-03). */
  async getComponent(diagramId: string, stableKey: string): Promise<ComponentLookupResult> {
    return this.request<ComponentLookupResult>(
      `/diagrams/${encodeURIComponent(diagramId)}/components/${encodeURIComponent(stableKey)}`,
    );
  }

  /**
   * `POST /diagrams/:id/mcp-patch` (MCP-07, T14) — only reachable when the
   * server booted with `MCP_WRITE_ENABLED=true`; a disabled server responds
   * 404 the same way a nonexistent route does, surfaced here as the same
   * typed `McpApiError` every other non-2xx response produces.
   */
  async setComponentMetadata(
    diagramId: string,
    input: SetComponentMetadataInput,
  ): Promise<SetComponentMetadataResult> {
    return this.request<SetComponentMetadataResult>(
      `/diagrams/${encodeURIComponent(diagramId)}/mcp-patch`,
      {
        method: 'POST',
        body: JSON.stringify({
          sourceRevision: input.sourceRevision,
          op: { op: 'setMetadata', elementId: input.elementId, metadata: input.metadata },
        }),
      },
    );
  }
}
