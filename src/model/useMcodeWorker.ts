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

import McodeWorkerInline from './mcode.worker?worker&inline'

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
 * Path of the worker module, for DEV only. Kept in a variable (not written
 * literally inside `new URL(...)`) so Vite's asset transform does not match the
 * pattern at build time and emit the raw .ts file as an asset; the whole dev
 * branch is dead code in a production build anyway.
 */
const DEV_WORKER_PATH = './mcode.worker.ts'

/**
 * Construct the MCODE worker — without hardcoding any origin, so the same
 * code works wherever the app is served from.
 *
 * PRODUCTION: `?worker&inline` embeds the bundled worker (its import graph is
 * pure algorithm code, ~5 kB) into this chunk and constructs it from a Blob at
 * runtime. A Blob worker is same-origin by construction, so it works no matter
 * where the remote is deployed — any origin, any base path, no CORS, no URL to
 * resolve. (The alternative, `?worker&url`, emits a root-absolute `/assets/…`
 * URL because the SDK owns `base: '/'`, which breaks subpath deployments.)
 *
 * DEV: Vite serves modules unbundled, so there is nothing to inline — the
 * inline wrapper falls back to `new Worker(<dev url>)`, and that breaks
 * cross-origin: this app is a Module Federation remote whose modules are
 * served from its own dev server (e.g. :6000) while the page is the host's
 * origin (e.g. cyweb on :5500), and browsers forbid constructing a Worker
 * directly from a cross-origin script URL. So in dev we build the worker from
 * a tiny same-origin Blob module that `import`s the dev-served worker module —
 * a module import may cross origins under CORS, and the dev server already
 * sends `Access-Control-Allow-Origin: *` (the host needs it to import
 * remoteEntry.js at all).
 */
function createMcodeWorker(): Worker {
  if (import.meta.env.PROD) {
    return new McodeWorkerInline({ name: 'mcode-worker' })
  }

  const workerUrl = new URL(DEV_WORKER_PATH, import.meta.url).href
  // Log the resolved URL so it can be checked directly (browser Network tab /
  // curl) when diagnosing load failures.
  console.debug(`Creating MCODE worker from: ${workerUrl}`)

  // The revoke frees the Blob once the module graph has loaded (static imports
  // resolve before the module body runs) — the same trick Vite's own inline
  // worker wrapper uses.
  const bootstrap =
    `import ${JSON.stringify(workerUrl)};\n` + `URL.revokeObjectURL(import.meta.url);`
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' }))
  const worker = new Worker(blobUrl, { type: 'module', name: 'mcode-worker' })
  // A failed import of the (cross-origin) worker script surfaces here as an
  // often-opaque error event. Echo the URL and a hint, since the event
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
