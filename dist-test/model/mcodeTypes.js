"use strict";
/**
 * Type definitions and default parameters for the MCODE algorithm.
 *
 * This is a TypeScript port of the MCODE (Molecular Complex Detection)
 * algorithm by Gary Bader.
 *   - Original paper: Bader GD, Hogue CW. "An automated method for finding
 *     molecular complexes in large protein interaction networks."
 *     BMC Bioinformatics. 2003.
 *   - Original Java source (LGPL v2.1+):
 *     https://github.com/BaderLab/MCODE
 *
 * Ported and adapted under the terms of the GNU Lesser General Public
 * License, version 2.1 or (at your option) any later version.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MCODE_PARAMETERS = void 0;
/** Default MCODE parameters (match the Cytoscape MCODE app). */
exports.DEFAULT_MCODE_PARAMETERS = {
    includeLoops: false,
    degreeCutoff: 2,
    kCore: 2,
    nodeScoreCutoff: 0.2,
    maxDepthFromStart: 100,
    haircut: true,
    fluff: false,
    fluffNodeDensityCutoff: 0.1,
};
