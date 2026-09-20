import { transform } from "./geo.mjs";
import { aggregate } from "./raster-grid.mjs";
// Sample in source pixel coordinates. Do not extrapolate or bridge NoData.
export function resampleGrid(r, g, method = "mean", progress = () => {}) {
  if (method === "mean") return aggregate(r, g, progress);
  if (!["nearest", "bilinear"].includes(method))
    throw new Error("Unknown raster resampling method.");
  const n = g.cols * g.rows,
    mean = new Float32Array(n).fill(NaN),
    count = new Uint32Array(n),
    coverage = new Float32Array(n),
    nodataRatio = new Float32Array(n).fill(1);
  const inverse = transform(g.crs, r.crs),
    dx = (r.extent[2] - r.extent[0]) / r.width,
    dy = (r.extent[3] - r.extent[1]) / r.height;
  for (let k = 0; k < n; k++) {
    const [x, y] = inverse([
      g.origin[0] + ((k % g.cols) + 0.5) * g.size,
      g.origin[1] + (Math.floor(k / g.cols) + 0.5) * g.size,
    ]);
    const u = (x - r.extent[0]) / dx - 0.5,
      v = (r.extent[3] - y) / dy - 0.5;
    let samples;
    if (method === "nearest") samples = [[Math.round(u), Math.round(v), 1]];
    else {
      const a = Math.floor(u),
        b = Math.floor(v),
        fx = u - a,
        fy = v - b;
      samples = [
        [a, b, (1 - fx) * (1 - fy)],
        [a + 1, b, fx * (1 - fy)],
        [a, b + 1, (1 - fx) * fy],
        [a + 1, b + 1, fx * fy],
      ].filter((q) => q[2] > 1e-9);
    }
    let sum = 0,
      valid = true;
    for (const [px, py, w] of samples) {
      const z = r.values[py * r.width + px];
      if (
        px < 0 ||
        py < 0 ||
        px >= r.width ||
        py >= r.height ||
        !Number.isFinite(z)
      ) {
        valid = false;
        break;
      }
      sum += w * z;
    }
    if (valid) {
      mean[k] = sum;
      count[k] = samples.length;
      coverage[k] = 1;
      nodataRatio[k] = 0;
    }
    if (k % 5000 === 0) progress(Math.round((k / n) * 100));
  }
  return {
    ...g,
    mean,
    min: mean.slice(),
    max: mean.slice(),
    count,
    coverage,
    nodataRatio,
    unit: r.unit,
    source: r.id,
    method:
      method === "bilinear"
        ? "bilinear at cell centre; strict NoData; coverage means sample support"
        : "nearest pixel at cell centre; coverage means sample support",
  };
}
