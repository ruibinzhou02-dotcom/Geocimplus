import { transform } from "./geo.mjs";
import { overlap } from "./raster-grid.mjs";
import { recoverGround } from "./terrain-mesh.mjs";
export function buildingMask(g, features) {
  const mask = new Uint8Array(g.cols * g.rows),
    p = transform("EPSG:4326", g.crs);
  for (const f of features) {
    const geom = f.geometry;
    if (!geom || !["Polygon", "MultiPolygon"].includes(geom.type)) continue;
    const polys =
      geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    for (const rings of polys) {
      const coords = rings.map((r) => r.map(p)),
        xs = coords[0].map((q) => q[0]),
        ys = coords[0].map((q) => q[1]);
      const x0 = Math.max(
          0,
          Math.floor((Math.min(...xs) - g.origin[0]) / g.size),
        ),
        x1 = Math.min(
          g.cols - 1,
          Math.floor((Math.max(...xs) - g.origin[0]) / g.size),
        ),
        y0 = Math.max(0, Math.floor((Math.min(...ys) - g.origin[1]) / g.size)),
        y1 = Math.min(
          g.rows - 1,
          Math.floor((Math.max(...ys) - g.origin[1]) / g.size),
        );
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const bx = g.origin[0] + x * g.size,
            by = g.origin[1] + y * g.size;
          let area = overlap(coords[0], bx, by, g.size);
          for (const hole of coords.slice(1))
            area -= overlap(hole, bx, by, g.size);
          if (area > 1e-5) mask[y * g.cols + x] = 1;
        }
    }
  }
  return mask;
}
export function flattenGround(g, features) {
  const mask = buildingMask(g, features),
    result = recoverGround(g, mask, 3),
    seen = new Uint8Array(mask.length);
  // A connected building zone is a flat plane estimated from its supported perimeter.
  // Interior cells inherit that plane; groups with no perimeter evidence remain NoData.
  for (let k = 0; k < mask.length; k++)
    if (mask[k] && !seen[k]) {
      const queue = [k],
        values = [];
      seen[k] = 1;
      for (let i = 0; i < queue.length; i++) {
        const j = queue[i],
          x = j % g.cols,
          y = Math.floor(j / g.cols);
        if (result.groundStatus[j] === 1) values.push(result.mean[j]);
        for (const [xx, yy] of [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ])
          if (xx >= 0 && xx < g.cols && yy >= 0 && yy < g.rows) {
            const q = yy * g.cols + xx;
            if (mask[q] && !seen[q]) {
              seen[q] = 1;
              queue.push(q);
            }
          }
      }
      values.sort((a, b) => a - b);
      const m = Math.floor(values.length / 2),
        z = values.length % 2 ? values[m] : (values[m - 1] + values[m]) / 2;
      if (values.length)
        for (const j of queue) {
          result.mean[j] = z;
          result.groundStatus[j] = 1;
        }
    }
  return {
    ...result,
    groundMethod:
      "Flat connected building zones; median of perimeter estimates using non-building neighbours within 3 cells. Interior inherits zone plane; unsupported zones remain NoData.",
  };
}
export function clipGrid(g, features) {
  const mask = buildingMask(g, features),
    result = {
      ...g,
      mean: g.mean.slice(),
      min: g.min.slice(),
      max: g.max.slice(),
      coverage: g.coverage.slice(),
      count: g.count.slice(),
      nodataRatio: g.nodataRatio.slice(),
      clipMethod: "Keep cells intersecting input polygons",
    };
  for (let i = 0; i < mask.length; i++)
    if (!mask[i]) {
      result.mean[i] = result.min[i] = result.max[i] = NaN;
      result.coverage[i] = result.count[i] = 0;
      result.nodataRatio[i] = 1;
    }
  return result;
}
