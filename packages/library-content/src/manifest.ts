import { type LibraryItem, type LibraryManifest, libraryManifestSchema } from './schema.js';

/**
 * Original, project-authored pictograms — plain geometric shapes (no
 * third-party design system's specific glyph is copied), so there is no
 * upstream license to track: they are dedicated to the public domain
 * (CC0-1.0) by this project. Kept intentionally simple (Simplicity
 * principle) — one recognizable abstract shape per category, nothing more.
 */
const GENERIC_LICENSE = 'CC0-1.0';
const GENERIC_ATTRIBUTION = 'Architecture Canvas project (original artwork, no external source)';

function inline(svg: string): LibraryItem['icon'] {
  return { kind: 'inline', svg };
}

/**
 * AWS Architecture Icons license, verified via the Knowledge Verification
 * Chain against `awslabs/aws-icons-for-plantuml` — an official AWS GitHub
 * org repository whose `LICENSE` file and README state the icons
 * (redistributed straight from https://aws.amazon.com/architecture/icons/)
 * are licensed CC-BY-ND 2.0, requiring attribution to Amazon Web Services
 * and forbidding derivative works. `aws.amazon.com` itself is
 * egress-blocked in this sandbox, so this indirect-but-official
 * confirmation is the strongest verification reachable here; see
 * `iconArtworkSchema`'s docstring in schema.ts for why every AWS item below
 * carries an `external` icon reference instead of embedded SVG markup.
 */
const AWS_LICENSE = 'CC-BY-ND-2.0';
const AWS_ATTRIBUTION = '© Amazon Web Services, Inc. — AWS Architecture Icons';
const AWS_SOURCE_URL = 'https://aws.amazon.com/architecture/icons/';
const AWS_SOURCE_VERIFICATION =
  'License verified indirectly via awslabs/aws-icons-for-plantuml (official AWS GitHub org) — its LICENSE file and README ' +
  'confirm CC-BY-ND 2.0 for icons sourced from this same official page. aws.amazon.com itself is unreachable from this ' +
  'sandbox (egress-blocked), so the actual SVG artwork is not embedded here — only verified metadata plus a reference to ' +
  'the authoritative download location, per the ND (no-derivatives) restriction and the task instruction to never guess ' +
  'a license.';

function awsIcon(): LibraryItem['icon'] {
  return { kind: 'external', sourceUrl: AWS_SOURCE_URL, note: AWS_SOURCE_VERIFICATION };
}

const GENERIC_ITEMS: LibraryItem[] = [
  {
    stableKey: 'generic.compute.server',
    name: 'Server',
    category: 'compute',
    aliases: ['host', 'vm', 'machine'],
    description: 'Generic compute host (VM, bare metal or long-lived process).',
    tags: ['compute', 'infra'],
    color: '#4B5563',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="6" rx="1.5"/><rect x="3" y="14" width="18" height="6" rx="1.5"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.containers.container',
    name: 'Container',
    category: 'containers',
    aliases: ['docker', 'pod'],
    description: 'Generic containerized workload (e.g. a single container or pod).',
    tags: ['containers', 'orchestration'],
    color: '#2563EB',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="6" width="14" height="14" rx="1.5"/><rect x="7" y="4" width="14" height="14" rx="1.5" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.serverless.function',
    name: 'Function',
    category: 'serverless',
    aliases: ['lambda', 'faas'],
    description: 'Generic serverless function / FaaS unit.',
    tags: ['serverless', 'compute'],
    color: '#D97706',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M13 2 4 14h6l-1 8 9-12h-6z"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.storage.object-storage',
    name: 'Object storage',
    category: 'storage',
    aliases: ['bucket', 'blob storage'],
    description: 'Generic object storage bucket.',
    tags: ['storage'],
    color: '#059669',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.database.relational-database',
    name: 'Relational database',
    category: 'database',
    aliases: ['sql database', 'rdbms'],
    description: 'Generic relational database instance.',
    tags: ['database', 'sql'],
    color: '#7C3AED',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5"/><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.networking.load-balancer',
    name: 'Load balancer',
    category: 'networking',
    aliases: ['lb', 'reverse proxy'],
    description: 'Generic load balancer distributing traffic across nodes.',
    tags: ['networking'],
    color: '#0891B2',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="12" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="20" cy="12" r="2"/><circle cx="20" cy="19" r="2"/><path d="M6 12h5M11 12 18 5M11 12h7M11 12 18 19" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.security.identity-provider',
    name: 'Identity provider',
    category: 'security',
    aliases: ['auth', 'iam'],
    description: 'Generic identity/authorization provider or policy boundary.',
    tags: ['security', 'auth'],
    color: '#DC2626',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="M9 12l2 2 4-4" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.observability.monitoring',
    name: 'Monitoring',
    category: 'observability',
    aliases: ['metrics', 'dashboard'],
    description: 'Generic monitoring/observability dashboard or agent.',
    tags: ['observability'],
    color: '#0D9488',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" fill="none" stroke-width="1.5"/><path d="M12 12 16 8" fill="none" stroke-width="1.5"/><circle cx="12" cy="12" r="1.2"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.messaging.queue',
    name: 'Message queue',
    category: 'messaging',
    aliases: ['topic', 'broker'],
    description: 'Generic asynchronous message queue or topic.',
    tags: ['messaging', 'async'],
    color: '#EA580C',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="7" width="20" height="14" rx="1.5"/><path d="M2 8l10 7 10-7" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.integration.api-gateway',
    name: 'API gateway',
    category: 'integration',
    aliases: ['gateway', 'bff'],
    description: 'Generic API gateway or integration façade.',
    tags: ['integration', 'api'],
    color: '#9333EA',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke-width="1.5"/><path d="M8 12h8M8 8h4M8 16h4" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.user_client.user',
    name: 'User',
    category: 'user_client',
    aliases: ['actor', 'end user', 'browser'],
    description: 'Generic human actor or client application.',
    tags: ['user', 'client'],
    color: '#334155',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
  {
    stableKey: 'generic.external_system.external-system',
    name: 'External system',
    category: 'external_system',
    aliases: ['third party', 'saas'],
    description: 'Generic external system outside the team/organization boundary.',
    tags: ['external'],
    color: '#64748B',
    icon: inline(
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7 18a4.5 4.5 0 0 1-1-8.9A5 5 0 0 1 15.3 7 4 4 0 0 1 17 15h-.5" fill="none" stroke-width="1.5"/><path d="M7 18h10" fill="none" stroke-width="1.5"/></svg>',
    ),
    version: '1.0.0',
    license: GENERIC_LICENSE,
    attribution: GENERIC_ATTRIBUTION,
  },
];

const AWS_ITEMS: LibraryItem[] = [
  {
    stableKey: 'aws.ec2',
    name: 'Amazon EC2',
    category: 'compute',
    aliases: ['ec2', 'elastic compute cloud'],
    description: 'Amazon Elastic Compute Cloud — resizable virtual machine instances.',
    tags: ['aws', 'compute'],
    color: '#ED7100',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.lambda',
    name: 'AWS Lambda',
    category: 'serverless',
    aliases: ['lambda', 'faas'],
    description: 'AWS Lambda — run code without provisioning or managing servers.',
    tags: ['aws', 'serverless'],
    color: '#ED7100',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.s3',
    name: 'Amazon S3',
    category: 'storage',
    aliases: ['s3', 'simple storage service'],
    description: 'Amazon Simple Storage Service — object storage built for scale.',
    tags: ['aws', 'storage'],
    color: '#7AA116',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.rds',
    name: 'Amazon RDS',
    category: 'database',
    aliases: ['rds', 'relational database service'],
    description: 'Amazon Relational Database Service — managed relational databases.',
    tags: ['aws', 'database'],
    color: '#C925D1',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.vpc',
    name: 'Amazon VPC',
    category: 'networking',
    aliases: ['vpc', 'virtual private cloud'],
    description: 'Amazon Virtual Private Cloud — an isolated network for AWS resources.',
    tags: ['aws', 'networking'],
    color: '#8C4FFF',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.api-gateway',
    name: 'Amazon API Gateway',
    category: 'integration',
    aliases: ['api gateway', 'apigw'],
    description: 'Amazon API Gateway — create, publish and secure APIs at scale.',
    tags: ['aws', 'integration'],
    color: '#C925D1',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
  {
    stableKey: 'aws.cloudfront',
    name: 'Amazon CloudFront',
    category: 'networking',
    aliases: ['cloudfront', 'cdn'],
    description: 'Amazon CloudFront — a fast content delivery network (CDN).',
    tags: ['aws', 'networking', 'cdn'],
    color: '#8C4FFF',
    icon: awsIcon(),
    version: '2026.1',
    license: AWS_LICENSE,
    attribution: AWS_ATTRIBUTION,
  },
];

const rawManifest: LibraryManifest = {
  name: 'architecture-canvas-core',
  version: '1.0.0',
  items: [...GENERIC_ITEMS, ...AWS_ITEMS],
};

/** Validated at import time — an invalid item fails the moment this module loads, not later. */
export const LIBRARY_MANIFEST: LibraryManifest = libraryManifestSchema.parse(rawManifest);
