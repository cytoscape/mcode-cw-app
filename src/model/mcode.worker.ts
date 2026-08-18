/**
 * Web worker entry point for MCODE analysis.
 *
 * Receives an adjacency map + parameters from the main thread, runs the
 * (potentially long, synchronous) MCODE algorithm here so the UI thread is
 * never blocked, and posts the ranked clusters back.
 *
 * Bundled automatically by Vite via the `?worker&url` import in
 * `useMcodeWorker`. Its import graph (mcodeAlgorithm → mcodeGraph →
 * mcodeTypes) is pure and free of React / MUI / cyweb dependencies.
 */
import { MCODEAlgorithm } from './mcodeAlgorithm'
import { MCODEWorkerRequest, MCODEWorkerResponse } from './mcodeWorkerTypes'

// `self` is the DedicatedWorkerGlobalScope. We cast to a minimal typed shape so
// this file does not need the (DOM-conflicting) "webworker" TS lib enabled.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<MCODEWorkerRequest>) => void) | null
  postMessage: (message: MCODEWorkerResponse) => void
}

ctx.onmessage = (event: MessageEvent<MCODEWorkerRequest>): void => {
  const { adjacency, parameters } = event.data

  try {
    const alg = new MCODEAlgorithm(parameters)
    const clusters = alg.run(adjacency)

    // Send a snapshot of the scored state so the main thread can rehydrate the
    // algorithm (cached nodeInfo/scores) without rescoring.
    ctx.postMessage({ type: 'success', clusters, snapshot: alg.toSnapshot() })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
