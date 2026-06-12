/**
 * Message contracts exchanged with the MCODE web worker.
 *
 * The worker runs the (synchronous, CPU-bound) MCODE algorithm off the main
 * thread so the UI stays responsive. All payloads are structured-cloneable:
 * `AdjacencyMap` is a `Map<string, string[]>`, and `MCODEParameters` /
 * `MCODECluster` are plain objects, so they post across the boundary as-is.
 */
import { AdjacencyMap, MCODECluster, MCODEParameters } from './mcodeTypes'

/** Main thread → worker: the graph and parameters to analyze. */
export interface MCODEWorkerRequest {
  adjacency: AdjacencyMap
  parameters: MCODEParameters
}

/** Worker → main thread: the ranked clusters on success, or an error message. */
export type MCODEWorkerResponse =
  | { type: 'success'; clusters: MCODECluster[] }
  | { type: 'error'; message: string }
