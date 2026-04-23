import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { FILTER_REGISTRY } from './graph.filters';
import {
  FilterSet,
  GraphData,
  GraphResponse,
  NormalizedEdge,
  Node,
  NodePredicate,
  RawEdge,
  RawGraphData,
} from './graph.types';

// Per-frame visited set rather than a shared one — a global set would prune
// legitimate fan-in paths (e.g. both A -> C and A -> B -> C would skip C the second time).
interface DfsFrame {
  node: Node;
  path: Node[];
  visited: Set<string>;
}

@Injectable()
export class GraphService implements OnModuleInit {
  private readonly logger = new Logger(GraphService.name);
  private graphData!: GraphData;

  onModuleInit(): void {
    const filePath =
      process.env.GRAPH_DATA_PATH ??
      path.join(process.cwd(), 'train-ticket-be (1).json');
    const raw = this.loadAndValidate(filePath);
    this.graphData = this.buildGraphData(raw);
  }

  private loadAndValidate(filePath: string): RawGraphData {
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      throw new Error(`Failed to read graph data file at ${filePath}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error('Graph data file contains invalid JSON');
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !Array.isArray((parsed as Record<string, unknown>).nodes) ||
      !Array.isArray((parsed as Record<string, unknown>).edges)
    ) {
      throw new Error(
        'Graph data file must have top-level "nodes" and "edges" arrays',
      );
    }

    return parsed as RawGraphData;
  }

  private buildGraphData(raw: RawGraphData): GraphData {
    const nodeMap = new Map<string, Node>();
    const adjacency = new Map<string, string[]>();

    for (const node of raw.nodes) {
      nodeMap.set(node.name, node);
    }

    // Build adjacency once at startup so each DFS call is O(1) neighbor lookup
    // rather than scanning the full edge list on every step.
    const normalizedEdges: NormalizedEdge[] = [];

    for (const edge of raw.edges) {
      if (!nodeMap.has(edge.from)) {
        this.logger.warn(
          `Edge "from" references unknown node "${edge.from}" — skipping`,
        );
        continue;
      }

      const targets = this.normalizeTarget(edge);
      const validTargets: string[] = [];

      for (const target of targets) {
        if (!nodeMap.has(target)) {
          this.logger.warn(
            `Edge references unknown node "${target}" (from "${edge.from}") — skipping`,
          );
          continue;
        }
        validTargets.push(target);
        normalizedEdges.push({ from: edge.from, to: target });
      }

      if (validTargets.length > 0) {
        const existing = adjacency.get(edge.from) ?? [];
        adjacency.set(edge.from, [...existing, ...validTargets]);
      }
    }

    return { nodeMap, adjacency, normalizedEdges };
  }

  private normalizeTarget(edge: RawEdge): string[] {
    return Array.isArray(edge.to) ? edge.to : [edge.to];
  }

  // Active filters are ANDed — a path must satisfy all of them to be included.
  query(filters: FilterSet): GraphResponse {
    const activeEntries = (
      Object.entries(FILTER_REGISTRY) as [keyof FilterSet, (typeof FILTER_REGISTRY)[keyof FilterSet]][]
    ).filter(([key]) => filters[key]);

    // No active filters : skip DFS entirely and return from the pre-built maps.
    // O(n) instead of O(n·m): meaningful difference on large graphs.
    if (activeEntries.length === 0) {
      return {
        nodes: Array.from(this.graphData.nodeMap.values()),
        edges: this.graphData.normalizedEdges,
      };
    }

    const activePredicates = activeEntries.map(([, e]) => e.path);

    // Combine all declared seed filters with AND logic. Seeds that fail are
    // skipped before DFS begins, pruning their entire sub-tree up-front.
    const seedChecks = activeEntries
      .map(([, e]) => e.seed)
      .filter((s): s is NodePredicate => s !== undefined);
    const seedFilter: NodePredicate =
      seedChecks.length > 0
        ? (node) => seedChecks.every((check) => check(node))
        : () => true;

    return this.traverseWithFilters(activePredicates, seedFilter);
  }

  private traverseWithFilters(
    activePredicates: ((path: Node[]) => boolean)[],
    seedFilter: NodePredicate,
  ): GraphResponse {
    const { nodeMap, adjacency } = this.graphData;

    const matchedNodeNames = new Set<string>();
    const matchedEdgeKeys = new Set<string>();
    const collectedEdges: NormalizedEdge[] = [];

    const stack: DfsFrame[] = [];

    // Seed from nodes that pass the combined seed filter. Filters with a seed
    // predicate (e.g. startsFromPublic) prune entire sub-trees here rather than
    // discovering at leaf evaluation that the origin was wrong.
    // Microservices graphs have no guaranteed single root, so every qualifying
    // node is a valid DFS origin.
    for (const [name, node] of nodeMap) {
      if (!seedFilter(node)) continue;
      stack.push({ node, path: [node], visited: new Set([name]) });
    }
    while (stack.length > 0) {
      const frame = stack.pop()!;
      const { node, path, visited } = frame;
      const neighbors = adjacency.get(node.name) ?? [];

      if (neighbors.length === 0) {
        if (activePredicates.every((p) => p(path))) {
          this.collectPath(path, matchedNodeNames, matchedEdgeKeys, collectedEdges);
        }
        continue;
      }

      let pushed = 0;
      for (const neighborName of neighbors) {
        if (visited.has(neighborName)) continue;

        const neighbor = nodeMap.get(neighborName);
        if (!neighbor) continue;

        const newVisited = new Set(visited);
        newVisited.add(neighborName);

        stack.push({
          node: neighbor,
          path: [...path, neighbor],
          visited: newVisited,
        });
        pushed++;
      }

      // pushed===0: all neighbors were already in this path's visited set (cycle prevention).
      // Treating this as a complete path is intentional — A→B is a valid terminus even if
      // B has an edge back to A. A separate true-leaf check would miss these paths.
      if (pushed === 0) {
        if (activePredicates.every((p) => p(path))) {
          this.collectPath(path, matchedNodeNames, matchedEdgeKeys, collectedEdges);
        }
      }
    }

    return {
      nodes: matchedNodeNames.size > 0
        ? Array.from(matchedNodeNames).map((n) => nodeMap.get(n)!)
        : [],
      edges: collectedEdges,
    };
  }

  private collectPath(
    path: Node[],
    matchedNodeNames: Set<string>,
    matchedEdgeKeys: Set<string>,
    collectedEdges: NormalizedEdge[],
  ): void {
    for (const node of path) {
      matchedNodeNames.add(node.name);
    }

    for (let i = 0; i < path.length - 1; i++) {
      const edgeKey = `${path[i].name}→${path[i + 1].name}`;
      if (!matchedEdgeKeys.has(edgeKey)) {
        matchedEdgeKeys.add(edgeKey);
        collectedEdges.push({ from: path[i].name, to: path[i + 1].name });
      }
    }
  }
}
