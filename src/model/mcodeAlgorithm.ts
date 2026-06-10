/**
 * MCODE (Molecular Complex Detection) — TypeScript port.
 *
 * Faithful port of BaderLab/MCODE's MCODEAlgorithm.java (LGPL v2.1+):
 *   Bader GD, Hogue CW. "An automated method for finding molecular complexes
 *   in large protein interaction networks." BMC Bioinformatics. 2003.
 *   https://github.com/BaderLab/MCODE
 *
 * Ported and adapted under the GNU Lesser General Public License, version 2.1
 * or (at your option) any later version. See mcodeTypes.ts for attribution.
 *
 * Parallelism note: the original Java implementation scores nodes on a thread
 * pool (one task per node). JavaScript is single-threaded, so the scoring phase
 * here is a sequential loop. The work is embarrassingly parallel and pure, so
 * for very large networks it could be offloaded to Web Workers without changing
 * the results — see scoreGraph() for where the per-node work happens.
 *
 * The algorithm has three stages:
 *   1. scoreGraph    — score every node from its neighborhood k-core & density.
 *   2. findClusters  — grow clusters from high-scoring seeds, then post-process
 *                      (filter by k-core, optional haircut, optional fluff).
 *   3. rank          — sort clusters by descending score.
 */
import { MCODEGraph } from './mcodeGraph'
import {
  AdjacencyMap,
  DEFAULT_MCODE_PARAMETERS,
  MCODECluster,
  MCODEParameters,
  NodeInfo,
} from './mcodeTypes'

export class MCODEAlgorithm {
  private readonly params: MCODEParameters

  /** Full input network as an MCODEGraph. Set during scoreGraph(). */
  private graph: MCODEGraph | null = null
  /** Per-node cached metrics (density, k-core, score), keyed by node id. */
  private nodeInfo: Map<string, NodeInfo> = new Map()
  /** Node ids ordered by descending score (seed iteration order). */
  private nodesByScoreDesc: string[] = []

  constructor(params: Partial<MCODEParameters> = {}) {
    this.params = { ...DEFAULT_MCODE_PARAMETERS, ...params }
  }

  /**
   * Convenience entry point: score the graph and return ranked clusters.
   * `adjacency` is an undirected `nodeId -> neighborIds` map (e.g. built from
   * Cytoscape Web's ElementApi.getConnectedNodes).
   */
  run(adjacency: AdjacencyMap): MCODECluster[] {
    this.scoreGraph(adjacency)
    return this.findClusters()
  }

  // ── Stage 1: scoring ────────────────────────────────────────────────────────

  /**
   * Compute a NodeInfo (and score) for every node. Equivalent to the Java
   * scoreGraph()/calcNodeInfo()/scoreNode() trio; runs sequentially here.
   */
  scoreGraph(adjacency: AdjacencyMap): void {
    this.graph = new MCODEGraph(adjacency.keys(), adjacency)
    this.nodeInfo = new Map()

    for (const nodeId of this.graph.nodes) {
      const info = this.calcNodeInfo(nodeId)
      info.score = this.scoreNode(info)
      this.nodeInfo.set(nodeId, info)
    }

    // Order nodes by descending score; ties broken by id for determinism.
    this.nodesByScoreDesc = [...this.graph.nodes].sort((a, b) => {
      const diff = this.scoreOf(b) - this.scoreOf(a)
      return diff !== 0 ? diff : a < b ? -1 : a > b ? 1 : 0
    })
  }

  /**
   * Per-node metrics: neighborhood density and the density of the
   * neighborhood's highest k-core. Mirrors calcNodeInfo().
   */
  private calcNodeInfo(nodeId: string): NodeInfo {
    const graph = this.requireGraph()
    const neighbors = graph.neighbors(nodeId)
    const numNeighbors = neighbors.length

    // A node needs at least two neighbors to form a meaningful core.
    if (numNeighbors < 2) {
      const trivial = numNeighbors === 1
      return {
        density: trivial ? 1 : 0,
        // Neighborhood size includes the node itself (matches the Java impl).
        numNodeNeighbors: numNeighbors + 1,
        nodeNeighbors: neighbors,
        coreLevel: trivial ? 1 : 0,
        coreDensity: trivial ? 1 : 0,
        score: 0,
      }
    }

    // Neighborhood subgraph = the node plus all of its neighbors.
    const neighborhood = graph.subgraph([nodeId, ...neighbors])
    const density = neighborhood.density(this.params.includeLoops)

    const { k, graph: coreGraph } = neighborhood.getHighestKCore(
      this.params.includeLoops,
    )
    const coreDensity =
      coreGraph !== null ? coreGraph.density(this.params.includeLoops) : 0

    return {
      density,
      // Neighborhood size includes the node itself (matches the Java impl).
      numNodeNeighbors: numNeighbors + 1,
      nodeNeighbors: neighbors,
      coreLevel: k,
      coreDensity,
      score: 0,
    }
  }

  /** Node score = coreDensity * coreLevel, or 0 below the degree cutoff. */
  private scoreNode(info: NodeInfo): number {
    if (info.numNodeNeighbors > this.params.degreeCutoff) {
      return info.coreDensity * info.coreLevel
    }
    return 0
  }

  // ── Stage 2: cluster finding ────────────────────────────────────────────────

  /**
   * Grow clusters from seed nodes in descending score order, then filter,
   * haircut and fluff. Mirrors findClusters().
   */
  findClusters(): MCODECluster[] {
    const graph = this.requireGraph()
    const clusters: MCODECluster[] = []

    // Tracks nodes already consumed as cluster cores so they cannot seed again.
    const nodeSeen = new Set<string>()

    for (const seedId of this.nodesByScoreDesc) {
      if (nodeSeen.has(seedId)) continue
      // Only positively-scored nodes can seed a cluster.
      if (this.scoreOf(seedId) <= 0) continue

      const coreNodes = this.getClusterCore(seedId, nodeSeen)
      if (coreNodes.length === 0) continue

      let clusterGraph = graph.subgraph(coreNodes)

      // Filter: the cluster must contain at least the required k-core.
      if (this.filterCluster(clusterGraph)) continue

      let nodes = coreNodes

      // Haircut: reduce to the 2-core, dropping degree-1 pendant nodes.
      if (this.params.haircut) {
        nodes = this.haircutCluster(clusterGraph)
        clusterGraph = graph.subgraph(nodes)
      }

      // Fluff: add back dense peripheral neighbors (not marked globally seen).
      if (this.params.fluff) {
        nodes = this.fluffCluster(nodes, nodeSeen)
        clusterGraph = graph.subgraph(nodes)
      }

      clusters.push({
        seedId,
        nodes,
        score: this.scoreCluster(clusterGraph),
        rank: 0, // assigned by rank()
      })
    }

    return this.rank(clusters)
  }

  /**
   * Build the list of nodes forming a cluster core grown from `seedId`.
   * Mirrors getClusterCore(): the seed is included, then neighbors are added
   * recursively when their score clears the seed-relative threshold.
   */
  private getClusterCore(seedId: string, nodeSeen: Set<string>): string[] {
    const cluster: string[] = [seedId]
    const seedScore = this.scoreOf(seedId)
    this.getClusterCoreInternal(seedId, nodeSeen, seedScore, 1, cluster)
    return cluster
  }

  /**
   * Recursive neighbor expansion. Mirrors getClusterCoreInternal().
   * `seedScore` is the reference score of the original seed and stays constant
   * across the recursion; a neighbor qualifies when
   *   score(neighbor) >= seedScore * (1 - nodeScoreCutoff).
   */
  private getClusterCoreInternal(
    startId: string,
    nodeSeen: Set<string>,
    seedScore: number,
    depth: number,
    cluster: string[],
  ): void {
    if (nodeSeen.has(startId)) return
    if (depth > this.params.maxDepthFromStart) return

    nodeSeen.add(startId)

    const threshold = seedScore * (1 - this.params.nodeScoreCutoff)
    const info = this.nodeInfo.get(startId)
    if (info === undefined) return

    for (const neighbor of info.nodeNeighbors) {
      if (nodeSeen.has(neighbor)) continue
      if (this.scoreOf(neighbor) >= threshold) {
        cluster.push(neighbor)
        this.getClusterCoreInternal(
          neighbor,
          nodeSeen,
          seedScore,
          depth + 1,
          cluster,
        )
      }
    }
  }

  // ── Stage 2 post-processing ─────────────────────────────────────────────────

  /**
   * Returns true when the cluster should be discarded: it must contain a
   * non-empty k-core of size `params.kCore`. Mirrors filterCluster().
   */
  private filterCluster(clusterGraph: MCODEGraph): boolean {
    if (clusterGraph.nodeCount === 0) return true
    const core = clusterGraph.getKCore(this.params.kCore, this.params.includeLoops)
    return core === null
  }

  /**
   * Haircut: reduce the cluster to its 2-core, removing degree-1 pendant
   * nodes. Falls back to the original nodes if no 2-core exists.
   * Mirrors haircutCluster().
   */
  private haircutCluster(clusterGraph: MCODEGraph): string[] {
    const core = clusterGraph.getKCore(2, this.params.includeLoops)
    return core !== null ? core.nodes : clusterGraph.nodes
  }

  /**
   * Fluff: add neighbors of the cluster whose own neighborhood density exceeds
   * `fluffNodeDensityCutoff`. Fluffed nodes are NOT added to the global
   * nodeSeen set, so they may also appear in other clusters.
   * Mirrors fluffClusterBoundary().
   */
  private fluffCluster(nodes: string[], nodeSeen: Set<string>): string[] {
    const result = [...nodes]
    const inCluster = new Set(nodes)
    const addedDuringFluff = new Set<string>()

    for (const nodeId of nodes) {
      const info = this.nodeInfo.get(nodeId)
      if (info === undefined) continue

      for (const neighbor of info.nodeNeighbors) {
        if (inCluster.has(neighbor)) continue
        if (nodeSeen.has(neighbor)) continue
        if (addedDuringFluff.has(neighbor)) continue

        const neighborInfo = this.nodeInfo.get(neighbor)
        if (
          neighborInfo !== undefined &&
          neighborInfo.density > this.params.fluffNodeDensityCutoff
        ) {
          result.push(neighbor)
          addedDuringFluff.add(neighbor)
        }
      }
    }

    return result
  }

  // ── Stage 3: scoring & ranking ──────────────────────────────────────────────

  /** Cluster score = density * nodeCount. Mirrors scoreCluster(). */
  private scoreCluster(clusterGraph: MCODEGraph): number {
    return clusterGraph.density(this.params.includeLoops) * clusterGraph.nodeCount
  }

  /** Sort clusters by descending score and assign 1-based ranks. */
  private rank(clusters: MCODECluster[]): MCODECluster[] {
    clusters.sort((a, b) => b.score - a.score)
    clusters.forEach((cluster, index) => {
      cluster.rank = index + 1
    })
    return clusters
  }

  // ── Public accessors ────────────────────────────────────────────────────────

  /** Score assigned to a node during scoreGraph(); 0 if the node is unknown. */
  getNodeScore(nodeId: string): number {
    return this.scoreOf(nodeId)
  }

  /** Cached metrics for a node, or undefined if it was never scored. */
  getNodeInfo(nodeId: string): NodeInfo | undefined {
    return this.nodeInfo.get(nodeId)
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private scoreOf(nodeId: string): number {
    return this.nodeInfo.get(nodeId)?.score ?? 0
  }

  private requireGraph(): MCODEGraph {
    if (this.graph === null) {
      throw new Error('scoreGraph() must be called before findClusters()')
    }
    return this.graph
  }
}
