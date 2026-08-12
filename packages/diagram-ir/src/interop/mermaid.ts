import { type IrContainer, type IrDocument, type IrEdge, type IrNode, validateIr } from '../schema.js';

/**
 * Mermaid flowchart import/export (T60, AAC-01/02). Supported subset only:
 *   - header: `flowchart <DIR>` / `graph <DIR>` (direction is not carried
 *     into the IR — `diagram-ir/v1` has no direction concept — and is simply
 *     skipped on import; export always emits `flowchart TD`).
 *   - node definitions: `id[label]` (rectangle), `id(label)` (rounded),
 *     `id{label}` (diamond) — the shape itself is NOT representable in
 *     `IrNode` (no shape field), so it is dropped on import and every node
 *     is re-emitted as `id[label]` on export, regardless of its original
 *     shape. This is a one-way information loss, not a parse failure.
 *   - edges: `A --> B`, `A -->|label| B`.
 *   - `subgraph <id>[<label>] ... end` (or bare `subgraph <label> ... end`,
 *     which mermaid treats as both id and label) → `IrContainer(kind:
 *     'group')`, nesting allowed.
 * Any line that doesn't match one of the above (and isn't blank or a `%%`
 * comment) is skipped — never invented, never aborts the whole parse —
 * and reported verbatim in `limitations`.
 */

const HEADER_RE = /^(flowchart|graph)\b/i;
const COMMENT_RE = /^%%/;
const SUBGRAPH_RE = /^subgraph\s+(.+)$/i;
const END_RE = /^end$/i;
// `A -->|label| B` or `A --> B`. Label group excludes `|` so it can't swallow the arrow.
const EDGE_RE = /^(.+?)\s*-->\s*(?:\|([^|]*)\|\s*)?(.+)$/;
// `id`, `id[label]`, `id(label)`, `id{label}`.
const NODE_SPEC_RE = /^([A-Za-z0-9_-]+)\s*(?:\[(.*)\]|\((.*)\)|\{(.*)\})?$/;

interface ParsedNodeRef {
  id: string;
  label: string;
}

function parseNodeSpec(raw: string): ParsedNodeRef | null {
  const match = NODE_SPEC_RE.exec(raw.trim());
  if (!match) return null;
  const [, id, bracketLabel, parenLabel, braceLabel] = match;
  if (!id) return null;
  const label = bracketLabel ?? parenLabel ?? braceLabel ?? id;
  return { id, label: label.trim().length > 0 ? label.trim() : id };
}

function slugify(text: string): string {
  const slug = text
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : `group_${text.length}`;
}

/** Default semantics assigned to every edge parsed from Mermaid, which has no equivalent concept for `mode`/`direction`. Mirrored on export as the "no extra semantics asserted" baseline that costs zero `limitations` entries (see `toMermaidFlowchart`). */
const IMPORTED_EDGE_MODE = 'dependency' as const;
const IMPORTED_EDGE_DIRECTION = 'oneway' as const;

/** Default `kind` assigned to every document parsed from Mermaid — flowchart syntax carries no `diagram-ir` kind concept, so this is a documented, overridable default rather than an invented fact. */
const DEFAULT_IMPORT_KIND = 'c4-context' as const;

/**
 * Parses a Mermaid `flowchart`/`graph` document into a `diagram-ir/v1`
 * `IrDocument`. Never throws on unrecognized syntax — such lines are
 * collected into `limitations` and skipped. `validateIr` is run on the
 * result before returning (referential integrity is guaranteed by
 * construction here, but this keeps a single source of truth for "valid").
 */
export function parseMermaidFlowchart(dsl: string): { ir: IrDocument; limitations: string[] } {
  const limitations: string[] = [];
  const nodes = new Map<string, IrNode>();
  const containers = new Map<string, IrContainer>();
  const edges: IrEdge[] = [];
  const containerStack: string[] = [];

  function registerNode(ref: ParsedNodeRef): void {
    if (!nodes.has(ref.id)) {
      nodes.set(ref.id, { id: ref.id, label: ref.label });
    }
    const parentId = containerStack.at(-1);
    if (parentId) {
      const parent = containers.get(parentId);
      if (parent && !parent.children.includes(ref.id)) parent.children.push(ref.id);
    }
  }

  const lines = dsl.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || COMMENT_RE.test(line) || HEADER_RE.test(line)) return;

    if (END_RE.test(line)) {
      if (containerStack.length === 0) {
        limitations.push(`line ${index + 1}: unmatched "end" (no open subgraph): "${rawLine.trim()}"`);
        return;
      }
      containerStack.pop();
      return;
    }

    const subgraphMatch = SUBGRAPH_RE.exec(line);
    if (subgraphMatch?.[1]) {
      const rest = subgraphMatch[1].trim();
      const ref = parseNodeSpec(rest);
      const id = ref?.id ?? slugify(rest);
      const label = ref?.label ?? rest.replace(/^"(.*)"$/, '$1');
      const container: IrContainer = { id, label, kind: 'group', children: [] };
      containers.set(id, container);
      const parentId = containerStack.at(-1);
      if (parentId) {
        const parent = containers.get(parentId);
        if (parent && !parent.children.includes(id)) parent.children.push(id);
      }
      containerStack.push(id);
      return;
    }

    const edgeMatch = EDGE_RE.exec(line);
    if (edgeMatch) {
      const [, leftRaw, edgeLabel, rightRaw] = edgeMatch;
      const left = leftRaw ? parseNodeSpec(leftRaw) : null;
      const right = rightRaw ? parseNodeSpec(rightRaw) : null;
      if (!left || !right) {
        limitations.push(`line ${index + 1}: unrecognized edge syntax: "${rawLine.trim()}"`);
        return;
      }
      registerNode(left);
      registerNode(right);
      edges.push({
        from: left.id,
        to: right.id,
        semantics: {
          mode: IMPORTED_EDGE_MODE,
          direction: IMPORTED_EDGE_DIRECTION,
          ...(edgeLabel && edgeLabel.trim().length > 0 ? { label: edgeLabel.trim() } : {}),
        },
      });
      return;
    }

    const nodeRef = parseNodeSpec(line);
    if (nodeRef) {
      registerNode(nodeRef);
      return;
    }

    limitations.push(`line ${index + 1}: unrecognized syntax, skipped: "${rawLine.trim()}"`);
  });

  const ir: IrDocument = {
    version: 'v1',
    kind: DEFAULT_IMPORT_KIND,
    nodes: Array.from(nodes.values()),
    containers: Array.from(containers.values()),
    edges,
  };

  return { ir: validateIr(ir), limitations };
}

/** Modes that round-trip losslessly through the exported/imported baseline (see `IMPORTED_EDGE_MODE`) — any other mode has no Mermaid arrow equivalent and is annotated. */
const LOSSLESS_EXPORT_MODE = IMPORTED_EDGE_MODE;

function mermaidNodeLine(node: IrNode): string {
  return `  ${node.id}[${node.label}]`;
}

function renderContainer(
  container: IrContainer,
  containersById: Map<string, IrContainer>,
  nodesById: Map<string, IrNode>,
  depth: number,
): string[] {
  const indent = '  '.repeat(depth + 1);
  const lines = [`${indent}subgraph ${container.id}[${container.label}]`];
  for (const childId of container.children) {
    const childContainer = containersById.get(childId);
    if (childContainer) {
      lines.push(...renderContainer(childContainer, containersById, nodesById, depth + 1));
      continue;
    }
    const childNode = nodesById.get(childId);
    if (childNode) lines.push(`${indent}  ${childNode.id}[${childNode.label}]`);
  }
  lines.push(`${indent}end`);
  return lines;
}

/**
 * Renders a `diagram-ir/v1` document as a Mermaid `flowchart TD` DSL.
 * Containers become `subgraph`s (nesting preserved); nodes not listed as a
 * child of any container are emitted as loose top-level node definitions.
 * Any `IrEdge.semantics.mode` other than the "no extra semantics asserted"
 * baseline (`'dependency'`) has no Mermaid arrow equivalent in this
 * subset — it is still exported as a plain `-->`, but is additionally
 * annotated with a `%%` comment and listed in `limitations` so the loss is
 * never silent. The same applies to `direction: 'bidirectional'`, which
 * this subset's single-arrowhead `-->` cannot represent.
 */
export function toMermaidFlowchart(ir: IrDocument): { dsl: string; limitations: string[] } {
  const limitations: string[] = [];
  const nodesById = new Map(ir.nodes.map((node) => [node.id, node]));
  const containersById = new Map(ir.containers.map((container) => [container.id, container]));
  const nestedNodeIds = new Set(
    ir.containers.flatMap((container) => container.children).filter((id) => nodesById.has(id)),
  );
  const nestedContainerIds = new Set(
    ir.containers.flatMap((container) => container.children).filter((id) => containersById.has(id)),
  );

  const lines = ['flowchart TD'];

  for (const container of ir.containers) {
    if (nestedContainerIds.has(container.id)) continue; // rendered by its parent
    lines.push(...renderContainer(container, containersById, nodesById, 0));
  }

  for (const node of ir.nodes) {
    if (nestedNodeIds.has(node.id)) continue;
    lines.push(mermaidNodeLine(node));
  }

  for (const edge of ir.edges) {
    const label = edge.semantics.label;
    const arrow = label ? `-->|${label}|` : '-->';
    lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
    if (edge.semantics.mode !== LOSSLESS_EXPORT_MODE) {
      const note = `edge ${edge.from}->${edge.to}: semantic mode "${edge.semantics.mode}" has no Mermaid arrow equivalent, exported as a plain arrow`;
      lines.push(`  %% ${note}`);
      limitations.push(note);
    }
    if (edge.semantics.direction === 'bidirectional') {
      const note = `edge ${edge.from}->${edge.to}: direction "bidirectional" has no equivalent in this Mermaid subset, exported as one-way`;
      lines.push(`  %% ${note}`);
      limitations.push(note);
    }
  }

  return { dsl: lines.join('\n'), limitations };
}
