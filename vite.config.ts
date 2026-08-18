import { defineCyWebApp } from '@cytoscape-web/app-runtime/vite'

export default defineCyWebApp(import.meta.url)

// That is the whole build configuration. defineCyWebApp sets up:
//
//   - the `cyweb` remote with `type: 'module'` (the host emits an ESM
//     remoteEntry.js)
//   - a production entry that is a SENTINEL, not a URL — the host publishes its
//     own entry on window.__CYWEB_HOST__ at boot and a runtime plugin swaps it
//     in, so one artifact works against any deployment (no hardcoded domains)
//   - `shared` matching the host's five singletons (react, react-dom,
//     @mui/material, @emotion/react, @emotion/styled) with `import: false`
//   - the `./AppConfig` expose from src/index.ts
//   - a build-time gate that fails if a shared package's implementation ends
//     up bundled anyway
//
// The app's identity — id, display name, dev port — lives in the `cyweb` block
// in package.json.
//
// The MCODE web worker needs nothing here: worker code is emitted by Vite's
// built-in `?worker&url` handling and loaded through a same-origin Blob shim
// (see src/model/useMcodeWorker.ts), which works on any origin.
