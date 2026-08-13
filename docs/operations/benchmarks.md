# Benchmarks

## Scene generation, diff and serialization (T11 baseline)

**What was measured:** `packages/editor-adapter`'s `computeDiff`, `serializeScene` and `parseScene`
against deterministic synthetic scenes from `packages/test-fixtures`'s `generateScene(elementCount,
seed)` (seed `42`; roughly even mix of rectangles/text/arrows), at 1,000 and 5,000 elements.

**How:** `pnpm --filter @arch-canvas/editor-adapter benchmark` (`vitest bench`, source at
`packages/editor-adapter/src/benchmark-scenes.bench.ts`). Elements are restored once via
`restoreElements` before timing starts; only `computeDiff` / `serializeScene` / `parseScene` are
inside the measured section. Numbers below are `vitest bench`'s reported mean wall-clock time per
call (`mean`, in ms) and the serialized JSON payload size.

**Environment (indicative, not a production SLO measurement):** this sandbox — Node v22.22.2, Intel
Xeon @ 2.80GHz, 4 vCPUs, 15 GiB RAM, single run, no isolation from other sandbox activity. These
numbers characterize relative cost and rough order of magnitude only; they are **not** a benchmark of
production hardware and must not be read as an SLO commitment. Re-run on target infrastructure before
using these numbers for capacity planning.

| Metric | 1,000 elements | 5,000 elements |
| --- | --- | --- |
| Serialized payload size | 522.3 KB | 2,619.3 KB (2.6 MB) |
| `serializeScene` (mean) | 2.69 ms | 12.69 ms |
| `parseScene` (mean) | 2.97 ms | 16.14 ms |
| `computeDiff` — all-upsert, empty prev (mean) | 0.10 ms | 0.75 ms |
| `computeDiff` — no-op, unchanged prev (mean) | 0.14 ms | 1.13 ms |

**Reading the numbers:**

- `computeDiff` is roughly two orders of magnitude cheaper than `serializeScene`/`parseScene` at both
  scales — the JSON round-trip, not the diffing itself, is the cost driver as scene size grows.
- Payload size scales close to linearly with element count (~0.52 KB/element at 1k, ~0.52 KB/element
  at 5k), consistent with `serializeScene` not doing any compression.
- `spec.md`'s EDT-01 bootstrap target (p95 < 3s at 5,000 elements) is not challenged by this slice of
  the pipeline: even `parseScene` at 5k elements (16 ms mean) is a small fraction of that budget. The
  rest of the bootstrap path (network fetch, editor mount, initial render) is out of scope for this
  benchmark and unmeasured here.

**Regenerating this baseline:** re-run `pnpm --filter @arch-canvas/editor-adapter benchmark` and
replace the table above; note the date and environment alongside any material change.
