import * as fs from 'fs';
import { GraphService } from '../src/graph/graph.service';
import { FilterSet, GraphData, GraphResponse, Node } from '../src/graph/graph.types';

// ── test graph ──────────────────────────────────────────────────────────────
//
//   pub (publicExposed) ──► vuln (has vulnerability) ──► sink (rds)
//   pub                 ──► sink                           (fan-in: two routes to sink)
//   plain               ──► queue (sqs)

const pub: Node = { name: 'pub', kind: 'service', publicExposed: true };
const vuln: Node = {
  name: 'vuln',
  kind: 'service',
  vulnerabilities: [{ file: 'Foo.java', severity: 'high', message: 'SQLi', metadata: { cwe: 'CWE-89' } }],
};
const sink: Node = { name: 'sink', kind: 'rds' };
const plain: Node = { name: 'plain', kind: 'service' };
const queue: Node = { name: 'queue', kind: 'sqs' };

const TEST_GRAPH: GraphData = {
  nodeMap: new Map([
    ['pub', pub],
    ['vuln', vuln],
    ['sink', sink],
    ['plain', plain],
    ['queue', queue],
  ]),
  adjacency: new Map([
    ['pub', ['vuln', 'sink']],
    ['vuln', ['sink']],
    ['plain', ['queue']],
  ]),
  normalizedEdges: [
    { from: 'pub', to: 'vuln' },
    { from: 'vuln', to: 'sink' },
    { from: 'pub', to: 'sink' },
    { from: 'plain', to: 'queue' },
  ],
};

// ── helpers ─────────────────────────────────────────────────────────────────

function makeService(): GraphService {
  const svc = new GraphService();
  (svc as any).graphData = TEST_GRAPH;
  return svc;
}

const NO_FILTERS: FilterSet = {
  startsFromPublic: false,
  endsAtSink: false,
  hasVulnerability: false,
};

const nodeNames = (res: GraphResponse): string[] =>
  res.nodes.map((n) => n.name).sort();

const edgeKeys = (res: GraphResponse): string[] =>
  res.edges.map((e) => `${e.from}→${e.to}`).sort();

// ── specs ────────────────────────────────────────────────────────────────────

describe('GraphService.query()', () => {
  let service: GraphService;

  beforeEach(() => {
    service = makeService();
  });

  // ── no filters (zero-filter shortcut) ─────────────────────────────────────

  describe('no filters', () => {
    it('returns every node', () => {
      expect(nodeNames(service.query(NO_FILTERS))).toEqual(
        ['plain', 'pub', 'queue', 'sink', 'vuln'],
      );
    });

    it('returns every edge', () => {
      expect(edgeKeys(service.query(NO_FILTERS))).toEqual([
        'plain→queue',
        'pub→sink',
        'pub→vuln',
        'vuln→sink',
      ]);
    });
  });

  // ── startsFromPublic ───────────────────────────────────────────────────────

  describe('startsFromPublic=true', () => {
    const filters = { ...NO_FILTERS, startsFromPublic: true };

    it('excludes paths from non-public origins', () => {
      const res = service.query(filters);
      expect(nodeNames(res)).not.toContain('plain');
      expect(nodeNames(res)).not.toContain('queue');
    });

    it('includes all nodes reachable from a public origin', () => {
      const res = service.query(filters);
      expect(nodeNames(res)).toContain('pub');
      expect(nodeNames(res)).toContain('vuln');
      expect(nodeNames(res)).toContain('sink');
    });

    it('includes both routes from pub to sink', () => {
      const res = service.query(filters);
      expect(edgeKeys(res)).toContain('pub→sink');
      expect(edgeKeys(res)).toContain('pub→vuln');
      expect(edgeKeys(res)).toContain('vuln→sink');
    });
  });

  // ── endsAtSink ────────────────────────────────────────────────────────────

  describe('endsAtSink=true', () => {
    const filters = { ...NO_FILTERS, endsAtSink: true };

    it('includes rds and sqs sink nodes', () => {
      const res = service.query(filters);
      expect(nodeNames(res)).toContain('sink');
      expect(nodeNames(res)).toContain('queue');
    });

    it('sink reachable via two routes appears only once in nodes', () => {
      const res = service.query(filters);
      expect(res.nodes.filter((n) => n.name === 'sink')).toHaveLength(1);
    });

    it('each edge appears at most once even with multiple paths to sink', () => {
      const res = service.query(filters);
      const keys = edgeKeys(res);
      expect(keys.length).toBe(new Set(keys).size);
    });
  });

  // ── hasVulnerability ──────────────────────────────────────────────────────

  describe('hasVulnerability=true', () => {
    const filters = { ...NO_FILTERS, hasVulnerability: true };

    it('excludes paths with no vulnerable node', () => {
      const res = service.query(filters);
      expect(nodeNames(res)).not.toContain('plain');
      expect(nodeNames(res)).not.toContain('queue');
    });

    it('includes the vulnerable node and everything on its path', () => {
      const res = service.query(filters);
      expect(nodeNames(res)).toContain('vuln');
      expect(nodeNames(res)).toContain('sink');
    });

    it('pub→sink direct path (no vulnerability) is excluded', () => {
      // pub→sink has no vuln, so that path is dropped.
      // pub still appears because pub→vuln→sink satisfies the filter.
      const res = service.query(filters);
      expect(nodeNames(res)).toContain('pub');
      expect(edgeKeys(res)).not.toContain('pub→sink');
    });
  });

  // ── AND logic (combined filters) ──────────────────────────────────────────

  describe('combined filters (AND logic)', () => {
    it('startsFromPublic + hasVulnerability keeps only pub→vuln→sink', () => {
      const res = service.query({ startsFromPublic: true, endsAtSink: false, hasVulnerability: true });
      // pub→sink fails hasVulnerability; pub→vuln→sink satisfies both
      expect(edgeKeys(res)).toEqual(['pub→vuln', 'vuln→sink'].sort());
      expect(nodeNames(res)).toEqual(['pub', 'sink', 'vuln'].sort());
    });

    it('all three filters combined return the one path that satisfies all', () => {
      const res = service.query({ startsFromPublic: true, endsAtSink: true, hasVulnerability: true });
      expect(nodeNames(res)).toContain('pub');
      expect(nodeNames(res)).toContain('vuln');
      expect(nodeNames(res)).toContain('sink');
      expect(nodeNames(res)).not.toContain('queue');
    });

    it('returns empty when no path satisfies all filters', () => {
      // queue is not a vulnerability path and not public-origin — no path can satisfy all three
      const svc = new GraphService();
      (svc as any).graphData = {
        nodeMap: new Map([['a', { name: 'a', kind: 'service' }], ['b', { name: 'b', kind: 'service' }]]),
        adjacency: new Map([['a', ['b']]]),
        normalizedEdges: [{ from: 'a', to: 'b' }],
      };
      const res = svc.query({ startsFromPublic: true, endsAtSink: true, hasVulnerability: true });
      expect(res.nodes).toHaveLength(0);
      expect(res.edges).toHaveLength(0);
    });
  });

  // ── edge normalization (to: string[]) ─────────────────────────────────────

  describe('edge normalization via onModuleInit', () => {
    it('normalizes to: string[] to flat { from, to } pairs', () => {
      const svc = new GraphService();
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(
        JSON.stringify({
          nodes: [
            { name: 'a', kind: 'service' },
            { name: 'b', kind: 'rds' },
            { name: 'c', kind: 'sqs' },
          ],
          edges: [{ from: 'a', to: ['b', 'c'] }],
        }) as any,
      );
      svc.onModuleInit();
      const res = svc.query(NO_FILTERS);
      expect(res.edges).toHaveLength(2);
      expect(res.edges.every((e) => typeof e.to === 'string')).toBe(true);
      expect(res.edges.map((e) => e.to).sort()).toEqual(['b', 'c']);
    });

    it('skips edges referencing unknown nodes without throwing', () => {
      const svc = new GraphService();
      jest.spyOn(fs, 'readFileSync').mockReturnValueOnce(
        JSON.stringify({
          nodes: [{ name: 'a', kind: 'service' }],
          edges: [{ from: 'a', to: 'ghost' }],
        }) as any,
      );
      svc.onModuleInit();
      const res = svc.query(NO_FILTERS);
      expect(res.nodes).toHaveLength(1);
      expect(res.edges).toHaveLength(0);
    });
  });
});
