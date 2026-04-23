export interface Vulnerability {
  file: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  metadata: { cwe: string };
}

export interface Node {
  name: string;
  kind: 'service' | 'rds' | 'sqs';
  language?: string;
  path?: string;
  publicExposed?: boolean;
  vulnerabilities?: Vulnerability[];
  metadata?: Record<string, unknown>;
}

export interface RawEdge {
  from: string;
  to: string | string[];
}

export interface NormalizedEdge {
  from: string;
  to: string;
}

export interface RawGraphData {
  nodes: Node[];
  edges: RawEdge[];
}

export interface GraphData {
  nodeMap: Map<string, Node>;
  adjacency: Map<string, string[]>;
  normalizedEdges: NormalizedEdge[];
}

export interface FilterSet {
  startsFromPublic: boolean;
  endsAtSink: boolean;
  hasVulnerability: boolean;
}

export interface GraphResponse {
  nodes: Node[];
  edges: NormalizedEdge[];
}

export type NodePredicate = (node: Node) => boolean;
export type PathPredicate = (path: Node[]) => boolean;

// A filter can declare an optional seed predicate that is evaluated against
// the origin node before DFS begins. When present it prunes entire subtrees
// up-front (e.g. startsFromPublic only seeds from public nodes), avoiding
// traversing sub-graphs that can never satisfy the filter.
export interface FilterEntry {
  path: PathPredicate;
  seed?: NodePredicate;
}
