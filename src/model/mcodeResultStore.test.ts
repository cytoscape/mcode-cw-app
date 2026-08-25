/**
 * Unit tests for the module-level MCODE result store: results must survive
 * panel unmounts (the store is module state, exercised here directly through
 * its mutators), ids must stay collision-free, and discarding must move the
 * selection the same way the panel always did.
 *
 * Uses Node's built-in test runner (no extra dependencies):
 *   node --test   (via `npm test`)
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { MCODEAlgorithm } from './mcodeAlgorithm'
import {
  addResult,
  discardAllResults,
  discardSelectedResult,
  getMcodeResults,
  networkEdgesCache,
  removeResultsForNetwork,
  selectCluster,
  selectResult,
  takeNextResultId,
} from './mcodeResultStore'
import { MCODECluster, MCODEResult } from './mcodeTypes'

/** A minimal result for store tests; the algorithm/clusters are not consulted. */
const makeResult = (id: number, networkId: string): MCODEResult => ({
  id,
  name: `${id} - ${networkId}`,
  networkId,
  algorithm: new MCODEAlgorithm(),
  clusters: [],
})

const makeCluster = (rank: number): MCODECluster =>
  ({ rank, nodes: [], score: 0, seedId: '' }) as unknown as MCODECluster

/** The store is module state shared across tests: start each one empty. */
const reset = (): void => {
  discardAllResults()
  networkEdgesCache.clear()
}

test('takeNextResultId increments and resets only on discard-all', () => {
  reset()
  const first = takeNextResultId()
  assert.equal(takeNextResultId(), first + 1)

  // Discarding a selected result while others remain must NOT reset the id.
  addResult(makeResult(takeNextResultId(), 'netA'))
  addResult(makeResult(takeNextResultId(), 'netA'))
  discardSelectedResult()
  const afterPartialDiscard = takeNextResultId()
  assert.ok(afterPartialDiscard > first + 1)

  // Discarding the last remaining result resets the counter.
  discardSelectedResult()
  assert.equal(getMcodeResults().results.length, 0)
  assert.equal(takeNextResultId(), 1)
})

test('addResult appends and selects the new result, clearing the cluster', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  addResult(a)
  selectCluster(makeCluster(1))

  const b = makeResult(takeNextResultId(), 'netA')
  addResult(b)

  const state = getMcodeResults()
  assert.deepEqual(state.results, [a, b])
  assert.equal(state.selectedResult, b)
  assert.equal(state.selectedCluster, null)
})

test('selectResult clears the selected cluster', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  const b = makeResult(takeNextResultId(), 'netA')
  addResult(a)
  addResult(b)
  selectCluster(makeCluster(1))

  selectResult(a)
  const state = getMcodeResults()
  assert.equal(state.selectedResult, a)
  assert.equal(state.selectedCluster, null)
})

test('discardSelectedResult moves the selection to the previous result', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  const b = makeResult(takeNextResultId(), 'netA')
  const c = makeResult(takeNextResultId(), 'netA')
  addResult(a)
  addResult(b)
  addResult(c)

  selectResult(b)
  discardSelectedResult()
  let state = getMcodeResults()
  assert.deepEqual(state.results, [a, c])
  assert.equal(state.selectedResult, a)

  // Discarding the first result selects the next remaining one.
  discardSelectedResult()
  state = getMcodeResults()
  assert.deepEqual(state.results, [c])
  assert.equal(state.selectedResult, c)

  // Discarding the last result leaves nothing selected.
  discardSelectedResult()
  state = getMcodeResults()
  assert.deepEqual(state.results, [])
  assert.equal(state.selectedResult, null)
})

test('discardSelectedResult without a selection is a no-op', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  addResult(a)
  selectResult(null)

  discardSelectedResult()
  assert.deepEqual(getMcodeResults().results, [a])
})

test('removeResultsForNetwork drops that network\'s results, cache, and selection', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  const b = makeResult(takeNextResultId(), 'netB')
  addResult(a)
  addResult(b)
  networkEdgesCache.set('netA', [])
  networkEdgesCache.set('netB', [])

  selectResult(b)
  selectCluster(makeCluster(1))
  removeResultsForNetwork('netB')

  const state = getMcodeResults()
  assert.deepEqual(state.results, [a])
  assert.equal(state.selectedResult, null)
  assert.equal(state.selectedCluster, null)
  assert.equal(networkEdgesCache.has('netB'), false)
  assert.equal(networkEdgesCache.has('netA'), true)
})

test('removeResultsForNetwork keeps an unrelated selection', () => {
  reset()
  const a = makeResult(takeNextResultId(), 'netA')
  const b = makeResult(takeNextResultId(), 'netB')
  addResult(a)
  addResult(b)

  selectResult(a)
  const cluster = makeCluster(1)
  selectCluster(cluster)
  removeResultsForNetwork('netB')

  const state = getMcodeResults()
  assert.deepEqual(state.results, [a])
  assert.equal(state.selectedResult, a)
  assert.equal(state.selectedCluster, cluster)
})
