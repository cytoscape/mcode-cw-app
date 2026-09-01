/**
 * MCODE results in the host's per-app storage — `AppContext.apis.appData`.
 *
 * WHAT THIS FIXES
 *   Results used to live only in `mcodeResultStore`, module state that dies
 *   with the page. Switching network left another network's results on screen,
 *   and a reload lost every result while its MCODE node columns stayed on the
 *   network. Both tiers of this module's storage are keyed by network id, so
 *   the panel can ask for "this network's results" and get exactly those.
 *
 * HOW THE HOST API IS USED
 *   appData.set(networkId, 'results', payload)   one entry per network
 *   appData.get(networkId, 'results')            synchronous — the host
 *                                                hydrates its local tier at
 *                                                boot, before apps mount
 *   appData.setGlobal('nextResultId', n)         app-scoped, no network
 *
 *   Entries are LOCAL by default: they never reach a CX2 download, an NDEx
 *   save or "Open in Cytoscape". Pass `{ export: true }` to `set` for a key
 *   that should travel with the network instead — see the note on EXPORTING
 *   below. Every call returns `ApiResult`, never throws.
 *
 * WIRING
 *   `MCODEApp.mount()` hands the api in (`setAppDataApi`). Writes then happen
 *   through a store subscription, so every mutator — including cluster
 *   exploration, which mutates a cluster in place and republishes the snapshot
 *   — persists without its own call. Reads happen in the panel, per network,
 *   on mount and on `network:switched` (`hydrateNetworkResults`).
 *
 *   A React component that only needs the api can call `useAppDataApi()` from
 *   `cyweb/AppDataApi` instead; it returns the same per-app instance. The
 *   module-level holder here exists because the store subscription runs
 *   outside React.
 */
import type { AppDataApi } from '@cytoscape-web/api-types'

import {
  getMcodeResults,
  getNextResultId,
  restoreNetworkResults,
  setNextResultId,
  subscribeMcodeResults,
} from './mcodeResultStore'
import { MCODEResult } from './mcodeTypes'
import { fromStoredResults, toStoredResults } from './mcodeResultPersistence'

/** Per-network key: every MCODE result computed on that network. */
const RESULTS_KEY = 'results'

/** App-scoped key (`setGlobal`): the result-id counter, which spans networks. */
const NEXT_ID_KEY = 'nextResultId'

/**
 * Writes are coalesced. Selecting a cluster republishes the store snapshot, so
 * an un-debounced subscriber would re-encode every result on each click.
 *
 * The cost: closing the tab within this window loses that write. Disabling the
 * app does not — `setAppDataApi(null)` flushes first.
 */
const WRITE_DEBOUNCE_MS = 400

let appData: AppDataApi | null = null
let unsubscribe: (() => void) | null = null
let writeTimer: ReturnType<typeof setTimeout> | null = null

/** Networks already read back once; hydration must not undo later edits. */
const hydrated = new Set<string>()

/**
 * The JSON last written per network, so an unchanged result set is not
 * rewritten. Its key set is also the list of networks to revisit when results
 * are discarded — a network that dropped to zero results needs its entry
 * removed, and it is no longer in the store to be found from there.
 */
const lastWritten = new Map<string, string>()

let lastNextIdWritten = 0

const warn = (what: string, error: { code: string; message: string }): void => {
  console.warn(`MCODE app data: ${what} — ${error.code} ${error.message}`)
}

/**
 * Take the host's per-app storage api (from `mount()`), or drop it (from
 * `unmount()`). Restores the result-id counter and starts persisting.
 */
export function setAppDataApi(api: AppDataApi | null): void {
  // Land a debounced write before letting go of the api, or a result computed
  // in the last WRITE_DEBOUNCE_MS before the app is disabled is never stored.
  if (writeTimer !== null) {
    clearTimeout(writeTimer)
    writeTimer = null
    flushWrites()
  }
  unsubscribe?.()
  unsubscribe = null
  appData = api ?? null

  // `hydrated` and `lastWritten` deliberately survive: the results themselves
  // are still in the store (the module outlives a disable), so re-enabling
  // must not read the stored copy back over them.
  //
  // `api == null` and not `=== null`: a host without the appData domain hands
  // in `undefined`, and calling through that would throw inside the panel.
  if (appData === null) {
    if (api === undefined) {
      console.warn(
        'MCODE app data: this host has no appData domain; results will not persist',
      )
    }
    return
  }

  // App-scoped read: no network involved, so it works before any network is
  // current. APP11 just means this app has never stored a counter.
  const stored = appData.getGlobal(NEXT_ID_KEY)
  if (stored.success) {
    if (typeof stored.data.value === 'number') {
      setNextResultId(stored.data.value)
      lastNextIdWritten = getNextResultId()
    }
  } else if (stored.error.code !== 'APP11') {
    warn(`failed to read "${NEXT_ID_KEY}"`, stored.error)
  }

  unsubscribe = subscribeMcodeResults(scheduleWrite)
}

/**
 * Read `networkId`'s stored results into the store, once per network per
 * session. Safe to call on every switch; a no-op the second time, so it never
 * overwrites results computed since.
 */
export function hydrateNetworkResults(networkId: string): void {
  const api = appData
  if (api === null || networkId === '' || hydrated.has(networkId)) return
  hydrated.add(networkId)

  const stored = api.get(networkId, RESULTS_KEY)
  if (!stored.success) {
    // APP11 = nothing stored: the normal case for a never-analyzed network.
    if (stored.error.code !== 'APP11') {
      warn(`failed to read results for network ${networkId}`, stored.error)
    }
    return
  }

  const results = fromStoredResults(networkId, stored.data.value)
  if (results.length === 0) {
    console.warn(
      `MCODE app data: stored results for network ${networkId} were unreadable and have been dropped`,
    )
    return
  }
  restoreNetworkResults(networkId, results)
  // Seed the write cache from what is now in the store, so the hydration
  // itself does not trigger a rewrite of the same bytes.
  lastWritten.set(networkId, JSON.stringify(toStoredResults(results)))
}

/**
 * Forget a deleted network. The host drops both app-data tiers for a deleted
 * network itself, so there is nothing to remove — only local bookkeeping.
 */
export function forgetNetwork(networkId: string): void {
  hydrated.delete(networkId)
  lastWritten.delete(networkId)
}

const scheduleWrite = (): void => {
  if (appData === null || writeTimer !== null) return
  writeTimer = setTimeout(() => {
    writeTimer = null
    flushWrites()
  }, WRITE_DEBOUNCE_MS)
}

/** Write every network whose result set differs from what was last stored. */
const flushWrites = (): void => {
  const api = appData
  if (api === null) return

  // Start from the networks last written so an emptied one is revisited, then
  // group what the store currently holds.
  const byNetwork = new Map<string, MCODEResult[]>()
  for (const networkId of lastWritten.keys()) byNetwork.set(networkId, [])
  for (const result of getMcodeResults().results) {
    const list = byNetwork.get(result.networkId)
    if (list === undefined) byNetwork.set(result.networkId, [result])
    else list.push(result)
  }

  for (const [networkId, results] of byNetwork) {
    const payload = toStoredResults(results)
    const json = JSON.stringify(payload)
    if (lastWritten.get(networkId) === json) continue

    const written =
      results.length === 0
        ? api.remove(networkId, RESULTS_KEY)
        : api.set(networkId, RESULTS_KEY, payload)
    if (!written.success) {
      // APP13 = over the 5 MB per-entry cap (a very large network's scoring
      // state). APP1 = the network left the workspace mid-write. Either way
      // the results stay in memory for this session; only the reload is lost.
      warn(`failed to store results for network ${networkId}`, written.error)
      continue
    }
    if (results.length === 0) lastWritten.delete(networkId)
    else lastWritten.set(networkId, json)
  }

  const nextId = getNextResultId()
  if (nextId !== lastNextIdWritten) {
    const written = api.setGlobal(NEXT_ID_KEY, nextId)
    if (written.success) lastNextIdWritten = nextId
    else warn(`failed to store "${NEXT_ID_KEY}"`, written.error)
  }
}

// EXPORTING RESULTS WITH THE NETWORK
//
// `api.set(networkId, RESULTS_KEY, payload, { export: true })` moves the entry
// into the network's `cyAppData` CX2 aspect: it is then saved to NDEx, present
// in every CX2 download, and marks the network modified. A key lives in
// exactly one tier, so switching the flag moves the entry rather than
// duplicating it. MCODE keeps results local — they are derived from the
// network and would otherwise be published to everyone the user shares it
// with — but an app whose results are the point should opt in.
