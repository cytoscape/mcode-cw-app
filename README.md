# MCODE App — Cytoscape Web

Aa a Cytoscape Web plugin, MCODE finds clusters (highly interconnected regions) in a network.
Clusters mean different things in different types of networks.
For instance, clusters in a protein-protein interaction network are often protein complexes and parts of pathways,
while clusters in a protein similarity network represent protein families.

| Field | Value |
|---|---|
| Federation name | `mcode` |
| Dev server port | `5555` |
| Entry point | `template@http://localhost:5555/remoteEntry.js` |

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (host must be running on :5500)
npm run dev
```

Add your app to the host's `src/assets/apps.local.json` (a JSON array):
```json
{
  "id": "mcode",
  "name": "MCODE",
  "url": "http://localhost:5555/remoteEntry.js",
  "author": "Bader Lab, University of Toronto",
  "description": "Finds clusters (highly interconnected regions) in a network.",
  "version": "0.1.0",
  "tags": ["clustering", "graph-analysis"],
  "license": "LGPL 2.1",
  "repository": "https://github.com/cytoscape/mcode-cw-app"
}
```

Open `http://localhost:5500` → **Apps** → **App Settings** → enable your app.

---

## Building for production

```bash
npx webpack --env production
```

This switches the host remote from `localhost:5555` to `web.cytoscape.org` and
enables minification.
