/**
 * Message contracts exchanged with the MCODE web worker.
 *
 * The worker runs the (synchronous, CPU-bound) MCODE algorithm off the main
 * thread so the UI stays responsive. All payloads are structured-cloneable:
 * `AdjacencyMap` is a `Map<string, string[]>`, and `MCODEParameters` /
 * `MCODECluster` are plain objects, so they post across the boundary as-is.
 */
import { MCODEAlgorithmSnapshot } from './mcodeAlgorithm'
import { AdjacencyMap, MCODECluster, MCODEParameters } from './mcodeTypes'

/** Main thread → worker: the graph and parameters to analyze. */
export interface MCODEWorkerRequest {
  adjacency: AdjacencyMap
  parameters: MCODEParameters
}

/**
 * Worker → main thread: on success, the ranked clusters plus a snapshot of the
 * scored algorithm state (so the main thread can rehydrate the MCODEAlgorithm
 * and reuse its cached nodeInfo/scores). On failure, an error message.
 */
export type MCODEWorkerResponse =
  | { type: 'success'; clusters: MCODECluster[]; snapshot: MCODEAlgorithmSnapshot }
  | { type: 'error'; message: string }
