/**
 * UIF-06..17: the recipes shared across screens, as utility strings.
 *
 * Components consume utilities and nothing else (AD-017), but four list pages repeating the
 * same twenty-utility row is how two screens drift apart. This module is the one place a
 * recipe is written; it introduces no CSS layer and no component abstraction — the strings
 * land in `className` exactly as if they had been typed inline.
 */

/** Page scaffolding. */
export const page = 'mx-auto w-full max-w-content px-6 py-8';
export const pageTitle = 'text-2xl font-semibold tracking-tight text-content';
export const sectionTitle = 'text-lg font-semibold text-content';
export const helpText = 'text-sm text-content-muted';

/** A raised panel: cards, forms, list containers. */
export const panel = 'rounded-panel border border-border bg-surface-raised shadow-panel';
export const panelPadded = `${panel} p-6`;

/** Lists — one row shape reused by workspaces, projects, diagrams and members. */
export const list = 'divide-y divide-border rounded-panel border border-border bg-surface-raised';
export const listRow = 'flex flex-wrap items-center justify-between gap-3 px-4 py-3';
export const listRowTitle = 'min-w-0 flex-1 truncate font-medium text-content';
export const listRowActions = 'flex shrink-0 flex-wrap items-center gap-2';

/** The three states a list can be in besides "has items". */
export const stateBox =
  'rounded-panel border border-dashed border-border bg-surface-sunken px-4 py-8 text-center text-sm text-content-muted';
export const errorBox =
  'rounded-panel border border-danger bg-danger-subtle px-4 py-3 text-sm text-danger';

/** Controls. */
const controlBase =
  'inline-flex items-center justify-center gap-2 rounded-control px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
export const buttonPrimary = `${controlBase} bg-accent text-content-inverse hover:bg-accent-hover`;
export const buttonSecondary = `${controlBase} border border-border bg-surface-raised text-content hover:bg-surface-hover`;
export const buttonDanger = `${controlBase} border border-danger text-danger hover:bg-danger-subtle`;
export const buttonQuiet = `${controlBase} text-content-muted hover:bg-surface-hover hover:text-content`;

export const input =
  'w-full rounded-control border border-border bg-surface-raised px-3 py-1.5 text-sm text-content placeholder:text-content-subtle';
export const select = `${input} pr-8`;
export const label = 'block text-sm font-medium text-content';
export const field = 'flex flex-col gap-1.5';

export const link = 'text-accent underline underline-offset-2 hover:text-accent-hover';

/** Small, quiet badge — used for the role a person holds in a workspace (RBAC-13). */
export const badge =
  'inline-flex items-center rounded-control bg-surface-sunken px-2 py-0.5 text-xs font-medium text-content-muted';
