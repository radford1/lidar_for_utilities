import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import MapGL, { NavigationControl } from 'react-map-gl';
import DeckGL from '@deck.gl/react';
import { OrbitView, COORDINATE_SYSTEM } from '@deck.gl/core';
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import { LineLayer, PathLayer, PointCloudLayer, ScatterplotLayer } from '@deck.gl/layers';
import PoleInfoPanel from './components/PoleInfoPanel';
import { generateRadarFrames, type RadarCell } from './utils/weatherRadar';

type LidarPoint = { x: number; y: number; z: number; classification?: number; lat?: number; lng?: number; is_encroaching?: boolean };
type Pole = { pole_id: string; lat: number; lng: number; height_m: number; connects_to?: string; line_sag?: number };
type Segment = { source: [number, number, number]; target: [number, number, number] };
type Conductor = { path: [number, number, number][], color: [number, number, number, number] };
type PoleSegment = { pole_id: string; source: [number, number, number]; target: [number, number, number] };

export default function App() {
  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [viewState, setViewState] = useState({
    latitude: 38.460145650299935,
    longitude: -121.17960993799349,
    zoom: 10,
    bearing: 0,
    pitch: 0
  });
  const [h3, setH3] = useState<string[]>([]);
  const [selectedH3s, setSelectedH3s] = useState<Set<string>>(new Set());
  const [points, setPoints] = useState<LidarPoint[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [poles, setPoles] = useState<Pole[]>([]);
  const [rendering3d, setRendering3d] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [showEncroachment, setShowEncroachment] = useState(false);
  const [showFireRisk, setShowFireRisk] = useState(false);
  const [showVegIcons, setShowVegIcons] = useState(false);
  const [fireRiskThreshold, setFireRiskThreshold] = useState<number>(0);
  const [hoverHex, setHoverHex] = useState<string | null>(null);
  const [hoverVisible, setHoverVisible] = useState(false);
  const [hoverPos, setHoverPos] = useState<{x:number;y:number}>({x:0,y:0});
  const hoverTimerRef = React.useRef<number | null>(null);
  const [pulse, setPulse] = useState(0);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{role:'user'|'assistant'; content:string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatSending, setChatSending] = useState(false);
  const [chatConversationId, setChatConversationId] = useState<string | null>(null);
  const [selectedPoleId, setSelectedPoleId] = useState<string | null>(null);

  // Weather radar state
  const [showRadar, setShowRadar] = useState(false);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [radarFrame, setRadarFrame] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        console.log('fetching config');
        const res = await fetch('/api/config');
        const json = await res.json();
        if (json && typeof json.mapboxToken === 'string') {
          setMapboxToken(json.mapboxToken);
        } else {
          setMapboxToken('');
        }
      } catch {
        setMapboxToken('');
      }
    })();
  }, []);

  const escapeHtml = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // Minimal markdown renderer with safe escaping
  const mdToHtml = (md: string) => {
    if (!md) return '';
    const codeBlocks: string[] = [];
    const inlineCodes: string[] = [];
    let work = String(md);
    // Extract fenced code blocks first
    work = work.replace(/```([\s\S]*?)```/g, (_, p1) => {
      const idx = codeBlocks.length;
      codeBlocks.push(`<pre style=\"background:#0f172a;color:#e2e8f0;padding:8px;border-radius:6px;overflow:auto\"><code>${escapeHtml(p1)}</code></pre>`);
      return `@@CODEBLOCK_${idx}@@`;
    });
    // Extract inline code
    work = work.replace(/`([^`]+?)`/g, (_, p1) => {
      const idx = inlineCodes.length;
      inlineCodes.push(`<code style=\"background:#e2e8f0;padding:2px 4px;border-radius:4px\">${escapeHtml(p1)}</code>`);
      return `@@INLINECODE_${idx}@@`;
    });
    // Escape remaining
    work = escapeHtml(work);
    // Links [text](url)
    work = work.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, p1, p2) => `<a href=\"${p2}\" target=\"_blank\" rel=\"noopener noreferrer\">${p1}</a>`);
    // Bold then italic
    work = work.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    work = work.replace(/\*(?!\*)([^*]+)\*/g, '<em>$1</em>');
    // Line breaks
    work = work.replace(/\n/g, '<br/>');
    // Restore inline code and code blocks
    work = work.replace(/@@INLINECODE_(\d+)@@/g, (_, i) => inlineCodes[Number(i)] || '');
    work = work.replace(/@@CODEBLOCK_(\d+)@@/g, (_, i) => codeBlocks[Number(i)] || '');
    return work;
  };
  const [showWoMenu, setShowWoMenu] = useState(false);
  const [woMenuPos, setWoMenuPos] = useState<{x:number;y:number}>({x:0,y:0});
  const [woHex, setWoHex] = useState<string | null>(null);
  const [woNote, setWoNote] = useState('');
  const [woSubmitting, setWoSubmitting] = useState(false);
  const [woResult, setWoResult] = useState<string | null>(null);

  const [encroachingH3, setEncroachingH3] = useState<Set<string>>(new Set());
  const [fireRiskMap, setFireRiskMap] = useState<Map<string, number>>(new Map());
  const [vegIndexMap, setVegIndexMap] = useState<Map<string, number>>(new Map());
  const [centroidMap, setCentroidMap] = useState<Map<string, [number, number]>>(new Map()); // hex -> [lat,lng]
  const [fireRiskRange, setFireRiskRange] = useState<{min:number;max:number}>({min:0,max:1});
  useEffect(() => {
    (async () => {
      const res = await fetch('/api/h3');
      const data = await res.json();
      setH3(data.h3 || []);
      setEncroachingH3(new globalThis.Set<string>((data.encroaching || []) as string[]));
      const fr: Record<string, number> = data.fireRisk || {};
      const entries = Object.entries(fr).map(([k,v]) => [k, Number(v)] as [string, number]);
      setFireRiskMap(new globalThis.Map(entries));
      const viRaw: Record<string, number> = (data.vegIndex || data.veg_index || {}) as Record<string, number>;
      const viEntries = Object.entries(viRaw).map(([k,v]) => [k, Number(v)] as [string, number]);
      setVegIndexMap(new globalThis.Map(viEntries));
      const centroidsRaw: Record<string, [number, number]> = data.centroids || {};
      const centEntries = Object.entries(centroidsRaw).map(([k,v]) => [k, [Number(v[0]), Number(v[1])] as [number, number]] as [string, [number, number]]);
      setCentroidMap(new globalThis.Map(centEntries));
      if (entries.length) {
        const vals = entries.map(([,v]) => v);
        const min = Math.min(...vals);
        const max = Math.max(...vals);
        setFireRiskRange({min, max: max === min ? min + 1 : max});
        setFireRiskThreshold(min);
      } else {
        setFireRiskRange({min:0,max:1});
        setFireRiskThreshold(0);
      }
    })();
  }, []);

  useEffect(() => {
    let raf = 0 as unknown as number;
    let start = 0;
    const animate = (t: number) => {
      if (!start) start = t;
      const elapsed = t - start;
      const s = (Math.sin((elapsed / 600) * Math.PI * 2) + 1) / 2; // 0..1 over ~0.6s (faster)
      setPulse(s);
      raf = window.requestAnimationFrame(animate);
    };
    raf = window.requestAnimationFrame(animate);
    return () => { window.cancelAnimationFrame(raf); };
  }, []);

  const selectedH3List = useMemo(() => Array.from(selectedH3s), [selectedH3s]);

  const h3Layer = useMemo(() => new H3HexagonLayer({
    id: 'h3-cells',
    data: h3,
    pickable: true,
    extruded: false,
    filled: true,
    stroked: true,
    lineWidthUnits: 'pixels',
    lineWidthMinPixels: 1,
    getHexagon: (d: string) => d,
    getFillColor: (d: string) => {
      if (selectedH3s.has(d)) {
        return [0, 220, 255, 150];
      }
      if (showFireRisk && fireRiskMap.has(d)) {
        const v = fireRiskMap.get(d)!;
        const t = Math.max(0, Math.min(1, (v - fireRiskRange.min) / (fireRiskRange.max - fireRiskRange.min)));
        const idx = Math.min(3, Math.max(0, Math.floor(t * 4)));
        const palette: [number, number, number][] = [
          [0, 180, 0],     // green
          [255, 215, 0],   // yellow
          [255, 140, 0],   // orange
          [220, 0, 0]      // red
        ];
        const [r, g, b] = palette[idx];
        return [r, g, b, 70]; // dimmer, more transparent
      }
      return [0, 128, 255, 80];
    },
    getLineColor: (d: string) => {
      if (selectedH3s.has(d)) {
        return [255, 255, 255, 255];
      }
      if (showEncroachment && encroachingH3.has(d)) {
        const alpha = Math.round(160 + 95 * pulse); // 160..255 (brighter)
        return [255, 0, 0, alpha];
      }
      return [30, 60, 90, 120];
    },
    getLineWidth: (d: string) => {
      if (selectedH3s.has(d)) {
        return 3;
      }
      if (showEncroachment && encroachingH3.has(d)) {
        return 3 + 2 * pulse; // 3..5 px (thicker)
      }
      return 1;
    },
    updateTriggers: { getFillColor: [selectedH3s, showFireRisk, fireRiskMap, fireRiskRange.min, fireRiskRange.max], getLineColor: [showEncroachment, encroachingH3, pulse], getLineWidth: [showEncroachment, encroachingH3, pulse], onHover: [showWoMenu] },
    onHover: (info) => {
      if (showWoMenu) {
        if (hoverTimerRef.current !== null) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        setHoverVisible(false);
        return;
      }
      const hex = info.object as string | null;
      setHoverPos({ x: info.x ?? 0, y: info.y ?? 0 });
      if (!hex) {
        if (hoverTimerRef.current !== null) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
        setHoverVisible(false);
        setHoverHex(null);
        return;
      }
      if (hoverHex !== hex) {
        setHoverHex(hex);
        setHoverVisible(false);
        if (hoverTimerRef.current !== null) { window.clearTimeout(hoverTimerRef.current); }
        hoverTimerRef.current = window.setTimeout(() => {
          setHoverVisible(true);
        }, 1000);
      }
    },
    onClick: (info, _event) => {
      if (info.object) {
        const h3Hex = info.object as string;
          // Right-click: open workorder popup instead of selection
          const ev: any = _event as any;
          const isRight = !!(ev && (ev.rightButton || ev.srcEvent?.button === 2 || ev.srcEvent?.which === 3));
          if (isRight) {
            ev.preventDefault?.();
            if (hoverTimerRef.current !== null) { window.clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null; }
            setHoverVisible(false);
            setHoverHex(null);
            setWoHex(h3Hex);
            setWoMenuPos({ x: info.x ?? 0, y: info.y ?? 0 });
            setShowWoMenu(true);
            setWoResult(null);
            return;
          }
          setSelectedH3s((prev) => {
            const next = new Set(prev);
            if (next.has(h3Hex)) {
              next.delete(h3Hex);
            } else {
              next.add(h3Hex);
            }
            return next;
          });
      }
    }
  }), [h3, selectedH3s, showEncroachment, showFireRisk, encroachingH3, fireRiskMap, fireRiskRange.min, fireRiskRange.max, hoverHex, pulse, showWoMenu]);

  const vegIconLayer = useMemo(() => {
    if (!showVegIcons) return null as any;
    const data: Array<{position: [number, number]}> = [];
    vegIndexMap.forEach((val, hex) => {
      if (val > 75 && centroidMap.has(hex)) {
        const [lat, lng] = centroidMap.get(hex)!;
        data.push({ position: [lng, lat] });
      }
    });
    if (!data.length) return null as any;
    return new ScatterplotLayer<{position: [number, number]}>({
      id: 'veg-icons',
      data,
      coordinateSystem: COORDINATE_SYSTEM.LNGLAT,
      getPosition: d => d.position,
      getFillColor: [34, 139, 34, 230],
      getLineColor: [255, 255, 255, 220],
      getLineWidth: 1,
      stroked: true,
      radiusUnits: 'pixels',
      radiusMinPixels: 6,
      radiusMaxPixels: 10,
      pickable: false
    });
  }, [showVegIcons, vegIndexMap, centroidMap]);

  // --- Weather radar frames (generated once) ---
  const radarFrames = useMemo(() => generateRadarFrames(38.460, -121.180, 24), []);

  // Auto-play when radar is toggled on
  useEffect(() => {
    if (showRadar) {
      setRadarPlaying(true);
      setRadarFrame(0);
    } else {
      setRadarPlaying(false);
    }
  }, [showRadar]);

  // Advance frames — pauses briefly on last frame before looping
  useEffect(() => {
    if (!showRadar || !radarPlaying) return;
    const isLast = radarFrame === radarFrames.length - 1;
    const delay = isLast ? 1400 : 500;
    const timeout = setTimeout(() => {
      setRadarFrame((f) => (f + 1) % radarFrames.length);
    }, delay);
    return () => clearTimeout(timeout);
  }, [showRadar, radarPlaying, radarFrame, radarFrames.length]);

  // Radar ScatterplotLayer
  const radarLayer = useMemo(() => {
    if (!showRadar) return null as any;
    return new ScatterplotLayer<RadarCell>({
      id: 'weather-radar',
      data: radarFrames[radarFrame] || [],
      getPosition: (d: RadarCell) => d.position,
      getFillColor: (d: RadarCell) => d.color,
      getRadius: 450,
      radiusUnits: 'meters' as const,
      radiusMinPixels: 2,
      pickable: false,
    });
  }, [showRadar, radarFrame, radarFrames]);

  const centered = useMemo(() => {
    if (!points || points.length === 0) return { data: [], centroid: [0, 0, 0] as [number, number, number] };
    const sum = points.reduce((acc, p) => {
      acc[0] += p.x; acc[1] += p.y; acc[2] += p.z; return acc;
    }, [0, 0, 0] as [number, number, number]);
    const centroid: [number, number, number] = [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length];
    const data = points.map(p => ({
      x: p.x - centroid[0],
      y: p.y - centroid[1],
      z: p.z - centroid[2],
      classification: p.classification,
      is_encroaching: p.is_encroaching
    }));
    return { data, centroid };
  }, [points]);

  function haversineMeters(lat1?: number, lon1?: number, lat2?: number, lon2?: number): number {
    if (!Number.isFinite(lat1 as number) || !Number.isFinite(lon1 as number) || !Number.isFinite(lat2 as number) || !Number.isFinite(lon2 as number)) return Number.POSITIVE_INFINITY;
    const R = 6371000; // meters
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad((lat2 as number) - (lat1 as number));
    const dLon = toRad((lon2 as number) - (lon1 as number));
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1 as number)) * Math.cos(toRad(lat2 as number)) * Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Compute pole positions (base and top) for 3D rendering — combines old poleSegments + poleTops
  const poleTops = useMemo(() => {
    if (!poles.length || !points.length) return {} as Record<string, { centered: [number, number, number]; base: [number, number, number]; lat: number; lng: number; line_sag?: number; height_m: number }>;
    const groundPoints = points.filter(p => p.classification === 2);

    const median = (arr: number[]) => {
      if (!arr.length) return undefined;
      const s = [...arr].sort((a,b)=>a-b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };

    const groundZMedian = median(groundPoints.map(p => p.z));
    const minZ = points.reduce((m, p) => Math.min(m, p.z), Number.POSITIVE_INFINITY);

    const nearestPointIdx = (lat: number, lng: number) => {
      let bestIdx = -1;
      let bestDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < points.length; i++) {
        const d = haversineMeters(lat, lng, points[i].lat, points[i].lng);
        if (d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx;
    };

    const nearestGroundZ = (lat: number, lng: number) => {
      let bestZ: number | undefined = undefined;
      let bestDist = 50.0001;
      for (let i = 0; i < groundPoints.length; i++) {
        const gp = groundPoints[i];
        const d = haversineMeters(lat, lng, gp.lat, gp.lng);
        if (d < bestDist) {
          bestDist = d;
          bestZ = gp.z;
        }
      }
      if (bestZ !== undefined) return bestZ;
      if (groundZMedian !== undefined) return groundZMedian;
      if (Number.isFinite(minZ)) return minZ;
      return 0;
    };

    const map: Record<string, { centered: [number, number, number]; base: [number, number, number]; lat: number; lng: number; line_sag?: number; height_m: number }> = {};
    for (const pole of poles) {
      const idx = nearestPointIdx(pole.lat, pole.lng);
      if (idx === -1) continue;
      const baseZ = nearestGroundZ(pole.lat, pole.lng);
      const topZ = baseZ + pole.height_m;
      const cx = points[idx].x - centered.centroid[0];
      const cy = points[idx].y - centered.centroid[1];
      const czBase = baseZ - centered.centroid[2];
      const czTop = topZ - centered.centroid[2];
      map[pole.pole_id] = { centered: [cx, cy, czTop], base: [cx, cy, czBase], lat: pole.lat, lng: pole.lng, line_sag: pole.line_sag, height_m: pole.height_m };
    }
    return map;
  }, [poles, points, centered.centroid]);

  // Data for pole LineLayer — vertical segments from base to top, with pole_id for picking
  const poleSegmentsData = useMemo<PoleSegment[]>(() => {
    return Object.entries(poleTops).map(([pole_id, data]) => ({
      pole_id,
      source: data.base as [number, number, number],
      target: data.centered as [number, number, number],
    }));
  }, [poleTops]);

  // Crossarm segments — horizontal beams near the top of each pole, perpendicular to conductor direction
  const crossarmSegments = useMemo<Segment[]>(() => {
    if (!poles.length || !Object.keys(poleTops).length) return [];
    const segments: Segment[] = [];

    for (const pole of poles) {
      const top = poleTops[pole.pole_id];
      if (!top) continue;

      // Determine conductor direction from this pole to find crossarm perpendicular
      let dx = 1, dy = 0;
      if (pole.connects_to) {
        const targets = String(pole.connects_to).split(',').map(s => s.trim()).filter(Boolean);
        for (const t of targets) {
          if (poleTops[t]) {
            const other = poleTops[t];
            dx = other.centered[0] - top.centered[0];
            dy = other.centered[1] - top.centered[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len > 0) { dx /= len; dy /= len; }
            break;
          }
        }
      }

      // Crossarm perpendicular to conductor direction
      const perpX = -dy;
      const perpY = dx;
      const armHalf = 1.2; // half-length of crossarm — extends past outer conductor positions
      const crossZ = top.centered[2] - 0.5; // just below pole top

      segments.push({
        source: [top.centered[0] - perpX * armHalf, top.centered[1] - perpY * armHalf, crossZ],
        target: [top.centered[0] + perpX * armHalf, top.centered[1] + perpY * armHalf, crossZ],
      });
    }
    return segments;
  }, [poles, poleTops]);

  // Three-phase conductor catenary curves — 3 parallel wires per span
  const conductors = useMemo(() => {
    const edges = new Set<string>();
    const paths: Conductor[] = [];
    const ids = Object.keys(poleTops);
    if (!ids.length) return paths;

    const idToPole: Record<string, Pole> = Object.fromEntries(poles.map((p) => [p.pole_id, p] as [string, Pole]));

    const phaseColors: [number, number, number, number][] = [
      [40, 40, 40, 255],    // Phase A — dark charcoal
      [70, 70, 70, 255],    // Phase B — medium dark gray
      [50, 50, 50, 255],    // Phase C — near-black
    ];
    const conductorOffsets = [-0.9, 0, 0.9]; // lateral offset in meters per phase

    for (const pole of poles) {
      if (!pole.connects_to) continue;
      const targets = String(pole.connects_to)
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      for (const t of targets) {
        if (!poleTops[pole.pole_id] || !poleTops[t]) continue;
        const a = pole.pole_id < t ? pole.pole_id : t;
        const b = pole.pole_id < t ? t : pole.pole_id;
        const key = `${a}|${b}`;
        if (edges.has(key)) continue;
        edges.add(key);

        const A = poleTops[a];
        const B = poleTops[b];
        const poleA = idToPole[a];
        const poleB = idToPole[b];
        const dist = haversineMeters(A.lat, A.lng, B.lat, B.lng);
        const sagA = poleA?.line_sag;
        const sagB = poleB?.line_sag;
        const sagMeters = Number.isFinite(sagA as number) && Number.isFinite(sagB as number)
          ? ((sagA as number) + (sagB as number)) / 2
          : dist * 0.02;

        // Perpendicular direction for lateral conductor offset (in xy plane)
        const spanDx = B.centered[0] - A.centered[0];
        const spanDy = B.centered[1] - A.centered[1];
        const spanLen = Math.sqrt(spanDx * spanDx + spanDy * spanDy);
        const perpX = spanLen > 0 ? -spanDy / spanLen : 0;
        const perpY = spanLen > 0 ? spanDx / spanLen : 1;

        // Attachment height is at the crossarm level (0.5m below pole top)
        const aZ = A.centered[2] - 0.5;
        const bZ = B.centered[2] - 0.5;

        const N = 32;

        for (let phase = 0; phase < 3; phase++) {
          const offset = conductorOffsets[phase];
          const ox = perpX * offset;
          const oy = perpY * offset;
          // Slight sag variation per phase so they don't overlap perfectly
          const phaseSag = sagMeters * (1 + (phase - 1) * 0.08);

          const path: [number, number, number][] = [];
          for (let i = 0; i <= N; i++) {
            const tNorm = i / N;
            const x = A.centered[0] * (1 - tNorm) + B.centered[0] * tNorm + ox;
            const y = A.centered[1] * (1 - tNorm) + B.centered[1] * tNorm + oy;
            const zLinear = aZ * (1 - tNorm) + bZ * tNorm;
            const zSag = phaseSag * 4 * tNorm * (1 - tNorm);
            const z = zLinear - zSag;
            path.push([x, y, z]);
          }
          paths.push({ path, color: phaseColors[phase] });
        }
      }
    }

    return paths;
  }, [poles, poleTops]);

  const pointCloudLayer = useMemo(() => new PointCloudLayer<{x:number;y:number;z:number;classification?: number; is_encroaching?: boolean}>({
    id: 'point-cloud',
    data: centered.data,
    coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
    getPosition: (d: {x:number;y:number;z:number}) => [d.x, d.y, d.z] as [number, number, number],
    getColor: (d: {classification?: number; is_encroaching?: boolean}) => {
      if (d.is_encroaching) {
        return [255, 0, 0, 255];
      }
      if (!(typeof d.classification === 'number' && Number.isFinite(d.classification))) {
        return [180, 180, 180, 180];
      }
      const id = d.classification;
      const map: Record<number, [number, number, number]> = {
        1: [160, 82, 45],
        2: [34, 139, 34],
        3: [139, 69, 19],
        4: [0, 100, 0],
        5: [0, 128, 0],
        6: [30, 144, 255],
        7: [70, 130, 180],
        9: [255, 69, 0],
        10: [255, 140, 0],
        18: [199, 21, 133]
      };
      const color = map[id] || [200, 200, 200];
      return [...color, 220];
    },
    pointSize: 2
  }), [centered]);

  const renderSelectedCells = async () => {
    if (!selectedH3List.length || rendering3d) return;
    try {
      setRendering3d(true);
      setRenderError(null);
      const res = await fetch('/api/h3/batch/points', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ h3Indices: selectedH3List })
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || 'Failed to render selected cells');
      }

      const rawPoints = json.points || [];
      const mappedPoints: LidarPoint[] = rawPoints
        .map((p: any) => {
          const clsRaw = p.classification ?? p.CLASSIFICATION ?? p.Classification;
          const cls = clsRaw !== undefined && clsRaw !== null ? Number(clsRaw) : undefined;
          const isEnc = Boolean(
            p.is_encroaching ?? p.IS_ENCROACHING ??
            p.is_encoraching ?? p.IS_ENCORACHING ??
            p.is_encroachment ?? p.IS_ENCROACHMENT
          );
          return {
            x: Number(p.x ?? p.X ?? p.longitude ?? p.lon),
            y: Number(p.y ?? p.Y ?? p.latitude ?? p.lat),
            z: Number(p.z ?? p.Z ?? p.height ?? p.elevation),
            classification: Number.isFinite(cls as number) ? (cls as number) : undefined,
            lat: Number(p.lat ?? p.latitude),
            lng: Number(p.lng ?? p.longitude ?? p.lon),
            is_encroaching: isEnc
          } as LidarPoint;
        })
        .filter((p: LidarPoint) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));

      const rawAssets = json.assets || json.poles || [];
      const mappedPoles: Pole[] = rawAssets
        .map((r: any) => ({
          pole_id: String(r.pole_id ?? r.POLE_ID ?? r.asset_id ?? r.id ?? ''),
          lat: Number(r.lat ?? r.latitude),
          lng: Number(r.lng ?? r.longitude ?? r.lon),
          height_m: Number(r.height_m ?? r.height ?? r.h),
          connects_to: String(r.connects_to ?? r.CONNECTS_TO ?? ''),
          line_sag: r.line_sag !== undefined ? Number(r.line_sag) : undefined
        }))
        .filter((p: Pole) => p.pole_id && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Number.isFinite(p.height_m));

      const dedupedPoles = Object.values(
        mappedPoles.reduce((acc, pole) => {
          acc[pole.pole_id] = pole;
          return acc;
        }, {} as Record<string, Pole>)
      );

      setPoints(mappedPoints);
      setPoles(dedupedPoles);
      if (hoverTimerRef.current !== null) {
        window.clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
      setHoverVisible(false);
      setHoverHex(null);
      setShowWoMenu(false);
      setShowModal(true);
    } catch (err: any) {
      setRenderError(err?.message || 'Failed to render selected cells');
    } finally {
      setRendering3d(false);
    }
  };

  return (
    <div style={{ height: '100%', width: '100%' }} onContextMenu={(e) => e.preventDefault()}>
      <style>{`@keyframes spin { from { transform: rotate(0deg);} to { transform: rotate(360deg);} }`}</style>
      <DeckGL
        initialViewState={viewState}
        controller={true}
        layers={[h3Layer, vegIconLayer, radarLayer].filter(Boolean) as any}
      >
        {!!mapboxToken && (
          <MapGL
            mapboxAccessToken={mapboxToken}
            mapStyle="mapbox://styles/mapbox/satellite-streets-v12"
            onMove={(evt) => setViewState(evt.viewState as any)}
          >
            <NavigationControl position="top-left" />
          </MapGL>
        )}
      </DeckGL>

      {selectedH3List.length > 0 && (
        <div style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          bottom: 22,
          zIndex: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          background: 'rgba(15, 23, 42, 0.92)',
          color: '#e2e8f0',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          borderRadius: 10,
          padding: '10px 12px'
        }}>
          <span style={{ fontSize: 13 }}>{selectedH3List.length} cell{selectedH3List.length === 1 ? '' : 's'} selected</span>
          <button
            onClick={() => { void renderSelectedCells(); }}
            disabled={rendering3d}
            style={{ border: 'none', borderRadius: 6, background: '#2563eb', color: 'white', padding: '6px 10px', cursor: rendering3d ? 'not-allowed' : 'pointer' }}
          >
            {rendering3d ? 'Rendering...' : 'Render 3D'}
          </button>
          <button
            onClick={() => {
              setSelectedH3s(new Set());
              setRenderError(null);
            }}
            style={{ borderRadius: 6, border: '1px solid #64748b', background: 'transparent', color: '#e2e8f0', padding: '6px 10px', cursor: 'pointer' }}
          >
            Clear Selection
          </button>
        </div>
      )}
      {renderError && (
        <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', bottom: 76, zIndex: 4, background: 'rgba(127,29,29,0.95)', color: '#fecaca', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
          {renderError}
        </div>
      )}

      <div style={{ position: 'absolute', top: 10, right: 10, zIndex: 2, background: 'rgba(31,42,60,0.9)', color: '#e6eef7', padding: 8, borderRadius: 4, display: 'flex', gap: 10, alignItems: 'center' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showEncroachment} onChange={e => setShowEncroachment(e.target.checked)} />
          Encroachment
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showFireRisk} onChange={e => setShowFireRisk(e.target.checked)} />
          Fire Risk
        </label>
        {/* Removed risk slider for simplicity */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showVegIcons} onChange={e => setShowVegIcons(e.target.checked)} />
          Veg Index
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showRadar} onChange={e => setShowRadar(e.target.checked)} />
          Radar
        </label>
        {/* Chat FAB bottom-right */}
      </div>
      {/* Weather radar playback controls */}
      {showRadar && (
        <div style={{
          position: 'absolute',
          left: 16,
          bottom: 62,
          zIndex: 4,
          background: 'rgba(15, 23, 42, 0.94)',
          borderRadius: 10,
          padding: '8px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          color: '#e2e8f0',
          border: '1px solid rgba(148, 163, 184, 0.35)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <button
            onClick={() => setRadarPlaying(p => !p)}
            style={{
              background: 'transparent',
              border: '1px solid rgba(148,163,184,0.4)',
              color: '#e2e8f0',
              borderRadius: 6,
              width: 30,
              height: 30,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 14,
            }}
            title={radarPlaying ? 'Pause' : 'Play'}
          >
            {radarPlaying ? '⏸' : '▶'}
          </button>
          <input
            type="range"
            min={0}
            max={radarFrames.length - 1}
            value={radarFrame}
            onChange={e => {
              setRadarFrame(Number(e.target.value));
              setRadarPlaying(false);
            }}
            style={{ width: 130, accentColor: '#3b82f6', cursor: 'pointer' }}
          />
          <span style={{ fontSize: 11, opacity: 0.8, minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {radarFrame === radarFrames.length - 1
              ? 'Now'
              : `-${(radarFrames.length - 1 - radarFrame) * 5} min`}
          </span>
          {/* Radar legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginLeft: 6 }}>
            {[
              { c: '#00c800', l: 'Light' },
              { c: '#ffc800', l: 'Mod' },
              { c: '#ff4600', l: 'Heavy' },
              { c: '#c80000', l: 'Severe' },
              { c: '#ff00ff', l: 'Extreme' },
            ].map(({ c, l }) => (
              <div key={l} title={l} style={{ width: 14, height: 10, background: c, borderRadius: 1 }} />
            ))}
            <span style={{ fontSize: 9, opacity: 0.5, marginLeft: 3 }}>dBZ</span>
          </div>
        </div>
      )}

      <button onClick={() => setShowChat(s => !s)} title="Chat"
        style={{ position: 'absolute', right: 16, bottom: 16, zIndex: 3, width: 56, height: 56, borderRadius: 28, border: 'none', background: '#2563eb', color: 'white', boxShadow: '0 8px 20px rgba(0,0,0,0.25)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 22 }}>💬</span>
      </button>

      {showModal && (
        <div style={{
          position: 'absolute', inset: '10px',
          background: '#1f2a3c', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', padding: 0,
          display: 'flex', flexDirection: 'column'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'relative', zIndex: 2, padding: 8, color: '#e6eef7' }}>
            <h3 style={{ margin: 0 }}>H3 {selectedH3List.join(', ')}</h3>
            <button onClick={() => { setShowModal(false); setSelectedPoleId(null); }}>Close</button>
          </div>
          <div style={{ position: 'relative', zIndex: 1, flex: '1 1 auto' }}>
            <DeckGL
              style={{ width: '100%', height: '100%', position: 'absolute', inset: '0', zIndex: '1' }}
              views={[new OrbitView()]}
              initialViewState={{
                target: [0, 0, 0] as [number, number, number],
                zoom: 2.6,
                rotationX: 30,
                rotationOrbit: 30
              } as unknown as any}
              controller={true}
              layers={centered.data.length ? [pointCloudLayer,
                // Wooden poles — vertical brown lines, clickable
                new LineLayer<PoleSegment>({
                  id: 'poles',
                  data: poleSegmentsData,
                  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
                  getSourcePosition: (d: PoleSegment) => d.source,
                  getTargetPosition: (d: PoleSegment) => d.target,
                  getColor: [139, 90, 43, 255] as [number, number, number, number],
                  widthMinPixels: 6,
                  pickable: true,
                  onClick: (info: any) => {
                    if (info.object) {
                      setSelectedPoleId((info.object as PoleSegment).pole_id);
                    }
                  },
                }),
                // Crossarms — horizontal brown beams near pole tops
                new LineLayer<Segment>({
                  id: 'crossarms',
                  data: crossarmSegments,
                  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
                  getSourcePosition: (d: Segment) => d.source,
                  getTargetPosition: (d: Segment) => d.target,
                  getColor: [101, 67, 33, 255] as [number, number, number, number],
                  widthMinPixels: 4,
                }),
                // Three-phase conductors — thin dark wires
                new PathLayer<Conductor>({
                  id: 'conductors',
                  data: conductors,
                  coordinateSystem: COORDINATE_SYSTEM.CARTESIAN,
                  getPath: (d: Conductor) => d.path,
                  getColor: (d: Conductor) => d.color,
                  widthMinPixels: 1,
                  widthMaxPixels: 1,
                  rounded: true,
                }),
              ] : []}
            />
            {!centered.data.length && (
              <div style={{ position: 'absolute', inset: '0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#666' }}>
                No points found
              </div>
            )}
            {centered.data.length > 0 && (() => {
              const present = Array.from(new Set(centered.data
                .filter(d => typeof d.classification === 'number' && Number.isFinite(d.classification))
                .map(d => d.classification as number)
              )).sort((a,b)=>a-b);
              const colorCss = (id: number) => {
                const map: Record<number, string> = {
                  1: 'rgb(160,82,45)',
                  2: 'rgb(34,139,34)',
                  3: 'rgb(139,69,19)',
                  4: 'rgb(0,100,0)',
                  5: 'rgb(0,128,0)',
                  6: 'rgb(30,144,255)',
                  7: 'rgb(70,130,180)',
                  9: 'rgb(255,69,0)',
                  10: 'rgb(255,140,0)',
                  18: 'rgb(199,21,133)'
                };
                return map[id] || 'rgb(200,200,200)';
              };
              const labelFor = (id: number) => {
                const map: Record<number, string> = {
                  1: 'Unclassified',
                  2: 'Ground',
                  3: 'Low Vegetation',
                  4: 'Medium Vegetation',
                  5: 'High Vegetation',
                  6: 'Building',
                  7: 'Low Point (Noise)',
                  9: 'Water',
                  10: 'Rail',
                  18: 'High Noise'
                };
                return map[id] || 'Other';
              };
              return (
                <div style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(255,255,255,0.92)', padding: 8, borderRadius: 4, fontSize: 12, lineHeight: 1.4 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center' }}>
                    {present.map(id => (
                      <React.Fragment key={id}>
                        <div style={{ width: 10, height: 10, background: colorCss(id) }} /> <span>{id} - {labelFor(id)}</span>
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            })()}
            {/* Pole Info Panel — slides in from right when a pole is clicked */}
            {selectedPoleId && (
              <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 360, zIndex: 3 }}>
                <PoleInfoPanel poleId={selectedPoleId} onClose={() => setSelectedPoleId(null)} />
              </div>
            )}
          </div>
        </div>
      )}
      {showChat && (
        <div style={{ position: 'absolute', right: 20, bottom: 84, width: 420, height: 520, background: '#ffffff', color: '#0f172a', borderRadius: 12, boxShadow: '0 12px 28px rgba(0,0,0,0.28)', display: 'flex', flexDirection: 'column', overflow: 'hidden', zIndex: 3 }}>
          <div style={{ padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e5e7eb' }}>
            <div style={{ fontWeight: 700 }}>Assistant</div>
            <button onClick={() => setShowChat(false)}>×</button>
          </div>
          <div style={{ flex: '1 1 auto', overflow: 'auto', padding: 14, background: '#f8fafc' }}>
            {chatMessages.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13 }}>Ask anything about the map or selected cells.</div>
            )}
            {chatMessages.map((m, i) => (
              <div key={i} style={{ marginBottom: 10, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ fontSize: 16 }}>{m.role === 'user' ? '🧑' : '🤖'}</div>
                <div style={{ background: m.role === 'user' ? '#e2e8f0' : '#fff', padding: '10px 12px', borderRadius: 10, border: '1px solid #e5e7eb', maxWidth: 320 }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}>{m.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            {chatSending && (
              <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                <div style={{ width: 16, height: 16, border: '2px solid #cbd5e1', borderTopColor: '#2563eb', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                <span>Thinking…</span>
              </div>
            )}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <textarea rows={2} placeholder="Type a message..." value={chatInput} onChange={e=>setChatInput(e.target.value)} onKeyDown={async (e)=>{
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (chatSending) return;
                const msg = chatInput.trim();
                if (!msg) return;
                setChatInput('');
                setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
                try {
                  setChatSending(true);
                  const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg, conversationId: chatConversationId || undefined }) });
                  const chatRes1 = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...chatMessages, { role: 'user', content: msg }], conversationId: chatConversationId || undefined }) });
                  const json = await chatRes1.json();
                  if (!chatRes1.ok) throw new Error(json.error || 'Request failed');
                  const reply = (json && (json.reply || (json.raw && (json.raw.text || json.raw.output_text)))) || 'OK';
                  setChatMessages(prev => [...prev, { role: 'assistant', content: String(reply) }]);
                  if (json.conversationId) setChatConversationId(String(json.conversationId));
                } catch (err:any) {
                  setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
                } finally {
                  setChatSending(false);
                }
              }
            }} style={{ width: '100%', resize: 'none', borderRadius: 8, border: '1px solid #cbd5e1', padding: 8 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button disabled={chatSending} onClick={async ()=>{
                if (chatSending) return;
                const msg = chatInput.trim();
                if (!msg) return;
                setChatInput('');
                setChatMessages(prev => [...prev, { role: 'user', content: msg }]);
                try {
                  setChatSending(true);
                  const chatRes2 = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: [...chatMessages, { role: 'user', content: msg }], conversationId: chatConversationId || undefined }) });
                  const json = await chatRes2.json();
                  if (!chatRes2.ok) throw new Error(json.error || 'Request failed');
                  const reply = (json && (json.reply || (json.raw && (json.raw.text || json.raw.output_text)))) || 'OK';
                  setChatMessages(prev => [...prev, { role: 'assistant', content: String(reply) }]);
                  if (json.conversationId) setChatConversationId(String(json.conversationId));
                } catch (err:any) {
                  setChatMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
                } finally {
                  setChatSending(false);
                }
              }}>{chatSending ? 'Sending...' : 'Send'}</button>
            </div>
          </div>
        </div>
      )}
      {showWoMenu && woHex && (
        <div style={{ position: 'absolute', left: woMenuPos.x, top: woMenuPos.y, background: '#fff', color: '#0f172a', padding: 12, borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', width: 260 }} onContextMenu={(e)=>e.preventDefault()}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Create Workorder</div>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 8 }}>H3: {woHex}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 13 }}>
            <div>🔥</div>
            <div>Fire Risk</div>
            <div style={{ fontWeight: 600 }}>{fireRiskMap.has(woHex) ? fireRiskMap.get(woHex) : 'N/A'}</div>
            <div>🌿</div>
            <div>Veg Index</div>
            <div style={{ fontWeight: 600 }}>{vegIndexMap.has(woHex) ? vegIndexMap.get(woHex) : 'N/A'}</div>
            <div>⚠️</div>
            <div>Encroachment</div>
            <div style={{ fontWeight: 600 }}>{encroachingH3.has(woHex) ? 'Yes' : 'No'}</div>
          </div>
          <textarea rows={3} placeholder="Add note..." value={woNote} onChange={e=>setWoNote(e.target.value)} style={{ width: '100%', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid #d1d5db', outline: 'none', marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={() => { setShowWoMenu(false); setWoNote(''); setWoResult(null); }}>Cancel</button>
            <button disabled={woSubmitting} onClick={async ()=>{
              try {
                setWoSubmitting(true);
                setWoResult(null);
                const res = await fetch('/api/workorders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ h3Hex: woHex, fireRisk: fireRiskMap.get(woHex) ?? null, vegIndex: vegIndexMap.get(woHex) ?? null, encroachment: encroachingH3.has(woHex), note: woNote })});
                const json = await res.json();
                if (!res.ok) throw new Error(json.error || 'Request failed');
                setWoResult(`Created: ${json.id}`);
                setWoNote('');
              } catch (e:any) {
                setWoResult(`Error: ${e.message}`);
              } finally {
                setWoSubmitting(false);
              }
            }}>{woSubmitting ? 'Creating...' : 'Create'}</button>
          </div>
          {woResult && <div style={{ marginTop: 8, fontSize: 12 }}>{woResult}</div>}
        </div>
      )}
      {hoverVisible && hoverHex && (
        <div style={{ position: 'absolute', left: hoverPos.x + 12, top: hoverPos.y + 12, background: '#fff', color: '#0f172a', padding: '10px 12px', borderRadius: 8, pointerEvents: 'none', fontSize: 13, boxShadow: '0 4px 12px rgba(0,0,0,0.2)', border: '1px solid rgba(15,23,42,0.08)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>H3 {hoverHex}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', alignItems: 'center', gap: 8 }}>
            <div>🔥</div>
            <div style={{ opacity: 0.8 }}>Fire Risk</div>
            <div style={{ fontWeight: 600 }}>{fireRiskMap.has(hoverHex) ? fireRiskMap.get(hoverHex) : 'N/A'}</div>

            <div>🌿</div>
            <div style={{ opacity: 0.8 }}>Veg Index</div>
            <div style={{ fontWeight: 600 }}>{vegIndexMap.has(hoverHex) ? vegIndexMap.get(hoverHex) : 'N/A'}</div>

            <div>⚠️</div>
            <div style={{ opacity: 0.8 }}>Encroachment</div>
            <div style={{ fontWeight: 600 }}>{encroachingH3.has(hoverHex) ? 'Yes' : 'No'}</div>
          </div>
        </div>
      )}
    </div>
  );
}


