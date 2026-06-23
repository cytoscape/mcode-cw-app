import path from 'path'
import url from 'url'
import mfPlugin from '@module-federation/enhanced/webpack'
import packageJson from './package.json' with { type: 'json' }

// Use @module-federation/enhanced (NOT webpack's built-in
// webpack.container.ModuleFederationPlugin). For an ESM remote that *consumes*
// another remote (cyweb), the built-in plugin emits a static
// `import … from "cyweb@<url>"`, which the browser's ESM loader rejects
// ("Failed to resolve module specifier"). The enhanced plugin loads remotes via
// @module-federation/runtime — the same runtime the cyweb (Vite) host uses — so
// no bare `name@url` specifier is emitted.
//
// The plugin package is CommonJS while this config is an ES module, so import
// the default export and destructure (the named CJS export is not reliably
// reachable via `import { ModuleFederationPlugin }`).
const { ModuleFederationPlugin } = mfPlugin

// Extract some properties from the package.json file to avoid duplication
const deps = packageJson.peerDependencies

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// TODO: Change DEV_SERVER_PORT to an unused port.
const DEV_SERVER_PORT = 5555

// Host remote URL — switches between local dev and production.
//
// NOTE: a plain URL, NOT the classic `cyweb@<url>` syntax. The `name@url` form
// only works for the `script` remote type; with ESM output (remoteType
// 'module') webpack uses the whole string as a static `import` specifier, and
// `cyweb@http://…` is not a valid module specifier ("Failed to resolve module
// specifier"). The remote's name comes from the `remotes` key (`cyweb`) below.
const LOCAL_CYWEB = 'http://localhost:5500/remoteEntry.js'
const PROD_CYWEB = 'https://web.cytoscape.org/remoteEntry.js'

export default (env) => {
  // webpack-cli passes `--env production=false` as the STRING "false", which is
  // truthy — so guard against it explicitly rather than testing `env.production`.
  const isProduction =
    env?.production === true || env?.production === 'true'

  return {
  mode: isProduction ? 'production' : 'development',
  devtool: false,
  target: 'web',
  optimization: {
    minimize: false,
    runtimeChunk: false,
    splitChunks: {
      // Split shared modules out of async chunks (the default), but NEVER out of
      // the web worker chunk. The worker is loaded via a cross-origin blob that
      // importScripts() it; inside that blob worker `self.location` is the host
      // origin, so webpack's auto publicPath can't fetch sibling chunks from the
      // remote's origin. Keeping the worker self-contained avoids that entirely.
      // The 'mcode-worker' name is set in src/model/useMcodeWorker.ts.
      chunks: (chunk) => chunk.name !== 'mcode-worker' && !chunk.canBeInitial(),
      name: false,
    },
  },
  entry: './src/index.ts',
  // Emit an ES module remote. The cyweb host loads every remote via
  // `import()` (registerRemotes with `type: 'module'`), so the container and
  // its chunks must be ESM, not the classic `var mcode` global.
  experiments: { outputModule: true },
  output: {
    clean: true,
    path: path.resolve(__dirname, 'dist'),
    // In dev, webpack-dev-server injects an `import.meta.url`-based auto
    // publicPath snippet into EVERY chunk — including the worker chunk. The
    // MCODE worker runs as a CLASSIC worker via importScripts() (see
    // useMcodeWorker.ts), and `import.meta` is a syntax error in a classic
    // worker, so importScripts fails to compile it (surfaces as a NetworkError
    // "failed to load"). An explicit publicPath disables that snippet. Prod
    // builds have no dev server and don't inject it, so 'auto' stays there to
    // keep the deployed remote location-agnostic.
    publicPath: isProduction ? 'auto' : `http://localhost:${DEV_SERVER_PORT}/`,
    module: true,
    // The MCODE web worker is loaded as a classic cross-origin blob that
    // importScripts() its chunk (see src/model/useMcodeWorker.ts); module
    // workers can't use importScripts(), so pin worker chunks to classic.
    workerChunkLoading: 'import-scripts',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'mcode', // unique camelCase app name.
      filename: 'remoteEntry.js',
      // Emit the federation container as an ES module so the host can import()
      // it. Requires output.module / experiments.outputModule above.
      library: { type: 'module' },
      // Load the cyweb remote as a native ES module (matches the host's ESM
      // container and the plain-URL remote entries above).
      remoteType: 'module',
      remotes: {
        cyweb: isProduction ? PROD_CYWEB : LOCAL_CYWEB,
      },
      exposes: {
        './AppConfig': './src/index.ts',
      },
      shared: {
        // Host-owned singletons: `import: false` means this remote never
        // bundles its own fallback copy — it consumes cyweb's instance only.
        // Keeps react/react-dom/@mui out of the distributed files entirely.
        react: { singleton: true, requiredVersion: deps.react, import: false },
        'react-dom': {
          singleton: true,
          requiredVersion: deps['react-dom'],
          import: false,
        },
        '@mui/material': {
          singleton: true,
          requiredVersion: deps['@mui/material'],
          import: false,
        },
      },
    }),
  ],
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  devServer: {
    hot: true,
    port: DEV_SERVER_PORT,
    headers: {
      'Access-Control-Allow-Origin': '*', // allow access from any origin
    },
  },
  }
}
