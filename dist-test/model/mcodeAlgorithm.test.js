"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for the MCODE TypeScript port.
 *
 * Ported from BaderLab/MCODE's JUnit tests (LGPL v2.1+):
 *   - AbstractMCODETest.createCompleteGraph(int)
 *   - MCODEAlgorithmTest.testCompleteGraphWithDefaultParameters()
 *   - MCODEAlgorithmTest.testCompleteGraphIncludingLoops()
 *   Copyright (c) 2004 Memorial Sloan-Kettering Cancer Center. Code by Gary Bader.
 *
 * Uses Node's built-in test runner (no extra dependencies):
 *   node --test --experimental-strip-types   (or `npm test`)
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const mcodeAlgorithm_1 = require("./mcodeAlgorithm");
const mcodeGraph_1 = require("./mcodeGraph");
/**
 * Build a complete graph K_n as an undirected adjacency map.
 * Mirrors AbstractMCODETest.createCompleteGraph: every distinct pair of nodes
 * is connected exactly once, giving n*(n-1)/2 undirected edges.
 */
function createCompleteGraph(totalNodes) {
    const ids = Array.from({ length: totalNodes }, (_, i) => String(i));
    const adjacency = new Map();
    for (const id of ids) {
        adjacency.set(id, ids.filter((other) => other !== id));
    }
    // Sanity check identical to the Java helper's assertion.
    const edgeCount = new mcodeGraph_1.MCODEGraph(adjacency.keys(), adjacency).edgeCount(false);
    strict_1.default.equal(edgeCount, (totalNodes * (totalNodes - 1)) / 2);
    return adjacency;
}
/** Build the induced subgraph for a cluster's nodes. */
function clusterGraph(cluster, adjacency) {
    return new mcodeGraph_1.MCODEGraph(cluster.nodes, adjacency);
}
(0, node_test_1.default)('complete graph (16 nodes) with default parameters', () => {
    const adjacency = createCompleteGraph(16);
    const alg = new mcodeAlgorithm_1.MCODEAlgorithm();
    const clusters = alg.run(adjacency);
    // Exactly one cluster — the seed consumes the whole complete graph.
    strict_1.default.equal(clusters.length, 1);
    const cluster = clusters[0];
    const cn = clusterGraph(cluster, adjacency);
    strict_1.default.ok(cluster.seedId !== undefined, 'cluster should have a seed node');
    strict_1.default.equal(cluster.score, 16); // density (1.0) * nodeCount (16)
    strict_1.default.equal(cn.nodeCount, 16);
    strict_1.default.equal(cn.edgeCount(false), 120);
    // Every node's score = coreDensity (1.0) * coreLevel (15) = 15.0
    for (const nodeId of cn.nodes) {
        strict_1.default.equal(alg.getNodeScore(nodeId), 15.0);
    }
});
(0, node_test_1.default)('triangle: degree-2 nodes are scored and form a cluster (regression)', () => {
    // A triangle's nodes each have exactly degree 2. With the default degree
    // cutoff of 2 they must still be scored — the neighborhood size counts the
    // node itself (3 > 2). Regression guard for the degree-cutoff off-by-one
    // that previously zeroed every degree-2 node and collapsed sparse networks
    // to a single cluster.
    const adjacency = new Map([
        ['a', ['b', 'c']],
        ['b', ['a', 'c']],
        ['c', ['a', 'b']],
    ]);
    const alg = new mcodeAlgorithm_1.MCODEAlgorithm();
    const clusters = alg.run(adjacency);
    // Each node: coreDensity (1.0) * coreLevel (2) = 2.0
    for (const id of ['a', 'b', 'c']) {
        strict_1.default.equal(alg.getNodeScore(id), 2.0);
    }
    strict_1.default.equal(clusters.length, 1);
    strict_1.default.equal(clusters[0].nodes.length, 3);
    strict_1.default.equal(clusters[0].score, 3); // density (1.0) * nodeCount (3)
});
(0, node_test_1.default)('complete graph (16 nodes) including loops', () => {
    const adjacency = createCompleteGraph(16);
    const alg = new mcodeAlgorithm_1.MCODEAlgorithm({ includeLoops: true });
    const clusters = alg.run(adjacency);
    strict_1.default.equal(clusters.length, 1);
    const cluster = clusters[0];
    const cn = clusterGraph(cluster, adjacency);
    strict_1.default.ok(cluster.seedId !== undefined, 'cluster should have a seed node');
    // density = 120 / (16*17/2 = 136) = 0.88235..., * 16 nodes = 14.1176...
    strict_1.default.ok(Math.abs(cluster.score - 14.118) <= 0.0009, `expected cluster score ~14.118, got ${cluster.score}`);
    strict_1.default.equal(cn.nodeCount, 16);
    strict_1.default.equal(cn.edgeCount(false), 120);
});
