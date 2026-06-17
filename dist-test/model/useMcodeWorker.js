"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.McodeCancelledError = void 0;
exports.useMcodeWorker = useMcodeWorker;
/**
 * React hook that owns a single MCODE web worker and exposes a promise-based
 * `run()` for executing an analysis off the main thread, plus a `cancel()` to
 * abort the one in progress.
 *
 * The worker is created lazily on first use and terminated when the consuming
 * component unmounts. Only one analysis may be in flight at a time (the caller
 * is expected to guard the UI accordingly); a second concurrent `run()` rejects.
 */
const react_1 = require("react");
/** Rejection raised when an in-flight analysis is cancelled by the user. */
class McodeCancelledError extends Error {
    constructor() {
        super('MCODE analysis was cancelled');
        this.name = 'McodeCancelledError';
    }
}
exports.McodeCancelledError = McodeCancelledError;
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
function resolveWorkerChunkUrl() {
    const RealWorker = globalThis.Worker;
    let capturedUrl = '';
    globalThis.Worker = class {
        constructor(scriptUrl) {
            capturedUrl = String(scriptUrl);
        }
    };
    try {
        // eslint-disable-next-line no-new
        new Worker(new URL('./mcode.worker.ts', import.meta.url));
    }
    finally {
        globalThis.Worker = RealWorker;
    }
    return capturedUrl;
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
function createMcodeWorker() {
    const bootstrap = `importScripts(${JSON.stringify(resolveWorkerChunkUrl())})`;
    const blobUrl = URL.createObjectURL(new Blob([bootstrap], { type: 'application/javascript' }));
    try {
        return new Worker(blobUrl);
    }
    finally {
        // The Worker has already fetched the bootstrap script; the blob URL can go.
        URL.revokeObjectURL(blobUrl);
    }
}
function useMcodeWorker() {
    const workerRef = (0, react_1.useRef)(null);
    const pendingRef = (0, react_1.useRef)(null);
    // Settle the in-flight promise (if any) and clear it.
    const settle = (0, react_1.useRef)((response) => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (!pending)
            return;
        if (response instanceof Error)
            pending.reject(response);
        else if (response.type === 'success')
            pending.resolve({ clusters: response.clusters, scores: response.scores });
        else
            pending.reject(new Error(response.message));
    });
    // Lazily create the worker and wire up its handlers.
    const getWorker = (0, react_1.useCallback)(() => {
        if (workerRef.current === null) {
            const worker = createMcodeWorker();
            worker.onmessage = (event) => settle.current(event.data);
            worker.onerror = (event) => settle.current(new Error(event.message || 'MCODE worker crashed'));
            workerRef.current = worker;
        }
        return workerRef.current;
    }, []);
    // Tear the worker down on unmount; reject any analysis still running.
    (0, react_1.useEffect)(() => {
        return () => {
            settle.current(new Error('MCODE worker was terminated'));
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);
    const run = (0, react_1.useCallback)((adjacency, parameters) => new Promise((resolve, reject) => {
        if (pendingRef.current) {
            reject(new Error('An MCODE analysis is already running'));
            return;
        }
        try {
            const worker = getWorker();
            pendingRef.current = { resolve, reject };
            const request = { adjacency, parameters };
            worker.postMessage(request);
        }
        catch (err) {
            pendingRef.current = null;
            reject(err instanceof Error ? err : new Error(String(err)));
        }
    }), [getWorker]);
    const cancel = (0, react_1.useCallback)(() => {
        if (pendingRef.current === null)
            return;
        // Reject the in-flight analysis and dispose the worker. A terminated worker
        // can't be reused, so the next run() lazily creates a fresh one.
        settle.current(new McodeCancelledError());
        workerRef.current?.terminate();
        workerRef.current = null;
    }, []);
    return { run, cancel };
}
