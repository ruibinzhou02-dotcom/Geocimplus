import { fromArrayBuffer } from "geotiff";
import { defineCRS, transform, projectedBounds } from "./geo.mjs";
export async function readRaster(buffer, meta = {}) {
  if (buffer.byteLength > 128 * 1024 * 1024)
    throw new Error("GeoTIFF exceeds 128 MiB. Crop locally first.");
  const t = await fromArrayBuffer(buffer),
    im = await t.getImage(),
    fd = im.getFileDirectory(),
    keys = im.getGeoKeys();
  const tag = (name) => (fd.getValue ? fd.getValue(name) : fd[name]);
  const matrix = tag("ModelTransformation");
  const width = im.getWidth(),
    height = im.getHeight();
  if (width * height > 4000000)
    throw new Error(
      "This local preview accepts up to 4 million pixels per raster.",
    );
  if (matrix && (matrix[1] !== 0 || matrix[4] !== 0))
    throw new Error("Reproject rotated imagery to a north-up GeoTIFF.");
  const res = im.getResolution();
  if (res[0] <= 0 || res[1] >= 0)
    throw new Error("A north-up raster is required.");
  const code = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey,
    crs = defineCRS("EPSG:" + code);
  const bands = im.getSamplesPerPixel(),
    rgb = bands >= 3 && tag("PhotometricInterpretation") === 2;
  if (rgb && (tag("BitsPerSample") || []).some((b) => b !== 8))
    throw new Error(
      "Use an 8-bit RGB display GeoTIFF, or a numerical single-band raster.",
    );
  const alpha =
    rgb &&
    bands === 4 &&
    (tag("ExtraSamples") || []).some((v) => v === 1 || v === 2);
  const samples = await im.readRasters({
    samples: rgb ? (alpha ? [0, 1, 2, 3] : [0, 1, 2]) : [0],
  });
  const metadata = (await im.getGDALMetadata()) || {},
    bandMetadata = (await im.getGDALMetadata(0)) || {};
  const scale = Number(bandMetadata.SCALE ?? 1),
    offset = Number(bandMetadata.OFFSET ?? 0);
  if (!Number.isFinite(scale) || !Number.isFinite(offset))
    throw new Error("Invalid raster scale / offset metadata.");
  const nodata = im.getGDALNoData(),
    values = Float32Array.from(samples[0], (v, i) =>
      Number.isFinite(v) &&
      v !== nodata &&
      Math.abs(v) < 1e30 &&
      (!alpha || samples[3][i] > 0)
        ? v * scale + offset
        : NaN,
    );
  return {
    ...meta,
    kind: "raster",
    width,
    height,
    extent: im.getBoundingBox(),
    crs,
    nodata,
    values,
    bands,
    rgb: rgb ? samples.slice(0, 3).map((a) => Uint8Array.from(a)) : null,
    metadata,
    bandMetadata,
    scale,
    offset,
    role: rgb ? "imagery" : meta.role || "dem",
    unit:
      meta.unit ||
      metadata.value_unit ||
      bandMetadata.UNITTYPE ||
      "unconfirmed",
  };
}
export function makeGrid(r, size, crs) {
  const epsg = Number(String(crs).replace("EPSG:", ""));
  if (!((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760)))
    throw new Error(
      "Choose a WGS84 UTM CRS for metre-based grids (for Shatou: EPSG:32650).",
    );
  if (!Number.isFinite(size) || size < 5 || size > 5000)
    throw new Error("Grid size must be between 5 and 5000 metres.");
  const b = projectedBounds(r, crs),
    x = Math.floor(b[0] / size) * size,
    y = Math.floor(b[1] / size) * size;
  const cols = Math.ceil((b[2] - x) / size),
    rows = Math.ceil((b[3] - y) / size);
  if (cols * rows > 160000)
    throw new Error("More than 160,000 cells. Increase the grid size.");
  return {
    crs,
    size,
    cols,
    rows,
    origin: [x, y],
    bounds: [x, y, x + cols * size, y + rows * size],
  };
}
function clip(poly, axis, bound, above) {
  const out = [];
  if (!poly.length) return out;
  let a = poly[poly.length - 1],
    ia = above ? a[axis] >= bound : a[axis] <= bound;
  for (const b of poly) {
    const ib = above ? b[axis] >= bound : b[axis] <= bound;
    if (ia !== ib) {
      const t = (bound - a[axis]) / (b[axis] - a[axis]);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
    if (ib) out.push(b);
    a = b;
    ia = ib;
  }
  return out;
}
export function overlap(poly, x, y, s) {
  let p = clip(
    clip(clip(clip(poly, 0, x, true), 0, x + s, false), 1, y, true),
    1,
    y + s,
    false,
  );
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[i],
      r = p[(i + 1) % p.length];
    a += (q[0] - x) * (r[1] - y) - (r[0] - x) * (q[1] - y);
  }
  return Math.abs(a) / 2;
}
/** Area-weighted pixel footprint intersections. Invalid footprints count toward coverage, never mean. */
export function aggregate(r, g, progress = () => {}) {
  const epsg = Number(String(g.crs).replace("EPSG:", ""));
  if (!((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760)))
    throw new Error("Analysis grid CRS must be a WGS84 UTM projection.");
  const n = g.cols * g.rows,
    sum = new Float64Array(n),
    weight = new Float64Array(n),
    total = new Float64Array(n),
    count = new Uint32Array(n),
    min = new Float32Array(n).fill(Infinity),
    max = new Float32Array(n).fill(-Infinity);
  const p = transform(r.crs, g.crs),
    [a, b, c, d] = r.extent,
    dx = (c - a) / r.width,
    dy = (d - b) / r.height,
    s = g.size,
    [ox, oy] = g.origin;
  const row = (y) =>
    Array.from({ length: r.width + 1 }, (_, x) => p([a + x * dx, d - y * dy]));
  let top = row(0);
  for (let y = 0; y < r.height; y++) {
    const bottom = row(y + 1);
    for (let x = 0; x < r.width; x++) {
      const poly = [top[x], top[x + 1], bottom[x + 1], bottom[x]],
        xs = poly.map((q) => q[0]),
        ys = poly.map((q) => q[1]);
      const x0 = Math.max(0, Math.floor((Math.min(...xs) - ox) / s)),
        x1 = Math.min(g.cols - 1, Math.floor((Math.max(...xs) - ox) / s)),
        y0 = Math.max(0, Math.floor((Math.min(...ys) - oy) / s)),
        y1 = Math.min(g.rows - 1, Math.floor((Math.max(...ys) - oy) / s));
      const v = r.values[y * r.width + x];
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const w = overlap(poly, ox + cx * s, oy + cy * s, s);
          if (w < 1e-7) continue;
          const k = cy * g.cols + cx;
          total[k] += w;
          if (Number.isFinite(v)) {
            sum[k] += v * w;
            weight[k] += w;
            count[k]++;
            min[k] = Math.min(min[k], v);
            max[k] = Math.max(max[k], v);
          }
        }
    }
    top = bottom;
    if (y % 40 === 0) progress(Math.round((y / r.height) * 100));
  }
  const mean = new Float32Array(n).fill(NaN),
    nodataRatio = new Float32Array(n),
    coverage = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (weight[k]) mean[k] = sum[k] / weight[k];
    else {
      min[k] = NaN;
      max[k] = NaN;
    }
    coverage[k] = Math.min(1, weight[k] / (s * s));
    nodataRatio[k] = total[k] ? Math.max(0, 1 - weight[k] / total[k]) : 1;
  }
  return {
    ...g,
    mean,
    min,
    max,
    count,
    coverage,
    nodataRatio,
    unit: r.unit,
    source: r.id,
    method: "area-weighted projected pixel-footprint mean",
  };
}
export function stats(values) {
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    n = 0;
  for (const v of values)
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum += v;
      n++;
    }
  return {
    min: n ? min : null,
    max: n ? max : null,
    mean: n ? sum / n : null,
    count: n,
  };
}
export function gridGeoJSON(g, indices = null) {
  const project = transform(g.crs, "EPSG:4326"),
    features = [];
  const ids = indices || Array.from({ length: g.mean.length }, (_, i) => i);
  for (const k of ids) {
    if (!Number.isFinite(g.mean[k])) continue;
    const x = g.origin[0] + (k % g.cols) * g.size,
      y = g.origin[1] + Math.floor(k / g.cols) * g.size;
    const ring = [
      [x, y],
      [x + g.size, y],
      [x + g.size, y + g.size],
      [x, y + g.size],
      [x, y],
    ].map(project);
    features.push({
      type: "Feature",
      id: k,
      properties: {
        cell_id: k,
        mean_value: g.mean[k],
        min_value: g.min[k],
        max_value: g.max[k],
        valid_count: g.count[k],
        coverage: g.coverage[k],
        nodata_ratio: g.nodataRatio[k],
        unit: g.unit,
      },
      geometry: { type: "Polygon", coordinates: [ring] },
    });
  }
  return { type: "FeatureCollection", features };
}
