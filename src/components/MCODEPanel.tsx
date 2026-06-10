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
import { useState } from 'react'
import { Box, Button, Paper, Typography } from '@mui/material'

import { useElementApi } from 'cyweb/ElementApi'
import { useSelectionApi } from 'cyweb/SelectionApi'
import { useWorkspaceApi } from 'cyweb/WorkspaceApi'
import { JSX } from 'react/jsx-runtime'

import { MCODEAlgorithm } from '../model/mcodeAlgorithm'
import { MCODECluster } from '../model/mcodeTypes'


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
              cursor: 'pointer',
              bgcolor: selectedCluster === cluster ? 'primary.light' : 'background.paper',
            }}
          >
            <Typography variant="body1">Cluster {i + 1}</Typography>
            <Typography variant="body2" color="text.secondary">
              Score: {cluster.score}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Nodes: {cluster.nodes.length}
            </Typography>
          </Paper>
        ))}
      </Box>
    </Box>
  )
}

export default MCODEPanel
