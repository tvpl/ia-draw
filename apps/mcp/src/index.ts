/**
 * Scaffold placeholder (T9) — `apps/mcp` has no library entrypoint of its
 * own; it ships as a `bin` (`arch-canvas-mcp`, `cli.ts`, T13), never
 * imported by another package. This file exists only so an empty `src/`
 * doesn't fail `tsc --noEmit` (TS18003, "no inputs found") before the real
 * modules (`client.ts` T10, `resources/*.ts` T11-T12, `cli.ts` T13) land.
 */
export {};
