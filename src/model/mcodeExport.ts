/**
 * Pure helpers for turning MCODE results into external representations:
 *   - a tab-delimited results report (.txt), mirroring the Java exporter, and
 *   - a cluster subnetwork sliced out of the source network's CX2.
 *
 * These have no React or Cytoscape Web dependencies (they operate on plain
 * data), so they are straightforward to unit-test in isolation.
 */
import { MCODEParameters } from './mcodeTypes'

/**
 * Score formatted with up to 3 fraction digits, trailing zeros stripped
 * (matches the Java NumberFormat with maximumFractionDigits = 3): e.g.
 * 2.3333 -> "2.333", 2 -> "2", 1.6 -> "1.6".
 */
export function formatScore(score: number): string {
  return String(Number(score.toFixed(3)))
}

/** Per-cluster values needed to render one row of the export report. */
export interface ClusterExportRow {
  score: number
  nodeCount: number
  edgeCount: number
  /** Display names of the cluster's nodes, in order. */
  nodeNames: string[]
}

/**
 * Build the MCODE results report text. The cluster rank is the row's 1-based
 * position in `rows` (which are expected to already be in ranked order).
 *
 * `now` is injectable so the output is deterministic in tests.
 */
export function buildMcodeResultsText(
  parameters: MCODEParameters,
  rows: ClusterExportRow[],
  now: Date = new Date(),
): string {
  const p = parameters
  const lines: string[] = [
    'MCODE App Results',
    `Date: ${now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}`,
    '',
    'Parameters:',
    '   Network Scoring:',
    `      Include Loops: ${p.includeLoops}  Degree Cutoff: ${p.degreeCutoff}`,
    '   Cluster Finding:',
    `      Node Score Cutoff: ${p.nodeScoreCutoff}  Haircut: ${p.haircut}  Fluff: ${p.fluff}` +
      `  K-Core: ${p.kCore}  Max. Depth from Seed: ${p.maxDepthFromStart}`,
    '',
    'Cluster\tScore (Density*#Nodes)\tNodes\tEdges\tNode IDs',
  ]

  rows.forEach((row, i) => {
    lines.push(
      `${i + 1}\t${formatScore(row.score)}\t${row.nodeCount}` +
        `\t${row.edgeCount}\t${row.nodeNames.join(', ')}`,
    )
  })

  return lines.join('\n') + '\n'
}

/**
 * Slice a source network's CX2 stream down to a single cluster: keep only the
 * cluster's nodes (with coordinates overridden from `nodePositions` when
 * present, so the importer runs no layout) and the edges whose endpoints are
 * both in the cluster, and fix up the metaData element counts to match.
 *
 * Operates on the loosely-typed CX2 aspect array (`any[]`); the caller casts
 * the result to the cyweb `Cx2` type when handing it to createNetworkFromCx2.
 */
export function sliceClusterCx2(
  cx2: any[],
  clusterNodeIds: string[],
  nodePositions?: Record<string, { x: number; y: number }>,
): any[] {
  const clusterNodes = new Set(clusterNodeIds)
  let nodeCount = 0
  let edgeCount = 0

  const sliced: any[] = cx2.map((aspect: Record<string, any>) => {
    if (Array.isArray(aspect.nodes)) {
      const nodes = aspect.nodes
        .filter((n: any) => clusterNodes.has(String(n.id)))
        .map((n: any) => {
          const pos = nodePositions?.[String(n.id)]
          return pos ? { ...n, x: pos.x, y: pos.y } : n
        })
      nodeCount = nodes.length
      return { nodes }
    }
    if (Array.isArray(aspect.edges)) {
      const edges = aspect.edges.filter(
        (e: any) => clusterNodes.has(String(e.s)) && clusterNodes.has(String(e.t)),
      )
      edgeCount = edges.length
      return { edges }
    }
    return aspect
  })

  for (const aspect of sliced) {
    if (Array.isArray(aspect.metaData)) {
      for (const meta of aspect.metaData as Array<{ name: string; elementCount?: number }>) {
        if (meta.name === 'nodes' && meta.elementCount !== undefined) meta.elementCount = nodeCount
        if (meta.name === 'edges' && meta.elementCount !== undefined) meta.elementCount = edgeCount
      }
    }
  }

  return sliced
}
