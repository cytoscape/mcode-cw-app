"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCODE_NAMESPACE = void 0;
exports.formatScore = formatScore;
exports.buildMcodeResultsText = buildMcodeResultsText;
exports.sliceClusterCx2 = sliceClusterCx2;
exports.mcodeColumnName = mcodeColumnName;
exports.mcodeColumnNames = mcodeColumnNames;
exports.buildMcodeNodeTableData = buildMcodeNodeTableData;
/**
 * Score formatted with up to 3 fraction digits, trailing zeros stripped
 * (matches the Java NumberFormat with maximumFractionDigits = 3): e.g.
 * 2.3333 -> "2.333", 2 -> "2", 1.6 -> "1.6".
 */
function formatScore(score) {
    return String(Number(score.toFixed(3)));
}
/**
 * Build the MCODE results report text. The cluster rank is the row's 1-based
 * position in `rows` (which are expected to already be in ranked order).
 *
 * `now` is injectable so the output is deterministic in tests.
 */
function buildMcodeResultsText(parameters, rows, now = new Date()) {
    const p = parameters;
    const lines = [
        'MCODE App Results',
        `Date: ${now.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })}`,
        '',
        'Parameters:',
        '   Network Scoring:',
        `      Include Loops: ${p.includeLoops}  Degree Cutoff: ${p.degreeCutoff}`,
        '   Cluster Finding:',
        `      Node Score Cutoff: ${p.nodeScoreCutoff}  Haircut: ${p.haircut}  Fluff: ${p.fluff}` +
            `  K-Core: ${p.kCore}  Max. Depth from Seed: ${p.maxDepthFromStart}`,
        '',
        'Cluster\tScore (Density*#Nodes)\tNodes\tEdges\tNode IDs',
    ];
    rows.forEach((row, i) => {
        lines.push(`${i + 1}\t${formatScore(row.score)}\t${row.nodeCount}` +
            `\t${row.edgeCount}\t${row.nodeNames.join(', ')}`);
    });
    return lines.join('\n') + '\n';
}
/**
 * Slice a source network's CX2 stream down to a single cluster: keep only the
 * cluster's nodes (with coordinates overridden from `nodePositions` when
 * present, so the importer runs no layout) and the edges whose endpoints are
 * both in the cluster, and fix up the metaData element counts to match.
 *
 * Operates on the loosely-typed CX2 aspect array (`any[]`); the caller casts
 * the result to the cyweb `Cx2` type when handing it to createNetworkFromCx2.
 */
function sliceClusterCx2(cx2, clusterNodeIds, nodePositions) {
    const clusterNodes = new Set(clusterNodeIds);
    let nodeCount = 0;
    let edgeCount = 0;
    const sliced = cx2.map((aspect) => {
        if (Array.isArray(aspect.nodes)) {
            const nodes = aspect.nodes
                .filter((n) => clusterNodes.has(String(n.id)))
                .map((n) => {
                const pos = nodePositions?.[String(n.id)];
                return pos ? { ...n, x: pos.x, y: pos.y } : n;
            });
            nodeCount = nodes.length;
            return { nodes };
        }
        if (Array.isArray(aspect.edges)) {
            const edges = aspect.edges.filter((e) => clusterNodes.has(String(e.s)) && clusterNodes.has(String(e.t)));
            edgeCount = edges.length;
            return { edges };
        }
        return aspect;
    });
    for (const aspect of sliced) {
        if (Array.isArray(aspect.metaData)) {
            for (const meta of aspect.metaData) {
                if (meta.name === 'nodes' && meta.elementCount !== undefined)
                    meta.elementCount = nodeCount;
                if (meta.name === 'edges' && meta.elementCount !== undefined)
                    meta.elementCount = edgeCount;
            }
        }
    }
    return sliced;
}
// ── MCODE node-table columns ────────────────────────────────────────────────
/** Namespace prefixing every MCODE node-table column. */
exports.MCODE_NAMESPACE = 'MCODE';
/**
 * Column name for an MCODE node attribute and result number, e.g.
 * `mcodeColumnName('Score', 1)` -> "MCODE::Score (1)". Mirrors the Java
 * `MCODEUtil.columnName(name, result)`.
 */
function mcodeColumnName(attr, resultNumber) {
    return `${exports.MCODE_NAMESPACE}::${attr} (${resultNumber})`;
}
/** The three node-table column names MCODE creates for a given result. */
function mcodeColumnNames(resultNumber) {
    return [
        mcodeColumnName('Score', resultNumber),
        mcodeColumnName('Node Status', resultNumber),
        mcodeColumnName('Clusters', resultNumber),
    ];
}
/**
 * Build the node-table columns and row values for an MCODE result, mirroring
 * `MCODEAnalyzeTask.createNetworkAttributes()`:
 *   - "MCODE::Score (n)"       (double)          : the node's MCODE score
 *   - "MCODE::Node Status (n)" (string)          : Unclustered | Clustered | Seed
 *   - "MCODE::Clusters (n)"    (list of string)  : e.g. ["Cluster 1", "Cluster 3"]
 *
 * Every scored node gets its score and defaults to "Unclustered"; nodes that
 * belong to clusters accumulate the cluster names and are marked "Seed" (when
 * the cluster's seed) or "Clustered". Nodes not analyzed simply keep the
 * column defaults.
 */
function buildMcodeNodeTableData(resultNumber, clusters, scores) {
    const scoreCol = mcodeColumnName('Score', resultNumber);
    const statusCol = mcodeColumnName('Node Status', resultNumber);
    const clustersCol = mcodeColumnName('Clusters', resultNumber);
    const columns = [
        { name: scoreCol, type: 'double', defaultValue: 0 },
        { name: statusCol, type: 'string', defaultValue: 'Unclustered' },
        { name: clustersCol, type: 'list_of_string', defaultValue: [] },
    ];
    const rows = {};
    // Every analyzed node gets its score and a default "Unclustered" status.
    for (const [nodeId, score] of Object.entries(scores)) {
        rows[nodeId] = { [scoreCol]: score, [statusCol]: 'Unclustered' };
    }
    // Nodes in clusters: accumulate cluster names (insertion order, de-duped) and
    // set the status. As in the Java version, when a node is in multiple clusters
    // the last one processed wins for the status value.
    for (const cluster of clusters) {
        const clusterName = `Cluster ${cluster.rank}`;
        for (const nodeId of cluster.nodes) {
            const row = rows[nodeId] ?? (rows[nodeId] = { [scoreCol]: scores[nodeId] ?? 0 });
            const list = row[clustersCol] ?? [];
            if (!list.includes(clusterName))
                list.push(clusterName);
            row[clustersCol] = list;
            row[statusCol] = cluster.seedId === nodeId ? 'Seed' : 'Clustered';
        }
    }
    return { columns, rows };
}
