/**
 * JSON form of the MCODE results, for the host's per-app storage
 * (`AppContext.apis.appData`). Pure conversion: no API access, no React.
 * `mcodeAppData.ts` does the reading and writing.
 *
 * Two things force a DTO instead of storing `MCODEResult` directly:
 *
 *   - `algorithm` is a class instance. It already flattens itself for the web
 *     worker (`toSnapshot`/`fromSnapshot`), but that snapshot holds `Map`s,
 *     which structured clone accepts and JSON does not. `appData` values must
 *     survive a JSON round trip, so the maps become entry arrays here.
 *   - `cluster.thumbnail` is a PNG data URI — hundreds of KB per cluster. The
 *     host caps one entry at `MAX_APP_DATA_VALUE_BYTES` (5 MB) and the panel
 *     regenerates a missing thumbnail on demand, so thumbnails are dropped.
 *
 * `nodePositions` IS kept: two numbers per node, and "create cluster network"
 * lays the subnetwork out from it.
 *
 * The stored shape is versioned. A payload written by a different version is
 * discarded rather than half-read — results are recomputable.
 */
import { MCODEAlgorithm } from './mcodeAlgorithm'
import {
  AdjacencyMap,
  MCODECluster,
  MCODEParameters,
  MCODEResult,
  NodeInfo,
} from './mcodeTypes'

/** Bump when a field changes meaning; older payloads are then discarded. */
export const MCODE_PAYLOAD_VERSION = 1

/** A cluster, minus the regenerable thumbnail. */
type StoredCluster = Omit<MCODECluster, 'thumbnail'>

/** `MCODEAlgorithmSnapshot` with its two `Map`s as entry arrays. */
interface StoredSnapshot {
  params: MCODEParameters
  adjacency: [string, string[]][]
  nodeInfo: [string, NodeInfo][]
  nodesByScoreDesc: string[]
}

interface StoredResult {
  id: number
  name: string
  clusters: StoredCluster[]
  snapshot: StoredSnapshot
}

/** What one `appData` entry holds: every result for one network. */
export interface StoredResultsPayload {
  version: number
  results: StoredResult[]
}

const toStoredCluster = (cluster: MCODECluster): StoredCluster => {
  const { thumbnail: _thumbnail, ...rest } = cluster
  return rest
}

const toStoredSnapshot = (algorithm: MCODEAlgorithm): StoredSnapshot => {
  const snapshot = algorithm.toSnapshot()
  return {
    params: snapshot.params,
    adjacency: [...snapshot.adjacency],
    nodeInfo: [...snapshot.nodeInfo],
    nodesByScoreDesc: snapshot.nodesByScoreDesc,
  }
}

/** The payload to store for one network's results. */
export const toStoredResults = (
  results: readonly MCODEResult[],
): StoredResultsPayload => ({
  version: MCODE_PAYLOAD_VERSION,
  results: results.map((result) => ({
    id: result.id,
    name: result.name,
    clusters: result.clusters.map(toStoredCluster),
    snapshot: toStoredSnapshot(result.algorithm),
  })),
})

// ── Reading back ────────────────────────────────────────────────────────────
//
// Everything below validates. The value comes out of IndexedDB, written by a
// possibly older build of this app, so it is external input: a bad record is
// dropped, never trusted into the store.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isStoredCluster = (value: unknown): value is StoredCluster =>
  isRecord(value) &&
  typeof value.seedId === 'string' &&
  typeof value.score === 'number' &&
  typeof value.rank === 'number' &&
  isStringArray(value.nodes)

const isEntryArray = (value: unknown): value is [string, unknown][] =>
  Array.isArray(value) &&
  value.every(
    (entry) =>
      Array.isArray(entry) && entry.length === 2 && typeof entry[0] === 'string',
  )

/** Entry array of `nodeId -> neighborIds`. */
const isAdjacencyEntryArray = (value: unknown): value is [string, string[]][] =>
  isEntryArray(value) && value.every(([, neighbors]) => isStringArray(neighbors))

/** Entry array whose values carry the per-node metrics the algorithm reads. */
const isNodeInfoEntryArray = (value: unknown): value is [string, NodeInfo][] =>
  isEntryArray(value) &&
  value.every(
    ([, info]) =>
      isRecord(info) &&
      typeof info.score === 'number' &&
      isStringArray(info.nodeNeighbors),
  )

const isStoredSnapshot = (value: unknown): value is StoredSnapshot =>
  isRecord(value) &&
  isRecord(value.params) &&
  isAdjacencyEntryArray(value.adjacency) &&
  isNodeInfoEntryArray(value.nodeInfo) &&
  isStringArray(value.nodesByScoreDesc)

const isStoredResult = (value: unknown): value is StoredResult =>
  isRecord(value) &&
  typeof value.id === 'number' &&
  typeof value.name === 'string' &&
  Array.isArray(value.clusters) &&
  value.clusters.every(isStoredCluster) &&
  isStoredSnapshot(value.snapshot)

/** True when `value` is a payload this build can read. */
export const isStoredResultsPayload = (
  value: unknown,
): value is StoredResultsPayload =>
  isRecord(value) &&
  value.version === MCODE_PAYLOAD_VERSION &&
  Array.isArray(value.results)

/**
 * Detach a payload from the host's frozen store copy.
 *
 * A JSON round trip, not `structuredClone`: the payload is JSON by
 * construction, and this is the same round trip the host performs on write, so
 * the two paths cannot disagree about what a value becomes.
 */
const copyPayload = (payload: StoredResultsPayload): StoredResultsPayload =>
  JSON.parse(JSON.stringify(payload)) as StoredResultsPayload

const fromStoredSnapshot = (snapshot: StoredSnapshot): MCODEAlgorithm =>
  MCODEAlgorithm.fromSnapshot({
    params: snapshot.params,
    adjacency: new Map(snapshot.adjacency) as AdjacencyMap,
    nodeInfo: new Map(snapshot.nodeInfo),
    nodesByScoreDesc: snapshot.nodesByScoreDesc,
  })

/**
 * Rebuild one network's results from a stored payload. Returns an empty list
 * for anything this build cannot read; individual malformed results are
 * skipped, so one bad record does not lose the rest.
 *
 * The payload is DEEP-COPIED first. `appData.get()` hands back the object the
 * host holds in its own Immer store, which is deeply frozen — reusing those
 * objects made the panel throw `Cannot assign to read only property
 * 'nodePositions'` the first time it rendered a restored cluster thumbnail.
 * The copy is what makes a restored result behave like a freshly computed one.
 */
export const fromStoredResults = (
  networkId: string,
  value: unknown,
): MCODEResult[] => {
  if (!isStoredResultsPayload(value)) return []
  const payload = copyPayload(value)

  const results: MCODEResult[] = []
  for (const stored of payload.results) {
    if (!isStoredResult(stored)) continue
    results.push({
      id: stored.id,
      name: stored.name,
      networkId,
      algorithm: fromStoredSnapshot(stored.snapshot),
      // Cast: the stored cluster is a cluster without its thumbnail, which is
      // optional on MCODECluster. The panel regenerates it on first render.
      clusters: stored.clusters as MCODECluster[],
    })
  }
  return results
}
