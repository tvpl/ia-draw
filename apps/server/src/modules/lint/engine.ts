import type { SceneSemantics } from '@arch-canvas/diagram-domain';
import type { SceneElement } from '@arch-canvas/editor-adapter';
import type { ElementMetadataRow } from '../library/metadata.js';

/**
 * AD-008: dependency-free, server-safe. `SceneElement` is only ever used as a
 * type here (erased at compile time) — this module never imports
 * `@excalidraw/excalidraw`/`@arch-canvas/editor-adapter` by value.
 *
 * LNT-01/02/03: a pure, side-effect-free lint pass. Every finding is a
 * `LintWarning` — `severity` is always `'warning'`, there is no error
 * severity in this engine, and nothing here ever throws on a "bad" diagram.
 * Lint never blocks the canvas (EARS "as warnings only").
 */

export type LintRuleName =
  | 'orphan-component'
  | 'unclear-direction'
  | 'connector-no-protocol'
  | 'missing-trust-boundary'
  | 'spof'
  | 'secret-in-label'
  | 'mixed-environments'
  | 'c4-level-mismatch';

export interface LintWarning {
  rule: LintRuleName;
  severity: 'warning';
  message: string;
  elementIds: string[];
}

/** `workspaces.settingsJson.lintRules` shape (LNT-03) — `false` disables a rule for every diagram in that workspace; absent/`true` leaves it enabled. No new column/table: reuses the existing `settingsJson` jsonb. */
export type WorkspaceLintRules = Partial<Record<LintRuleName, boolean>>;

/** More than this many sensitive-classification components outside a trust boundary triggers the aggregated warning (heuristic, documented — not a hard architectural rule). */
const TRUST_BOUNDARY_SENSITIVE_THRESHOLD = 1;

const SENSITIVE_DATA_CLASSIFICATIONS: ReadonlySet<string> = new Set([
  'pii',
  'secret',
  'confidential',
  'restricted',
]);

const SECRET_LABEL_PATTERN = /api[_-]?key|password|secret/i;

const C4_LEVEL_ORDER: Record<string, number> = {
  context: 0,
  container: 1,
  component: 2,
  deployment: 3,
};

/** Elements below are never "components" for orphan/SPOF purposes — arrows are connectors, text is a label carrier. */
function isComponentType(type: string): boolean {
  return type !== 'arrow' && type !== 'text';
}

function isNonDeleted(element: SceneElement): boolean {
  return !(element as { isDeleted?: boolean }).isDeleted;
}

function metaFor(
  elementId: string,
  meta: readonly ElementMetadataRow[],
): ElementMetadataRow | undefined {
  return meta.find((row) => row.elementId === elementId);
}

function metadataField(row: ElementMetadataRow | undefined, field: string): unknown {
  if (!row) return undefined;
  const json = row.metadataJson;
  if (typeof json !== 'object' || json === null) return undefined;
  return (json as Record<string, unknown>)[field];
}

function isRuleEnabled(rule: LintRuleName, workspaceRules?: WorkspaceLintRules): boolean {
  return workspaceRules?.[rule] !== false;
}

function detectOrphanComponents(semantics: SceneSemantics): LintWarning | null {
  const connected = new Set<string>();
  for (const edge of semantics.edges) {
    connected.add(edge.from);
    connected.add(edge.to);
  }
  const orphans = semantics.elements
    .filter((el) => isComponentType(el.type) && !connected.has(el.elementId))
    .map((el) => el.elementId);
  if (orphans.length === 0) return null;
  return {
    rule: 'orphan-component',
    severity: 'warning',
    message: `${orphans.length} componente(s) sem nenhum edge conectado.`,
    elementIds: orphans,
  };
}

/** T58's `extractSceneSemantics` already drops arrows with an unresolved binding from `edges` — this rule detects those SAME arrows from the raw scene, which is the only place that information still exists. */
function detectUnclearDirection(scene: readonly SceneElement[]): LintWarning | null {
  const offenders: string[] = [];
  for (const element of scene) {
    if (!isNonDeleted(element)) continue;
    const el = element as {
      type: string;
      id: string;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    };
    if (el.type !== 'arrow') continue;
    if (!el.startBinding?.elementId || !el.endBinding?.elementId) offenders.push(el.id);
  }
  if (offenders.length === 0) return null;
  return {
    rule: 'unclear-direction',
    severity: 'warning',
    message: `${offenders.length} conector(es) sem direção clara (binding de origem ou destino ausente).`,
    elementIds: offenders,
  };
}

function detectConnectorsWithoutProtocol(
  scene: readonly SceneElement[],
  meta: readonly ElementMetadataRow[],
): LintWarning | null {
  const offenders: string[] = [];
  for (const element of scene) {
    if (!isNonDeleted(element)) continue;
    const el = element as {
      type: string;
      id: string;
      startBinding?: { elementId: string } | null;
      endBinding?: { elementId: string } | null;
    };
    if (el.type !== 'arrow') continue;
    if (!el.startBinding?.elementId || !el.endBinding?.elementId) continue; // already flagged by unclear-direction
    const protocol = metadataField(metaFor(el.id, meta), 'protocol');
    if (typeof protocol !== 'string' || protocol.trim() === '') offenders.push(el.id);
  }
  if (offenders.length === 0) return null;
  return {
    rule: 'connector-no-protocol',
    severity: 'warning',
    message: `${offenders.length} conector(es) sem \`protocol\` em metadados.`,
    elementIds: offenders,
  };
}

function trustBoundaryFrameIds(
  scene: readonly SceneElement[],
  meta: readonly ElementMetadataRow[],
): Set<string> {
  const boundaries = new Set<string>();
  for (const element of scene) {
    if (!isNonDeleted(element)) continue;
    const el = element as { type: string; id: string };
    if (el.type !== 'frame') continue;
    const row = metaFor(el.id, meta);
    if (row?.semanticType === 'trustBoundary') boundaries.add(el.id);
  }
  return boundaries;
}

function detectMissingTrustBoundary(
  scene: readonly SceneElement[],
  meta: readonly ElementMetadataRow[],
): LintWarning | null {
  const boundaryFrameIds = trustBoundaryFrameIds(scene, meta);
  const offenders: string[] = [];
  for (const element of scene) {
    if (!isNonDeleted(element)) continue;
    const el = element as { type: string; id: string; frameId?: string | null };
    if (!isComponentType(el.type)) continue;
    const classification = metadataField(metaFor(el.id, meta), 'dataClassification');
    if (typeof classification !== 'string' || !SENSITIVE_DATA_CLASSIFICATIONS.has(classification))
      continue;
    const inBoundary = el.frameId != null && boundaryFrameIds.has(el.frameId);
    if (!inBoundary) offenders.push(el.id);
  }
  if (offenders.length <= TRUST_BOUNDARY_SENSITIVE_THRESHOLD) return null;
  return {
    rule: 'missing-trust-boundary',
    severity: 'warning',
    message: `${offenders.length} componente(s) com classificação de dados sensível fora de qualquer trust boundary.`,
    elementIds: offenders,
  };
}

/** Heuristic, documented as imperfect: a component with >1 incoming edge and no OTHER component sharing its `semanticType` is flagged as a possible single point of failure. */
function detectSpof(
  semantics: SceneSemantics,
  meta: readonly ElementMetadataRow[],
): LintWarning | null {
  const incomingCount = new Map<string, number>();
  for (const edge of semantics.edges) {
    incomingCount.set(edge.to, (incomingCount.get(edge.to) ?? 0) + 1);
  }

  const typeCounts = new Map<string, number>();
  for (const el of semantics.elements) {
    const type = metaFor(el.elementId, meta)?.semanticType;
    if (!type) continue;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
  }

  const offenders: string[] = [];
  for (const el of semantics.elements) {
    if ((incomingCount.get(el.elementId) ?? 0) <= 1) continue;
    const semanticType = metaFor(el.elementId, meta)?.semanticType;
    const redundant = semanticType != null && (typeCounts.get(semanticType) ?? 0) > 1;
    if (!redundant) offenders.push(el.elementId);
  }
  if (offenders.length === 0) return null;
  return {
    rule: 'spof',
    severity: 'warning',
    message: `${offenders.length} componente(s) com múltiplas entradas e nenhum componente redundante do mesmo tipo semântico (possível SPOF).`,
    elementIds: offenders,
  };
}

function detectSecretInLabel(semantics: SceneSemantics): LintWarning | null {
  const offenders = semantics.elements
    .filter((el) => typeof el.label === 'string' && SECRET_LABEL_PATTERN.test(el.label))
    .map((el) => el.elementId);
  if (offenders.length === 0) return null;
  return {
    rule: 'secret-in-label',
    severity: 'warning',
    message: `${offenders.length} elemento(s) com um possível segredo escrito diretamente no label (heurística).`,
    elementIds: offenders,
  };
}

function detectMixedEnvironments(
  semantics: SceneSemantics,
  meta: readonly ElementMetadataRow[],
): LintWarning | null {
  const offenders = new Set<string>();
  for (const edge of semantics.edges) {
    const fromEnv = metadataField(metaFor(edge.from, meta), 'environment');
    const toEnv = metadataField(metaFor(edge.to, meta), 'environment');
    if (typeof fromEnv === 'string' && typeof toEnv === 'string' && fromEnv !== toEnv) {
      offenders.add(edge.from);
      offenders.add(edge.to);
    }
  }
  if (offenders.size === 0) return null;
  return {
    rule: 'mixed-environments',
    severity: 'warning',
    message: `${offenders.size} componente(s) em ambientes diferentes conectados diretamente, sem boundary explícito.`,
    elementIds: Array.from(offenders),
  };
}

/** LNT-02: soft C4-level validation. Flags an element whose `c4Level` is more than one abstraction level finer than the coarsest `c4Level` present in the diagram (e.g. a Context-level diagram containing Component-level detail) — never an error, always a warning. */
function detectC4LevelMismatch(
  semantics: SceneSemantics,
  meta: readonly ElementMetadataRow[],
): LintWarning | null {
  const levelsPresent = semantics.elements
    .map((el) => metadataField(metaFor(el.elementId, meta), 'c4Level'))
    .filter((level): level is string => typeof level === 'string' && level in C4_LEVEL_ORDER);
  if (levelsPresent.length === 0) return null;

  const coarsest = Math.min(...levelsPresent.map((level) => C4_LEVEL_ORDER[level] as number));

  const offenders: string[] = [];
  for (const el of semantics.elements) {
    const level = metadataField(metaFor(el.elementId, meta), 'c4Level');
    if (typeof level !== 'string' || !(level in C4_LEVEL_ORDER)) continue;
    const ordinal = C4_LEVEL_ORDER[level] as number;
    if (ordinal - coarsest > 1) offenders.push(el.elementId);
  }
  if (offenders.length === 0) return null;
  return {
    rule: 'c4-level-mismatch',
    severity: 'warning',
    message: `${offenders.length} elemento(s) com detalhe de nível C4 mais fino do que o nível predominante do diagrama.`,
    elementIds: offenders,
  };
}

/**
 * LNT-01/02/03: runs every lint rule and returns the enabled subset's
 * warnings. Pure — no I/O, never throws on a "bad" diagram, never mutates
 * anything. `scene` is the raw materialized scene (needed for arrow-binding
 * and frame-membership checks that `extractSceneSemantics` already resolved
 * away); `semantics` is T58's compact extraction; `elementsMeta` is every
 * `diagram_elements_meta` row for the diagram; `workspaceRules` optionally
 * disables individual rules per workspace (LNT-03).
 */
export function lintDiagram(
  scene: readonly SceneElement[],
  semantics: SceneSemantics,
  elementsMeta: readonly ElementMetadataRow[],
  workspaceRules?: WorkspaceLintRules,
): LintWarning[] {
  const candidates: (LintWarning | null)[] = [
    isRuleEnabled('orphan-component', workspaceRules) ? detectOrphanComponents(semantics) : null,
    isRuleEnabled('unclear-direction', workspaceRules) ? detectUnclearDirection(scene) : null,
    isRuleEnabled('connector-no-protocol', workspaceRules)
      ? detectConnectorsWithoutProtocol(scene, elementsMeta)
      : null,
    isRuleEnabled('missing-trust-boundary', workspaceRules)
      ? detectMissingTrustBoundary(scene, elementsMeta)
      : null,
    isRuleEnabled('spof', workspaceRules) ? detectSpof(semantics, elementsMeta) : null,
    isRuleEnabled('secret-in-label', workspaceRules) ? detectSecretInLabel(semantics) : null,
    isRuleEnabled('mixed-environments', workspaceRules)
      ? detectMixedEnvironments(semantics, elementsMeta)
      : null,
    isRuleEnabled('c4-level-mismatch', workspaceRules)
      ? detectC4LevelMismatch(semantics, elementsMeta)
      : null,
  ];
  return candidates.filter((warning): warning is LintWarning => warning !== null);
}
