import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { JSX } from 'react/jsx-runtime'
import {
  DEFAULT_MCODE_PARAMETERS,
  MCODEAnalysisScope,
  MCODE_ANALYSIS_SCOPE_LABELS,
  MCODEParameters,
} from '../model/mcodeTypes'

/**
 * Keys of the numeric parameters edited as text fields. Used to key the
 * per-field validation error map.
 */
type NumericField =
  | 'degreeCutoff'
  | 'nodeScoreCutoff'
  | 'kCore'
  | 'maxDepthFromStart'
  | 'fluffNodeDensityCutoff'

type Errors = Partial<Record<NumericField, string>>

/**
 * Validate a single integer field that must be strictly greater than `min`.
 * Returns an error message, or undefined when the value is valid.
 */
const validateIntGreaterThan = (raw: string, min: number, label: string): string | undefined => {
  const value = Number(raw)
  if (raw.trim() === '' || !Number.isInteger(value) || value <= min)
    return `The ${label} must be greater than ${min}.`
  return undefined
}

/**
 * Validate a single fraction field that must lie within [0, 1] inclusive.
 * Returns an error message, or undefined when the value is valid.
 */
const validateFraction = (raw: string, label: string): string | undefined => {
  const value = Number(raw)
  if (raw.trim() === '' || Number.isNaN(value) || value < 0 || value > 1)
    return `The ${label} must be between 0 and 1.`
  return undefined
}

export const NewAnalysisDialog = ({
  networkId,
  open,
  onClose,
  onSubmit,
}: {
  networkId: string
  open: boolean
  onClose: () => void
  onSubmit: (parameters: MCODEParameters) => void
}): JSX.Element => {
  // Scope and the two boolean options are stored as their final types; the
  // numeric inputs are kept as strings so the user can type freely (and we
  // can surface validation messages) before parsing on submit.
  const [scope, setScope] = useState<MCODEAnalysisScope>(DEFAULT_MCODE_PARAMETERS.scope)
  const [includeLoops, setIncludeLoops] = useState(DEFAULT_MCODE_PARAMETERS.includeLoops)
  const [haircut, setHaircut] = useState(DEFAULT_MCODE_PARAMETERS.haircut)
  const [fluff, setFluff] = useState(DEFAULT_MCODE_PARAMETERS.fluff)
  const [degreeCutoff, setDegreeCutoff] = useState(String(DEFAULT_MCODE_PARAMETERS.degreeCutoff))
  const [nodeScoreCutoff, setNodeScoreCutoff] = useState(
    String(DEFAULT_MCODE_PARAMETERS.nodeScoreCutoff),
  )
  const [kCore, setKCore] = useState(String(DEFAULT_MCODE_PARAMETERS.kCore))
  const [maxDepthFromStart, setMaxDepthFromStart] = useState(
    String(DEFAULT_MCODE_PARAMETERS.maxDepthFromStart),
  )
  const [fluffNodeDensityCutoff, setFluffNodeDensityCutoff] = useState(
    String(DEFAULT_MCODE_PARAMETERS.fluffNodeDensityCutoff),
  )
  const [errors, setErrors] = useState<Errors>({})

  // Reset every field back to the defaults each time the dialog is (re)opened,
  // since the component stays mounted between openings.
  useEffect(() => {
    if (!open) return
    setScope(DEFAULT_MCODE_PARAMETERS.scope)
    setIncludeLoops(DEFAULT_MCODE_PARAMETERS.includeLoops)
    setHaircut(DEFAULT_MCODE_PARAMETERS.haircut)
    setFluff(DEFAULT_MCODE_PARAMETERS.fluff)
    setDegreeCutoff(String(DEFAULT_MCODE_PARAMETERS.degreeCutoff))
    setNodeScoreCutoff(String(DEFAULT_MCODE_PARAMETERS.nodeScoreCutoff))
    setKCore(String(DEFAULT_MCODE_PARAMETERS.kCore))
    setMaxDepthFromStart(String(DEFAULT_MCODE_PARAMETERS.maxDepthFromStart))
    setFluffNodeDensityCutoff(String(DEFAULT_MCODE_PARAMETERS.fluffNodeDensityCutoff))
    setErrors({})
  }, [open])

  /**
   * Run every consistency check (mirroring the Java FormattedTextFieldAction
   * bounds) and return the resulting error map. The density cutoff is only
   * checked when fluffing is enabled, since it is otherwise ignored.
   */
  const validate = (): Errors => {
    const next: Errors = {}
    next.degreeCutoff = validateIntGreaterThan(degreeCutoff, 1, 'degree cutoff')
    next.nodeScoreCutoff = validateFraction(nodeScoreCutoff, 'node score cutoff')
    next.kCore = validateIntGreaterThan(kCore, 1, 'K-Core')
    next.maxDepthFromStart = validateIntGreaterThan(maxDepthFromStart, 0, 'maximum depth')
    if (fluff)
      next.fluffNodeDensityCutoff = validateFraction(
        fluffNodeDensityCutoff,
        'fluff node density cutoff',
      )
    // Drop the undefined entries so `errors` only holds real messages.
    ;(Object.keys(next) as NumericField[]).forEach((k) => next[k] === undefined && delete next[k])
    return next
  }

  const handleSubmit = (): void => {
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return

    const parameters: MCODEParameters = {
      scope,
      includeLoops,
      degreeCutoff: Number(degreeCutoff),
      kCore: Number(kCore),
      nodeScoreCutoff: Number(nodeScoreCutoff),
      maxDepthFromStart: Number(maxDepthFromStart),
      haircut,
      fluff,
      fluffNodeDensityCutoff: Number(fluffNodeDensityCutoff),
    }
    onClose()
    onSubmit(parameters)
  }

  // Shared props for the small, right-aligned numeric text fields.
  const numberFieldSx = { width: 90 }

  return (
    <Dialog
      open={open}
      maxWidth="xs"
      fullWidth
      // Escape cancels (same as the Cancel button); backdrop clicks stay inert.
      onClose={(_event, reason) => {
        if (reason === 'escapeKeyDown') {
          onClose()
        }
      }}
    >
      <DialogTitle>New MCODE Analysis</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
          {/* Scope ------------------------------------------------------- */}
          <FormControl
            component="fieldset"
            sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1, px: 2, py: 1 }}
          >
            <FormLabel component="legend" sx={{ px: 0.5 }}>
              Find Clusters
            </FormLabel>
            <RadioGroup
              value={scope}
              onChange={(e) => setScope(e.target.value as MCODEAnalysisScope)}
            >
              {(Object.keys(MCODE_ANALYSIS_SCOPE_LABELS) as MCODEAnalysisScope[]).map((value) => (
                <FormControlLabel
                  key={value}
                  value={value}
                  control={<Radio size="small" />}
                  label={MCODE_ANALYSIS_SCOPE_LABELS[value]}
                />
              ))}
            </RadioGroup>
          </FormControl>

          {/* Network Scoring -------------------------------------------- */}
          <Box
            component="fieldset"
            sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1, px: 2, py: 1, m: 0 }}
          >
            <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>
              Network Scoring
            </Typography>
            <Tooltip title="Self-edges may increase a node's score slightly.">
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={includeLoops}
                    onChange={(e) => setIncludeLoops(e.target.checked)}
                  />
                }
                label="Include Loops"
              />
            </Tooltip>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Degree Cutoff:
              </Typography>
              <Tooltip title="Sets the minimum number of edges for a node to be scored.">
                <TextField
                  size="small"
                  type="number"
                  value={degreeCutoff}
                  onChange={(e) => setDegreeCutoff(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, degreeCutoff: validateIntGreaterThan(degreeCutoff, 1, 'degree cutoff') }))}
                  error={Boolean(errors.degreeCutoff)}
                  helperText={errors.degreeCutoff}
                  sx={numberFieldSx}
                />
              </Tooltip>
            </Box>
          </Box>

          {/* Cluster Finding -------------------------------------------- */}
          <Box
            component="fieldset"
            sx={{ border: (t) => `1px solid ${t.palette.divider}`, borderRadius: 1, px: 2, py: 1, m: 0 }}
          >
            <Typography component="legend" variant="subtitle2" sx={{ px: 0.5 }}>
              Cluster Finding
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Tooltip title="Remove singly connected nodes from clusters.">
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={haircut}
                      onChange={(e) => setHaircut(e.target.checked)}
                    />
                  }
                  label="Haircut"
                />
              </Tooltip>
              <Tooltip title="Expand core cluster by one neighbour shell (applied after the optional haircut).">
                <FormControlLabel
                  control={
                    <Checkbox
                      size="small"
                      checked={fluff}
                      onChange={(e) => setFluff(e.target.checked)}
                    />
                  }
                  label="Fluff"
                />
              </Tooltip>
            </Box>

            {/* Node Density Cutoff is only meaningful when fluffing. */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ mt: 1 }} color={fluff ? 'text.primary' : 'text.disabled'}>
                Node Density Cutoff:
              </Typography>
              <Tooltip title="Limits fluffing by setting the acceptable node density deviance from the core cluster density (allows clusters' edges to overlap).">
                <TextField
                  size="small"
                  type="number"
                  disabled={!fluff}
                  value={fluffNodeDensityCutoff}
                  onChange={(e) => setFluffNodeDensityCutoff(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, fluffNodeDensityCutoff: fluff ? validateFraction(fluffNodeDensityCutoff, 'fluff node density cutoff') : undefined }))}
                  error={Boolean(errors.fluffNodeDensityCutoff)}
                  helperText={errors.fluffNodeDensityCutoff}
                  inputProps={{ step: 0.001 }}
                  sx={numberFieldSx}
                />
              </Tooltip>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Node Score Cutoff:
              </Typography>
              <Tooltip title="Sets the acceptable score deviance from the seed node's score for expanding a cluster (most influential parameter for cluster size).">
                <TextField
                  size="small"
                  type="number"
                  value={nodeScoreCutoff}
                  onChange={(e) => setNodeScoreCutoff(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, nodeScoreCutoff: validateFraction(nodeScoreCutoff, 'node score cutoff') }))}
                  error={Boolean(errors.nodeScoreCutoff)}
                  helperText={errors.nodeScoreCutoff}
                  inputProps={{ step: 0.001 }}
                  sx={numberFieldSx}
                />
              </Tooltip>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ mt: 1 }}>
                K-Core:
              </Typography>
              <Tooltip title="Filters out clusters lacking a maximally inter-connected core of at least k edges per node.">
                <TextField
                  size="small"
                  type="number"
                  value={kCore}
                  onChange={(e) => setKCore(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, kCore: validateIntGreaterThan(kCore, 1, 'K-Core') }))}
                  error={Boolean(errors.kCore)}
                  helperText={errors.kCore}
                  sx={numberFieldSx}
                />
              </Tooltip>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', mt: 1 }}>
              <Typography variant="body2" sx={{ mt: 1 }}>
                Max. Depth:
              </Typography>
              <Tooltip title="Limits the cluster size by setting the maximum search distance from a seed node (100 virtually means no limit).">
                <TextField
                  size="small"
                  type="number"
                  value={maxDepthFromStart}
                  onChange={(e) => setMaxDepthFromStart(e.target.value)}
                  onBlur={() => setErrors((p) => ({ ...p, maxDepthFromStart: validateIntGreaterThan(maxDepthFromStart, 0, 'maximum depth') }))}
                  error={Boolean(errors.maxDepthFromStart)}
                  helperText={errors.maxDepthFromStart}
                  sx={numberFieldSx}
                />
              </Tooltip>
            </Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained">
          Analyze Current Network
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default NewAnalysisDialog
