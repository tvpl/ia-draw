import {
  type IrContainer,
  type IrDocument,
  type IrEdge,
  type IrNode,
  validateIr,
} from '../schema.js';

/**
 * Structurizr DSL import/export (T61, AAC-01/02) — same `{ ir, limitations }`
 * / `{ dsl, limitations }` contract as `mermaid.ts` (T60). Supported subset
 * only: `model { softwareSystem "Name" { container "Name" { ... } } }` and
 * `relationship` lines (`a -> b "label"`), mapped to
 * `IrContainer(kind: 'boundedContext')` (softwareSystem) / `IrNode`
 * (container) / `IrEdge` (relationship). `workspace { ... }` and
 * `model { ... }` are recognized as transparent structural wrappers (no IR
 * node/container is created for them). `person "Name" { ... }` is accepted
 * as a bonus (maps to a bare top-level `IrNode`) beyond the letter of the
 * task spec, because real Structurizr files reference actors in
 * relationships constantly — without it, every relationship touching a
 * person would be silently dropped as "dangling", which is a worse outcome
 * than the small scope extension. Any other block (`views`, `styles`,
 * `deploymentEnvironment`, `component`, bare property lines, ...) is
 * ignored — its extent (brace-tracked, so nested unrecognized blocks never
 * desync the parser's frame stack) is recorded once in `limitations`, never
 * causes a total parse failure.
 */

const COMMENT_RE = /^\/\//;
const CLOSE_RE = /^\}$/;
const WORKSPACE_RE = /^workspace\b.*\{$/i;
const MODEL_RE = /^model\s*\{$/i;
const IGNORED_BLOCK_RE = /^(views|styles|deploymentEnvironment)\b.*\{$/i;
const SOFTWARE_SYSTEM_RE = /^(?:(\w+)\s*=\s*)?softwareSystem\s+"([^"]*)"\s*(\{)?$/i;
const CONTAINER_RE = /^(?:(\w+)\s*=\s*)?container\s+"([^"]*)"\s*(\{)?$/i;
const PERSON_RE = /^(?:(\w+)\s*=\s*)?person\s+"([^"]*)"\s*(\{)?$/i;
const RELATIONSHIP_RE = /^(\w+)\s*->\s*(\w+)(?:\s+"([^"]*)")?\s*$/;

function slugify(text: string): string {
  const slug = text
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug.length > 0 ? slug : `entity_${text.length}`;
}

function countChar(line: string, ch: string): number {
  return line.split(ch).length - 1;
}

type Frame =
  | { type: 'workspace' }
  | { type: 'model' }
  | { type: 'softwareSystem'; containerId: string }
  | { type: 'container'; nodeId: string }
  | { type: 'person'; nodeId: string }
  | { type: 'unknown' };

const IMPORTED_EDGE_MODE = 'dependency' as const;
const IMPORTED_EDGE_DIRECTION = 'oneway' as const;
const DEFAULT_IMPORT_KIND = 'c4-context' as const;

/**
 * Parses a Structurizr DSL `workspace`/`model` document into a
 * `diagram-ir/v1` `IrDocument`. Never throws on unrecognized syntax —
 * `views`/`styles`/`deploymentEnvironment` and any other out-of-subset block
 * are skipped (brace-depth tracked so a nested unrecognized block never
 * desyncs frame popping) and reported in `limitations`. A relationship
 * referencing an id that was never declared (e.g. inside an ignored block)
 * is omitted rather than invented, same "skip incomplete, never guess"
 * philosophy as `extractSceneSemantics`'s arrow-binding resolution (T58).
 * `validateIr` runs on the result before returning.
 */
export function parseStructurizrDsl(dsl: string): { ir: IrDocument; limitations: string[] } {
  const limitations: string[] = [];
  const nodes = new Map<string, IrNode>();
  const containers = new Map<string, IrContainer>();
  const edges: IrEdge[] = [];
  const stack: Frame[] = [];

  let ignoreDepth = 0;
  let ignoreBlockName = '';
  let ignoreStartLine = 0;

  function currentSoftwareSystemId(): string | undefined {
    for (let i = stack.length - 1; i >= 0; i -= 1) {
      const frame = stack[i];
      if (frame?.type === 'softwareSystem') return frame.containerId;
    }
    return undefined;
  }

  const lines = dsl.split(/\r?\n/);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();

    if (ignoreDepth > 0) {
      ignoreDepth += countChar(line, '{') - countChar(line, '}');
      if (ignoreDepth <= 0) {
        limitations.push(
          `ignored out-of-subset block "${ignoreBlockName}" (structurizr, lines ${ignoreStartLine}-${index + 1})`,
        );
        ignoreDepth = 0;
      }
      return;
    }

    if (line.length === 0 || COMMENT_RE.test(line)) return;

    if (CLOSE_RE.test(line)) {
      if (stack.length === 0) {
        limitations.push(`line ${index + 1}: unmatched "}" (no open block): "${rawLine.trim()}"`);
        return;
      }
      stack.pop();
      return;
    }

    if (WORKSPACE_RE.test(line)) {
      stack.push({ type: 'workspace' });
      return;
    }
    if (MODEL_RE.test(line)) {
      stack.push({ type: 'model' });
      return;
    }

    const ignoredMatch = IGNORED_BLOCK_RE.exec(line);
    if (ignoredMatch?.[1]) {
      ignoreDepth = 1;
      ignoreBlockName = ignoredMatch[1];
      ignoreStartLine = index + 1;
      return;
    }

    const systemMatch = SOFTWARE_SYSTEM_RE.exec(line);
    if (systemMatch) {
      const [, explicitId, name, hasBody] = systemMatch;
      const id = explicitId ?? slugify(name ?? '');
      if (!containers.has(id)) {
        containers.set(id, { id, label: name ?? id, kind: 'boundedContext', children: [] });
      }
      if (hasBody) stack.push({ type: 'softwareSystem', containerId: id });
      return;
    }

    const containerMatch = CONTAINER_RE.exec(line);
    if (containerMatch) {
      const [, explicitId, name, hasBody] = containerMatch;
      const id = explicitId ?? slugify(name ?? '');
      if (!nodes.has(id)) nodes.set(id, { id, label: name ?? id });
      const parentSystemId = currentSoftwareSystemId();
      if (parentSystemId) {
        const parent = containers.get(parentSystemId);
        if (parent && !parent.children.includes(id)) parent.children.push(id);
      }
      if (hasBody) stack.push({ type: 'container', nodeId: id });
      return;
    }

    const personMatch = PERSON_RE.exec(line);
    if (personMatch) {
      const [, explicitId, name, hasBody] = personMatch;
      const id = explicitId ?? slugify(name ?? '');
      if (!nodes.has(id)) nodes.set(id, { id, label: name ?? id });
      if (hasBody) stack.push({ type: 'person', nodeId: id });
      return;
    }

    const relMatch = RELATIONSHIP_RE.exec(line);
    if (relMatch) {
      const [, from, to, label] = relMatch;
      const knownIds = new Set([...nodes.keys(), ...containers.keys()]);
      if (!from || !to || !knownIds.has(from) || !knownIds.has(to)) {
        limitations.push(
          `line ${index + 1}: relationship references an undeclared id, skipped: "${rawLine.trim()}"`,
        );
        return;
      }
      edges.push({
        from,
        to,
        semantics: {
          mode: IMPORTED_EDGE_MODE,
          direction: IMPORTED_EDGE_DIRECTION,
          ...(label && label.trim().length > 0 ? { label: label.trim() } : {}),
        },
      });
      return;
    }

    // Unrecognized line: if it opens a block, push an `unknown` frame so its
    // eventual matching "}" pops the right frame instead of desyncing the
    // stack (e.g. `component "X" {`, `properties {`, `tags "..." {`).
    if (line.endsWith('{')) stack.push({ type: 'unknown' });
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

const LOSSLESS_EXPORT_MODE = IMPORTED_EDGE_MODE;

/**
 * Renders a `diagram-ir/v1` document as a Structurizr DSL string
 * (`workspace { model { ... } } }`). Every top-level `IrContainer` (one not
 * listed as another container's child — this subset's softwareSystem/
 * container nesting is exactly two levels deep, so deeper IR nesting is
 * flattened, noted below) becomes a `softwareSystem`; any `IrNode` listed as
 * its child becomes a nested `container`; any `IrNode` with no parent
 * container is emitted as a bare `container` at the model level (not
 * strictly valid real-world Structurizr, but this exporter's own parser
 * above accepts it — the round-trip contract this module promises — and the
 * loss is documented, not silent). A container whose `kind` is not already
 * `'boundedContext'` is exported as a `softwareSystem` regardless (the only
 * mapping this subset has) and noted in `limitations`.
 */
export function toStructurizrDsl(ir: IrDocument): { dsl: string; limitations: string[] } {
  const limitations: string[] = [];
  const nodesById = new Map(ir.nodes.map((node) => [node.id, node]));
  const containersById = new Map(ir.containers.map((container) => [container.id, container]));
  const nestedNodeIds = new Set(
    ir.containers.flatMap((container) => container.children).filter((id) => nodesById.has(id)),
  );
  const nestedContainerIds = new Set(
    ir.containers.flatMap((container) => container.children).filter((id) => containersById.has(id)),
  );

  const lines = ['workspace {', '  model {'];

  for (const container of ir.containers) {
    if (nestedContainerIds.has(container.id)) {
      limitations.push(
        `container "${container.id}" is nested inside another container — Structurizr's softwareSystem/container nesting is exactly two levels, this nesting level is flattened away`,
      );
      continue;
    }
    if (container.kind !== 'boundedContext') {
      limitations.push(
        `container "${container.id}": kind "${container.kind}" has no Structurizr equivalent, exported as softwareSystem`,
      );
    }
    lines.push(`    ${container.id} = softwareSystem "${container.label}" {`);
    for (const childId of container.children) {
      const childNode = nodesById.get(childId);
      if (childNode) lines.push(`      ${childNode.id} = container "${childNode.label}"`);
    }
    lines.push('    }');
  }

  for (const node of ir.nodes) {
    if (nestedNodeIds.has(node.id)) continue;
    lines.push(`    ${node.id} = container "${node.label}"`);
  }

  for (const edge of ir.edges) {
    const label = edge.semantics.label;
    const suffix = label ? ` "${label}"` : '';
    lines.push(`    ${edge.from} -> ${edge.to}${suffix}`);
    if (edge.semantics.mode !== LOSSLESS_EXPORT_MODE) {
      limitations.push(
        `edge ${edge.from}->${edge.to}: semantic mode "${edge.semantics.mode}" has no Structurizr equivalent`,
      );
    }
    if (edge.semantics.direction === 'bidirectional') {
      limitations.push(
        `edge ${edge.from}->${edge.to}: direction "bidirectional" has no equivalent in this Structurizr subset, exported as one-way`,
      );
    }
  }

  lines.push('  }', '}');

  return { dsl: lines.join('\n'), limitations };
}
