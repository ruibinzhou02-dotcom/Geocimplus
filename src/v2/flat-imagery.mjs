import { transform } from "./geo.mjs";
export function flatImagery(r, g, z) {
  if (!Number.isFinite(z)) throw new Error("Invalid reference plane");
  const project = transform(r.crs, g.crs),
    n = 16,
    positions = [],
    uv = [],
    indices = [];
  for (let y = 0; y <= n; y++)
    for (let x = 0; x <= n; x++) {
      const p = project([
        r.extent[0] + (x / n) * (r.extent[2] - r.extent[0]),
        r.extent[1] + (y / n) * (r.extent[3] - r.extent[1]),
      ]);
      positions.push(p[0] - g.origin[0], p[1] - g.origin[1], z);
      uv.push(x / n, y / n);
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = y * (n + 1) + x;
      indices.push(a, a + 1, a + n + 2, a, a + n + 2, a + n + 1);
    }
  const pixels = new Uint8Array(r.width * r.height * 4);
  for (let k = 0; k < r.values.length; k++) {
    if (!Number.isFinite(r.values[k])) continue;
    for (let b = 0; b < 3; b++)
      pixels[k * 4 + b] = r.rgb ? r.rgb[b][k] : r.values[k];
    pixels[k * 4 + 3] = 255;
  }
  return {
    mesh: {
      positions: new Float32Array(positions),
      uv: new Float32Array(uv),
      indices: new Uint32Array(indices),
    },
    texture: { width: r.width, height: r.height, pixels },
    referenceZ: z,
    source: r.id,
  };
}
