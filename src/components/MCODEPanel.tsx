import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/Delete'
import { useEffect, useState } from 'react'
import { Box, Button, Container, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, IconButton, MenuItem, Paper, Select, Tooltip, Typography } from '@mui/material'
import cytoscape from 'cytoscape'

import { useCyWebEvent } from 'cyweb/EventBus'
import { useElementApi } from 'cyweb/ElementApi'
import { useSelectionApi } from 'cyweb/SelectionApi'
import { useWorkspaceApi } from 'cyweb/WorkspaceApi'
import { JSX } from 'react/jsx-runtime'

import { MCODEAlgorithm } from '../model/mcodeAlgorithm'
import { MCODECluster, MCODEParameters, MCODEResult } from '../model/mcodeTypes'
import { NewAnalysisDialog } from './NewAnalysisDialog'


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
  const workspaceApi = useWorkspaceApi()
  const elementApi = useElementApi()
  const selectionApi = useSelectionApi()

  const [currentNetworkId, setCurrentNetworkId] = useState<string | null>(() => {
    const current = workspaceApi.getCurrentNetworkId()
    return current.success ? current.data.networkId : null
  })
  const [results, setResults] = useState<MCODEResult[]>([])
  const [selectedResult, setSelectedResult] = useState<MCODEResult | null>(null)
  const [networkId, setNetworkId] = useState<string | null>(null)
  const [selectedCluster, setSelectedCluster] = useState<MCODECluster | null>(null)
  const [analysisDialogOpen, setAnalysisDialogOpen] = useState(false)
  const [noResultsOpen, setNoResultsOpen] = useState(false)

  useCyWebEvent('network:switched', ({ networkId: newId, previousId }) => {
    console.log(`current network changed: ${previousId || '(none)'} → ${newId}`)
    setCurrentNetworkId(newId)
  })

  const handleDiscardResultClick = (): void => {
    if (!selectedResult) return
    setSelectedResult((prev) => {
      const index = results.indexOf(prev!)
      if (index > 0) {
        return results[index - 1]
      }
      return results.length > 1 ? results[1] : null
    })
    setResults((prev) => prev.filter((r) => r !== selectedResult))
    setSelectedCluster(null)
  }

  const handleNewAnalysisClick = (): void => {
    setAnalysisDialogOpen(true)
  }
  
  const handleSubmitAnalysis = (parameters: MCODEParameters): void => {
    if (!currentNetworkId) {
      return
    }

    // 1. Determine the set of nodes to analyze. For SELECTION scope, restrict
    //    to the currently selected nodes; otherwise use the whole network.
    let nodeIds: string[]
    if (parameters.scope === 'SELECTION') {
      const selection = selectionApi.getSelection(currentNetworkId)
      if (!selection.success) {
        console.warn('Failed to read selection:', selection.error.message)
        return
      }
      nodeIds = selection.data.selectedNodes
    } else {
      const nodesResult = elementApi.getNodeIds(currentNetworkId)
      if (!nodesResult.success) {
        console.warn('Failed to read nodes:', nodesResult.error.message)
        return
      }
      nodeIds = nodesResult.data.nodeIds
    }

    // 2. Read the network's graph via ElementApi as an undirected
    //    adjacency map { nodeId -> neighborNodeIds[] } for MCODE. When the
    //    scope is a selection, keep only neighbors that are themselves in scope.
    const inScope = new Set(nodeIds)
    const adjacency = new Map<string, string[]>()
    for (const nodeId of nodeIds) {
      const neighbors = elementApi.getConnectedNodes(currentNetworkId, nodeId)
      const neighborIds = neighbors.success ? neighbors.data.nodeIds : []
      adjacency.set(
        nodeId,
        parameters.scope === 'SELECTION'
          ? neighborIds.filter((id) => inScope.has(id))
          : neighborIds,
      )
    }
    console.log('Adjacency map:', adjacency)

    // 3. Run MCODE over the adjacency map.
    const clusters = new MCODEAlgorithm(parameters).run(adjacency)

    // If nothing was found, don't add an empty result; just inform the user.
    if (clusters.length === 0) {
      setNoResultsOpen(true)
      return
    }

    // 4. Build the result. The name is "{COUNT} - {network name}" where COUNT
    //    is the new result's position in the results array (1-based, i.e. the
    //    last index once it is appended).
    const summary = workspaceApi.getNetworkSummary(currentNetworkId)
    const networkName = summary.success ? summary.data.name : currentNetworkId
    const count = results.length + 1
    const newResult: MCODEResult = {
      name: `${count} - ${networkName}`,
      networkId: currentNetworkId,
      parameters,
      clusters,
    }
    setResults((prev) => [...prev, newResult])
    setSelectedResult(newResult)
    console.log(`MCODE found ${clusters.length} cluster(s)`, clusters)
  }

  const handleClusterClick = (cluster: MCODECluster): void => {
    setSelectedCluster(cluster)

    if (!selectedResult) {
      console.warn('No selected result')
      return
    }

    const selected = selectionApi.exclusiveSelect(
      selectedResult.networkId,
      cluster.nodes,
      [],
    )
    if (!selected.success) {
      console.warn('Failed to select cluster nodes:', selected.error.message)
    }
  }

  return (
    <>
      <Box
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            backgroundColor: 'background.default',
            p: 1,
            gap: 1,
          }}
        >
          <Select
            value={selectedResult?.name || ''}
            disabled={results.length === 0}
            size="small"
            onChange={(e) => {
              const result = results.find((r) => r.name === e.target.value) || null
              setSelectedResult(result)
              setSelectedCluster(null)
            }}
            displayEmpty
            sx={{
              flexGrow: 1,
              minWidth: 200,
              bgcolor: results.length === 0 ? 'transparent' : 'background.paper',
            }}
          >
            {results.map((result) => (
              <MenuItem key={result.name} value={result.name}>
                {result.name}
              </MenuItem>
            ))}
          </Select>
          <Tooltip title="Discard selected result">
            <span>
              <IconButton
                disabled={!selectedResult}
                onClick={handleDiscardResultClick}
                sx={{
                  color: 'text.primary',
                }}
              >
                <DeleteIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="New analysis...">
            <span>
              <Button
                variant="contained"
                disabled={!currentNetworkId}
                onClick={handleNewAnalysisClick}
                sx={{
                  minWidth: 24,
                  px: 1,
                }}
              >
                <AddIcon />
              </Button>
            </span>
          </Tooltip>
        </Box>
        <Box
          sx={{
            flexGrow: 1,
            overflowY: 'auto',
          }}
        >
          {selectedResult?.clusters.map((cluster, i) => (
            <Box
              key={i}
              onClick={() => handleClusterClick(cluster)}
              sx={{
                px: 2,
                py: 0.5,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                cursor: 'pointer',
                bgcolor: selectedCluster === cluster ? 'action.selected' : 'background.paper',
                borderBottom: (theme) => `2px solid ${theme.palette.background.default}`,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                }}
              >
                <Typography
                  variant="body1"
                  sx={{
                    textAlign: 'right',
                    width: 32,
                    flexShrink: 0,
                    color: 'text.secondary',
                    fontWeight: 'bold',
                  }}
                >
                  {i + 1}
                </Typography>
                <Box>
                  <ClusterThumbnail networkId={selectedResult.networkId} cluster={cluster} />
                </Box>
                <Box>
                  <Typography variant="body1" color="text.secondary">
                    Score: {Math.round(cluster.score * 100) / 100}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Nodes: {cluster.nodes.length}
                  </Typography>
                </Box>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    {currentNetworkId && (
      <NewAnalysisDialog
        networkId={currentNetworkId}
        open={analysisDialogOpen}
        onClose={() => setAnalysisDialogOpen(false)}
        onSubmit={handleSubmitAnalysis}
      />
    )}
    <Dialog open={noResultsOpen} onClose={() => setNoResultsOpen(false)}>
      <DialogTitle>No Results</DialogTitle>
      <DialogContent>
        <DialogContentText sx={{ whiteSpace: 'pre-line' }}>
          {'No clusters were found.\n'
            + 'You can try changing the MCODE parameters or\n'
            + 'modifying your node selection if you are using\n'
            + 'a selection-specific scope.'}
        </DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setNoResultsOpen(false)} variant="contained">
          OK
        </Button>
      </DialogActions>
    </Dialog>
    </>
  )
}

export default MCODEPanel
