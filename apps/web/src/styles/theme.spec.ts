import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const THEME = join(SRC_ROOT, 'styles/theme.css');

describe('design tokens (UIF-02, UIF-03)', () => {
  const theme = readFileSync(THEME, 'utf8');

  it('declares every token scale the spec names, in one file', () => {
    for (const token of [
      '--color-surface',
      '--color-content',
      '--color-border',
      '--color-accent',
      '--color-danger',
      '--radius-control',
      '--shadow-panel',
      '--font-sans',
      '--spacing-content',
    ]) {
      expect(theme).toContain(token);
    }
  });

  it('holds the tokens in a @theme block, not scattered across rules', () => {
    expect(theme).toContain('@theme {');
  });
});
