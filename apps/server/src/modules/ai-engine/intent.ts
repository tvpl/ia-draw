/**
 * Intent classification (T53, product-spec.md §8.4 step 1: "Classificar
 * intenção: criar, editar, reorganizar, revisar, explicar ou documentar").
 * A simple keyword heuristic is explicitly sufficient for this phase (T53
 * "What": "heurística simples baseada no texto do pedido é aceitável nesta
 * fase, não precisa ser um classificador sofisticado") — this is NOT a
 * security boundary (the tool registry + preview thresholds are), only a
 * hint used to decide which extra tool-schema context (diagram-ir/v1) to
 * hand the model for a creation request.
 */

export type AiIntent = 'create' | 'edit' | 'reorganize' | 'review' | 'explain' | 'document';

interface KeywordRule {
  intent: AiIntent;
  keywords: readonly string[];
}

// Order matters: checked top to bottom, first match wins. PT/EN keywords side
// by side since the workspace's `language` is user-configurable (T50).
const RULES: readonly KeywordRule[] = [
  {
    intent: 'document',
    keywords: ['documenta', 'document', 'gerar spec', 'generate spec', 'spec draft'],
  },
  {
    intent: 'explain',
    keywords: ['explique', 'explain', 'por que', 'why is'],
  },
  {
    intent: 'review',
    keywords: [
      'revise',
      'revisar',
      'review',
      'audit',
      'valide',
      'validate',
      'risco',
      'risk',
      'single point of failure',
    ],
  },
  {
    intent: 'reorganize',
    keywords: [
      'reorganiz',
      'reorganize',
      'layout',
      'arrume',
      'clean up',
      'auto layout',
      'auto-layout',
    ],
  },
  {
    intent: 'create',
    keywords: [
      'crie',
      'criar',
      'create',
      'generate',
      'gere',
      'gerar',
      'novo diagrama',
      'new diagram',
      'desenhe',
      'draw',
    ],
  },
];

/**
 * Classifies `userRequest` into one of the six pipeline intents. Falls back
 * to `'edit'` (the most conservative choice — no whole-scene creation
 * assumed) when no keyword matches.
 */
export function classifyIntent(userRequest: string): AiIntent {
  const normalized = userRequest.toLowerCase();
  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) return rule.intent;
  }
  return 'edit';
}
