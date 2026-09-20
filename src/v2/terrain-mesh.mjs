export const RAMPS = {
  thermal: ["#323788", "#348cb6", "#83cbb7", "#f5eaa0", "#ed974f", "#b92f55"],
  terrain: ["#42565b", "#8faaa0", "#cbcfab", "#e6dac0", "#f8f4e7"],
  purple: ["#ede8f6", "#c3b8e0", "#9277bc", "#63418e", "#351f5d"],
};
export function colorAt(value, min, max, ramp = "thermal") {
  if (![value, min, max].every(Number.isFinite)) return [0.7, 0.7, 0.7];
  const colors = RAMPS[ramp] || RAMPS.thermal,
    t =
      Math.max(0, Math.min(1, (value - min) / (max - min || 1))) *
      (colors.length - 1),
    i = Math.min(colors.length - 2, Math.floor(t)),
    f = t - i;
  const rgb = (s) =>
      [1, 3, 5].map((k) => parseInt(s.slice(k, k + 2), 16) / 255),
    a = rgb(colors[i]),
    b = rgb(colors[i + 1]);
  return a.map((v, k) => v + (b[k] - v) * f);
}
export function terrainMesh(g) {
  const { cols, rows, size } = g,
    stride = cols + 1,
    n = stride * (rows + 1),
    positions = new Float32Array(n * 3),
    uv = new Float32Array(n * 2),
    indices = [],
    lines = [],
    z = new Float32Array(n).fill(NaN);
  for (let y = 0; y <= rows; y++)
    for (let x = 0; x <= cols; x++) {
      const k = y * stride + x;
      let sum = 0,
        count = 0;
      let flatSum = 0,
        flatCount = 0;
      for (const [cx, cy] of [
        [x - 1, y - 1],
        [x, y - 1],
        [x - 1, y],
        [x, y],
      ])
        if (cx >= 0 && cx < cols && cy >= 0 && cy < rows) {
          const v = g.mean[cy * cols + cx];
          if (Number.isFinite(v)) {
            sum += v;
            count++;
            if (g.groundStatus?.[cy * cols + cx] === 1) {
              flatSum += v;
              flatCount++;
            }
          }
        }
      if (count) z[k] = flatCount ? flatSum / flatCount : sum / count;
      positions.set([x * size, y * size, count ? z[k] : 0], k * 3);
      uv.set([x / cols, y / rows], k * 2);
    }
  const seen = new Set();
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const k = y * cols + x;
      if (!Number.isFinite(g.mean[k])) continue;
      const a = y * stride + x,
        b = a + 1,
        c = a + stride,
        d = c + 1;
      indices.push(a, b, d, a, d, c);
      for (const [u, v] of [
        [a, b],
        [b, d],
        [d, c],
        [c, a],
      ]) {
        const key = Math.min(u, v) + ":" + Math.max(u, v);
        if (!seen.has(key)) {
          seen.add(key);
          lines.push(u, v);
        }
      }
    }
  return {
    positions,
    uv,
    indices: Uint32Array.from(indices),
    lines: Uint32Array.from(lines),
    z,
  };
}
export function heightAt(g, mesh, x, y) {
  const cx = Math.floor(x / g.size),
    cy = Math.floor(y / g.size);
  if (
    cx < 0 ||
    cy < 0 ||
    cx >= g.cols ||
    cy >= g.rows ||
    !Number.isFinite(g.mean[cy * g.cols + cx])
  )
    return null;
  const fx = x / g.size - cx,
    fy = y / g.size - cy,
    a = cy * (g.cols + 1) + cx,
    b = a + 1,
    c = a + g.cols + 1,
    d = c + 1,
    z = mesh.z;
  return fy <= fx
    ? z[a] * (1 - fx) + z[b] * (fx - fy) + z[d] * fy
    : z[a] * (1 - fy) + z[d] * fx + z[c] * (fy - fx);
}
export function recoverGround(g, mask, radius = 3) {
  if (!Number.isInteger(radius) || radius < 1 || radius > 3)
    throw new Error("Ground search radius must be 1–3 cells.");
  const mean = g.mean.slice(),
    status = new Uint8Array(mean.length);
  for (let k = 0; k < mean.length; k++)
    if (mask[k]) {
      const x = k % g.cols,
        y = Math.floor(k / g.cols);
      let found = [];
      for (let r = 1; r <= radius && !found.length; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx,
              yy = y + dy,
              j = yy * g.cols + xx;
            if (
              xx >= 0 &&
              xx < g.cols &&
              yy >= 0 &&
              yy < g.rows &&
              !mask[j] &&
              Number.isFinite(g.mean[j])
            )
              found.push(g.mean[j]);
          }
      if (found.length) {
        found.sort((a, b) => a - b);
        const m = Math.floor(found.length / 2);
        mean[k] = found.length % 2 ? found[m] : (found[m - 1] + found[m]) / 2;
        status[k] = 1;
      } else {
        mean[k] = NaN;
        status[k] = 2;
      }
    }
  return {
    ...g,
    mean,
    groundStatus: status,
    groundMethod: "estimated neighbour median; not surveyed ground",
  };
}
