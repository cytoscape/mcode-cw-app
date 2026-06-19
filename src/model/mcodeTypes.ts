/**
 * Type definitions and default parameters for the MCODE algorithm.
 *
 * This is a TypeScript port of the MCODE (Molecular Complex Detection)
 * algorithm by Gary Bader.
 *   - Original paper: Bader GD, Hogue CW. "An automated method for finding
 *     molecular complexes in large protein interaction networks."
 *     BMC Bioinformatics. 2003.
 *   - Original Java source (LGPL v2.1+):
 *     https://github.com/BaderLab/MCODE
 *
 * Ported and adapted under the terms of the GNU Lesser General Public
 * License, version 2.1 or (at your option) any later version.
 */

// Type-only import: MCODEResult references the algorithm class, but this stays
// erased at compile time so there's no runtime import cycle with mcodeAlgorithm.
import type { MCODEAlgorithm } from './mcodeAlgorithm'

/** An undirected graph expressed as `nodeId -> neighborNodeIds`. */
export type AdjacencyMap = Map<string, string[]>

/**
 * The set of nodes MCODE runs over: the whole network, or only the
 * currently selected nodes. Mirrors Java `MCODEAnalysisScope`.
 */
export type MCODEAnalysisScope = 'NETWORK' | 'SELECTION'

/** Human-readable labels for each scope (matches the Java enum's toString). */
export const MCODE_ANALYSIS_SCOPE_LABELS: Record<MCODEAnalysisScope, string> = {
  NETWORK: 'In Whole Network',
  SELECTION: 'From Selection',
}

/**
 * Tunable parameters controlling scoring, cluster finding and
 * post-processing. Defaults mirror the Cytoscape MCODE app defaults.
 */
export interface MCODEParameters {
  /** Which nodes to analyze: the whole network or the current selection. */
  scope: MCODEAnalysisScope
  /** Count self-loops when computing degree and density. */
  includeLoops: boolean
  /** Minimum neighbor count for a node to receive a non-zero score. */
  degreeCutoff: number
  /** Minimum k-core a cluster must contain to be kept (filter step). */
  kCore: number
  /**
   * Fraction in [0, 1]. During expansion a neighbor is added when its
   * score is >= `seedScore * (1 - nodeScoreCutoff)`. Lower values give
   * smaller, denser clusters.
   */
  nodeScoreCutoff: number
  /** Maximum recursion depth away from the seed during expansion. */
  maxDepthFromStart: number
  /** Remove singly-connected (degree-1) nodes from each cluster (2-core). */
  haircut: boolean
  /** Add dense peripheral neighbors back onto each cluster. */
  fluff: boolean
  /** Minimum neighborhood density for a node to be added during fluff. */
  fluffNodeDensityCutoff: number
}

/** Cached per-node metrics produced by the scoring phase. */
export interface NodeInfo {
  /** Density of the node's immediate neighborhood subgraph. */
  density: number
  /** Neighborhood size, i.e. direct neighbors plus the node itself. */
  numNodeNeighbors: number
  /** The node's direct neighbor ids (excludes self), used to expand clusters. */
  nodeNeighbors: string[]
  /** k of the highest k-core found in the neighborhood. */
  coreLevel: number
  /** Density of that highest k-core. */
  coreDensity: number
  /** Final node score = `coreDensity * coreLevel` (0 below degree cutoff). */
  score: number
}

/** A detected molecular complex / cluster. */
export interface MCODECluster {
  /** The seed node the cluster grew from. */
  seedId: string
  /** All node ids belonging to the cluster. */
  nodes: string[]
  /** Cluster score = density * nodeCount. */
  score: number
  /** Node-score cutoff this cluster was last (re)grown with, if explored. */
  nodeScoreCutoff?: number
  /** 1-based rank after sorting clusters by descending score. */
  rank: number
  /** The node positions, after the cluster thumbnail is generated. */
  nodePositions?: Record<string, { x: number; y: number }>
  /**
   * Snapshot of the node ids already consumed by higher-ranked clusters when
   * this cluster was seeded. Used by MCODEAlgorithm.exploreCluster() to keep
   * those clusters' priority when shrinking. Internal to the algorithm.
   */
  nodeSeenSnapshot?: string[]
}

export interface MCODEResult {
  id: number
  name: string
  networkId: string
  /**
   * The algorithm instance used for this result. It carries the parameters
   * (getParameters()) plus the cached scoring state (nodeInfo, etc.), so
   * features like cluster exploration can re-run without rescoring.
   */
  algorithm: MCODEAlgorithm
  clusters: MCODECluster[]
}

/** Default MCODE parameters (match the Cytoscape MCODE app). */
export const DEFAULT_MCODE_PARAMETERS: MCODEParameters = {
  scope: 'NETWORK',
  includeLoops: false,
  degreeCutoff: 2,
  kCore: 2,
  nodeScoreCutoff: 0.2,
  maxDepthFromStart: 100,
  haircut: true,
  fluff: false,
  fluffNodeDensityCutoff: 0.1,
}
