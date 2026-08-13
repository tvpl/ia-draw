import { describe, expect, it } from 'vitest';
import type { WorkspaceMember } from '../workspace/index.js';
import { parseMentionTokens, resolveMentions } from './mentions.js';

function member(userId: string, email: string): WorkspaceMember {
  return { userId, workspaceId: 'ws-1', role: 'editor', email, displayName: email };
}

describe('parseMentionTokens (T69, CMT-01)', () => {
  it('finds a @userId (uuid-shaped) mention', () => {
    expect(parseMentionTokens('hey @11111111-1111-4111-8111-111111111111 check this')).toEqual([
      '11111111-1111-4111-8111-111111111111',
    ]);
  });

  it('finds a @email mention', () => {
    expect(parseMentionTokens('cc @alice@example.com please review')).toEqual([
      'alice@example.com',
    ]);
  });

  it('ignores an @ that is not followed by a uuid or an email', () => {
    expect(parseMentionTokens('this is not @avalidmention, just prose')).toEqual([]);
  });

  it('returns an empty array for a body with no mentions', () => {
    expect(parseMentionTokens('no mentions here')).toEqual([]);
  });
});

describe('resolveMentions (T69, CMT-01)', () => {
  const alice = member('11111111-1111-4111-8111-111111111111', 'alice@example.com');
  const members = [alice];

  it('resolves a valid @userId mention to that member', () => {
    expect(resolveMentions(`hi @${alice.userId}`, members)).toEqual([alice.userId]);
  });

  it('resolves a valid @email mention (case-insensitively) to that member', () => {
    expect(resolveMentions('hi @ALICE@EXAMPLE.COM', members)).toEqual([alice.userId]);
  });

  it('silently drops a mention of a non-member — never throws, returns the empty set for that token', () => {
    expect(resolveMentions('hi @bob@example.com', members)).toEqual([]);
  });

  it('a mix of one valid and one invalid mention resolves only the valid one', () => {
    const result = resolveMentions(`@${alice.userId} and @nobody@example.com`, members);
    expect(result).toEqual([alice.userId]);
  });

  it('deduplicates the same member mentioned twice', () => {
    expect(resolveMentions(`@${alice.userId} @${alice.userId}`, members)).toEqual([alice.userId]);
  });

  it('a body with no @ at all resolves to an empty array', () => {
    expect(resolveMentions('plain comment, nothing special', members)).toEqual([]);
  });
});
