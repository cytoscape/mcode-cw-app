/**
 * MCODE regression test against the real galFiltered network (Cytoscape sample
 * data). Locks in parity with the original Java MCODE implementation, which —
 * with default parameters — finds 7 clusters with sizes [4,5,3,3,3,3,4] and
 * scores [3.333, 3, 3, 3, 3, 3, 2.667].
 *
 * The expected clusters below are keyed by stable gene labels; they were
 * validated against the Java output (identical cluster count, size multiset
 * and score multiset). Clusters are compared as an unordered set so that the
 * arbitrary ordering of equal-scored clusters does not make the test brittle.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { MCODEAlgorithm } from './mcodeAlgorithm'
import { AdjacencyMap } from './mcodeTypes'
import { GAL_FILTERED_EDGES } from './__fixtures__/galFilteredEdges'

/** Build an undirected adjacency map from a list of label pairs. */
function buildAdjacency(edges: ReadonlyArray<readonly [string, string]>): AdjacencyMap {
  const adjacency: AdjacencyMap = new Map()
  const link = (a: string, b: string): void => {
    const neighbors = adjacency.get(a) ?? []
    if (a !== b && !neighbors.includes(b)) neighbors.push(b)
    adjacency.set(a, neighbors)
  }
  for (const [a, b] of edges) {
    link(a, b)
    link(b, a)
  }
  return adjacency
}

/** Canonical signature for a cluster: score + sorted gene labels. */
function signature(score: number, nodes: readonly string[]): string {
  return `${score.toFixed(3)}::${[...nodes].sort().join(',')}`
}

// Expected clusters (gene labels), validated against the Java MCODE output.
const EXPECTED: ReadonlyArray<{ score: number; nodes: string[] }> = [
  { score: 3.3333333333333335, nodes: ['YBL021C', 'YGL237C', 'YJR048W', 'YKL109W'] },
  { score: 3, nodes: ['YAL040C', 'YBR160W', 'YGR108W', 'YJL157C', 'YMR043W'] },
  { score: 3, nodes: ['YCL032W', 'YDR103W', 'YLR362W'] },
  { score: 3, nodes: ['YDL014W', 'YLR197W', 'YOR310C'] },
  { score: 3, nodes: ['YDR100W', 'YGL161C', 'YOR036W'] },
  { score: 3, nodes: ['YMR309C', 'YOR361C', 'YPR041W'] },
  { score: 2.6666666666666665, nodes: ['YAL003W', 'YBR118W', 'YLR249W', 'YPR080W'] },
]

test('galFiltered: 7 clusters matching the Java MCODE output (default params)', () => {
  const adjacency = buildAdjacency(GAL_FILTERED_EDGES)
  const clusters = new MCODEAlgorithm().run(adjacency)

  // Cluster count and the multiset of sizes match the Java result.
  assert.equal(clusters.length, 7)
  assert.deepEqual(
    clusters.map((c) => c.nodes.length).sort((a, b) => a - b),
    [3, 3, 3, 3, 4, 4, 5],
  )

  // Exact membership + score, compared as an unordered set of clusters.
  const actual = new Set(clusters.map((c) => signature(c.score, c.nodes)))
  const expected = new Set(EXPECTED.map((c) => signature(c.score, c.nodes)))
  assert.deepEqual(actual, expected)

  // Every cluster's seed must be one of its own member nodes.
  for (const c of clusters) {
    assert.ok(c.nodes.includes(c.seedId), `seed ${c.seedId} not in its cluster`)
  }
})
