/**
 * Creates a truncated cone cylinder mesh for rendering utility poles.
 * The mesh extends from z=0 (base) to z=1 (top) and should be
 * scaled vertically by the pole height via SimpleMeshLayer's getScale.
 *
 * @param segments  Number of sides around the circumference (16 looks smooth)
 * @param bottomRadius  Radius at z=0 (meters in world coords, slightly exaggerated for visibility)
 * @param topRadius  Radius at z=1 (narrower than base for tapered look)
 */
export function createPoleMesh(
  segments: number = 16,
  bottomRadius: number = 0.4,
  topRadius: number = 0.25
) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];

  // Slope angle for normal calculation on a truncated cone
  const slopeLen = Math.sqrt((bottomRadius - topRadius) ** 2 + 1);
  const cosSlope = 1 / slopeLen;
  const sinSlope = (bottomRadius - topRadius) / slopeLen;

  // ---- Side vertices: two rings (bottom z=0, top z=1) ----
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);

    // Bottom vertex
    positions.push(ct * bottomRadius, st * bottomRadius, 0);
    normals.push(ct * cosSlope, st * cosSlope, sinSlope);

    // Top vertex
    positions.push(ct * topRadius, st * topRadius, 1);
    normals.push(ct * cosSlope, st * cosSlope, sinSlope);
  }

  // Side face indices (two triangles per quad, CCW winding from outside)
  for (let i = 0; i < segments; i++) {
    const bl = i * 2;       // bottom-left
    const tl = i * 2 + 1;   // top-left
    const br = (i + 1) * 2; // bottom-right
    const tr = (i + 1) * 2 + 1; // top-right

    indices.push(bl, br, tr);
    indices.push(bl, tr, tl);
  }

  // ---- Bottom cap ----
  const bottomCenter = positions.length / 3;
  positions.push(0, 0, 0);
  normals.push(0, 0, -1);

  const bottomRingStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(theta) * bottomRadius, Math.sin(theta) * bottomRadius, 0);
    normals.push(0, 0, -1);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(bottomCenter, bottomRingStart + i + 1, bottomRingStart + i);
  }

  // ---- Top cap ----
  const topCenter = positions.length / 3;
  positions.push(0, 0, 1);
  normals.push(0, 0, 1);

  const topRingStart = positions.length / 3;
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    positions.push(Math.cos(theta) * topRadius, Math.sin(theta) * topRadius, 1);
    normals.push(0, 0, 1);
  }
  for (let i = 0; i < segments; i++) {
    indices.push(topCenter, topRingStart + i, topRingStart + i + 1);
  }

  // Return in the format that deck.gl SimpleMeshLayer / luma.gl Geometry can consume
  return {
    topology: 'triangle-list' as const,
    attributes: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
    },
    indices: new Uint16Array(indices),
  };
}
