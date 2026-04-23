import { FILTER_REGISTRY } from '../src/graph/graph.filters';
import { FilterSet, Node } from '../src/graph/graph.types';

const makeNode = (overrides: Partial<Node> = {}): Node => ({
  name: 'node',
  kind: 'service',
  ...overrides,
});

const vuln = {
  file: 'src/Foo.java',
  severity: 'high' as const,
  message: 'SQL injection',
  metadata: { cwe: 'CWE-89' },
};

describe('FILTER_REGISTRY', () => {
  it('covers every key defined in FilterSet', () => {
    const filterSetKeys: (keyof FilterSet)[] = [
      'startsFromPublic',
      'endsAtSink',
      'hasVulnerability',
    ];
    for (const key of filterSetKeys) {
      expect(FILTER_REGISTRY).toHaveProperty(key);
      expect(typeof FILTER_REGISTRY[key].path).toBe('function');
    }
  });

  it('startsFromPublic declares a seed predicate for up-front pruning', () => {
    expect(typeof FILTER_REGISTRY.startsFromPublic.seed).toBe('function');
  });

  it('seed predicate for startsFromPublic accepts only public nodes', () => {
    const seed = FILTER_REGISTRY.startsFromPublic.seed!;
    expect(seed(makeNode({ publicExposed: true }))).toBe(true);
    expect(seed(makeNode({ publicExposed: false }))).toBe(false);
    expect(seed(makeNode())).toBe(false);
  });
});

describe('startsFromPublic predicate', () => {
  const predicate = FILTER_REGISTRY.startsFromPublic.path;

  it('passes when the first node has publicExposed: true', () => {
    const path = [makeNode({ publicExposed: true }), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(true);
  });

  it('fails when the first node has publicExposed: false', () => {
    const path = [makeNode({ publicExposed: false }), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(false);
  });

  it('fails when the first node has publicExposed absent', () => {
    const path = [makeNode(), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(false);
  });

  it('passes for a single-node path where that node is public', () => {
    const path = [makeNode({ publicExposed: true })];
    expect(predicate(path)).toBe(true);
  });

  it('evaluates only the first node, ignoring public nodes deeper in the path', () => {
    const path = [
      makeNode({ publicExposed: false }),
      makeNode({ name: 'mid', publicExposed: true }),
    ];
    expect(predicate(path)).toBe(false);
  });
});

describe('endsAtSink predicate', () => {
  const predicate = FILTER_REGISTRY.endsAtSink.path;

  it('passes when the last node has kind: rds', () => {
    const path = [makeNode(), makeNode({ name: 'db', kind: 'rds' })];
    expect(predicate(path)).toBe(true);
  });

  it('passes when the last node has kind: sqs', () => {
    const path = [makeNode(), makeNode({ name: 'q', kind: 'sqs' })];
    expect(predicate(path)).toBe(true);
  });

  it('fails when the last node has kind: service', () => {
    const path = [makeNode(), makeNode({ name: 'svc', kind: 'service' })];
    expect(predicate(path)).toBe(false);
  });

  it('evaluates only the last node, ignoring sinks earlier in the path', () => {
    const path = [
      makeNode({ name: 'db', kind: 'rds' }),
      makeNode({ name: 'svc', kind: 'service' }),
    ];
    expect(predicate(path)).toBe(false);
  });

  it('passes for a single-node path that is itself a sink', () => {
    const path = [makeNode({ kind: 'rds' })];
    expect(predicate(path)).toBe(true);
  });
});

describe('hasVulnerability predicate', () => {
  const predicate = FILTER_REGISTRY.hasVulnerability.path;

  it('passes when any node in the path has vulnerabilities', () => {
    const path = [
      makeNode(),
      makeNode({ name: 'b', vulnerabilities: [vuln] }),
      makeNode({ name: 'c' }),
    ];
    expect(predicate(path)).toBe(true);
  });

  it('passes when the first node in the path has vulnerabilities', () => {
    const path = [makeNode({ vulnerabilities: [vuln] }), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(true);
  });

  it('passes when the last node in the path has vulnerabilities', () => {
    const path = [makeNode(), makeNode({ name: 'b', vulnerabilities: [vuln] })];
    expect(predicate(path)).toBe(true);
  });

  it('fails when no node has vulnerabilities', () => {
    const path = [makeNode(), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(false);
  });

  it('fails when vulnerabilities array is empty', () => {
    const path = [makeNode({ vulnerabilities: [] }), makeNode({ name: 'b' })];
    expect(predicate(path)).toBe(false);
  });

  it('fails for a single clean node', () => {
    const path = [makeNode()];
    expect(predicate(path)).toBe(false);
  });
});
