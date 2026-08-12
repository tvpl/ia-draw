import { describe, expect, it } from 'vitest';
import { parseStructurizrDsl, toStructurizrDsl } from './structurizr.js';

describe('parseStructurizrDsl / toStructurizrDsl (T61, AAC-01/02)', () => {
  it('parses a softwareSystem with 2 containers and 1 relationship into a valid IrDocument', () => {
    const dsl = [
      'workspace {',
      '  model {',
      '    sys = softwareSystem "My System" {',
      '      webapp = container "Web Application"',
      '      database = container "Database"',
      '      webapp -> database "Reads/writes"',
      '    }',
      '  }',
      '}',
    ].join('\n');

    const { ir, limitations } = parseStructurizrDsl(dsl);

    expect(limitations).toEqual([]);
    const container = ir.containers.find((c) => c.id === 'sys');
    expect(container).toMatchObject({ kind: 'boundedContext', label: 'My System' });
    expect(container?.children.sort()).toEqual(['database', 'webapp']);

    expect(ir.nodes.map((n) => n.id).sort()).toEqual(['database', 'webapp']);

    expect(ir.edges).toHaveLength(1);
    expect(ir.edges[0]).toMatchObject({
      from: 'webapp',
      to: 'database',
      semantics: { mode: 'dependency', direction: 'oneway', label: 'Reads/writes' },
    });
  });

  it('ignores a views block without failing the parse, and mentions it in limitations', () => {
    const dsl = [
      'workspace {',
      '  model {',
      '    sys = softwareSystem "My System" {',
      '      webapp = container "Web Application"',
      '    }',
      '  }',
      '  views {',
      '    systemContext sys {',
      '      include *',
      '      autoLayout',
      '    }',
      '  }',
      '}',
    ].join('\n');

    const { ir, limitations } = parseStructurizrDsl(dsl);

    expect(ir.containers.map((c) => c.id)).toEqual(['sys']);
    expect(ir.nodes.map((n) => n.id)).toEqual(['webapp']);
    expect(limitations.some((l) => l.includes('views'))).toBe(true);
  });

  it('toStructurizrDsl of a simple IrDocument produces a DSL that is parseable back', () => {
    const ir = {
      version: 'v1' as const,
      kind: 'c4-context' as const,
      nodes: [
        { id: 'webapp', label: 'Web Application' },
        { id: 'database', label: 'Database' },
      ],
      containers: [
        {
          id: 'sys',
          label: 'My System',
          kind: 'boundedContext' as const,
          children: ['webapp', 'database'],
        },
      ],
      edges: [
        {
          from: 'webapp',
          to: 'database',
          semantics: {
            mode: 'dependency' as const,
            direction: 'oneway' as const,
            label: 'writes to',
          },
        },
      ],
    };

    const { dsl } = toStructurizrDsl(ir);
    expect(dsl).toContain('softwareSystem "My System"');
    expect(dsl).toContain('webapp -> database "writes to"');

    const reparsed = parseStructurizrDsl(dsl);
    expect(reparsed.ir.containers.map((c) => c.id)).toEqual(['sys']);
    expect(reparsed.ir.nodes.map((n) => n.id).sort()).toEqual(['database', 'webapp']);
    expect(reparsed.ir.edges).toHaveLength(1);
  });

  it('interop/index.ts barrel exports the 4 functions', async () => {
    const barrel = await import('./index.js');
    expect(typeof barrel.parseMermaidFlowchart).toBe('function');
    expect(typeof barrel.toMermaidFlowchart).toBe('function');
    expect(typeof barrel.parseStructurizrDsl).toBe('function');
    expect(typeof barrel.toStructurizrDsl).toBe('function');
  });
});
