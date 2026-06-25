/**
 * React hook that owns a single MCODE web worker and exposes a promise-based
 * `run()` for executing an analysis off the main thread, plus a `cancel()` to
 * abort the one in progress.
 *
 * The worker is created lazily on first use and terminated when the consuming
 * component unmounts. Only one analysis may be in flight at a time (the caller
 * is expected to guard the UI accordingly); a second concurrent `run()` rejects.
 *
 * ── Why a Web Worker? ───────────────────────────────────────────────────────
 * MCODE clustering is heavy, synchronous, CPU-bound work (per-node k-core /
 * density scoring, then cluster finding) with nothing to await — it just
 * occupies the thread until it finishes. JavaScript is single-threaded, and the
 * main thread is shared with rendering and input, so running it inline freezes
 * the UI for the whole duration.
 *
 * That's especially bad here because this app is a Module Federation remote
 * embedded in Cytoscape Web: a blocked main thread freezes the *host* app, not
 * just our panel. Offloading to a worker keeps the main thread free, which buys:
 *   - no freeze: large networks take seconds, but the UI stays live;
 *   - a real progress spinner and a working Cancel button (we just terminate()
 *     the worker — you can't reliably cancel synchronous main-thread work).
 *
 * It's a clean fit because the algorithm is pure: it operates on a plain
 * adjacency map with no DOM / React / cyweb dependencies, so the worker bundle
 * contains only the algorithm.
 *
 * Trade-offs we accept: inputs/outputs cross by structured-clone copy via
 * postMessage (fine — they're plain/cloneable), and because the algorithm
 * instance lives in the worker, its scored state is returned as a serializable
 * snapshot and rehydrated on the main thread (see MCODEAlgorithm.toSnapshot /
 * fromSnapshot) so features like cluster exploration can reuse it without
 * rescoring. If analyses were always tiny this would be over-engineering, but
 * real MCODE runs block long enough — and freezing the host raises the stakes —
 * to make it worth the message-passing overhead.
 */
import { useCallback, useEffect, useRef } from 'react'

import { MCODEAlgorithm } from './mcodeAlgorithm'
import { AdjacencyMap, MCODECluster, MCODEParameters } from './mcodeTypes'
import { MCODEWorkerRequest, MCODEWorkerResponse } from './mcodeWorkerTypes'

/** Rejection raised when an in-flight analysis is cancelled by the user. */
export class McodeCancelledError extends Error {
  constructor() {
    super('MCODE analysis was cancelled')
    this.name = 'McodeCancelledError'
  }
}

/** Result of a successful analysis: ranked clusters plus the (rehydrated)
 *  algorithm instance carrying the cached scoring state. */
export interface MCODEAnalysisResult {
  clusters: MCODECluster[]
  algorithm: MCODEAlgorithm
}

type Pending = {
  resolve: (result: MCODEAnalysisResult) => void
  reject: (error: Error) => void
}

/**
 * Resolve the absolute URL of the webpack-emitted MCODE worker chunk.
 *
 * webpack rewrites `new Worker(new URL('./mcode.worker.ts', import.meta.url))`
 * at build time: it emits the worker as a self-contained classic-worker chunk
 * and fills in the chunk's absolute URL (derived from the runtime publicPath).
 * That URL is only produced *inside* the `new Worker(...)` expression — a bare
 * `new URL(...)` instead emits the raw, uncompiled `.ts` source.
 *
 * To read the URL without actually constructing the worker (which would throw
 * cross-origin — see createMcodeWorker), we briefly swap in a stub `Worker`
 * that just records its first argument. The swap is synchronous and restored in
 * `finally`, so nothing else can observe it.
 *
 * The `{ name }` option pins the worker's chunk filename (e.g. `mcode-worker.js`)
 * instead of a chunk-id-derived name. That keeps the URL stable when unrelated
 * changes shift webpack's chunk ids — otherwise the dev server's worker child
 * compilation can desync and serve a 404 for the captured URL.
 */
function resolveWorkerChunkUrl(): string {
  const RealWorker = globalThis.Worker
  let capturedUrl = ''
  globalThis.Worker = class {
    constructor(scriptUrl: string | URL) {
      capturedUrl = String(scriptUrl)
    }
  } as unknown as typeof Worker

  try {
    // The 'mcode-worker' name is load-bearing: webpack.config.js's
    // optimization.splitChunks excludes this chunk name from splitting so the
    // worker stays self-contained (it's loaded via a cross-origin blob and can't
    // fetch sibling chunks). Keep the two in sync if you rename it.
    // eslint-disable-next-line no-new
    new Worker(new URL('./mcode.worker.ts', import.meta.url), { name: 'mcode-worker' })
  } finally {
    globalThis.Worker = RealWorker
  }

  return capturedUrl
}

/**
 * Construct the MCODE worker.
 *
 * When this app runs as a Module Federation remote, the worker chunk is served
 * from the remote's own origin (e.g. the plugin dev server on :5555), which
 * differs from the host page's origin (e.g. cyweb on :5500). Browsers forbid
 * constructing a `Worker` directly from a cross-origin script, so we wrap it in
 * a tiny same-origin Blob that `importScripts()` the real worker URL — classic
 * workers may `importScripts` cross-origin (the remote serves assets with
 * `Access-Control-Allow-Origin: *`). This path also works unchanged same-origin.
 */
function createMcodeWorker(): Worker {
  const workerUrl = resolveWorkerChunkUrl()
  // Log the resolved URL so it can be checked directly (browser Network tab /
  // curl) when diagnosing load failures.
  console.debug(`Creating MCODE worker from: ${workerUrl}`)

  const bootstrap = `importScripts(${JSON.stringify(workerUrl)})`
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }))
  try {
    const worker = new Worker(blobUrl)
    // A failed importScripts of the (cross-origin) worker chunk surfaces here as
    // an often-opaque error event. Echo the URL and a hint, since the event
    // message is usually empty for cross-origin worker load failures. (The
    // hook's onerror handler is what actually rejects the pending analysis.)
    worker.addEventListener('error', (event) => {
      console.error(
        `MCODE worker failed to load from "${workerUrl}". ` +
          'Check that the dev server serves this exact URL (HTTP 200) — a stale ' +
          'dev server usually needs a full restart, not just HMR. ' +
          `Worker error: ${event.message || '(no message; likely a cross-origin load failure)'}`,
      )
    })
    return worker
  } finally {
    // The Worker has already fetched the bootstrap script; the blob URL can go.
    URL.revokeObjectURL(blobUrl)
  }
}

export interface McodeWorkerController {
  run: (adjacency: AdjacencyMap, parameters: MCODEParameters) => Promise<MCODEAnalysisResult>
  cancel: () => void
}

export function useMcodeWorker(): McodeWorkerController {
  const workerRef = useRef<Worker | null>(null)
  const pendingRef = useRef<Pending | null>(null)

  // Settle the in-flight promise (if any) and clear it.
  const settle = useRef((response: MCODEWorkerResponse | Error): void => {
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return

    if (response instanceof Error) pending.reject(response)
    else if (response.type === 'success')
      pending.resolve({
        clusters: response.clusters,
        algorithm: MCODEAlgorithm.fromSnapshot(response.snapshot),
      })
    else pending.reject(new Error(response.message))
  })

  // Lazily create the worker and wire up its handlers.
  const getWorker = useCallback((): Worker => {
    if (workerRef.current === null) {
      const worker = createMcodeWorker()
      worker.onmessage = (event: MessageEvent<MCODEWorkerResponse>) => settle.current(event.data)
      worker.onerror = (event) =>
        settle.current(new Error(event.message || 'MCODE worker crashed'))
      workerRef.current = worker
    }
    return workerRef.current
  }, [])

  // Tear the worker down on unmount; reject any analysis still running.
  useEffect(() => {
    return () => {
      settle.current(new Error('MCODE worker was terminated'))
      workerRef.current?.terminate()
      workerRef.current = null
    }
  }, [])

  const run = useCallback(
    (adjacency: AdjacencyMap, parameters: MCODEParameters): Promise<MCODEAnalysisResult> =>
      new Promise<MCODEAnalysisResult>((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error('An MCODE analysis is already running'))
          return
        }
        try {
          const worker = getWorker()
          pendingRef.current = { resolve, reject }
          const request: MCODEWorkerRequest = { adjacency, parameters }
          worker.postMessage(request)
        } catch (err) {
          pendingRef.current = null
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      }),
    [getWorker],
  )

  const cancel = useCallback((): void => {
    if (pendingRef.current === null) return
    // Reject the in-flight analysis and dispose the worker. A terminated worker
    // can't be reused, so the next run() lazily creates a fresh one.
    settle.current(new McodeCancelledError())
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  return { run, cancel }
}
