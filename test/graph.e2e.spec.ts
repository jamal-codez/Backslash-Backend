import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { GraphResponse, NormalizedEdge, Node } from '../src/graph/graph.types';

describe('GET /graph (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('response shape', () => {
    it('returns 200 with { nodes: [], edges: [] } structure', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      expect(res.body).toHaveProperty('nodes');
      expect(res.body).toHaveProperty('edges');
      expect(Array.isArray(res.body.nodes)).toBe(true);
      expect(Array.isArray(res.body.edges)).toBe(true);
    });

    it('every node has at least name and kind fields', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      const body = res.body as GraphResponse;
      for (const node of body.nodes) {
        expect(typeof node.name).toBe('string');
        expect(['service', 'rds', 'sqs']).toContain(node.kind);
      }
    });

    it('every edge is a flat { from: string, to: string } pair', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      const body = res.body as GraphResponse;
      for (const edge of body.edges) {
        expect(typeof edge.from).toBe('string');
        expect(typeof edge.to).toBe('string');
        expect(Array.isArray(edge.to)).toBe(false);
      }
    });
  });

  describe('no filters', () => {
    it('returns a non-empty node list', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      expect((res.body as GraphResponse).nodes.length).toBeGreaterThan(0);
    });

    it('returns a non-empty edge list', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      expect((res.body as GraphResponse).edges.length).toBeGreaterThan(0);
    });

    it('returns the same counts on repeated calls', async () => {
      const r1 = await request(app.getHttpServer()).get('/graph').expect(200);
      const r2 = await request(app.getHttpServer()).get('/graph').expect(200);
      expect(r1.body.nodes.length).toBe(r2.body.nodes.length);
      expect(r1.body.edges.length).toBe(r2.body.edges.length);
    });

    it('every edge endpoint references a node that exists in the response', async () => {
      const res = await request(app.getHttpServer()).get('/graph').expect(200);
      const body = res.body as GraphResponse;
      const names = new Set(body.nodes.map((n: Node) => n.name));
      for (const edge of body.edges) {
        expect(names.has(edge.from)).toBe(true);
        expect(names.has(edge.to)).toBe(true);
      }
    });
  });

  describe('startsFromPublic=true', () => {
    it('returns 200', async () => {
      await request(app.getHttpServer())
        .get('/graph?startsFromPublic=true')
        .expect(200);
    });

    it('every returned path originates from a publicExposed node', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?startsFromPublic=true')
        .expect(200);
      const body = res.body as GraphResponse;

      const nodeMap = new Map<string, Node>(body.nodes.map((n: Node) => [n.name, n]));

      const fromNodes = new Set(body.edges.map((e: NormalizedEdge) => e.from));
      const toNodes = new Set(body.edges.map((e: NormalizedEdge) => e.to));
      const originNodes = [...fromNodes].filter((n) => !toNodes.has(n));

      for (const originName of originNodes) {
        const node = nodeMap.get(originName);
        expect(node?.publicExposed).toBe(true);
      }
    });

    it('returns fewer nodes than the unfiltered graph', async () => {
      const full = await request(app.getHttpServer()).get('/graph').expect(200);
      const filtered = await request(app.getHttpServer())
        .get('/graph?startsFromPublic=true')
        .expect(200);
      expect(filtered.body.nodes.length).toBeLessThan(full.body.nodes.length);
    });
  });

  describe('endsAtSink=true', () => {
    it('returns 200', async () => {
      await request(app.getHttpServer())
        .get('/graph?endsAtSink=true')
        .expect(200);
    });

    it('every returned path terminates at a node with kind rds or sqs', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=true')
        .expect(200);
      const body = res.body as GraphResponse;
      const nodeMap = new Map<string, Node>(body.nodes.map((n: Node) => [n.name, n]));

      const fromNodes = new Set(body.edges.map((e: NormalizedEdge) => e.from));
      const toNodes = new Set(body.edges.map((e: NormalizedEdge) => e.to));
      const terminalNodes = [...toNodes].filter((n) => !fromNodes.has(n));

      for (const termName of terminalNodes) {
        const node = nodeMap.get(termName);
        expect(['rds', 'sqs']).toContain(node?.kind);
      }
    });

    it('the response includes at least one rds or sqs node', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=true')
        .expect(200);
      const sinkNodes = (res.body as GraphResponse).nodes.filter(
        (n: Node) => n.kind === 'rds' || n.kind === 'sqs',
      );
      expect(sinkNodes.length).toBeGreaterThan(0);
    });
  });

  describe('hasVulnerability=true', () => {
    it('returns 200', async () => {
      await request(app.getHttpServer())
        .get('/graph?hasVulnerability=true')
        .expect(200);
    });

    it('the response contains at least one node with non-empty vulnerabilities', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?hasVulnerability=true')
        .expect(200);
      const vulnerableNodes = (res.body as GraphResponse).nodes.filter(
        (n: Node) =>
          Array.isArray(n.vulnerabilities) && n.vulnerabilities.length > 0,
      );
      expect(vulnerableNodes.length).toBeGreaterThan(0);
    });
  });

  describe('combined filters (AND logic)', () => {
    it('startsFromPublic=true&endsAtSink=true returns 200', async () => {
      await request(app.getHttpServer())
        .get('/graph?startsFromPublic=true&endsAtSink=true')
        .expect(200);
    });

    it('endsAtSink=true&hasVulnerability=true returns 200 with nodes', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=true&hasVulnerability=true')
        .expect(200);
      expect(res.body.nodes.length).toBeGreaterThan(0);
    });

    it('all three filters return { nodes, edges } even if empty', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?startsFromPublic=true&endsAtSink=true&hasVulnerability=true')
        .expect(200);
      expect(Array.isArray(res.body.nodes)).toBe(true);
      expect(Array.isArray(res.body.edges)).toBe(true);
    });
  });

  describe('validation', () => {
    it('accepts "false" for startsFromPublic and returns full graph with filter inactive', async () => {
      const full = await request(app.getHttpServer()).get('/graph').expect(200);
      const res = await request(app.getHttpServer())
        .get('/graph?startsFromPublic=false')
        .expect(200);
      expect(res.body.nodes.length).toBe(full.body.nodes.length);
    });

    it('accepts "false" for endsAtSink and returns full graph with filter inactive', async () => {
      const full = await request(app.getHttpServer()).get('/graph').expect(200);
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=false')
        .expect(200);
      expect(res.body.nodes.length).toBe(full.body.nodes.length);
    });

    it('accepts "false" for hasVulnerability and returns full graph with filter inactive', async () => {
      const full = await request(app.getHttpServer()).get('/graph').expect(200);
      const res = await request(app.getHttpServer())
        .get('/graph?hasVulnerability=false')
        .expect(200);
      expect(res.body.nodes.length).toBe(full.body.nodes.length);
    });

    it('returns 400 for non-boolean string values', async () => {
      await request(app.getHttpServer())
        .get('/graph?startsFromPublic=yes')
        .expect(400);
    });

    it('ignores unknown query params and returns 200', async () => {
      await request(app.getHttpServer())
        .get('/graph?unknown=foo&anotherParam=bar')
        .expect(200);
    });

    it('returns full graph when unknown params are provided', async () => {
      const clean = await request(app.getHttpServer()).get('/graph').expect(200);
      const withUnknown = await request(app.getHttpServer())
        .get('/graph?foo=bar')
        .expect(200);
      expect(withUnknown.body.nodes.length).toBe(clean.body.nodes.length);
    });
  });

  describe('response deduplication', () => {
    it('no node appears twice in any filtered response', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=true')
        .expect(200);
      const names = (res.body as GraphResponse).nodes.map((n: Node) => n.name);
      expect(names.length).toBe(new Set(names).size);
    });

    it('no edge appears twice in any filtered response', async () => {
      const res = await request(app.getHttpServer())
        .get('/graph?endsAtSink=true')
        .expect(200);
      const edgeKeys = (res.body as GraphResponse).edges.map(
        (e: NormalizedEdge) => `${e.from}→${e.to}`,
      );
      expect(edgeKeys.length).toBe(new Set(edgeKeys).size);
    });
  });
});
