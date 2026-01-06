import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ReactFlow, { Background, Controls, MarkerType, Node, Edge, Position, NodeProps, Handle } from 'reactflow';
import dagre from 'dagre';
import 'reactflow/dist/style.css';
import { diagram, DiagramNode, DiagramEdge } from '../architecture/config';

type HoverTarget =
  | { kind: 'node'; node: DiagramNode }
  | { kind: 'edge'; edge: DiagramEdge };

export default function Architecture() {
  const [hover, setHover] = React.useState<HoverTarget | null>(null);
  const [mousePos, setMousePos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const onMouseMoveRoot = (e: React.MouseEvent) => {
    setMousePos({ x: e.clientX + 12, y: e.clientY + 12 });
  };
  const onMouseLeaveRoot = () => {
    setHover(null);
  };

  const ImageNode: React.FC<NodeProps<DiagramNode>> = ({ data }) => {
    const node = data as DiagramNode;
    return (
      <div onMouseEnter={() => setHover({ kind: 'node', node })} onMouseLeave={() => setHover(null)} style={{ pointerEvents: 'auto' }}>
        <Handle type="target" position={Position.Left} style={{ opacity: 0, width: 8, height: 8 }} />
        <Handle type="source" position={Position.Right} style={{ opacity: 0, width: 8, height: 8 }} />
        <div style={{ width: node.width, height: node.height, background: 'transparent' }}>
          {node.iconSrc ? (
            <img src={node.iconSrc} alt={node.label || node.id} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ width: '100%', height: '100%', background: node.color || '#1f2a3c', borderRadius: 10 }} />
          )}
        </div>
        {(node.label || node.id) && (
          <div style={{ textAlign: 'center', marginTop: 6, color: '#e2e8f0', fontSize: 25, pointerEvents: 'none' }}>{node.label || node.id}</div>
        )}
      </div>
    );
  };

  const tooltip = (() => {
    if (!hover) return null;
    const md = hover.kind === 'node' ? hover.node.markdown : hover.edge.markdown;
    if (!md) return null;
    return (
      <div style={{ position: 'fixed', left: mousePos.x, top: mousePos.y, zIndex: 2000, pointerEvents: 'none' }}>
        <div style={{ background: 'white', color: '#0f172a', borderRadius: 8, padding: '10px 12px', boxShadow: '0 8px 24px rgba(0,0,0,0.2)', maxWidth: 320, border: '1px solid #e5e7eb' }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{md}</ReactMarkdown>
        </div>
      </div>
    );
  })();

  return (
    <div style={{ position: 'absolute', inset: 0, background: diagram.canvas.background || '#0b1220' }} onMouseMove={onMouseMoveRoot} onMouseLeave={onMouseLeaveRoot}>
      <ReactFlow
        nodes={(function layout() {
          const g = new dagre.graphlib.Graph();
          g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 });
          g.setDefaultEdgeLabel(() => ({}));
          for (const n of diagram.nodes) {
            g.setNode(n.id, { width: n.width, height: n.height });
          }
          for (const e of diagram.edges) {
            g.setEdge(e.from, e.to);
          }
          dagre.layout(g);
          const nodes: Node[] = diagram.nodes.map((n) => {
            const pos = g.node(n.id);
            const x = (pos?.x ?? n.x) - n.width / 2;
            const y = (pos?.y ?? n.y) - n.height / 2;
            return { id: n.id, type: 'imageNode', position: { x, y }, data: n, width: n.width, height: n.height } as Node;
          });
          return nodes;
        })()}
        edges={diagram.edges.map<Edge>((e) => ({ id: e.id, source: e.from, target: e.to, label: e.label, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: e.color || '#94a3b8' }, data: e }))}
        nodeTypes={{ imageNode: ImageNode }}
        panOnDrag={true}
        zoomOnScroll={true}
        zoomOnPinch={true}
        zoomOnDoubleClick={false}
        fitView={false}
        proOptions={{ hideAttribution: true }}
        onNodeMouseEnter={(_, node) => setHover({ kind: 'node', node: node.data as DiagramNode })}
        onNodeMouseLeave={() => setHover(null)}
        onEdgeMouseEnter={(_, edge) => setHover({ kind: 'edge', edge: edge.data as DiagramEdge })}
        onEdgeMouseLeave={() => setHover(null)}
      >
        <Background />
        <Controls position="bottom-right" />
      </ReactFlow>
      {tooltip}
    </div>
  );
}


