/**
 * React hook that owns a single MCODE web worker and exposes a promise-based
 * `run()` for executing an analysis off the main thread, plus a `cancel()` to
 * abort the one in progress.
 *
 * The worker is created lazily on first use and terminated when the consuming
 * component unmounts. Only one analysis may be in flight at a time (the caller
 * is expected to guard the UI accordingly); a second concurrent `run()` rejects.
 */
import { useCallback, useEffect, useRef } from 'react'

import { AdjacencyMap, MCODECluster, MCODEParameters } from './mcodeTypes'
import { MCODEWorkerRequest, MCODEWorkerResponse } from './mcodeWorkerTypes'

/** Rejection raised when an in-flight analysis is cancelled by the user. */
export class McodeCancelledError extends Error {
  constructor() {
    super('MCODE analysis was cancelled')
    this.name = 'McodeCancelledError'
  }
}

type Pending = {
  resolve: (clusters: MCODECluster[]) => void
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
    // eslint-disable-next-line no-new
    new Worker(new URL('./mcode.worker.ts', import.meta.url))
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
  const bootstrap = `importScripts(${JSON.stringify(resolveWorkerChunkUrl())})`
  const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }))
  try {
    return new Worker(blobUrl)
  } finally {
    // The Worker has already fetched the bootstrap script; the blob URL can go.
    URL.revokeObjectURL(blobUrl)
  }
}

export interface McodeWorkerController {
  run: (adjacency: AdjacencyMap, parameters: MCODEParameters) => Promise<MCODECluster[]>
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
    else if (response.type === 'success') pending.resolve(response.clusters)
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
    (adjacency: AdjacencyMap, parameters: MCODEParameters): Promise<MCODECluster[]> =>
      new Promise<MCODECluster[]>((resolve, reject) => {
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
