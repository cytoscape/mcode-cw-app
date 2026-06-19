import path from 'path'
import url from 'url'
import webpack from 'webpack'
import packageJson from './package.json' with { type: 'json' }

const { ModuleFederationPlugin } = webpack.container

// Extract some properties from the package.json file to avoid duplication
const deps = packageJson.peerDependencies

const __filename = url.fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// TODO: Change DEV_SERVER_PORT to an unused port.
const DEV_SERVER_PORT = 5555

// Host remote URL — switches between local dev and production.
const CYWEB_NAME = 'cyweb'
const LOCAL_CYWEB = `${CYWEB_NAME}@http://localhost:5500/remoteEntry.js`
const PROD_CYWEB = `${CYWEB_NAME}@https://web.cytoscape.org/remoteEntry.js`

export default (env) => ({
  mode: env?.production ? 'production' : 'development',
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
  output: {
    clean: true,
    path: path.resolve(__dirname, 'dist'),
    publicPath: 'auto',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'mcode', // unique camelCase app name.
      filename: 'remoteEntry.js',
      remotes: {
        cyweb: env?.production ? PROD_CYWEB : LOCAL_CYWEB,
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
})
