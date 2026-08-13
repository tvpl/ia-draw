import type { WorkspaceMember } from '../workspace/index.js';

/**
 * Simple `@userId` / `@email` mention syntax (CMT-01) — matches a `@`
 * followed by either a UUID (v4-shaped, as every `users.id` is) or an
 * email address. Anything else after `@` (a plain name, a stray `@` in
 * prose) simply doesn't match and is left alone in `body` — never rewritten,
 * never causing a parse failure.
 */
const MENTION_PATTERN =
  /@([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

/** Every raw `@token` found in `body`, in order of appearance — duplicates kept, resolution/dedup happens in `resolveMentions`. */
export function parseMentionTokens(body: string): string[] {
  return [...body.matchAll(MENTION_PATTERN)].map((match) => match[1] as string);
}

/**
 * Resolves `body`'s `@userId`/`@email` mentions against `members` (the
 * commenting diagram's workspace membership) and returns the DISTINCT set
 * of matched member `userId`s. A mention that doesn't resolve to a current
 * workspace member (typo, ex-member, someone from a different workspace) is
 * silently dropped — never thrown, and `body` itself is always persisted
 * verbatim regardless (CMT-01 "Done when": "não falha o comment inteiro").
 */
export function resolveMentions(body: string, members: readonly WorkspaceMember[]): string[] {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) return [];

  const byUserId = new Set(members.map((member) => member.userId));
  const byEmail = new Map(members.map((member) => [member.email.toLowerCase(), member.userId]));

  const resolved = new Set<string>();
  for (const token of tokens) {
    if (byUserId.has(token)) {
      resolved.add(token);
      continue;
    }
    const viaEmail = byEmail.get(token.toLowerCase());
    if (viaEmail) resolved.add(viaEmail);
  }
  return [...resolved];
}
