import { describe, expect, it, vi } from 'vitest';
import { createLintClient, type LintWarning } from './lintClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const ORPHAN_WARNING: LintWarning = {
  rule: 'orphan-component',
  severity: 'warning',
  message: '1 componente(s) sem nenhum edge conectado.',
  elementIds: ['el-1'],
};

describe('createLintClient — list (ALNT-01..04)', () => {
  it('resolves {status: "ok", warnings} on 200 with warnings, calling the documented route', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [ORPHAN_WARNING] }),
    ) as unknown as typeof fetch;
    const client = createLintClient(fetchImpl);

    await expect(client.list('diagram-1')).resolves.toEqual({
      status: 'ok',
      warnings: [ORPHAN_WARNING],
    });
    expect(fetchImpl).toHaveBeenCalledWith('/diagrams/diagram-1/lint');
  });

  it('resolves {status: "ok", warnings: []} on 200 with no warnings — never treated as an error', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { warnings: [] }),
    ) as unknown as typeof fetch;
    const client = createLintClient(fetchImpl);

    await expect(client.list('diagram-1')).resolves.toEqual({ status: 'ok', warnings: [] });
  });

  it('resolves {status: "error"} on a non-200 status (e.g. 404 IDOR convention) — never throws', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(404, {})) as unknown as typeof fetch;
    const client = createLintClient(fetchImpl);

    await expect(client.list('diagram-1')).resolves.toEqual({ status: 'error' });
  });

  it('resolves {status: "error"} when the network call itself rejects — never throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    const client = createLintClient(fetchImpl);

    await expect(client.list('diagram-1')).resolves.toEqual({ status: 'error' });
  });
});
