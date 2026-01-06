export type DiagramCanvas = {
  width: number;
  height: number;
  background?: string;
};

export type DiagramNode = {
  id: string;
  x?: number;
  y?: number; // top-left position in canvas coords
  width: number;
  height: number;
  label?: string;
  iconSrc?: string;
  color?: string;
  markdown?: string;
};

export type DiagramEdge = {
  id: string;
  from: string;
  to: string;
  label?: string;
  color?: string;
  width?: number;
  markdown?: string;
};

export type DiagramConfig = {
  canvas: DiagramCanvas;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

// Assets
import poleLocationsPng from './assets/pole_locations.png';
import lidarSource from './assets/lidar_source.png';
import databricks from './assets/databricks.png';
import delta from './assets/deltalake.png';
// Markdown (loaded via Vite raw glob)
const mdFiles = import.meta.glob('./md/*.md', { as: 'raw', eager: true }) as Record<string, string>;
const md = (name: string) => mdFiles[`./md/${name}.md`] || '';

// Example backend data-flow diagram. Adjust positions/sizes as desired.
export const diagram: DiagramConfig = {
  canvas: { width: 2000, height: 1200, background: '#0b1220' },
  nodes: [
    { id: 'laz', x: 80, y: 120, width: 180, height: 100, label: 'LAZ Files', iconSrc: lidarSource, color: '#1f2937', markdown: md('laz') },
    { id: 'dbx_lidar_ingest', x: 360, y: 110, width: 240, height: 120, label: 'Ingest Lidar',iconSrc: databricks, color: '#b91c1c', markdown: md('dbx_lidar_ingest') },
    {id: 'dbx_poles_ingest', width: 240, height: 120, label: 'Ingest Poles', iconSrc: databricks, color: '#b91c1c', markdown: md('dbx_poles_ingest') },
    { id: 'lidar_raw_delta', x: 680, y: 100, width: 230, height: 100, label: 'Delta: lidar_raw', iconSrc: delta, color: '#0e7490', markdown: md('lidar_delta') },
    { id: 'poles_src', x: 80, y: 360, width: 200, height: 120, label: 'Pole Location', iconSrc: poleLocationsPng, color: '#1f2937', markdown: md('poles_src') },
    { id: 'poles_delta', x: 680, y: 350, width: 230, height: 100, label: 'Delta: poles', iconSrc: delta, color: '#0e7490', markdown: md('poles_delta') },
    { id: 'join', x: 980, y: 220, width: 200, height: 100, label: 'Join LiDAR ↔ Poles', iconSrc:databricks, color: '#334155', markdown: md('join') },
    { id: 'clip', x: 1220, y: 220, width: 200, height: 100, label: 'Clip LiDAR', iconSrc:delta, color: '#334155', markdown: md('clip') },
    { id: 'cluster', x: 1460, y: 220, width: 220, height: 100, label: 'Simple Clustering', iconSrc:databricks, color: '#334155', markdown: md('cluster') },
    { id: 'delta_out', x: 1720, y: 220, width: 230, height: 100, label: 'Clustered Points', iconSrc:delta, color: '#0e7490', markdown: md('delta_out') }
  ],
  edges: [
    { id: 'e1', from: 'laz', to: 'dbx_lidar_ingest', markdown: md('e1') },
    { id: 'e2', from: 'dbx_lidar_ingest', to: 'lidar_raw_delta', markdown: md('e2') },
    { id: 'e3', from: 'poles_src', to: 'dbx_poles_ingest', markdown: md('e3') },
    { id: 'e4', from: 'lidar_raw_delta', to: 'join', markdown: md('e4') },
    { id: 'e5', from: 'poles_delta', to: 'join', markdown: md('e5') },
    { id: 'e6', from: 'join', to: 'clip', markdown: md('e6') },
    { id: 'e7', from: 'clip', to: 'cluster', markdown: md('e7') },
    { id: 'e8', from: 'cluster', to: 'delta_out', markdown: md('e8') },
    {id: 'e9', from: 'poles_src', to: 'dbx_poles_ingest'},
    {id: 'e9', from: 'dbx_poles_ingest', to: 'poles_delta'}
  ]
};


