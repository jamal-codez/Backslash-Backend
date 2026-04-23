import { FilterEntry, FilterSet, Node, NodePredicate, PathPredicate } from './graph.types';

// Predicates receive the full path rather than a single node so future filters
// can reason about shape — hop count, intermediate node patterns, etc.
const isPublicOrigin: NodePredicate = (node) => node.publicExposed === true;

const isAtSink: NodePredicate = (node) =>
  node.kind === 'rds' || node.kind === 'sqs';

const hasVulnerabilityNode: NodePredicate = (node) =>
  (node.vulnerabilities?.length ?? 0) > 0;

const pathStartsFromPublic: PathPredicate = (path) =>
  path.length > 0 && isPublicOrigin(path[0]);

const pathEndsAtSink: PathPredicate = (path) =>
  path.length > 0 && isAtSink(path[path.length - 1]);

const pathHasVulnerability: PathPredicate = (path) =>
  path.some((n) => hasVulnerabilityNode(n));

// Adding a filter = one entry here. The controller, service, and DTO stay
// untouched as long as the key already exists in FilterSet.
// seed (optional): a node-level check applied before DFS begins; prunes entire
// subtrees so the traversal never visits paths that cannot satisfy the filter.
export const FILTER_REGISTRY: Record<keyof FilterSet, FilterEntry> = {
  startsFromPublic: { path: pathStartsFromPublic, seed: isPublicOrigin },
  endsAtSink:       { path: pathEndsAtSink },
  hasVulnerability: { path: pathHasVulnerability },
};
