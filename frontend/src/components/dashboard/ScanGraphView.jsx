import EmptyState from '../common/EmptyState';

function getNodeLayout(nodes = [], edges = [], width = 900, height = 420) {
  if (!nodes.length) return [];

  const centerX = width / 2;
  const centerY = height / 2;

  if (nodes.length === 1) {
    return [{ ...nodes[0], x: centerX, y: centerY, angle: 0 }];
  }

  const degree = new Map(nodes.map((node) => [String(node.id), 0]));
  edges.forEach((edge) => {
    const sourceId = String(edge.source);
    const targetId = String(edge.target);
    degree.set(sourceId, (degree.get(sourceId) || 0) + 1);
    degree.set(targetId, (degree.get(targetId) || 0) + 1);
  });

  const sorted = [...nodes].sort((a, b) => (degree.get(String(b.id)) || 0) - (degree.get(String(a.id)) || 0));
  const anchor = sorted[0];
  const others = sorted.slice(1);

  const positioned = [{ ...anchor, x: centerX, y: centerY, angle: 0 }];
  const ringCapacities = [8, 12, 18];
  const baseRadius = Math.max(115, Math.min(width, height) * 0.25);

  let offset = 0;
  for (let ringIndex = 0; ringIndex < ringCapacities.length && offset < others.length; ringIndex += 1) {
    const cap = ringCapacities[ringIndex];
    const chunk = others.slice(offset, offset + cap);
    const radius = baseRadius + ringIndex * 70;
    const angleOffset = ringIndex % 2 === 0 ? -Math.PI / 2 : -Math.PI / 2 + Math.PI / 8;

    chunk.forEach((node, index) => {
      const angle = (index / Math.max(chunk.length, 1)) * Math.PI * 2 + angleOffset;
      positioned.push({
        ...node,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle),
        angle,
      });
    });

    offset += chunk.length;
  }

  return positioned;
}

function nodeColor(type = '') {
  const normalized = String(type || '').toLowerCase();
  if (normalized.includes('domain')) return '#4aa5d5';
  if (normalized.includes('api')) return '#4bc399';
  if (normalized.includes('certificate')) return '#f2b36d';
  if (normalized.includes('ip')) return '#8f91d9';
  return '#6f9fb7';
}

function buildGraphDescription(nodes = [], edges = []) {
  const relationTypeCount = edges.reduce((acc, edge) => {
    const type = String(edge.type || 'related').replace(/_/g, ' ').toLowerCase();
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  const topRelations = Object.entries(relationTypeCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);

  const line1 = `This graph maps ${nodes.length} nodes linked through ${edges.length} relationships discovered for this scan.`;

  const line2 = topRelations.length
    ? `Most connections represent ${topRelations.join(' and ')} across domains, endpoints, certificates, and cryptographic signals.`
    : 'Nodes represent discovered assets and security signals; no direct relationships were recorded in this scan output.';

  return { line1, line2 };
}

export default function ScanGraphView({ graph, loading, error }) {
  if (loading) {
    return (
      <div className="loader-wrap">
        <div className="loader" />
        <span>Loading scan graph...</span>
      </div>
    );
  }

  if (error) {
    return <div className="error-banner">{error}</div>;
  }

  const nodes = Array.isArray(graph?.nodes) ? graph.nodes.slice(0, 18) : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];

  if (!nodes.length) {
    return (
      <EmptyState
        title="No graph nodes yet"
        description="Run another scan or discovery workflow to build node-edge relations for this scan."
      />
    );
  }

  const width = 900;
  const height = 420;
  const positionedNodes = getNodeLayout(nodes, edges, width, height);
  const nodeById = new Map(positionedNodes.map((item) => [String(item.id), item]));

  const visibleEdges = edges.filter(
    (edge) => nodeById.has(String(edge.source)) && nodeById.has(String(edge.target))
  );
  const description = buildGraphDescription(positionedNodes, visibleEdges);

  return (
    <div className="scan-graph-wrap">
      <div className="scan-graph-stats">
        <span className="badge">Nodes: {nodes.length}</span>
        <span className="badge">Edges: {visibleEdges.length}</span>
      </div>

      <div className="scan-graph-description">
        <p>{description.line1}</p>
        <p>{description.line2}</p>
      </div>

      <div className="scan-graph-canvas">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Scan graph">
          {visibleEdges.map((edge) => {
            const source = nodeById.get(String(edge.source));
            const target = nodeById.get(String(edge.target));
            if (!source || !target) return null;

            return (
              <line
                key={edge.id}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className="scan-graph-edge"
              />
            );
          })}

          {positionedNodes.map((node) => (
            <g key={node.id}>
              <circle cx={node.x} cy={node.y} r="13" fill={nodeColor(node.type)} className="scan-graph-node" />
              <text
                x={node.x}
                y={node.y + (node.y < height / 2 ? 30 : -20)}
                textAnchor="middle"
                className="scan-graph-label"
              >
                {String(node.label || node.type || 'node').slice(0, 18)}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
