import { transform } from "./geo.mjs";
import { classifyLayer } from "./layers.mjs";

// Cartographic dimensions in metres, never inferred physical road dimensions.
export const ROAD_DISPLAY = Object.freeze({
  width: 2,
  thickness: 0.15,
  clearance: 0.35,
});
export const isRoadLayer = (l) =>
  l.kind === "vector" &&
  !l.heightField &&
  (l.category === "transport" || l.id === "roads") &&
  l.data?.features?.length > 0 &&
  l.data.features.every((f) =>
    ["LineString", "MultiLineString"].includes(f.geometry?.type),
  );
const cross = (a, b, p) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
function clip(poly, triangle) {
  for (let j = 0; j < 3 && poly.length; j++) {
    const a = triangle[j],
      b = triangle[(j + 1) % 3],
      out = [];
    let prev = poly.at(-1),
      dp = cross(a, b, prev);
    for (const q of poly) {
      const dq = cross(a, b, q);
      if (dp >= -1e-8 !== dq >= -1e-8) {
        const t = dp / (dp - dq);
        out.push([
          prev[0] + t * (q[0] - prev[0]),
          prev[1] + t * (q[1] - prev[1]),
        ]);
      }
      if (dq >= -1e-8) out.push(q);
      prev = q;
      dp = dq;
    }
    poly = out;
  }
  return poly;
}
// Intersect each ribbon with the existing terrain triangles. Its top follows
// the actual rendered surface, including triangle edges and NoData holes.
export function roadRibbon(path, g, terrain) {
  path = path.filter(
    (p, i) =>
      !i || Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) > 1e-7,
  );
  if (path.length < 2) return null;
  const half = ROAD_DISPLAY.width / 2;
  const normals = path.slice(1).map((p, i) => {
    const dx = p[0] - path[i][0],
      dy = p[1] - path[i][1],
      n = Math.hypot(dx, dy);
    return [-dy / n, dx / n];
  });
  const offsets = path.map((p, i) => {
    const a = normals[Math.max(0, i - 1)],
      b = normals[Math.min(normals.length - 1, i)],
      n = Math.hypot(a[0] + b[0], a[1] + b[1]);
    if (n < 1e-6) return b.map((v) => v * half);
    const m = [(a[0] + b[0]) / n, (a[1] + b[1]) / n],
      scale = Math.min(
        half * 2,
        half / Math.max(0.01, m[0] * b[0] + m[1] * b[1]),
      );
    return m.map((v) => v * scale);
  });
  const vertices = [],
    top = [],
    lookup = new Map(),
    edges = new Map();
  const vertex = (x, y, z) => {
    const key = [x, y, z].map((v) => Math.round(v * 1e6)).join(":");
    if (!lookup.has(key)) {
      lookup.set(key, vertices.length / 3);
      vertices.push(x, y, z);
    }
    return lookup.get(key);
  };
  const face = (a, b, c) => {
    if (a === b || b === c || a === c) return;
    top.push(a, b, c);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = Math.min(u, v) + ":" + Math.max(u, v),
        e = edges.get(k);
      if (e) e.count++;
      else edges.set(k, { u, v, count: 1 });
    }
  };
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i],
      oa = offsets[i - 1],
      ob = offsets[i];
    const quad = [
      [a[0] + oa[0], a[1] + oa[1]],
      [a[0] - oa[0], a[1] - oa[1]],
      [b[0] - ob[0], b[1] - ob[1]],
      [b[0] + ob[0], b[1] + ob[1]],
    ];
    const x0 = Math.max(
        0,
        Math.floor(Math.min(...quad.map((p) => p[0])) / g.size),
      ),
      x1 = Math.min(
        g.cols - 1,
        Math.floor(Math.max(...quad.map((p) => p[0])) / g.size),
      );
    const y0 = Math.max(
        0,
        Math.floor(Math.min(...quad.map((p) => p[1])) / g.size),
      ),
      y1 = Math.min(
        g.rows - 1,
        Math.floor(Math.max(...quad.map((p) => p[1])) / g.size),
      );
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        if (!Number.isFinite(g.mean[y * g.cols + x])) continue;
        const k = y * (g.cols + 1) + x,
          ids = [k, k + 1, k + g.cols + 2, k + g.cols + 1];
        const corners = [
          [x * g.size, y * g.size],
          [(x + 1) * g.size, y * g.size],
          [(x + 1) * g.size, (y + 1) * g.size],
          [x * g.size, (y + 1) * g.size],
        ];
        for (const ts of [
          [0, 1, 2],
          [0, 2, 3],
        ]) {
          const tri = ts.map((j) => corners[j]),
            poly = clip(quad, tri);
          if (poly.length < 3) continue;
          const area = cross(tri[0], tri[1], tri[2]);
          const idx = poly.map((p) => {
            const w0 = cross(tri[1], tri[2], p) / area,
              w1 = cross(tri[2], tri[0], p) / area,
              w2 = 1 - w0 - w1;
            const z =
              w0 * terrain.z[ids[ts[0]]] +
              w1 * terrain.z[ids[ts[1]]] +
              w2 * terrain.z[ids[ts[2]]];
            return vertex(
              ...p,
              z + ROAD_DISPLAY.clearance + ROAD_DISPLAY.thickness,
            );
          });
          for (let j = 1; j < idx.length - 1; j++)
            if (cross(poly[0], poly[j], poly[j + 1]) > 1e-8)
              face(idx[0], idx[j], idx[j + 1]);
        }
      }
  }
  if (!top.length) return null;
  const n = vertices.length / 3,
    positions = [...vertices],
    indices = [...top];
  for (let i = 0; i < vertices.length; i += 3)
    positions.push(
      vertices[i],
      vertices[i + 1],
      vertices[i + 2] - ROAD_DISPLAY.thickness,
    );
  for (let i = 0; i < top.length; i += 3)
    indices.push(top[i] + n, top[i + 2] + n, top[i + 1] + n);
  for (const { u, v, count } of edges.values())
    if (count === 1) indices.push(u, v + n, v, u, u + n, v + n);
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    topVertexCount: n,
  };
}
export function roadModels(layers, g, terrain, selection) {
  const p = transform("EPSG:4326", g.crs),
    models = [],
    selected = new Set(selection?.ids || []);
  for (const layer of layers.filter(
    (l) =>
      isRoadLayer(l) && l.visible !== false && l.symbology?.outline !== false,
  )) {
    const classification = classifyLayer(layer);
    for (const [featureIndex, f] of layer.data.features.entries()) {
      const paths =
        f.geometry.type === "LineString"
          ? [f.geometry.coordinates]
          : f.geometry.coordinates;
      for (const path of paths) {
        const m = roadRibbon(
          path.map((q) => {
            const v = p(q);
            return [v[0] - g.origin[0], v[1] - g.origin[1]];
          }),
          g,
          terrain,
        );
        if (!m) continue;
        const color =
          selection?.layer === layer.id && selected.has(featureIndex)
            ? [1, 0.75, 0.15]
            : classification.color(f.properties?.[layer.symbology?.field]);
        const colors = new Float32Array(m.positions.length);
        for (let i = 0; i < colors.length; i += 3) colors.set(color, i);
        models.push({
          ...m,
          colors,
          layerId: layer.id,
          featureIndex,
          name: String(f.properties?.name || f.id || layer.name),
        });
      }
    }
  }
  return models;
}
