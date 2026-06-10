/**
 * TemplateMenuItem — Minimal Apps-menu action.
 *
 * Demonstrates:
 *   - Creating a network from an edge list (simplest API usage)
 *   - MUI components in a menu item
 *   - closeOnAction: true in TemplateApp.resources[] means the dropdown
 *     closes automatically after the user clicks — no handleClose needed.
 *
 * Replace this with your own menu action.
 */
import { Typography } from '@mui/material'

import { useNetworkApi } from 'cyweb/NetworkApi'
import { JSX } from 'react/jsx-runtime'


const MCODEMenuItem = (): JSX.Element => {
  const networkApi = useNetworkApi()

  const handleClick = (): void => {
    networkApi.createNetworkFromEdgeList({
      name: 'MCODE Network',
      description: 'Created by the MCODE menu action.',
      edgeList: [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'A'],
      ],
      addToWorkspace: true,
    })
  }

  return (
    <Typography
      sx={{
        px: 2,
        py: 1,
        cursor: 'pointer',
        '&:hover': { bgcolor: 'action.hover' },
      }}
      onClick={handleClick}
    >
      Create example network
    </Typography>
  )
}

export default MCODEMenuItem
