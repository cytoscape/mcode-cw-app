/**
 * MCODEGraph — a lightweight, immutable undirected graph used by the MCODE
 * algorithm for neighborhood, cluster and k-core computations.
 *
 * TypeScript port of the graph helpers from BaderLab/MCODE (LGPL v2.1+).
 * See mcodeTypes.ts for full attribution.
 *
 * The graph stores an adjacency map restricted to its own node set, so that
 * induced subgraphs (neighborhoods, k-cores, clusters) can be derived cheaply
 * without referencing the parent network. Edges are treated as undirected and
 * parallel/duplicate edges are merged (each unordered node pair counts once).
 */
import { AdjacencyMap } from './mcodeTypes'

export class MCODEGraph {
  /** Node ids contained in this graph. */
  readonly nodes: string[]

  private readonly nodeSet: Set<string>
  /** Adjacency restricted to `nodeSet`; values are de-duplicated. */
  private readonly adjacency: Map<string, string[]>

  /**
   * Build an induced subgraph over `nodeIds` using the supplied adjacency.
   * Any neighbor not in `nodeIds` is dropped, so the result is self-contained.
   */
  constructor(nodeIds: Iterable<string>, sourceAdjacency: AdjacencyMap) {
    this.nodeSet = new Set(nodeIds)
    this.nodes = [...this.nodeSet]
    this.adjacency = new Map()

    for (const node of this.nodes) {
      const neighbors = sourceAdjacency.get(node) ?? []
      const seen = new Set<string>()
      const kept: string[] = []
      for (const neighbor of neighbors) {
        // Keep only edges whose endpoint is inside this subgraph and
        // collapse parallel edges to a single entry.
        if (this.nodeSet.has(neighbor) && !seen.has(neighbor)) {
          seen.add(neighbor)
          kept.push(neighbor)
        }
      }
      this.adjacency.set(node, kept)
    }
  }

  get nodeCount(): number {
    return this.nodes.length
  }

  /** Neighbors of `nodeId` within this graph (empty if absent). */
  neighbors(nodeId: string): string[] {
    return this.adjacency.get(nodeId) ?? []
  }

  /**
   * Degree of `nodeId` = number of merged undirected edges touching it.
   * A self-loop contributes 1 only when `includeLoops` is true.
   */
  degree(nodeId: string, includeLoops: boolean): number {
    const neighbors = this.adjacency.get(nodeId)
    if (neighbors === undefined) return 0

    let degree = 0
    for (const neighbor of neighbors) {
      if (neighbor === nodeId) {
        if (includeLoops) degree += 1
      } else {
        degree += 1
      }
    }
    return degree
  }

  /**
   * Count of unique undirected edges in the graph. Each unordered pair is
   * counted once; self-loops are included only when `includeLoops` is true.
   */
  edgeCount(includeLoops: boolean): number {
    const pairs = new Set<string>()
    for (const node of this.nodes) {
      for (const neighbor of this.adjacency.get(node) ?? []) {
        if (neighbor === node) {
          if (includeLoops) pairs.add(`${node}|${node}`)
          continue
        }
        const pair = node < neighbor ? `${node}|${neighbor}` : `${neighbor}|${node}`
        pairs.add(pair)
      }
    }
    return pairs.size
  }

  /**
   * Graph density = actualEdges / possibleEdges.
   *
   *   possibleEdges = includeLoops ? n*(n+1)/2 : n*(n-1)/2
   *
   * Returns 0 when there are too few nodes to form any edge.
   */
  density(includeLoops: boolean): number {
    const n = this.nodeCount
    const possible = includeLoops ? (n * (n + 1)) / 2 : (n * (n - 1)) / 2
    if (possible <= 0) return 0
    return this.edgeCount(includeLoops) / possible
  }

  /** Build the induced subgraph over a subset of this graph's nodes. */
  subgraph(nodeIds: Iterable<string>): MCODEGraph {
    return new MCODEGraph(nodeIds, this.adjacency)
  }

  /**
   * The k-core: the maximal subgraph in which every node has degree >= k.
   * Computed by iteratively removing all nodes whose degree drops below k.
   * Returns null when the k-core is empty.
   */
  getKCore(k: number, includeLoops: boolean): MCODEGraph | null {
    let current: MCODEGraph = this

    // Repeatedly peel away low-degree nodes until the set is stable.
    for (;;) {
      const kept = current.nodes.filter(
        (node) => current.degree(node, includeLoops) >= k,
      )
      if (kept.length === 0) return null
      if (kept.length === current.nodeCount) break // stable — every node qualifies
      current = current.subgraph(kept)
    }

    return current
  }

  /**
   * The highest k-core in the graph: the largest k for which a non-empty
   * k-core exists, together with that core's subgraph.
   * Returns `{ k: 0, graph: null }` for an edgeless graph.
   */
  getHighestKCore(includeLoops: boolean): { k: number; graph: MCODEGraph | null } {
    let k = 1
    let previous: MCODEGraph | null = null

    for (;;) {
      const core = this.getKCore(k, includeLoops)
      if (core === null) break
      previous = core
      k += 1
    }

    return { k: k - 1, graph: previous }
  }
}
