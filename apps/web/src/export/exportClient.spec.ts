import { describe, expect, it, vi } from 'vitest';
import { createExportClient, type ExportFormats } from './exportClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const FORMATS: ExportFormats = {
  excalidraw: { url: 'https://s3/e', checksum: 'sha256:e', sizeBytes: 10, contentType: 'a' },
  svg: { url: 'https://s3/s', checksum: 'sha256:s', sizeBytes: 20, contentType: 'b' },
  png: { url: 'https://s3/p', checksum: 'sha256:p', sizeBytes: 30, contentType: 'c' },
  pdf: { url: 'https://s3/f', checksum: 'sha256:f', sizeBytes: 40, contentType: 'd' },
};

describe('createExportClient (T1, XPRT-01/05/07/13)', () => {
  describe('generateExports', () => {
    it('sends a single POST /diagrams/:id/exports and returns exportId/revision/formats on 200 (XPRT-01)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, { exportId: 'exp-1', revision: 7, formats: FORMATS }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.generateExports('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/exports',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        status: 'ok',
        exportId: 'exp-1',
        revision: 7,
        formats: FORMATS,
      });
    });

    it('maps a 429 response to status "rate_limited" (XPRT-03)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(429, { title: 'Too Many Requests' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.generateExports('diagram-1');

      expect(result).toEqual({ status: 'rate_limited' });
    });

    it('maps any other non-200 response to status "error"', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(500, { title: 'boom' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.generateExports('diagram-1');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('generateBundle', () => {
    it('sends POST /diagrams/:id/bundle and returns bundleId/url/sizeBytes/manifest on 200 (XPRT-05)', async () => {
      const manifest = { files: ['scene.excalidraw'] };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          bundleId: 'bundle-1',
          url: 'https://s3/bundle',
          sizeBytes: 512,
          manifest,
        }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.generateBundle('diagram-1');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/bundle',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({
        status: 'ok',
        bundleId: 'bundle-1',
        url: 'https://s3/bundle',
        sizeBytes: 512,
        manifest,
      });
    });

    it('maps a non-200 response to status "error"', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(500, { title: 'boom' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.generateBundle('diagram-1');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('previewImport', () => {
    it('sends fileContent without confirm and returns the preview on 200 (XPRT-07)', async () => {
      const preview = { elementCount: 3, appState: { viewBackgroundColor: '#fff' } };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, { preview }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.previewImport('project-1', '{"elements":[]}');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/projects/project-1/import',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ fileContent: '{"elements":[]}' }),
        }),
      );
      expect(result).toEqual({ status: 'ok', preview });
    });

    it('maps a 400 (malformed/limit exceeded) response to status "invalid" with the server message (XPRT-08)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(400, {
          title: '.excalidraw file has 25000 elements, exceeding the 20000-element import limit',
        }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.previewImport('project-1', '{"elements":[]}');

      expect(result).toEqual({
        status: 'invalid',
        message: '.excalidraw file has 25000 elements, exceeding the 20000-element import limit',
      });
    });

    it('maps a non-200/400 response to status "error"', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(500, { title: 'boom' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.previewImport('project-1', '{"elements":[]}');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('confirmImport', () => {
    it('sends fileContent + confirm:true + title and returns preview/diagram on 201 (XPRT-09/10)', async () => {
      const preview = { elementCount: 3, appState: { viewBackgroundColor: '#fff' } };
      const diagram = { id: 'diagram-9', projectId: 'project-1', title: 'Imported' };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(201, { preview, diagram }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.confirmImport('project-1', '{"elements":[]}', 'Imported');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/projects/project-1/import',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            fileContent: '{"elements":[]}',
            confirm: true,
            title: 'Imported',
          }),
        }),
      );
      expect(result).toEqual({ status: 'ok', preview, diagram });
    });

    it('maps a 400 response to status "invalid" with the server message (XPRT-08)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(400, { title: 'malformed .excalidraw file: invalid JSON' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.confirmImport('project-1', 'not json', 'Imported');

      expect(result).toEqual({
        status: 'invalid',
        message: 'malformed .excalidraw file: invalid JSON',
      });
    });

    it('maps a non-201/400 response to status "error"', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(500, { title: 'boom' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.confirmImport('project-1', '{"elements":[]}', 'Imported');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('requestWorkspaceBundle', () => {
    it('sends POST /workspaces/:id/bundles and returns jobId on 200 (XPRT-13)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, { jobId: 'job-1', status: 'queued' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.requestWorkspaceBundle('ws-1');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/workspaces/ws-1/bundles',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ status: 'ok', jobId: 'job-1' });
    });

    it('maps a 503 (job queue unavailable) response to status "unavailable" (XPRT-15)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(503, { title: 'bulk workspace export is unavailable' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.requestWorkspaceBundle('ws-1');

      expect(result).toEqual({ status: 'unavailable' });
    });

    it('maps a non-200/503 response to status "error"', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(403, { title: 'forbidden' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.requestWorkspaceBundle('ws-1');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('exportDsl', () => {
    it('sends POST /diagrams/:id/export:mermaid with no body and returns dsl/limitations on 200 (INT-01)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, { dsl: 'flowchart TD\n  A --> B', limitations: [] }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.exportDsl('diagram-1', 'mermaid');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/export:mermaid',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        status: 'ok',
        dsl: 'flowchart TD\n  A --> B',
        limitations: [],
      });
    });

    it('sends POST /diagrams/:id/export:structurizr and passes non-empty limitations through (INT-02/03)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(200, {
          dsl: 'workspace { ... }',
          limitations: ["edge 'conn' mode 'data' has no Structurizr equivalent"],
        }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.exportDsl('diagram-1', 'structurizr');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/diagrams/diagram-1/export:structurizr',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({
        status: 'ok',
        dsl: 'workspace { ... }',
        limitations: ["edge 'conn' mode 'data' has no Structurizr equivalent"],
      });
    });

    it('maps a non-200 response to status "error" (INT-04)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(404, { title: 'Not Found' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.exportDsl('diagram-1', 'mermaid');

      expect(result).toEqual({ status: 'error' });
    });
  });

  describe('importDsl', () => {
    it('sends POST /projects/:id/import:mermaid with {dsl} (no title) when title is omitted, returns diagramId/diagram/limitations on 201 (INT-09/10)', async () => {
      const diagram = {
        id: 'diagram-9',
        projectId: 'project-1',
        title: 'Imported Mermaid flowchart',
      };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(201, { diagramId: 'diagram-9', diagram, limitations: [] }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.importDsl('project-1', 'mermaid', 'flowchart TD\n  A --> B');

      expect(fetchImpl).toHaveBeenCalledWith(
        '/projects/project-1/import:mermaid',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ dsl: 'flowchart TD\n  A --> B' }),
        }),
      );
      expect(result).toEqual({
        status: 'ok',
        diagramId: 'diagram-9',
        diagram,
        limitations: [],
      });
    });

    it('sends POST /projects/:id/import:structurizr with {dsl, title} when title is provided (INT-09)', async () => {
      const diagram = { id: 'diagram-9', projectId: 'project-1', title: 'My import' };
      const fetchImpl = vi.fn(async () =>
        jsonResponse(201, { diagramId: 'diagram-9', diagram, limitations: [] }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.importDsl(
        'project-1',
        'structurizr',
        'workspace { ... }',
        'My import',
      );

      expect(fetchImpl).toHaveBeenCalledWith(
        '/projects/project-1/import:structurizr',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ dsl: 'workspace { ... }', title: 'My import' }),
        }),
      );
      expect(result).toEqual({
        status: 'ok',
        diagramId: 'diagram-9',
        diagram,
        limitations: [],
      });
    });

    it('maps a 400 response to status "invalid" with the server message (INT-11)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(400, { title: 'unsupported interop format' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.importDsl('project-1', 'mermaid', '');

      expect(result).toEqual({ status: 'invalid', message: 'unsupported interop format' });
    });

    it('maps a non-201/400 response to status "error" (INT-12)', async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse(500, { title: 'boom' }),
      ) as unknown as typeof fetch;
      const client = createExportClient(fetchImpl);

      const result = await client.importDsl('project-1', 'mermaid', 'flowchart TD\n  A --> B');

      expect(result).toEqual({ status: 'error' });
    });
  });
});
