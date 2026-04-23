# Backslash Backend, Graph Query Engine

NestJS REST API that loads a microservices architecture JSON file at startup and exposes a single `GET /graph` endpoint for querying it. You can filter the returned graph by paths that originate from a publicly exposed node, terminate at a sink (`rds`/`sqs`), or pass through a vulnerable node. Filters are combinable with AND logic. CORS is enabled so it can be hit directly from a browser.

## Running it

Node.js 20+, npm 10+.

```bash
npm install
npm run start:dev       # watch mode
npm run build && npm run start:prod
npm test                # unit + integration tests
npm run test:cov        # with coverage report
```

`PORT` defaults to `3000`. `GRAPH_DATA_PATH` defaults to `train-ticket-be (1).json` in the project root, set it if the file lives elsewhere.

```bash
PORT=8080 GRAPH_DATA_PATH=/data/graph.json npm run start:prod
```

```bash
curl http://localhost:3000/graph
curl "http://localhost:3000/graph?startsFromPublic=true"
curl "http://localhost:3000/graph?startsFromPublic=true&endsAtSink=true"
curl "http://localhost:3000/graph?hasVulnerability=true&endsAtSink=true"
curl "http://localhost:3000/graph?startsFromPublic=true&endsAtSink=true&hasVulnerability=true"
```

Only `true` activates a filter. `false` or omitting the param returns the full graph. Anything else (e.g. `?startsFromPublic=yes`) returns 400.

Swagger UI is available at `http://localhost:3000/api` once the server is running.

## The approach

On startup the service reads the JSON once and builds a `nodeMap` (name to node) and an `adjacency` map (name to neighbor names) in a single pass over the edges array. Everything after that works off those two maps, no re-scanning the raw data per request.

The query engine runs an iterative DFS rather than recursive to avoid stack overflow on deep graphs. Each frame on the stack carries its own `visited` set rather than sharing a global one. That distinction matters. A shared visited set would prune legitimate fan-in paths; if both `A -> C` and `A -> B -> C` are valid, a global set would skip `C` the second time it appears. The downside of per-frame sets is memory. Each frame clones the parent's set, so deep graphs with heavy fan-out can get expensive. For the graphs this is targeting it's fine. A frame with no unvisited neighbors is a completed path and gets evaluated against the active filters.

Filters are pure functions of type `PathPredicate = (path: Node[]) => boolean`, collected in a single registry object. When a request comes in, the service pulls whatever predicates correspond to the active filter keys and runs them with AND logic over each completed path. The predicate signature takes the full path array, not just a single node, so future filters can reason about path shape (hop count, intermediate node patterns, etc.) without changing the interface.

Each registry entry can also declare an optional `seed` predicate — a node-level check evaluated against the DFS origin before traversal begins. When present, nodes that fail it are skipped entirely, pruning their whole sub-tree up-front rather than discovering at leaf evaluation that the origin was wrong. `startsFromPublic` uses this: instead of traversing every sub-tree and discarding non-public paths at the end, DFS only starts from `publicExposed === true` nodes. The path predicate is still evaluated at completion as the authoritative check; the seed is purely a performance hint.

Adding a new filter is three steps:
1. Add a boolean key to `FilterSet` in `graph.types.ts`
2. Write a `PathPredicate` (and optionally a `seed` `NodePredicate`) in `graph.filters.ts`
3. Register it in `FILTER_REGISTRY`

The controller, service, and DTO don't need to change. TypeScript enforces `FILTER_REGISTRY` is exhaustive over `FilterSet` via `Record<keyof FilterSet, FilterEntry>`.

When no filters are active, DFS is skipped entirely and the response is assembled directly from the pre-built maps. It's a minor thing but the full traversal is O(n·m) and the shortcut is O(n), so it felt worth the two lines.

## Assumptions

- Some edges reference nodes that don't exist in the `nodes` array. I log a warning per missing reference and skip those edges rather than throwing.
- The `to` field on an edge can be either a `string` or `string[]` in the raw JSON. I normalize everything to flat `{ from, to }` pairs at load time.
- Nodes without an explicit `publicExposed: true` are treated as non-public.
- `?filter=false` is treated the same as omitting the parameter, filter inactive, full graph returned.
- The brief says "rds/sql" for sink types. The actual JSON has no `sql` kind — nodes are typed as `service`, `rds`, or `sqs`. `rds` covers the relational-database case. `sqs` (an AWS message queue) is a different category but is equally relevant as an external data sink from an attack-path perspective, so both are included. If the intent was strictly relational databases, the filter would narrow to `rds` alone.

## What I'd do with more time

- **Pagination or streaming.** For large graphs, returning the full node and edge set in one JSON blob will hurt. A cursor-based page or a streaming response would be more practical.
- **Persisted/hot-reloadable graph data.** Right now a graph change requires a restart. A file watcher or a thin persistence layer (even just SQLite) would fix that.
- **Filter composition beyond AND.** OR logic and negation would make the query engine meaningfully more powerful without a huge amount of work given the predicate model already in place.
