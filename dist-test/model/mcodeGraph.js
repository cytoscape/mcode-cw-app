"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCODEGraph = void 0;
class MCODEGraph {
    /** Node ids contained in this graph. */
    nodes;
    nodeSet;
    /** Adjacency restricted to `nodeSet`; values are de-duplicated. */
    adjacency;
    /**
     * Build an induced subgraph over `nodeIds` using the supplied adjacency.
     * Any neighbor not in `nodeIds` is dropped, so the result is self-contained.
     */
    constructor(nodeIds, sourceAdjacency) {
        this.nodeSet = new Set(nodeIds);
        this.nodes = [...this.nodeSet];
        this.adjacency = new Map();
        for (const node of this.nodes) {
            const neighbors = sourceAdjacency.get(node) ?? [];
            const seen = new Set();
            const kept = [];
            for (const neighbor of neighbors) {
                // Keep only edges whose endpoint is inside this subgraph and
                // collapse parallel edges to a single entry.
                if (this.nodeSet.has(neighbor) && !seen.has(neighbor)) {
                    seen.add(neighbor);
                    kept.push(neighbor);
                }
            }
            this.adjacency.set(node, kept);
        }
    }
    get nodeCount() {
        return this.nodes.length;
    }
    /** Neighbors of `nodeId` within this graph (empty if absent). */
    neighbors(nodeId) {
        return this.adjacency.get(nodeId) ?? [];
    }
    /**
     * Degree of `nodeId` = number of merged undirected edges touching it.
     * A self-loop contributes 1 only when `includeLoops` is true.
     */
    degree(nodeId, includeLoops) {
        const neighbors = this.adjacency.get(nodeId);
        if (neighbors === undefined)
            return 0;
        let degree = 0;
        for (const neighbor of neighbors) {
            if (neighbor === nodeId) {
                if (includeLoops)
                    degree += 1;
            }
            else {
                degree += 1;
            }
        }
        return degree;
    }
    /**
     * Count of unique undirected edges in the graph. Each unordered pair is
     * counted once; self-loops are included only when `includeLoops` is true.
     */
    edgeCount(includeLoops) {
        const pairs = new Set();
        for (const node of this.nodes) {
            for (const neighbor of this.adjacency.get(node) ?? []) {
                if (neighbor === node) {
                    if (includeLoops)
                        pairs.add(`${node}|${node}`);
                    continue;
                }
                const pair = node < neighbor ? `${node}|${neighbor}` : `${neighbor}|${node}`;
                pairs.add(pair);
            }
        }
        return pairs.size;
    }
    /**
     * Graph density = actualEdges / possibleEdges.
     *
     *   possibleEdges = includeLoops ? n*(n+1)/2 : n*(n-1)/2
     *
     * Returns 0 when there are too few nodes to form any edge.
     */
    density(includeLoops) {
        const n = this.nodeCount;
        const possible = includeLoops ? (n * (n + 1)) / 2 : (n * (n - 1)) / 2;
        if (possible <= 0)
            return 0;
        return this.edgeCount(includeLoops) / possible;
    }
    /** Build the induced subgraph over a subset of this graph's nodes. */
    subgraph(nodeIds) {
        return new MCODEGraph(nodeIds, this.adjacency);
    }
    /**
     * The k-core: the maximal subgraph in which every node has degree >= k.
     * Computed by iteratively removing all nodes whose degree drops below k.
     * Returns null when the k-core is empty.
     */
    getKCore(k, includeLoops) {
        let current = this;
        // Repeatedly peel away low-degree nodes until the set is stable.
        for (;;) {
            const kept = current.nodes.filter((node) => current.degree(node, includeLoops) >= k);
            if (kept.length === 0)
                return null;
            if (kept.length === current.nodeCount)
                break; // stable — every node qualifies
            current = current.subgraph(kept);
        }
        return current;
    }
    /**
     * The highest k-core in the graph: the largest k for which a non-empty
     * k-core exists, together with that core's subgraph.
     * Returns `{ k: 0, graph: null }` for an edgeless graph.
     */
    getHighestKCore(includeLoops) {
        let k = 1;
        let previous = null;
        for (;;) {
            const core = this.getKCore(k, includeLoops);
            if (core === null)
                break;
            previous = core;
            k += 1;
        }
        return { k: k - 1, graph: previous };
    }
}
exports.MCODEGraph = MCODEGraph;
