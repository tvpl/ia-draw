/**
 * LIVE-15: a stable colour per person, derived from the `senderId` alone.
 *
 * Nothing server-side carries a colour field, and the protocol has no way to
 * negotiate one, so the assignment has to be reproducible without any
 * coordination: every client that sees the same `senderId` must pick the same
 * pair, in every session. A hash into a fixed palette is the whole mechanism.
 */
export interface CollaboratorColor {
  background: string;
  stroke: string;
}

/** Eight pairs, each a mid-tone fill with a darker outline so a cursor stays legible on a white canvas. */
const PALETTE: readonly CollaboratorColor[] = [
  { background: '#e03131', stroke: '#a51111' },
  { background: '#1971c2', stroke: '#0b4f8a' },
  { background: '#2f9e44', stroke: '#1a6b2a' },
  { background: '#f08c00', stroke: '#a35f00' },
  { background: '#9c36b5', stroke: '#6b1f7d' },
  { background: '#0c8599', stroke: '#065968' },
  { background: '#e8590c', stroke: '#a13a05' },
  { background: '#5f3dc4', stroke: '#3d2585' },
];

/** FNV-1a, 32-bit — small, dependency-free, and well spread for short ascii ids. */
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The colour pair for `senderId`. Pure: the same id always yields the same pair. */
export function collaboratorColor(senderId: string): CollaboratorColor {
  const entry = PALETTE[hash32(senderId) % PALETTE.length];
  // PALETTE is non-empty and the index is a modulo of its length, so this is
  // unreachable — it exists only to satisfy noUncheckedIndexedAccess.
  if (!entry) throw new Error('collaboratorColor: empty palette');
  return entry;
}
