/**
 * MCODEPanel — right-panel component.
 *
 * Demonstrates:
 *   - Reading workspace info via useWorkspaceApi()
 *   - ApiResult<T> pattern (check .success before .data)
 *   - MUI components (shared singletons from host)
 *
 * Replace this with your own panel UI.
 */
import { useEffect, useState } from 'react'
import { Box, Button, Paper, Typography } from '@mui/material'
import cytoscape from 'cytoscape'

import { useElementApi } from 'cyweb/ElementApi'
import { useSelectionApi } from 'cyweb/SelectionApi'
import { useWorkspaceApi } from 'cyweb/WorkspaceApi'
import { JSX } from 'react/jsx-runtime'

import { MCODEAlgorithm } from '../model/mcodeAlgorithm'
import { MCODECluster } from '../model/mcodeTypes'


const ClusterThumbnail = ({
  networkId,
  cluster
}: {
  networkId: string,
  cluster: MCODECluster
}): JSX.Element => {
  const [image, setImage] = useState<string | null>(null)
  const elementApi = useElementApi()

  // Create an offscreen canvas to draw the cluster thumbnail and get the exported PNG.
  // (get the actual nodes ans edges from the network from the node IDs provided by the cluster)
  useEffect(() => {
    if (cluster.nodes.length === 0) {
      setImage(null)
      return
    }

    // Collect the edges induced by the cluster: keep only those whose both
    // endpoints belong to the cluster. getConnectedNodes is undirected, so we
    // canonicalize each pair to avoid adding it twice.
    const clusterNodes = new Set(cluster.nodes)
    const edgeKeys = new Set<string>()
    for (const nodeId of cluster.nodes) {
      const connected = elementApi.getConnectedNodes(networkId, nodeId)
      if (!connected.success) continue
      for (const neighbor of connected.data.nodeIds) {
        if (!clusterNodes.has(neighbor)) continue
        edgeKeys.add(nodeId < neighbor ? `${nodeId}|${neighbor}` : `${neighbor}|${nodeId}`)
      }
    }

    const elements: cytoscape.ElementDefinition[] = [
      ...cluster.nodes.map((id) => ({ data: { id } })),
      ...[...edgeKeys].map((key) => {
        const [source, target] = key.split('|')
        return { data: { id: key, source, target } }
      }),
    ]

    // Cytoscape's canvas renderer needs a sized DOM node, so render into a
    // detached, off-screen container, export the PNG, then tear it down.
    const container = document.createElement('div')
    container.style.position = 'absolute'
    container.style.left = '-9999px'
    container.style.top = '-9999px'
    container.style.width = '200px'
    container.style.height = '200px'
    document.body.appendChild(container)

    const cy = cytoscape({
      container,
      elements,
      style: [
        {
          selector: 'node',
          style: { 'background-color': '#2185d0', width: 14, height: 14 },
        },
        {
          selector: 'edge',
          style: { 'line-color': '#9e9e9e', width: 2 },
        },
      ],
      // Discrete layout: positions are applied synchronously on run().
      layout: { name: 'cose', animate: false },
    })

    // `full: true` exports the entire graph fit to the image, independent of
    // viewport zoom/pan. Returns a base64 PNG data URI usable as an <img> src.
    const png = cy.png({ full: true, bg: '#ffffff', scale: 2 })

    cy.destroy()
    document.body.removeChild(container)
    setImage(png)
    // elementApi is intentionally omitted: it may be a fresh reference each
    // render, and the thumbnail only needs to rebuild when the inputs change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [networkId, cluster])

  return (
    <Box
      sx={{
        width: 80,
        height: 80,
        bgcolor: '#ffffff',
        border: (theme) => `1px solid ${theme.palette.divider}`,
        borderRadius: 1,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {image ? (
        <img
          src={image}
          alt="Cluster Thumbnail"
          style={{ maxWidth: '100%', maxHeight: '100%' }}
        />
      ) : (
        <Typography variant="caption" color="text.secondary">
          Loading...
        </Typography>
      )}
    </Box>
  )
}

const MCODEPanel = (): JSX.Element => {
  const [networkId, setNetworkId] = useState<string | null>(null)
  const [clusters, setClusters] = useState<MCODECluster[]>([])
  const [selectedCluster, setSelectedCluster] = useState<MCODECluster | null>(null)

  const workspaceApi = useWorkspaceApi()
  const elementApi = useElementApi()
  const selectionApi = useSelectionApi()
  const result = workspaceApi.getWorkspaceInfo()
  const workspaceName =
    result.success && result.data.name !== ''
      ? result.data.name
      : 'Untitled Workspace'

  const handleAnalizeClick = (): void => {
    // 1. Resolve the currently active network's ID.
    const currentNetwork = workspaceApi.getCurrentNetworkId()
    if (!currentNetwork.success) {
      console.warn('No current network:', currentNetwork.error.message)
      return
    }
    const networkId = currentNetwork.data.networkId
    setNetworkId(networkId)
    console.log('Current network ID:', networkId)

    // 2. Read the network's graph via ElementApi as an undirected
    //    adjacency map { nodeId -> neighborNodeIds[] } for MCODE.
    const nodesResult = elementApi.getNodeIds(networkId)
    if (!nodesResult.success) {
      console.warn('Failed to read nodes:', nodesResult.error.message)
      return
    }

    const adjacency = new Map<string, string[]>()
    for (const nodeId of nodesResult.data.nodeIds) {
      const neighbors = elementApi.getConnectedNodes(networkId, nodeId)
      adjacency.set(nodeId, neighbors.success ? neighbors.data.nodeIds : [])
    }
    console.log('Adjacency map:', adjacency)

    // 3. Run MCODE over the adjacency map (uses default parameters).
    const clusters = new MCODEAlgorithm().run(adjacency)
    setClusters(clusters)
    console.log(`MCODE found ${clusters.length} cluster(s)`, clusters)
  }

  const handleClusterClick = (cluster: MCODECluster): void => {
    setSelectedCluster(cluster)

    if (!networkId) {
      console.warn('No current network ID')
      return
    }

    const selected = selectionApi.exclusiveSelect(
      networkId,
      cluster.nodes,
      [],
    )
    if (!selected.success) {
      console.warn('Failed to select cluster nodes:', selected.error.message)
    }
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: 3,
      }}
    >
      <Typography variant="h5">MCODE</Typography>
      <Box>
        <Button
          variant="contained"
          onClick={handleAnalizeClick}
        >
          Analyze Current Network
        </Button>
      </Box>
      <Box>
        {clusters.map((cluster, i) => (
          <Paper
            key={i}
            onClick={() => handleClusterClick(cluster)}
            sx={{
              p: 2,
              mb: 1,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
              bgcolor: selectedCluster === cluster ? 'action.selected' : 'background.paper',
            }}
          >
            <Box>
              <Typography variant="body1">Cluster {i + 1}</Typography>
              <Typography variant="body2" color="text.secondary">
                Score: {Math.round(cluster.score * 100) / 100}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Nodes: {cluster.nodes.length}
              </Typography>
            </Box>
            <Box>
              {networkId && <ClusterThumbnail networkId={networkId} cluster={cluster} />}
            </Box>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

export default MCODEPanel
