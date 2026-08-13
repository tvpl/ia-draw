/**
 * Redacts free-text argument fields before a tool call is persisted to
 * `ai_tool_calls.arguments_redacted` (T53 "What": "argumentos redigidos —
 * nunca o token, nunca dados potencialmente sensíveis do usuário além do
 * necessário para auditoria"). The audit trail keeps every structural field
 * (elementIds, numbers, enums, stableKeys) — the shape of what happened is
 * exactly what auditing needs — but replaces the handful of free-text
 * fields every tool's own JSON Schema exposes (`label`, `text`, `query`;
 * see packages/ai-tools' read/write tool arg schemas) with a fixed
 * placeholder, since those fields may echo arbitrary user- or
 * scene-authored text (including, in the adversarial case, prompt-injection
 * payloads — T56) that has no audit value beyond "a tool was called".
 *
 * Deep/recursive so it also covers `generate_ir`/`compile_ir`'s nested IR
 * document argument (`nodes[].label`, `edges[].semantics.label`,
 * `containers[].label`).
 */

const REDACTED_KEYS = new Set(['label', 'text', 'query']);
const REDACTED_PLACEHOLDER = '[redacted]';

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object')
    return redactObject(value as Record<string, unknown>);
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACTED_KEYS.has(key) && typeof value === 'string') {
      result[key] = REDACTED_PLACEHOLDER;
    } else {
      result[key] = redactValue(value);
    }
  }
  return result;
}

/** Redacts `args` (a tool call's already-parsed argument object) for audit storage. Never throws — a non-object `args` is returned as-is (no free-text field to redact). */
export function redactToolArguments(args: unknown): unknown {
  if (args !== null && typeof args === 'object' && !Array.isArray(args)) {
    return redactObject(args as Record<string, unknown>);
  }
  return args;
}
