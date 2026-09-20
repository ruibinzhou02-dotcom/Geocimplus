import { ShapeUtils, Vector2 } from "three";
import { transform } from "./geo.mjs";
import { terrainMesh, heightAt, colorAt } from "./terrain-mesh.mjs";
import { stats } from "./raster-grid.mjs";
export function buildingModels(layers, g, terrain) {
  const models = [],
    p = transform("EPSG:4326", g.crs);
  let skipped = 0;
  for (const layer of layers.filter(
    (l) => l.kind === "vector" && l.heightField,
  ))
    for (const [featureIndex, f] of layer.data.features.entries()) {
      const h = Number(f.properties[layer.heightField]);
      if (!Number.isFinite(h) || h <= 0 || h > 2000) {
        skipped++;
        continue;
      }
      const polygons =
        f.geometry.type === "Polygon"
          ? [f.geometry.coordinates]
          : f.geometry.type === "MultiPolygon"
            ? f.geometry.coordinates
            : [];
      for (const poly of polygons) {
        const rings = poly.map((r) =>
          r.slice(0, -1).map((q) => {
            const v = p(q);
            return new Vector2(v[0] - g.origin[0], v[1] - g.origin[1]);
          }),
        );
        if (!rings[0]?.length) continue;
        const samples = rings[0]
          .map((v) => heightAt(g, terrain, v.x, v.y))
          .filter(Number.isFinite);
        if (!samples.length) {
          skipped++;
          continue;
        }
        samples.sort((a, b) => a - b);
        const base = samples[Math.floor(samples.length / 2)],
          v = rings.flat(),
          n = v.length,
          positions = [],
          indices = [];
        for (const z of [base, base + h])
          for (const q of v) positions.push(q.x, q.y, z);
        for (const tri of ShapeUtils.triangulateShape(
          rings[0],
          rings.slice(1),
        )) {
          indices.push(
            tri[2],
            tri[1],
            tri[0],
            tri[0] + n,
            tri[1] + n,
            tri[2] + n,
          );
        }
        let offset = 0;
        for (const ring of rings) {
          for (let i = 0; i < ring.length; i++) {
            const a = offset + i,
              b = offset + ((i + 1) % ring.length);
            indices.push(a, b, b + n, a, b + n, a + n);
          }
          offset += ring.length;
        }
        models.push({
          featureIndex,
          name: String(f.properties.BLDG_NO || f.id || models.length),
          layerId: layer.id,
          positions: Float32Array.from(positions),
          indices: Uint32Array.from(indices),
          base,
          height: h,
          properties: f.properties,
        });
      }
    }
  return { models, skipped };
}
export function thematicModel(grid, terrainGrid, terrain, ramp, min, max) {
  const positions = [],
    indices = [],
    colors = [],
    [lo, hi] = [min ?? stats(grid.mean).min, max ?? stats(grid.mean).max];
  for (let y = 0; y < grid.rows; y++)
    for (let x = 0; x < grid.cols; x++) {
      const k = y * grid.cols + x;
      if (
        !Number.isFinite(grid.mean[k]) ||
        !Number.isFinite(terrainGrid.mean[k])
      )
        continue;
      const a = y * (grid.cols + 1) + x,
        ids = [a, a + 1, a + grid.cols + 2, a + grid.cols + 1],
        start = positions.length / 3,
        c = colorAt(grid.mean[k], lo, hi, ramp);
      for (const v of ids) {
        positions.push(
          terrain.positions[v * 3],
          terrain.positions[v * 3 + 1],
          terrain.positions[v * 3 + 2] + 0.12,
        );
        colors.push(...c);
      }
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    colors: Float32Array.from(colors),
  };
}
export function mergeModels(models) {
  const positions = [],
    indices = [];
  for (const m of models) {
    const o = positions.length / 3;
    for (const v of m.positions) positions.push(v);
    for (const i of m.indices) indices.push(i + o);
  }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
  };
}
export function vectorLines(layers, g, terrain) {
  const p = transform("EPSG:4326", g.crs),
    lines = [];
  for (const l of layers.filter((l) => l.kind === "vector" && !l.heightField))
    for (const f of l.data.features) {
      const geom = f.geometry;
      let rings =
        geom.type === "Polygon"
          ? geom.coordinates
          : geom.type === "MultiPolygon"
            ? geom.coordinates.flat()
            : geom.type === "LineString"
              ? [geom.coordinates]
              : geom.type === "MultiLineString"
                ? geom.coordinates
                : [];
      for (const r of rings) {
        const points = r.map((ll) => {
          const q = p(ll),
            x = q[0] - g.origin[0],
            y = q[1] - g.origin[1];
          return [x, y, (heightAt(g, terrain, x, y) ?? 0) + 0.5];
        });
        lines.push({ layerId: l.id, name: l.name, points });
      }
    }
  return lines;
}
export { terrainMesh };
export function vectorSurfaces(layers, g, terrain) {
  const p = transform("EPSG:4326", g.crs),
    models = [],
    points = [];
  const project = (ll) => {
    const q = p(ll),
      x = q[0] - g.origin[0],
      y = q[1] - g.origin[1];
    return [x, y, (heightAt(g, terrain, x, y) ?? 0) + 0.3];
  };
  for (const l of layers.filter(
    (l) => l.kind === "vector" && !l.heightField && l.id !== "boundary",
  ))
    for (const f of l.data.features) {
      const geom = f.geometry;
      if (geom.type === "Point") points.push(...project(geom.coordinates));
      if (geom.type === "MultiPoint")
        for (const q of geom.coordinates) points.push(...project(q));
      const polygons =
        geom.type === "Polygon"
          ? [geom.coordinates]
          : geom.type === "MultiPolygon"
            ? geom.coordinates
            : [];
      for (const poly of polygons) {
        const rings = poly.map((r) => r.slice(0, -1).map((q) => project(q))),
          flat = rings.flat(),
          positions = Float32Array.from(flat.flat()),
          tri = ShapeUtils.triangulateShape(
            rings[0].map((q) => new Vector2(q[0], q[1])),
            rings.slice(1).map((r) => r.map((q) => new Vector2(q[0], q[1]))),
          ),
          color = l.density
            ? colorAt(
                Number(f.properties[l.density.field]),
                0,
                l.density.max,
                "thermal",
              )
            : [0.56, 0.42, 0.69],
          colors = Float32Array.from(flat.flatMap(() => color));
        models.push({
          positions,
          indices: Uint32Array.from(tri.flat()),
          colors,
          layerId: l.id,
        });
      }
    }
  return { models, points };
}
