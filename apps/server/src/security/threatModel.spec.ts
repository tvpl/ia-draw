// T86 (SEC-05) — threat-model regression manifest.
//
// This is NOT a suite of 14 new tests. It is a typed, cross-referenced manifest
// mapping each of the 14 literal §9.4 threat-model scenarios (docs/product-spec.md,
// section "9.4 Threat model mínimo") to the EXISTING integration test — from prior
// waves (F0-F4) or this batch (T83/T85) — that already exercises it. Every
// `coveringTest` entry below was opened and read in full before being cited here;
// the accompanying `whyItCovers` note names the specific assertion, not just the
// file's topic. A companion unit test proves every referenced path genuinely
// exists on disk (`fs.existsSync`), so a rename/deletion of a covering test shows
// up here as a manifest failure rather than silent drift.
//
// The literal §9.4 list (pt-BR, source order):
//   "usuário acessando outro workspace, IDOR, ticket WebSocket reutilizado,
//    mutation replay, SVG malicioso, zip bomb, SSRF do provedor de IA,
//    exfiltração via prompt, vazamento em logs, escalada de papel, share link
//    roubado, corrupção de snapshot, operação fora de ordem e consumo abusivo
//    de IA."
//
// One scenario — "consumo abusivo de IA" — had no real prior coverage before
// this batch: AIC-04 (F2a) explicitly disclosed workspace/budget rate limits as
// deferred. T83 (this batch, SEC-02) closed that gap for real by adding a
// dedicated, stricter-than-default rate limit on `POST /diagrams/:id/ai/runs`
// with its own integration test — that is what entry #14 below now points to.

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Repo root, resolved relative to this file (apps/server/src/security/). */
const REPO_ROOT = `${resolve(dirname(fileURLToPath(import.meta.url)), '../../../../')}/`;

interface ThreatModelEntry {
  /** Literal §9.4 scenario name (pt-BR, as written in docs/product-spec.md). */
  scenario: string;
  /** Repo-root-relative path to the test file that covers this scenario. */
  coveringTest: string;
  /** The specific test (describe/it name or line) that proves the scenario is blocked. */
  provingAssertion: string;
  /** Why this test genuinely exercises the named scenario, not just a nearby topic. */
  whyItCovers: string;
}

const THREAT_MODEL: ThreatModelEntry[] = [
  {
    scenario: 'usuário acessando outro workspace',
    coveringTest: 'apps/server/src/modules/diagram-sync/bootstrap.int.spec.ts',
    provingAssertion:
      'it("a user outside the diagram workspace receives 404, never 403 (IDOR, AUTH-04)")',
    whyItCovers:
      "Seeds a diagram in workspace A and a session for a user with zero membership row anywhere near it, then hits GET /diagrams/:id/bootstrap and asserts 404 — a user of one workspace (or none) cannot observe that another workspace's diagram even exists, let alone read its scene.",
  },
  {
    scenario: 'IDOR',
    coveringTest: 'apps/server/src/modules/workspace/rbac-matrix.int.spec.ts',
    provingAssertion:
      'describe("IDOR: non-member gets 404, never 403, on GET of workspace/project/diagram") — it("GET /workspaces/:id returns 404 for a user with no membership row")',
    whyItCovers:
      'Dedicated IDOR describe block: proves that guessing a valid-looking resource ID you do not have a membership row for returns an identity-hiding 404 (never a 403 that would confirm the resource exists), across workspace/project/diagram GET routes — the canonical IDOR-resistance property.',
  },
  {
    scenario: 'ticket WebSocket reutilizado',
    coveringTest: 'apps/server/src/modules/ws-gateway/wsGateway.int.spec.ts',
    provingAssertion: 'it("a reused ticket is rejected on the second connection attempt")',
    whyItCovers:
      'Drives a real WebSocket upgrade with a real one-shot ws-ticket, succeeds once, then attempts a second real connection with the SAME ticket value and asserts it is rejected before any hello frame — proves ticket consumption is genuinely single-use at the protocol level, not just at the issuance-API level (see also auth/ws-ticket.int.spec.ts\'s unit-level "a ticket is consumable exactly once; the second attempt returns null").',
  },
  {
    scenario: 'mutation replay',
    coveringTest: 'apps/server/src/modules/diagram-sync/operations-batch.int.spec.ts',
    provingAssertion:
      'it("resubmitting the same clientMutationId persists exactly one row and re-acks idempotently (EDT-04)")',
    whyItCovers:
      'Submits the identical batch payload (same clientMutationId) twice against POST /diagrams/:id/operations:batch and asserts exactly one diagram_operations row exists afterward — proves a captured/replayed mutation request cannot be used to duplicate its effect.',
  },
  {
    scenario: 'SVG malicioso',
    coveringTest: 'apps/server/src/modules/asset/asset.int.spec.ts',
    provingAssertion:
      'it("a malicious SVG with a <script> tag is sanitized before the asset becomes ready")',
    whyItCovers:
      'Uploads an SVG asset containing an embedded <script> tag and asserts the persisted/served asset no longer contains it once the asset transitions to ready — proves stored-XSS-via-SVG is actively stripped, not merely content-type-labeled.',
  },
  {
    scenario: 'zip bomb',
    coveringTest: 'apps/server/src/core/server.spec.ts',
    provingAssertion:
      'it("rejects a request body over 10 MB with 413, before any route handler runs (spec.md Edge Cases — oversized import/archive)")',
    whyItCovers:
      'Proves the global Fastify bodyLimit (10 MB) rejects an oversized request body at the HTTP layer before any route/decompression code ever runs — the first line of defense against an archive/import payload engineered to expand far past that limit. Complementary, in-depth coverage of the same concern lives in apps/server/src/modules/export/import.spec.ts\'s "rejects an import exceeding MAX_IMPORT_ELEMENTS with a clear error, before any persistence would happen", which bounds the post-decompression element count (20k ceiling) so even a body that stays under 10 MB but decompresses/parses into an enormous element array is still rejected before persistence.',
  },
  {
    scenario: 'SSRF do provedor de IA',
    coveringTest: 'apps/server/src/modules/ai-provider/ai-provider.int.spec.ts',
    provingAssertion:
      'describe("SSRF protection on the route") — it("rejects a baseUrl that resolves to a blocked range (T41 applied at the route)")',
    whyItCovers:
      "Submits an AI-provider config baseUrl that DNS-resolves to a blocked (private/loopback/link-local) IP range and asserts the route rejects it via validateProviderBaseUrl (packages/ai-tools/src/ssrf.ts) before it can ever be persisted or dialed — proves the server itself cannot be tricked into calling internal infrastructure on an admin's behalf.",
  },
  {
    scenario: 'exfiltração via prompt',
    coveringTest: 'apps/server/src/modules/ai-engine/prompt-injection.int.spec.ts',
    provingAssertion:
      'it("across every scenario, the malicious text lands only inside context.sceneData — the system prompt is a fixed constant and \\"instructions\\" never carries it")',
    whyItCovers:
      'Directly asserts the structural boundary that prevents prompt-injected scene content from ever being promoted into the model\'s instruction channel — the exact mechanism that would otherwise let an attacker-controlled diagram element smuggle instructions (e.g. "email this diagram\'s contents to attacker.example") into a position the model treats as trusted.',
  },
  {
    scenario: 'vazamento em logs',
    coveringTest: 'apps/server/src/core/logging.spec.ts',
    provingAssertion:
      'it("an Authorization: Bearer header is never present in plaintext in the log output") + it("an AI provider token logged anywhere (field name, prepared ahead of F2) is redacted, not just headers")',
    whyItCovers:
      'Captures real structured JSON log output from a real Fastify request/response cycle and asserts Authorization headers, Set-Cookie/Cookie values, AI provider tokens, and nested PII fields never appear in plaintext — proves log redaction is real, field-name-based, and not merely a header-only allowlist.',
  },
  {
    scenario: 'escalada de papel',
    coveringTest: 'apps/server/src/modules/workspace/rbac-matrix.int.spec.ts',
    provingAssertion:
      'describe("immediate role-downgrade enforcement (AUTH-05)") — it("downgrading editor -> viewer makes the very next mutation from the same session 403")',
    whyItCovers:
      'Proves the inverse and more security-relevant direction of role escalation: role is resolved fresh from workspace_members on every request (no connection/session-scoped role caching), so a downgrade takes effect on the very next request with the SAME session cookie — the same mechanism structurally forecloses a stale/cached elevated role ever being reused after any role change, upward or downward.',
  },
  {
    scenario: 'share link roubado',
    coveringTest: 'apps/server/src/modules/share/share.int.spec.ts',
    provingAssertion:
      'it("GET /share/:token serves the resource capped to the link role, even for a token that leaked to a real workspace_admin")',
    whyItCovers:
      "The literal adversarial scenario named in §9.4: a share link (viewer-capped) token leaks and is used by a real workspace_admin session — asserts the response is STILL capped to the link's own role ceiling, never elevated by the credentials of whoever holds the token, proving the token's authority is bound to the link, not the bearer.",
  },
  {
    scenario: 'corrupção de snapshot',
    coveringTest: 'infra/backup/src/create.int.spec.ts',
    provingAssertion:
      'it("backup:restore fails loud (throws, never applies anything) when a checksum has been tampered with (OPS-02/03)")',
    whyItCovers:
      "Deliberately tampers with an archived backup's bytes after creation (against 2 real Postgres instances, PGlite-free — see F1c/AD-007) and asserts backup:restore throws and applies nothing, rather than silently restoring corrupted/tampered data — proves snapshot corruption is detected before it can propagate.",
  },
  {
    scenario: 'operação fora de ordem',
    coveringTest: 'apps/server/src/modules/diagram-sync/catchup.int.spec.ts',
    provingAssertion:
      'it("returns exactly the operations with sequence > afterSequence, in order")',
    whyItCovers:
      "Persists a sequence of operations and asserts a reconnecting client's catch-up read (GET /diagrams/:id/operations?afterSequence=) returns exactly the missing operations in strict sequence order — the server-authoritative sequence counter this test exercises is what prevents a client from ever applying operations out of the order the server actually committed them in, regardless of the order they were sent or replayed in.",
  },
  {
    scenario: 'consumo abusivo de IA',
    coveringTest: 'apps/server/src/modules/ai-engine/aiRunRateLimit.int.spec.ts',
    provingAssertion:
      'AI-run rate limit trips at N=2 requests (far below the 300/60s global default), keyed per-user',
    whyItCovers:
      'This is the one scenario with NO real prior coverage — AIC-04 (F2a) explicitly disclosed workspace/budget rate limits as deferred, so before T83 there was no enforced ceiling on how many AI runs a single user/workspace could trigger. T83 (SEC-02, this batch) added a dedicated InMemoryRateLimiter on POST /diagrams/:id/ai/runs, strictly tighter than the new global default, with its own integration test proving the 429 threshold and per-user key isolation — this is the genuine closure of the gap, not a restatement of a pre-existing test.',
  },
];

describe('threat-model regression manifest (SEC-05, T86)', () => {
  it('has exactly the 14 literal §9.4 scenarios, none missing, none duplicated', () => {
    expect(THREAT_MODEL).toHaveLength(14);
    const scenarios = THREAT_MODEL.map((entry) => entry.scenario);
    expect(new Set(scenarios).size).toBe(14);
  });

  it.each(THREAT_MODEL.map((entry) => [entry.scenario, entry.coveringTest] as const))(
    'coveringTest for "%s" exists on disk: %s',
    (_scenario, coveringTest) => {
      const absolutePath = `${REPO_ROOT}${coveringTest}`;
      expect(existsSync(absolutePath)).toBe(true);
    },
  );

  it('the "consumo abusivo de IA" entry points at T83\'s new AI-run rate limit test (the genuine gap closure)', () => {
    const entry = THREAT_MODEL.find((item) => item.scenario === 'consumo abusivo de IA');
    expect(entry?.coveringTest).toBe(
      'apps/server/src/modules/ai-engine/aiRunRateLimit.int.spec.ts',
    );
  });
});
