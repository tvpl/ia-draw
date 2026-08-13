import { extractSceneSemantics } from '@arch-canvas/diagram-domain';
import {
  EDGE_DIRECTIONS,
  EDGE_MODES,
  type EdgeDirection,
  type EdgeMode,
  type IrDocument,
  type IrEdge,
  type IrKind,
  type IrNode,
  toMermaidFlowchart,
  toStructurizrDsl,
  validateIr,
} from '@arch-canvas/diagram-ir';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { ElementMetadataRow } from '../library/metadata.js';
import type { InteropFormat } from './importDsl.js';

/**
 * `extractSceneSemantics` (T58) alone is NOT enough to rebuild a full
 * `IrDocument` — per T68's own task text, it has no `kind` and no explicit
 * container/grouping concept. This module builds a best-effort `IrDocument`
 * from that semantic data plus the same raw `diagram_elements_meta` rows
 * `docgen`/`lint` already read, and documents every heuristic field inline
 * below (never silently guessed, matching T58/T60/T61's "skip, don't
 * invent" discipline):
 *
 *  - `kind` is a fixed default (`'c4-context'`) — a raw scene carries no
 *    `ir.kind` concept at all; same documented-default precedent T60 uses
 *    on Mermaid import for the reverse direction.
 *  - `containers` is always `[]` — no geometric/positional grouping
 *    detection is attempted (the task explicitly says not to over-engineer
 *    this); every element becomes a flat top-level node.
 *  - a node with no resolvable label (`extractSceneSemantics` couldn't find
 *    one) falls back to its own `elementId` as the label, since `IrNode.label`
 *    is a required non-empty string.
 *  - a bound-text child (its raw scene element has `containerId` set) is
 *    excluded from becoming its own node — its text is already the parent's
 *    resolved label, so including it too would double up every
 *    labeled shape as two redundant nodes.
 *  - an edge's `semantics.mode`/`protocol`/`direction` are read from the
 *    connecting arrow's OWN `diagram_elements_meta` row (looked up by the
 *    arrow's `elementId`, which `extractSceneSemantics`'s `SemanticEdge`
 *    deliberately omits — see `rawArrows` below) and default to
 *    `'dependency'`/`'oneway'` when absent, the same baseline
 *    `parseMermaidFlowchart` stamps on import (T60) — any edge whose real
 *    mode/direction differs from that baseline is then flagged in
 *    `limitations` by `toMermaidFlowchart`/`toStructurizrDsl` themselves,
 *    never invented here.
 */
const BEST_EFFORT_IR_KIND: IrKind = 'c4-context';

interface RawArrowInfo {
  elementId: string;
  from: string;
  to: string;
}

/**
 * Duck-typed raw-scene arrow scan — deliberately separate from (not
 * imported from) `packages/diagram-domain/src/sceneSemantics.ts`'s private
 * `arrowBinding()`, for the same AD-008/L-003 "small, documented,
 * independent duplication" reason T58's own top comment gives: this needs
 * to retain each arrow's own `elementId` (to look up its metadata), which
 * `SceneSemantics.edges` (T58's public output) intentionally does not carry.
 */
function rawArrows(scene: readonly SceneElement[]): RawArrowInfo[] {
  const result: RawArrowInfo[] = [];
  for (const element of scene) {
    const el = element as {
      id: string;
      type: string;
      isDeleted?: boolean;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    };
    if (el.isDeleted || el.type !== 'arrow') continue;
    const from = el.startBinding?.elementId;
    const to = el.endBinding?.elementId;
    if (!from || !to) continue;
    result.push({ elementId: el.id, from, to });
  }
  return result;
}

/** Element ids that are a bound-text label of some other element (`containerId` set) — excluded from becoming their own IR node, see the module doc comment above. */
function boundTextChildIds(scene: readonly SceneElement[]): Set<string> {
  const ids = new Set<string>();
  for (const element of scene) {
    const el = element as {
      id: string;
      type: string;
      isDeleted?: boolean;
      containerId?: string | null;
    };
    if (el.isDeleted) continue;
    if (el.type === 'text' && el.containerId) ids.add(el.id);
  }
  return ids;
}

const NODE_SEMANTIC_KEYS = [
  'technology',
  'provider',
  'environment',
  'dataClassification',
  'criticality',
] as const;

/** Picks only the `IrNode.semantics` fields the schema actually knows about out of a free-form metadata blob — unknown keys are dropped, never guessed into a shape. */
function pickNodeSemantics(raw: Record<string, unknown> | undefined): IrNode['semantics'] {
  if (!raw) return undefined;
  const picked: Record<string, string> = {};
  for (const key of NODE_SEMANTIC_KEYS) {
    const value = raw[key];
    if (typeof value === 'string' && value.length > 0) picked[key] = value;
  }
  return Object.keys(picked).length > 0 ? (picked as IrNode['semantics']) : undefined;
}

function toElementMetadataInput(rows: readonly ElementMetadataRow[]) {
  return rows.map((row) => ({
    elementId: row.elementId,
    semantics: {
      ...(row.semanticType !== null ? { semanticType: row.semanticType } : {}),
      ...(typeof row.metadataJson === 'object' && row.metadataJson !== null
        ? (row.metadataJson as Record<string, unknown>)
        : {}),
    },
  }));
}

/** Builds the best-effort `IrDocument` this module's top comment documents — pure function, no I/O. */
export function buildBestEffortIr(
  scene: readonly SceneElement[],
  elementsMeta: readonly ElementMetadataRow[],
): IrDocument {
  const metadataInputs = toElementMetadataInput(elementsMeta);
  const semantics = extractSceneSemantics(scene, metadataInputs);
  const metaByElementId = new Map(metadataInputs.map((m) => [m.elementId, m.semantics]));
  const boundChildIds = boundTextChildIds(scene);

  const nodes: IrNode[] = semantics.elements
    .filter((el) => el.type !== 'arrow' && !boundChildIds.has(el.elementId))
    .map((el) => {
      const nodeSemantics = pickNodeSemantics(el.semantics as Record<string, unknown> | undefined);
      return {
        id: el.elementId,
        label: el.label ?? el.elementId,
        ...(nodeSemantics ? { semantics: nodeSemantics } : {}),
      };
    });
  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges: IrEdge[] = [];
  for (const arrow of rawArrows(scene)) {
    // Dangling after node filtering (e.g. bound to a since-excluded label
    // child) is skipped, never guessed — same discipline as T58's own edge
    // resolution.
    if (!nodeIds.has(arrow.from) || !nodeIds.has(arrow.to)) continue;

    const arrowMeta = metaByElementId.get(arrow.elementId) as Record<string, unknown> | undefined;
    const modeRaw = arrowMeta?.mode;
    const mode: EdgeMode =
      typeof modeRaw === 'string' && (EDGE_MODES as readonly string[]).includes(modeRaw)
        ? (modeRaw as EdgeMode)
        : 'dependency';
    const directionRaw = arrowMeta?.direction;
    const direction: EdgeDirection =
      typeof directionRaw === 'string' &&
      (EDGE_DIRECTIONS as readonly string[]).includes(directionRaw)
        ? (directionRaw as EdgeDirection)
        : 'oneway';
    const protocol = typeof arrowMeta?.protocol === 'string' ? arrowMeta.protocol : undefined;
    const labelMatch = semantics.edges.find((e) => e.from === arrow.from && e.to === arrow.to);

    edges.push({
      from: arrow.from,
      to: arrow.to,
      semantics: {
        mode,
        direction,
        ...(protocol ? { protocol } : {}),
        ...(labelMatch?.label ? { label: labelMatch.label } : {}),
      },
    });
  }

  const ir: IrDocument = {
    version: 'v1',
    kind: BEST_EFFORT_IR_KIND,
    nodes,
    containers: [],
    edges,
  };
  return validateIr(ir);
}

export interface ExportDslResult {
  dsl: string;
  limitations: string[];
}

/** Builds the best-effort IR from `scene`/`elementsMeta`, then renders it via T60/T61's `toMermaidFlowchart`/`toStructurizrDsl` (AAC-02) — `limitations` is theirs verbatim, so any lossy edge (e.g. `mode: 'data'`, no direct Mermaid equivalent) is reported, never hidden. */
export function exportDslFromScene(
  format: InteropFormat,
  scene: readonly SceneElement[],
  elementsMeta: readonly ElementMetadataRow[],
): ExportDslResult {
  const ir = buildBestEffortIr(scene, elementsMeta);
  return format === 'mermaid' ? toMermaidFlowchart(ir) : toStructurizrDsl(ir);
}
