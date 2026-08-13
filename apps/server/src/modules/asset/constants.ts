/** MIME allowlist for uploaded assets (design.md asset module: "allowlist MIME"). */
export const ALLOWED_ASSET_MIME_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

/** Max accepted upload size, 10 MiB. */
export const MAX_ASSET_SIZE_BYTES = 10 * 1024 * 1024;

/** Signed-URL TTL for the upload PUT (seconds). */
export const UPLOAD_URL_TTL_SECONDS = 900;
