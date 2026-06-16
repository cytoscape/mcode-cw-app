/**
 * Actions the user can run against a selected MCODE result / cluster from the
 * options menu: view the source network, create a cluster subnetwork, and
 * export the result to a text file.
 *
 * These handlers are stateful (they consume Cytoscape Web API hooks), so they
 * live in a custom hook rather than a plain utility module. The pure data
 * transforms they rely on live in `mcodeExport.ts`.
 */
import { useCallback } from 'react'

import type { Cx2 } from '@cytoscape-web/api-types'
import { useElementApi } from 'cyweb/ElementApi'
import { useExportApi } from 'cyweb/ExportApi'
import { useNetworkApi } from 'cyweb/NetworkApi'
import { useWorkspaceApi } from 'cyweb/WorkspaceApi'

import { buildMcodeResultsText, ClusterExportRow, sliceClusterCx2 } from './mcodeExport'
import { MCODECluster, MCODEResult } from './mcodeTypes'

export interface McodeResultActions {
  /** Make the result's source network the active/shown one. */
  viewSourceNetwork: () => void
  /** Create a new subnetwork from the selected cluster. */
  createClusterNetwork: () => void
  /** Download the selected result as a tab-delimited .txt report. */
  exportResult: () => void
}

export function useMcodeResultActions(
  selectedResult: MCODEResult | null,
  selectedCluster: MCODECluster | null,
): McodeResultActions {
  const workspaceApi = useWorkspaceApi()
  const networkApi = useNetworkApi()
  const exportApi = useExportApi()
  const elementApi = useElementApi()

  const viewSourceNetwork = useCallback(() => {
    if (!selectedResult) return
    const res = workspaceApi.switchCurrentNetwork(selectedResult.networkId)
    if (!res.success) {
      console.warn('Failed to switch to source network:', res.error.message)
    }
  }, [selectedResult, workspaceApi])

  const createClusterNetwork = useCallback(() => {
    if (!selectedResult || !selectedCluster) return

    // Export the source network to CX2 and slice it down to the cluster, rather
    // than building an edge list: CX2 carries the original node/edge table
    // attributes (and visual styles), so the subnetwork preserves them.
    const clusterName = `${selectedResult.name} (Cluster ${selectedCluster.rank})`
    const exported = exportApi.exportToCx2(selectedResult.networkId, { networkName: clusterName })
    if (!exported.success) {
      console.warn('Failed to export source network:', exported.error.message)
      return
    }

    const cxData = sliceClusterCx2(exported.data, selectedCluster.nodes, selectedCluster.nodePositions)
    const created = networkApi.createNetworkFromCx2({
      cxData: cxData as unknown as Cx2,
      addToWorkspace: true,
      navigate: true,
    })
    if (!created.success) {
      console.warn('Failed to create cluster network:', created.error.message)
    }
  }, [selectedResult, selectedCluster, exportApi, networkApi])

  const exportResult = useCallback(() => {
    if (!selectedResult) return
    const { networkId, parameters, clusters, name } = selectedResult

    // Resolve a node's display name from the source network ("name" column),
    // falling back to the raw node id when no name attribute is present.
    const nodeName = (nodeId: string): string => {
      const node = elementApi.getNode(networkId, nodeId)
      if (node.success) {
        const value = node.data.attributes.name ?? node.data.attributes['shared name']
        if (value !== undefined && value !== null) return String(value)
      }
      return nodeId
    }

    // Count the edges induced by the cluster's nodes in the source network
    // (undirected, each unordered pair once) — i.e. the cluster's edge count.
    const inducedEdgeCount = (nodes: string[]): number => {
      const inCluster = new Set(nodes)
      const seen = new Set<string>()
      for (const nodeId of nodes) {
        const connected = elementApi.getConnectedNodes(networkId, nodeId)
        if (!connected.success) continue
        for (const neighbor of connected.data.nodeIds) {
          if (!inCluster.has(neighbor)) continue
          seen.add(nodeId < neighbor ? `${nodeId}|${neighbor}` : `${neighbor}|${nodeId}`)
        }
      }
      return seen.size
    }

    const rows: ClusterExportRow[] = clusters.map((cluster) => ({
      score: cluster.score,
      nodeCount: cluster.nodes.length,
      edgeCount: inducedEdgeCount(cluster.nodes),
      nodeNames: cluster.nodes.map(nodeName),
    }))
    const content = buildMcodeResultsText(parameters, rows)

    // Name the file after the source network, e.g. "galFiltered-mcode-results.txt".
    const summary = workspaceApi.getNetworkSummary(networkId)
    const networkName = summary.success ? summary.data.name : name
    const fileName = `${networkName}-mcode-results.txt`

    // Trigger a browser download of the text file.
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }, [selectedResult, elementApi, workspaceApi])

  return { viewSourceNetwork, createClusterNetwork, exportResult }
}
