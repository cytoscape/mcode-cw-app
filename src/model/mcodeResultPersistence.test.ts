/**
 * Round-trip tests for the JSON form the results are stored in through the
 * host's per-app storage (`appData`). What matters here is that the value
 * survives JSON — the host round-trips every value it stores — and that a
 * malformed or older payload is dropped rather than half-read.
 *
 * Uses Node's built-in test runner (no extra dependencies):
 *   node --test   (via `npm test`)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { MCODEAlgorithm } from './mcodeAlgorithm'
import {
  fromStoredResults,
  MCODE_PAYLOAD_VERSION,
  toStoredResults,
} from './mcodeResultPersistence'
import { AdjacencyMap, MCODEResult } from './mcodeTypes'

/** A small triangle plus a pendant node, scored so the snapshot is populated. */
const makeScoredResult = (networkId: string): MCODEResult => {
  const adjacency: AdjacencyMap = new Map([
    ['a', ['b', 'c']],
    ['b', ['a', 'c']],
    ['c', ['a', 'b', 'd']],
    ['d', ['c']],
  ])
  const algorithm = new MCODEAlgorithm({ degreeCutoff: 1, kCore: 1 })
  const clusters = algorithm.run(adjacency)
  return { id: 1, name: `1 - ${networkId}`, networkId, algorithm, clusters }
}

/** What the host does to every value it stores. */
const throughJson = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value))

/**
 * What `appData.get()` actually hands back: the object the host holds in its
 * own Immer store, deeply frozen (Immer's autofreeze is never disabled there).
 */
const deepFreeze = <T>(value: T): T => {
  if (typeof value !== 'object' || value === null) return value
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value)
}

/** One stored value, exactly as a read from the host produces it. */
const asStoredByHost = (results: MCODEResult[]): unknown =>
  deepFreeze(throughJson(toStoredResults(results)))

test('a scored result survives the JSON round trip', () => {
  const original = makeScoredResult('net1')
  const stored = throughJson(toStoredResults([original]))

  const [restored] = fromStoredResults('net1', stored)
  assert.equal(restored.id, original.id)
  assert.equal(restored.name, original.name)
  assert.equal(restored.networkId, 'net1')
  assert.equal(restored.clusters.length, original.clusters.length)
  assert.deepEqual(restored.clusters[0].nodes, original.clusters[0].nodes)
  assert.deepEqual(
    restored.algorithm.getParameters(),
    original.algorithm.getParameters(),
  )
  assert.deepEqual(restored.algorithm.getScores(), original.algorithm.getScores())
})

test('the restored algorithm can still explore a cluster', () => {
  // Exploration is why the scoring snapshot is stored at all: it needs the
  // adjacency and the per-node metrics, not just the cluster's node list.
  const original = makeScoredResult('net1')
  const stored = throughJson(toStoredResults([original]))

  const [restored] = fromStoredResults('net1', stored)
  const cluster = restored.clusters[0]
  const explored = restored.algorithm.exploreCluster(cluster, 0.5)
  assert.ok(explored.nodes.includes(cluster.seedId))
})

test('thumbnails are not stored', () => {
  const result = makeScoredResult('net1')
  result.clusters[0].thumbnail = 'data:image/png;base64,AAAA'

  const payload = toStoredResults([result])
  assert.equal('thumbnail' in payload.results[0].clusters[0], false)

  const [restored] = fromStoredResults('net1', throughJson(payload))
  assert.equal(restored.clusters[0].thumbnail, undefined)
})

test('node positions are stored, so a cluster subnetwork keeps its layout', () => {
  const result = makeScoredResult('net1')
  result.clusters[0].nodePositions = { a: { x: 1, y: 2 } }

  const [restored] = fromStoredResults(
    'net1',
    throughJson(toStoredResults([result])),
  )
  assert.deepEqual(restored.clusters[0].nodePositions, { a: { x: 1, y: 2 } })
})

test('a payload from another version is dropped whole', () => {
  const payload = throughJson(toStoredResults([makeScoredResult('net1')])) as {
    version: number
  }
  payload.version = MCODE_PAYLOAD_VERSION + 1
  assert.deepEqual(fromStoredResults('net1', payload), [])
})

test('a malformed result is skipped, the rest are kept', () => {
  const first = makeScoredResult('net1')
  const second = { ...makeScoredResult('net1'), id: 2, name: '2 - net1' }
  const payload = throughJson(toStoredResults([first, second])) as {
    results: unknown[]
  }
  payload.results[0] = { id: 1, name: 'broken' } // no clusters, no snapshot

  const restored = fromStoredResults('net1', payload)
  assert.equal(restored.length, 1)
  assert.equal(restored[0].id, 2)
})

test('anything that is not a payload reads as no results', () => {
  for (const value of [undefined, null, 'results', 42, [], {}]) {
    assert.deepEqual(fromStoredResults('net1', value), [])
  }
})

test('a restored result is mutable, though the host returns frozen objects', () => {
  // Regression: reusing the host's objects threw `Cannot assign to read only
  // property 'nodePositions'` in updateImage() the first time the panel drew a
  // restored cluster thumbnail.
  const [restored] = fromStoredResults('net1', asStoredByHost([makeScoredResult('net1')]))
  const cluster = restored.clusters[0]

  assert.equal(Object.isFrozen(cluster), false)
  // The three writes the panel makes while rendering a cluster.
  cluster.nodePositions = { a: { x: 1, y: 2 } }
  cluster.thumbnail = 'data:image/png;base64,AAAA'
  cluster.nodeScoreCutoff = 0.5
  assert.deepEqual(cluster.nodePositions, { a: { x: 1, y: 2 } })
})

test('exploring a restored cluster mutates it in place, as the slider does', () => {
  const [restored] = fromStoredResults('net1', asStoredByHost([makeScoredResult('net1')]))
  const cluster = restored.clusters[0]

  const explored = restored.algorithm.exploreCluster(cluster, 0.5)
  cluster.nodes = explored.nodes
  cluster.score = explored.score
  cluster.nodeSeenSnapshot = explored.nodeSeenSnapshot
  assert.ok(cluster.nodes.length > 0)
})
