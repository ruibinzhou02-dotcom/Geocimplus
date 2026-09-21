import { transform } from "./geo.mjs";
export function displayTexture(texture, layer) {
  if (!texture || layer?.symbology?.imageryMode !== "grayscale") return texture;
  const pixels = texture.pixels.slice();
  for (let i = 0; i < pixels.length; i += 4)
    pixels[i + 1] = pixels[i + 2] = pixels[i];
  return { ...texture, pixels };
}
export function drapeTexture(r, g) {
  const w = 1024,
    h = Math.max(1, Math.round((w * g.rows) / g.cols)),
    pixels = new Uint8Array(w * h * 4),
    p = transform(g.crs, r.crs);
  if (h > 4096) throw new Error("Texture aspect ratio is too tall.");
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const q = p([
          g.bounds[0] + ((x + 0.5) / w) * (g.bounds[2] - g.bounds[0]),
          g.bounds[3] - ((y + 0.5) / h) * (g.bounds[3] - g.bounds[1]),
        ]),
        sx = Math.floor(
          ((q[0] - r.extent[0]) / (r.extent[2] - r.extent[0])) * r.width,
        ),
        sy = Math.floor(
          ((r.extent[3] - q[1]) / (r.extent[3] - r.extent[1])) * r.height,
        );
      if (sx < 0 || sy < 0 || sx >= r.width || sy >= r.height) continue;
      const k = sy * r.width + sx,
        i = (y * w + x) * 4;
      if (!Number.isFinite(r.values[k])) continue;
      for (let b = 0; b < 3; b++)
        pixels[i + b] = r.rgb ? r.rgb[b][k] : r.values[k];
      pixels[i + 3] = 255;
    }
  return { width: w, height: h, pixels };
}
