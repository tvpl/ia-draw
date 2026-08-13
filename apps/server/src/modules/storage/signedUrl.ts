import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface HeadObjectResult {
  exists: boolean;
  sizeBytes?: number;
  contentType?: string;
}

/**
 * Thin, testable wrapper over the S3 SDK (T27). Every method here is the
 * seam mocked in `signedUrl.spec.ts` — no test in this module talks to a
 * real MinIO (none is reachable in this sandbox, see the module README note
 * in `index.ts`).
 */
export interface StorageClient {
  /** Signed URL a client PUTs the object bytes to directly, valid for `ttlSeconds`. */
  putSignedUrl(
    bucket: string,
    key: string,
    contentType: string,
    ttlSeconds: number,
  ): Promise<string>;
  /** Signed URL a client GETs the object bytes from directly, valid for `ttlSeconds`. */
  getSignedUrl(bucket: string, key: string, ttlSeconds: number): Promise<string>;
  /** Confirms whether `key` exists in `bucket` without downloading it — used to verify an upload actually landed before marking an asset `ready`. */
  headObject(bucket: string, key: string): Promise<HeadObjectResult>;
  /** Server writes an object directly (e.g. a sanitized SVG, a generated export). */
  putObject(
    bucket: string,
    key: string,
    body: Buffer | Uint8Array | string,
    contentType: string,
  ): Promise<void>;
  /** Server reads an object directly (e.g. to hash it or re-sanitize it). */
  getObject(bucket: string, key: string): Promise<Buffer>;
}

/** True for the S3 SDK's "object not found" errors, across the shapes MinIO/AWS can throw. */
function isNotFoundError(error: unknown): boolean {
  const name = (error as { name?: string } | undefined)?.name;
  const httpStatusCode = (error as { $metadata?: { httpStatusCode?: number } } | undefined)
    ?.$metadata?.httpStatusCode;
  return name === 'NotFound' || name === 'NoSuchKey' || httpStatusCode === 404;
}

export function createStorageClient(s3: S3Client): StorageClient {
  return {
    async putSignedUrl(bucket, key, contentType, ttlSeconds) {
      const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
      return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
    },

    async getSignedUrl(bucket, key, ttlSeconds) {
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(s3, command, { expiresIn: ttlSeconds });
    },

    async headObject(bucket, key) {
      try {
        const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          exists: true,
          sizeBytes: result.ContentLength,
          contentType: result.ContentType,
        };
      } catch (error) {
        if (isNotFoundError(error)) return { exists: false };
        throw error;
      }
    },

    async putObject(bucket, key, body, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
      );
    },

    async getObject(bucket, key) {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error(`object ${bucket}/${key} has no body`);
      return Buffer.from(await result.Body.transformToByteArray());
    },
  };
}
