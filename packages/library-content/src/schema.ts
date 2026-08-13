import { z } from 'zod';

/**
 * The 12 categories from the source document (docs/product-spec.md), listed
 * verbatim in T37's task body: compute, containers, serverless, storage,
 * database, networking, security, observability, messaging, integration,
 * user/client, external system.
 */
export const SOURCE_DOCUMENT_CATEGORIES = [
  'compute',
  'containers',
  'serverless',
  'storage',
  'database',
  'networking',
  'security',
  'observability',
  'messaging',
  'integration',
  'user_client',
  'external_system',
] as const;

/**
 * T67 (PRS-04) adds `wireframe` as a 13th category for the low-fi
 * prototyping kit (screens, buttons, inputs, lists) — it does not map to
 * any of the 12 infra-taxonomy categories above, which come verbatim from
 * the source document and are deliberately kept as their own constant
 * (`SOURCE_DOCUMENT_CATEGORIES`) so `manifest.spec.ts`'s "every source-
 * document category has a generic component" assertion keeps checking
 * exactly those 12, unaffected by this addition.
 */
export const CATEGORIES = [...SOURCE_DOCUMENT_CATEGORIES, 'wireframe'] as const;

export type Category = (typeof CATEGORIES)[number];

export const categorySchema = z.enum(CATEGORIES);

/**
 * `iconArtwork` is either the actual SVG markup (original, unlicensed-from-a-
 * third-party artwork we authored ourselves) or an external reference to an
 * asset we deliberately do NOT embed — used for the AWS items below, whose
 * upstream license (CC-BY-ND 2.0, verified against `awslabs/aws-icons-for-
 * plantuml` — the official AWS GitHub org's own redistribution) forbids
 * derivative works and whose original files this sandbox has no network
 * access to fetch (aws.amazon.com is egress-blocked here). Rather than draw
 * a look-alike (which would misrepresent itself as the licensed asset while
 * also risking an unlicensed derivative of AWS's trademarked pictograms),
 * every AWS item ships as an `external` reference to the authoritative
 * download location, fully licensed and attributed by metadata alone.
 */
export const iconArtworkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inline'), svg: z.string().min(1) }),
  z.object({
    kind: z.literal('external'),
    sourceUrl: z.string().url(),
    note: z.string().min(1),
  }),
]);

export type IconArtwork = z.infer<typeof iconArtworkSchema>;

/**
 * Central guarantee of T37 (spec.md LIB-01, product-spec.md §3.5): every
 * item MUST carry a non-empty `license` and `attribution`. `stableKey` is
 * the identifier the AI resolves components by (design.md `compile(ir,
 * library)`), so it is validated as a slug-safe, non-empty string.
 */
export const libraryItemSchema = z.object({
  stableKey: z
    .string()
    .min(1)
    .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/, 'stableKey must be a lowercase slug'),
  name: z.string().min(1),
  category: categorySchema,
  aliases: z.array(z.string().min(1)).default([]),
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'color must be a #rrggbb hex value'),
  icon: iconArtworkSchema,
  version: z.string().min(1),
  license: z.string().min(1),
  attribution: z.string().min(1),
});

export type LibraryItem = z.infer<typeof libraryItemSchema>;

export const libraryManifestSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  items: z.array(libraryItemSchema).min(1),
});

export type LibraryManifest = z.infer<typeof libraryManifestSchema>;
