import { describe, expect, it } from 'vitest';
import { classifyIntent } from './intent.js';

describe('classifyIntent (T53, product-spec.md §8.4 step 1)', () => {
  it('classifies a creation request', () => {
    expect(classifyIntent('Crie um diagrama AWS multi-AZ com ALB, ECS e RDS')).toBe('create');
    expect(classifyIntent('Generate a new diagram for our checkout flow')).toBe('create');
  });

  it('classifies a reorganize request', () => {
    expect(classifyIntent('Reorganize este diagrama sem mudar a semântica')).toBe('reorganize');
  });

  it('classifies a review request', () => {
    expect(classifyIntent('Revise os riscos e marque pontos únicos de falha')).toBe('review');
  });

  it('classifies an explain request', () => {
    expect(classifyIntent('Explique por que este componente é um single point of failure')).toBe(
      'explain',
    );
  });

  it('classifies a document request', () => {
    expect(classifyIntent('Gerar spec draft fiel ao desenho atual')).toBe('document');
  });

  it('falls back to edit when no keyword matches', () => {
    expect(classifyIntent('Mova o componente de banco de dados 200px para a direita')).toBe('edit');
  });
});
