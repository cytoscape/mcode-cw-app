/**
 * Update:
 *   1. `resources`   → add/remove panels and menu items
 *   2. `mount()`     → register context menus, event listeners, etc.
 *   3. `unmount()`   → clean up event listeners from mount()
 *
 * Identity (id, display name, version, description) arrives from
 * `virtual:cyweb-app-meta`, which the build fills in from the `cyweb` block
 * and standard fields in package.json — written once, read everywhere. Do NOT
 * `import packageJson from '../package.json'`: that pulls the whole file,
 * devDependencies included, into the browser bundle (`cyweb-app verify` fails
 * a build that does).
 *
 * Resources (panels and menu items) are registered declaratively — the host
 * renders them automatically. Context menus need `apis` access, so they are
 * registered in mount() instead.
 */

import { lazy } from 'react'

import { AppContext, CyAppWithLifecycle } from 'cyweb/ApiTypes'
import { description, displayName, id, version } from 'virtual:cyweb-app-meta'

export const MCODEApp: CyAppWithLifecycle = {
  id, // the Module Federation container name, from `cyweb.id` in package.json
  name: displayName,
  description,
  version,
  apiVersion: '1.0',

  // ── Declarative resource registration ──────────────────────────────────
  // Panels and menu items are declared here. The host registers them
  // automatically — no mount() needed for these.
  resources: [
    {
      slot: 'right-panel',
      id: 'MCODEPanel',
      title: 'MCODE', // Tab title shown in the right panel.
      component: lazy(() => import('./components/MCODEPanel')),
    },
  ],

  // ── Lifecycle hooks ────────────────────────────────────────────────────
  // mount() is called once after the app's resources are registered.
  // Use it for context menus (handlers need api access) and event listeners.

  mount(context: AppContext): void {
    // Context menu items are registered here because their handlers need
    // access to context.apis. The host auto-cleans all items when the app
    // is disabled — no explicit removal in unmount() needed.
    // registerSelectNeighbors(context)

    // TODO: Add more context menu registrations or event listeners here.
    // See src/contextMenus.ts for the pattern.
  },

  unmount(): void {
    // Only manual cleanup (e.g. event listeners) goes here.
    // Context menu items and resources are auto-cleaned by the host.
    //
    // if (_handler !== null) {
    //   window.removeEventListener('network:switched', _handler)
    //   _handler = null
    // }
  },
}
