// ---------------------------------------------------------------------------
// Synthetic weather radar data — generates a squall line rolling in from the
// southwest with embedded severe cells, trailing stratiform rain, and
// organic noise texture.  Each "frame" is one radar scan (~5 min apart).
// ---------------------------------------------------------------------------

export interface RadarCell {
  position: [number, number]; // [lng, lat]
  dbz: number;
  color: [number, number, number, number];
}

// ---- Deterministic value-noise helpers ------------------------------------

function hash2d(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h = (h ^ (h >>> 16)) | 0;
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2d(ix, iy, seed);
  const n10 = hash2d(ix + 1, iy, seed);
  const n01 = hash2d(ix, iy + 1, seed);
  const n11 = hash2d(ix + 1, iy + 1, seed);
  return (
    n00 * (1 - sx) * (1 - sy) +
    n10 * sx * (1 - sy) +
    n01 * (1 - sx) * sy +
    n11 * sx * sy
  );
}

/** Fractal Brownian Motion — stacks octaves of value noise for organic texture */
function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let value = 0,
    amp = 1,
    freq = 1,
    max = 0;
  for (let i = 0; i < octaves; i++) {
    value += amp * smoothNoise(x * freq, y * freq, seed + i * 97);
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return value / max;
}

// ---- NWS-style radar color mapping ----------------------------------------

function dbzColor(dbz: number): [number, number, number, number] {
  if (dbz < 5) return [0, 0, 0, 0];
  if (dbz < 10) return [100, 230, 100, 95];
  if (dbz < 15) return [50, 200, 50, 110];
  if (dbz < 20) return [0, 190, 0, 125];
  if (dbz < 25) return [0, 160, 0, 140];
  if (dbz < 30) return [255, 255, 0, 145];
  if (dbz < 35) return [255, 200, 0, 155];
  if (dbz < 40) return [255, 140, 0, 165];
  if (dbz < 45) return [255, 70, 0, 175];
  if (dbz < 50) return [240, 0, 0, 185];
  if (dbz < 55) return [190, 0, 0, 195];
  if (dbz < 60) return [255, 0, 255, 205];
  return [180, 80, 255, 215];
}

// ---- Frame generation -----------------------------------------------------

/**
 * Generates `frameCount` radar scans showing a squall line rolling in from
 * the southwest.  The animation represents the past ~2 hours of radar
 * imagery ending at "now".
 */
export function generateRadarFrames(
  centerLat: number,
  centerLng: number,
  frameCount = 24,
): RadarCell[][] {
  // Grid covering the visible area plus some margin for the storm to
  // enter / exit.  Step ≈ 670 m (lat) / 520 m (lng) at this latitude.
  const latHalf = 0.35;
  const lngHalf = 0.45;
  const latMin = centerLat - latHalf;
  const latMax = centerLat + latHalf;
  const lngMin = centerLng - lngHalf;
  const lngMax = centerLng + lngHalf;
  const step = 0.006;

  // Pre-compute grid positions (shared across frames)
  const grid: [number, number][] = [];
  for (let lat = latMin; lat <= latMax; lat += step) {
    for (let lng = lngMin; lng <= lngMax; lng += step) {
      grid.push([lat, lng]);
    }
  }

  // Squall line orientation (NW-SE axis, angle from north)
  const lineAngle = -0.55; // radians
  const cosA = Math.cos(lineAngle);
  const sinA = Math.sin(lineAngle);

  // Longitude-to-"meters" scale factor at this latitude
  const lngScale = Math.cos((centerLat * Math.PI) / 180); // ≈ 0.78

  const frames: RadarCell[][] = [];

  for (let f = 0; f < frameCount; f++) {
    const t = f / (frameCount - 1); // 0 → 1

    // Intensity ramps up as the storm develops, stays strong, fades slightly
    const intensityMod = Math.min(1, t * 3.5) * Math.min(1, (1 - t) * 2.5 + 0.4);

    // Storm center movement: SW → NE
    const stormLat = centerLat - 0.30 + t * 0.60;
    const stormLng = centerLng - 0.38 + t * 0.68;

    // Severe cell drifts slightly relative to the line over time
    const sevOffU = 0.008 + t * 0.004;
    const sevOffV = -0.04 - t * 0.02;
    // Second cell
    const c2OffU = -0.005;
    const c2OffV = 0.09 + t * 0.01;

    const points: RadarCell[] = [];

    for (let g = 0; g < grid.length; g++) {
      const lat = grid[g][0];
      const lng = grid[g][1];

      // Storm-relative coordinates (normalised to approx. meters scale)
      const dlat = lat - stormLat;
      const dlng = (lng - stormLng) * lngScale;

      // Rotate into line-relative frame: u = perpendicular, v = along line
      const u = dlat * cosA - dlng * sinA;
      const v = dlat * sinA + dlng * cosA;

      // 1. Main squall line — Gaussian in u, tapered Gaussian in v
      const lineWidth = 0.032 + 0.012 * Math.sin(v * 22 + f * 0.4);
      const lineEnvelope = Math.exp(-0.5 * (v / 0.24) ** 2);
      const lineDbz = 40 * intensityMod * Math.exp(-0.5 * (u / lineWidth) ** 2) * lineEnvelope;

      // 2. Embedded severe cell
      const su = u - sevOffU;
      const sv = v - sevOffV;
      const severeDbz =
        65 * intensityMod * Math.exp(-(su * su + sv * sv) / (2 * 0.022 * 0.022));

      // 3. Second strong cell
      const cu = u - c2OffU;
      const cv = v - c2OffV;
      const cell2Dbz =
        48 * intensityMod * Math.exp(-(cu * cu + cv * cv) / (2 * 0.032 * 0.032));

      // 4. Trailing stratiform rain (behind the line)
      const trailOffset = u - 0.09;
      const stratiform =
        trailOffset > 0 && trailOffset < 0.18
          ? 22 *
            intensityMod *
            (1 - trailOffset / 0.18) *
            lineEnvelope *
            0.85
          : 0;

      // 5. Pre-frontal scattered showers (ahead of the line)
      const preOffset = u + 0.16;
      const preFrontal =
        preOffset < 0 && preOffset > -0.12
          ? 18 *
            intensityMod *
            fbm(lat * 28, lng * 28, 200 + f, 3) *
            lineEnvelope *
            0.5
          : 0;

      // Combine — take max of the convective sources, add stratiform/prefrontal
      let dbz =
        Math.max(lineDbz, severeDbz, cell2Dbz) +
        stratiform * 0.5 +
        preFrontal;

      // Organic noise texture — drifts slowly with frame
      const noiseDrift = f * 0.25;
      const noise =
        (fbm(lat * 38 + noiseDrift * 0.3, lng * 38, 42, 3) - 0.5) * 14;
      dbz += noise;

      dbz = Math.max(0, Math.min(70, dbz));

      if (dbz >= 5) {
        points.push({
          position: [lng, lat],
          dbz,
          color: dbzColor(dbz),
        });
      }
    }

    frames.push(points);
  }

  return frames;
}
