// SPEC_DEVIATION: no real MinIO reachable in this sandbox (no Docker daemon — .specs/STATE.md
// AD-007). `putSignedUrl`/`getSignedUrl` are exercised for real against the AWS SDK's presigner,
// which signs locally (SigV4) without a network round trip — see @aws-sdk/s3-request-presigner's
// own README ("presigner based on signature V4"), confirmed by reading the installed package.
// `headObject` DOES require a real request, so it mocks `S3Client.send` at the SDK boundary and
// documents that limitation explicitly, matching T6/F0's honesty pattern.
import { S3Client } from '@aws-sdk/client-s3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageClient, type StorageClient } from './signedUrl.js';

function fakeClient(): S3Client {
  return new S3Client({
    endpoint: 'http://localhost:9000',
    region: 'us-east-1',
    credentials: { accessKeyId: 'test-key', secretAccessKey: 'test-secret' },
    forcePathStyle: true,
  });
}

describe('putSignedUrl / getSignedUrl (T27, EXP-01 pre-requisite)', () => {
  let s3: S3Client;
  let storage: StorageClient;

  beforeEach(() => {
    s3 = fakeClient();
    storage = createStorageClient(s3);
  });

  it('a PUT signed URL is valid for exactly the requested TTL', async () => {
    const url = await storage.putSignedUrl('assets', 'diagrams/d1/a1.png', 'image/png', 900);
    const parsed = new URL(url);
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('900');
    expect(parsed.pathname).toContain('assets');
    expect(parsed.pathname).toContain('diagrams/d1/a1.png');
  });

  it('a GET signed URL is valid for exactly the requested TTL, distinct from a PUT URL', async () => {
    const putUrl = await storage.putSignedUrl('assets', 'diagrams/d1/a1.png', 'image/png', 300);
    const getUrl = await storage.getSignedUrl('assets', 'diagrams/d1/a1.png', 300);

    expect(new URL(getUrl).searchParams.get('X-Amz-Expires')).toBe('300');
    // Different signed operations (PUT vs GET) produce different signatures/query strings.
    expect(getUrl).not.toBe(putUrl);
  });

  it('a shorter TTL than a previous call is reflected exactly, not clamped or reused', async () => {
    const shortUrl = await storage.putSignedUrl('exports', 'k', 'application/pdf', 60);
    expect(new URL(shortUrl).searchParams.get('X-Amz-Expires')).toBe('60');
  });
});

describe('headObject (T27)', () => {
  let s3: S3Client;
  let storage: StorageClient;

  beforeEach(() => {
    s3 = fakeClient();
    storage = createStorageClient(s3);
  });

  it('reports exists:true with the object size for an object the SDK confirms', async () => {
    vi.spyOn(s3, 'send').mockResolvedValueOnce({
      ContentLength: 1234,
      ContentType: 'image/svg+xml',
      $metadata: {},
    } as never);

    const result = await storage.headObject('assets', 'diagrams/d1/exists.svg');
    expect(result).toEqual({ exists: true, sizeBytes: 1234, contentType: 'image/svg+xml' });
  });

  it('reports exists:false, never throwing, when the SDK reports the object is missing', async () => {
    const notFound = Object.assign(new Error('NotFound'), {
      name: 'NotFound',
      $metadata: { httpStatusCode: 404 },
    });
    vi.spyOn(s3, 'send').mockRejectedValueOnce(notFound);

    const result = await storage.headObject('assets', 'diagrams/d1/missing.svg');
    expect(result).toEqual({ exists: false });
  });

  it('re-throws an unrelated SDK error instead of masking it as exists:false', async () => {
    const serverError = Object.assign(new Error('InternalError'), {
      name: 'InternalError',
      $metadata: { httpStatusCode: 500 },
    });
    vi.spyOn(s3, 'send').mockRejectedValueOnce(serverError);

    await expect(storage.headObject('assets', 'diagrams/d1/broken.svg')).rejects.toThrow(
      'InternalError',
    );
  });
});
