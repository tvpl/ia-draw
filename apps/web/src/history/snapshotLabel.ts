import type { TFunction } from 'i18next';
import type { SnapshotRow } from './snapshotClient.js';

/**
 * Human label for one snapshot row (spec.md's Assumptions table: `auto` -> "Automático",
 * `named` -> the chosen name (or "Snapshot sem nome" when `name` is `null`), `pre_ai` ->
 * "Antes da edição por IA", `restore_point` -> "Ponto de restauração", `published` ->
 * "Publicado"). Shared by `HistoryPanel` (the timeline) and `DiffView` (the from/to pickers) —
 * both need to distinguish a snapshot's origin without reading its raw `kind`.
 */
export function snapshotLabel(t: TFunction, snapshot: SnapshotRow): string {
  if (snapshot.kind === 'named') {
    return snapshot.name && snapshot.name.trim().length > 0
      ? snapshot.name
      : t('history.unnamedSnapshot');
  }
  return t(`history.kind.${snapshot.kind}`);
}
