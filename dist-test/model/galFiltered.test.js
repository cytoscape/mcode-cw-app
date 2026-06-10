"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * MCODE regression test against the real galFiltered network (Cytoscape sample
 * data). Locks in parity with the original Java MCODE implementation, which —
 * with default parameters — finds 7 clusters with sizes [4,5,3,3,3,3,4] and
 * scores [3.333, 3, 3, 3, 3, 3, 2.667].
 *
 * The expected clusters below are keyed by stable gene labels; they were
 * validated against the Java output (identical cluster count, size multiset
 * and score multiset). Clusters are compared as an unordered set so that the
 * arbitrary ordering of equal-scored clusters does not make the test brittle.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const mcodeAlgorithm_1 = require("./mcodeAlgorithm");
const galFilteredEdges_1 = require("./__fixtures__/galFilteredEdges");
/** Build an undirected adjacency map from a list of label pairs. */
function buildAdjacency(edges) {
    const adjacency = new Map();
    const link = (a, b) => {
        const neighbors = adjacency.get(a) ?? [];
        if (a !== b && !neighbors.includes(b))
            neighbors.push(b);
        adjacency.set(a, neighbors);
    };
    for (const [a, b] of edges) {
        link(a, b);
        link(b, a);
    }
    return adjacency;
}
/** Canonical signature for a cluster: score + sorted gene labels. */
function signature(score, nodes) {
    return `${score.toFixed(3)}::${[...nodes].sort().join(',')}`;
}
// Expected clusters (gene labels), validated against the Java MCODE output.
const EXPECTED = [
    { score: 3.3333333333333335, nodes: ['YBL021C', 'YGL237C', 'YJR048W', 'YKL109W'] },
    { score: 3, nodes: ['YAL040C', 'YBR160W', 'YGR108W', 'YJL157C', 'YMR043W'] },
    { score: 3, nodes: ['YCL032W', 'YDR103W', 'YLR362W'] },
    { score: 3, nodes: ['YDL014W', 'YLR197W', 'YOR310C'] },
    { score: 3, nodes: ['YDR100W', 'YGL161C', 'YOR036W'] },
    { score: 3, nodes: ['YMR309C', 'YOR361C', 'YPR041W'] },
    { score: 2.6666666666666665, nodes: ['YAL003W', 'YBR118W', 'YLR249W', 'YPR080W'] },
];
(0, node_test_1.default)('galFiltered: 7 clusters matching the Java MCODE output (default params)', () => {
    const adjacency = buildAdjacency(galFilteredEdges_1.GAL_FILTERED_EDGES);
    const clusters = new mcodeAlgorithm_1.MCODEAlgorithm().run(adjacency);
    // Cluster count and the multiset of sizes match the Java result.
    strict_1.default.equal(clusters.length, 7);
    strict_1.default.deepEqual(clusters.map((c) => c.nodes.length).sort((a, b) => a - b), [3, 3, 3, 3, 4, 4, 5]);
    // Exact membership + score, compared as an unordered set of clusters.
    const actual = new Set(clusters.map((c) => signature(c.score, c.nodes)));
    const expected = new Set(EXPECTED.map((c) => signature(c.score, c.nodes)));
    strict_1.default.deepEqual(actual, expected);
    // Every cluster's seed must be one of its own member nodes.
    for (const c of clusters) {
        strict_1.default.ok(c.nodes.includes(c.seedId), `seed ${c.seedId} not in its cluster`);
    }
});
