import { createHash } from 'node:crypto';
import { diagramAssets } from '@arch-canvas/database';
import { and, eq, inArray } from 'drizzle-orm';
import JSZip from 'jszip';
import type { Db } from '../auth/db.js';
import { materializeScene } from '../snapshot/scene.js';
import { ASSET_BUCKET, type StorageClient } from '../storage/index.js';
import { DEFAULT_EXPORT_APP_STATE } from './generateExports.js';
import { serializeScene } from './sceneFile.js';

export interface BundleManifestEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface BundleManifest {
  diagramId: string;
  revision: number;
  generatedAt: string;
  files: BundleManifestEntry[];
}

export interface DiagramBundle {
  buffer: Buffer;
  manifest: BundleManifest;
}

/** Excalidraw's own `fileId` field on `type: 'image'` elements — the same binding `asset/assertAssetsReady.ts` (T29) relies on. */
function referencedAssetIds(elements: readonly unknown[]): string[] {
  const ids = new Set<string>();
  for (const raw of elements) {
    const element = raw as { type?: unknown; fileId?: unknown };
    if (element.type === 'image' && typeof element.fileId === 'string') {
      ids.add(element.fileId);
    }
  }
  return [...ids];
}

function assetFileName(assetId: string, mimeType: string): string {
  const extension = mimeType.split('/')[1] ?? 'bin';
  return `assets/${assetId}.${extension}`;
}

/**
 * Builds a `.zip` bundle (EXP-02) for one diagram: the materialized scene (as
 * `.excalidraw`), every `ready` asset the scene's image elements actually reference,
 * semantic metadata and generated specs (both empty placeholders — the semantic layer
 * and spec generation are F2/F3, not built yet, per this task's own scope note), and a
 * JSON manifest with a SHA-256 checksum + byte size per file the bundle contains. The
 * manifest itself is added last and is not self-listed (its own checksum would be
 * circular); every OTHER file in the zip has a manifest entry whose checksum can be
 * verified against the unzipped bytes.
 */
export async function buildDiagramBundle(
  db: Db,
  storage: StorageClient,
  diagramId: string,
): Promise<DiagramBundle> {
  const { scene, revision } = await materializeScene(db, diagramId);
  const sceneJson = serializeScene(scene, DEFAULT_EXPORT_APP_STATE);

  const assetIds = referencedAssetIds(scene);
  const assets =
    assetIds.length === 0
      ? []
      : await db
          .select()
          .from(diagramAssets)
          .where(
            and(
              eq(diagramAssets.diagramId, diagramId),
              inArray(diagramAssets.id, assetIds),
              eq(diagramAssets.status, 'ready'),
            ),
          );

  const zip = new JSZip();
  const files: BundleManifestEntry[] = [];

  function addFile(path: string, bytes: Buffer): void {
    zip.file(path, bytes);
    files.push({
      path,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.byteLength,
    });
  }

  addFile('scene.excalidraw', Buffer.from(sceneJson, 'utf8'));
  addFile('metadata.json', Buffer.from(JSON.stringify({ semantic: null }), 'utf8'));

  for (const asset of assets) {
    const bytes = await storage.getObject(ASSET_BUCKET, asset.objectKey);
    addFile(assetFileName(asset.id, asset.mimeType), bytes);
  }

  const manifest: BundleManifest = {
    diagramId,
    revision,
    generatedAt: new Date().toISOString(),
    files,
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return { buffer, manifest };
}
