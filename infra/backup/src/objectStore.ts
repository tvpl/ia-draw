import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface BackupObjectStore {
  listObjects(bucket: string): Promise<string[]>;
  getObject(bucket: string, key: string): Promise<Buffer>;
  putObject(bucket: string, key: string, body: Buffer): Promise<void>;
}

export interface S3Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Same `forcePathStyle` requirement as `apps/server/src/modules/storage/client.ts` — MinIO doesn't support virtual-hosted-style addressing. This is a separate, minimal client (not imported from `apps/server`, which isn't a shared workspace package) — the object-storage surface it needs is 3 operations, not the full server storage module. */
export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
  });
}

export function createS3ObjectStore(client: S3Client): BackupObjectStore {
  return {
    async listObjects(bucket) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      do {
        const result = await client.send(
          new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
        );
        for (const object of result.Contents ?? []) {
          if (object.Key) keys.push(object.Key);
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },

    async getObject(bucket, key) {
      const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!result.Body) throw new Error(`object ${bucket}/${key} has no body`);
      return Buffer.from(await result.Body.transformToByteArray());
    },

    async putObject(bucket, key, body) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body }));
    },
  };
}
