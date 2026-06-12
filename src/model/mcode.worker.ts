/**
 * Web worker entry point for MCODE analysis.
 *
 * Receives an adjacency map + parameters from the main thread, runs the
 * (potentially long, synchronous) MCODE algorithm here so the UI thread is
 * never blocked, and posts the ranked clusters back.
 *
 * Bundled automatically by webpack 5 via the `new Worker(new URL(...))` call
 * in `useMcodeWorker`. Its import graph (mcodeAlgorithm → mcodeGraph →
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
    const clusters = new MCODEAlgorithm(parameters).run(adjacency)
    ctx.postMessage({ type: 'success', clusters })
  } catch (err) {
    ctx.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    })
  }
}
