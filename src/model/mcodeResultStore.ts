/**
 * Module-level store of the MCODE results, following the pattern of
 * NetworkAnalyzer's analysisResultStore: the Side Panel unmounts its whole
 * tree when closed (WorkspaceEditor renders it conditionally), so results kept
 * in component state would vanish on close. This module lives as long as the
 * app's JS module does, and the panel simply re-reads it on remount.
 *
 * State is one immutable snapshot object; every mutator replaces it and
 * notifies subscribers, which is what useSyncExternalStore needs to trigger
 * re-renders (the snapshot reference must be stable between mutations).
 */
import { useSyncExternalStore } from 'react'

import { MCODECluster, MCODEResult } from './mcodeTypes'

/** A source-network edge, reduced to what cluster thumbnails need. */
export type NetworkEdge = { id: string; source: string; target: string }

export interface McodeResultsState {
  readonly results: readonly MCODEResult[]
  readonly selectedResult: MCODEResult | null
  readonly selectedCluster: MCODECluster | null
}

let state: McodeResultsState = {
  results: [],
  selectedResult: null,
  selectedCluster: null,
}

// Monotonically increasing result id. It never reuses an id while any result
// exists, even across panel close/reopen, so a new result can't collide with
// a deleted one's leftover node columns. Reset to 1 only when the results
// list empties through an explicit discard.
let nextResultId = 1

// Cache of every analyzed network's edges, so cluster thumbnails filter an
// in-memory list instead of re-fetching all edges from the source network.
// Keyed by network id; entries are dropped when the network is deleted.
export const networkEdgesCache = new Map<string, NetworkEdge[]>()

const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Subscribe to every store change from outside React. Used by `mcodeAppData`
 * to write the results through the host's per-app storage — persistence is a
 * subscriber, not a call in each mutator, so a new mutator is covered for free.
 */
export function subscribeMcodeResults(listener: () => void): () => void {
  return subscribe(listener)
}

function setState(partial: Partial<McodeResultsState>): void {
  state = { ...state, ...partial }
  emitChange()
}

/** The current results snapshot; re-renders the caller on every store change. */
export function useMcodeResults(): McodeResultsState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Non-hook read of the current snapshot, for use outside React renders. */
export function getMcodeResults(): McodeResultsState {
  return state
}

/** Claim the next result id (increments the counter). */
export function takeNextResultId(): number {
  return nextResultId++
}

/**
 * The counter's current value, for persisting it across reloads. Result ids
 * name node-table columns ("MCODE::Score (3)"), so a reloaded session must not
 * hand out an id whose columns are still on a network — see `mcodeAppData`.
 */
export function getNextResultId(): number {
  return nextResultId
}

/** Restore the counter (never lowers it). */
export function setNextResultId(value: number): void {
  if (Number.isInteger(value) && value > nextResultId) {
    nextResultId = value
  }
}

/** Append a new result and make it (with no cluster) the current selection. */
export function addResult(result: MCODEResult): void {
  setState({
    results: [...state.results, result],
    selectedResult: result,
    selectedCluster: null,
  })
}

/**
 * Replace one network's results with the ones read back from storage, leaving
 * every other network's results alone. The list stays ordered by result id, so
 * restored results sit where they were created.
 *
 * The selection is kept only if the selected result object is still in the
 * list; the panel then points it at the current network (`syncSelectionToNetwork`).
 */
export function restoreNetworkResults(
  networkId: string,
  restored: readonly MCODEResult[],
): void {
  const others = state.results.filter((r) => r.networkId !== networkId)
  const results = [...others, ...restored].sort((a, b) => a.id - b.id)

  // Ids are unique per session AND across reloads: a restored result's columns
  // are still on the network, so the counter must clear every id it sees.
  for (const result of restored) setNextResultId(result.id + 1)

  const keep =
    state.selectedResult !== null && results.includes(state.selectedResult)
  setState({
    results,
    selectedResult: keep ? state.selectedResult : null,
    selectedCluster: keep ? state.selectedCluster : null,
  })
}

/**
 * Move the selection onto `networkId`'s newest result, unless it already holds
 * one of that network's. This is what makes the panel follow a network switch:
 * the store keeps every network's results, and the panel shows the current
 * network's.
 */
export function syncSelectionToNetwork(networkId: string): void {
  if (state.selectedResult?.networkId === networkId) return
  const forNetwork = state.results.filter((r) => r.networkId === networkId)
  selectResult(forNetwork.length > 0 ? forNetwork[forNetwork.length - 1] : null)
}

/** Switch the selected result; clears the cluster selection. */
export function selectResult(result: MCODEResult | null): void {
  setState({ selectedResult: result, selectedCluster: null })
}

/**
 * Select a cluster. Also safe to call with the already-selected cluster after
 * mutating it in place (exploration does): every call publishes a fresh
 * snapshot object, so subscribers re-render either way.
 */
export function selectCluster(cluster: MCODECluster | null): void {
  setState({ selectedCluster: cluster })
}

/**
 * Remove the selected result. The selection moves to the previous result in
 * the list (or the next one when the first was discarded, or none remain).
 */
export function discardSelectedResult(): void {
  const { results, selectedResult } = state
  if (!selectedResult) return

  const index = results.indexOf(selectedResult)
  const remaining = results.filter((r) => r !== selectedResult)
  if (remaining.length === 0) {
    nextResultId = 1
  }
  setState({
    results: remaining,
    selectedResult: index > 0 ? results[index - 1] : (remaining[0] ?? null),
    selectedCluster: null,
  })
}

export function discardAllResults(): void {
  nextResultId = 1
  setState({ results: [], selectedResult: null, selectedCluster: null })
}

/** A network was deleted: drop its results, edge cache, and selection. */
export function removeResultsForNetwork(networkId: string): void {
  networkEdgesCache.delete(networkId)

  const filtered = state.results.filter((r) => r.networkId !== networkId)
  if (filtered.length === state.results.length) return

  const selectionGone = state.selectedResult?.networkId === networkId
  setState({
    results: filtered,
    selectedResult: selectionGone ? null : state.selectedResult,
    selectedCluster: selectionGone ? null : state.selectedCluster,
  })
}
