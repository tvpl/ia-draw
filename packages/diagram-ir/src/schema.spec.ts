import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { IR_JSON_SCHEMA, IrValidationError, validateIr } from './schema.js';

function validDocument() {
  return {
    version: 'v1' as const,
    kind: 'aws-multi-az' as const,
    nodes: [
      { id: 'n1', label: 'Web server', componentKey: 'generic.compute.server' },
      { id: 'n2', label: 'Database', semantics: { technology: 'postgres', criticality: 'high' } },
      { id: 'n3', label: 'Queue' },
    ],
    containers: [
      { id: 'c1', label: 'VPC', kind: 'vpc' as const, children: ['n1', 'n2', 'c2'] },
      { id: 'c2', label: 'Private subnet', kind: 'zone' as const, children: ['n3'] },
    ],
    edges: [
      { from: 'n1', to: 'n2', semantics: { mode: 'sync' as const, direction: 'oneway' as const } },
      {
        from: 'n1',
        to: 'n3',
        semantics: {
          mode: 'async' as const,
          direction: 'bidirectional' as const,
          label: 'publish',
        },
      },
      {
        from: 'n2',
        to: 'n3',
        semantics: { mode: 'data' as const, direction: 'oneway' as const, protocol: 'tcp' },
      },
      {
        from: 'n3',
        to: 'n1',
        semantics: { mode: 'dependency' as const, direction: 'oneway' as const },
      },
    ],
  };
}

describe('validateIr', () => {
  it('accepts a complete valid document with nodes, nested containers and one edge per mode', () => {
    const doc = validateIr(validDocument());
    expect(doc.nodes).toHaveLength(3);
    expect(doc.containers).toHaveLength(2);
    expect(doc.edges.map((edge) => edge.semantics.mode)).toEqual([
      'sync',
      'async',
      'data',
      'dependency',
    ]);
  });

  it('accepts an empty document (no nodes/containers/edges)', () => {
    const doc = validateIr({
      version: 'v1',
      kind: 'c4-context',
      nodes: [],
      containers: [],
      edges: [],
    });
    expect(doc.nodes).toEqual([]);
  });

  it('rejects an edge referencing a non-existent "from" node with a structured, path-pointing issue', () => {
    const invalid = validDocument();
    invalid.edges = [{ from: 'ghost', to: 'n2', semantics: { mode: 'sync', direction: 'oneway' } }];

    expect(() => validateIr(invalid)).toThrow(IrValidationError);
    try {
      validateIr(invalid);
      expect.unreachable('validateIr should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IrValidationError);
      const irError = error as IrValidationError;
      expect(irError.issues).toContainEqual(
        expect.objectContaining({ path: ['edges', 0, 'from'] }),
      );
    }
  });

  it('rejects an edge referencing a non-existent "to" node with a structured, path-pointing issue', () => {
    const invalid = validDocument();
    invalid.edges = [{ from: 'n1', to: 'ghost', semantics: { mode: 'sync', direction: 'oneway' } }];

    try {
      validateIr(invalid);
      expect.unreachable('validateIr should have thrown');
    } catch (error) {
      const irError = error as IrValidationError;
      expect(irError.issues).toContainEqual(expect.objectContaining({ path: ['edges', 0, 'to'] }));
    }
  });

  it('rejects a container referencing a non-existent child id with a structured, path-pointing issue', () => {
    const invalid = validDocument();
    invalid.containers = [{ id: 'c1', label: 'VPC', kind: 'vpc', children: ['ghost'] }];
    invalid.edges = [];

    try {
      validateIr(invalid);
      expect.unreachable('validateIr should have thrown');
    } catch (error) {
      const irError = error as IrValidationError;
      expect(irError.issues).toContainEqual(
        expect.objectContaining({ path: ['containers', 0, 'children', 0] }),
      );
    }
  });

  it('rejects a document whose kind is outside the enum', () => {
    const invalid = { ...validDocument(), kind: 'not-a-real-kind' };

    try {
      validateIr(invalid);
      expect.unreachable('validateIr should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(IrValidationError);
      const irError = error as IrValidationError;
      expect(irError.issues.some((issue) => issue.path[0] === 'kind')).toBe(true);
    }
  });
});

describe('IR_JSON_SCHEMA', () => {
  const ajv = new Ajv2020();
  const validate = ajv.compile(IR_JSON_SCHEMA);

  it('is a valid, compilable JSON Schema object', () => {
    expect(IR_JSON_SCHEMA).toBeTypeOf('object');
    expect(typeof validate).toBe('function');
  });

  it('accepts the same valid document validateIr accepts', () => {
    const ok = validate(validDocument());
    expect(ok).toBe(true);
  });

  it('rejects a document whose kind is outside the enum (same shape violation as validateIr)', () => {
    const invalid = { ...validDocument(), kind: 'not-a-real-kind' };
    const ok = validate(invalid);
    expect(ok).toBe(false);
  });

  it('rejects an edge missing the required "semantics.direction" field', () => {
    const invalid = validDocument();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately malformed for the negative test
    delete (invalid.edges[0] as any).semantics.direction;
    const ok = validate(invalid);
    expect(ok).toBe(false);
  });
});
