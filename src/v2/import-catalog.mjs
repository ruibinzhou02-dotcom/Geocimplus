import { fromArrayBuffer } from "geotiff";
import { unpackShapeZip } from "../import-local.mjs";
export const DATA_TYPES = {
  point: ["Point", "点", "•"],
  line: ["Polyline", "线", "╱"],
  polygon: ["Polygon", "面", "⬡"],
  mixed: ["Mixed geometry", "混合几何", "◇"],
  raster: ["Raster", "栅格", "▧"],
  weather: ["Weather", "气象", "☼"],
  unknown: ["Unknown", "待识别", "?"],
};
export function shapeType(buffer) {
  const v = new DataView(buffer);
  if (
    v.byteLength < 100 ||
    v.getInt32(0) !== 9994 ||
    v.getInt32(28, true) !== 1000
  )
    throw new Error("Invalid Shapefile header / Shapefile 文件头无效");
  const code = v.getInt32(32, true);
  return [1, 8, 11, 18, 21, 28].includes(code)
    ? "point"
    : [3, 13, 23].includes(code)
      ? "line"
      : [5, 15, 25].includes(code)
        ? "polygon"
        : "unknown";
}
export function geometryType(features) {
  const types = new Set(
    features
      .map((f) => f.geometry?.type)
      .filter(Boolean)
      .map((t) =>
        /Point/.test(t)
          ? "point"
          : /LineString/.test(t)
            ? "line"
            : /Polygon/.test(t)
              ? "polygon"
              : "unknown",
      ),
  );
  return types.size === 1 ? [...types][0] : "mixed";
}
export function suggestedCategory(entry) {
  return entry.type === "line"
    ? "transport"
    : /building|建筑|bldg/i.test(entry.name)
      ? "buildings"
      : /boundary|边界|范围/i.test(entry.name)
        ? "boundary"
        : entry.type === "raster" &&
            /satellite|底图|影像|basemap/i.test(entry.name)
          ? "basemap"
          : "other";
}
const pathOf = (f) => (f.webkitRelativePath || f.name).replaceAll("\\", "/");
export function mergeCatalogFiles(previous, next) {
  const files = new Map(previous.map((f) => [pathOf(f).toLowerCase(), f]));
  for (const f of next) files.set(pathOf(f).toLowerCase(), f);
  return [...files.values()];
}
export async function inspectDatasets(files) {
  if (
    files.length > 512 ||
    files.reduce((s, f) => s + f.size, 0) > 128 * 1024 ** 2
  )
    throw new Error(
      "Choose up to 128 MiB / 512 files. / 最多选择 128 MiB、512 个文件。",
    );
  const items = [];
  for (const f of files) {
    const path = pathOf(f);
    if (/\.zip$/i.test(path)) {
      const contents = unpackShapeZip(new Uint8Array(await f.arrayBuffer()));
      for (const [name, bytes] of Object.entries(contents))
        items.push({
          path: path + "/" + name,
          file: new File([bytes], name.split("/").pop()),
        });
    } else items.push({ path, file: f });
  }
  const groups = new Map(),
    entries = [];
  for (const { path, file } of items) {
    const m = path.match(/^(.*)\.(shp|shx|dbf|prj|cpg|sbn|sbx)$/i);
    if (m) {
      if (/\.vat$/i.test(m[1])) continue;
      const key = m[1].toLowerCase();
      if (!groups.has(key))
        groups.set(key, {
          id: key,
          name: m[1].split("/").pop(),
          folder: m[1].split("/").slice(0, -1).join("/"),
          format: "Shapefile",
          parts: {},
        });
      groups.get(key).parts[m[2].toLowerCase()] = file;
      continue;
    }
    if (/\.adf$/i.test(path)) {
      if (!/\/hdr\.adf$/i.test(path)) continue;
      const folder = path.replace(/\/hdr\.adf$/i, "");
      entries.push({
        id: folder,
        name: folder.split("/").pop(),
        format: "ArcInfo Grid",
        type: "raster",
        files: [],
        ready: false,
        issue: "Convert to GeoTIFF / 请先转换为 GeoTIFF",
        folder,
      });
      continue;
    }
    if (!/\.(geojson|json|tiff?|epw)$/i.test(path)) continue;
    const e = {
      id: path.toLowerCase(),
      name: file.name,
      folder: path.split("/").slice(0, -1).join("/"),
      files: [file],
      ready: true,
    };
    try {
      if (/\.epw$/i.test(path)) {
        e.format = "EPW";
        e.type = "weather";
        e.crs = "Station / 气象站";
      } else if (/\.tiff?$/i.test(path)) {
        const tif = await fromArrayBuffer(await file.arrayBuffer()),
          im = await tif.getImage(),
          keys = im.getGeoKeys();
        e.format = "GeoTIFF";
        e.type = "raster";
        e.count = `${im.getWidth()} × ${im.getHeight()}`;
        const crs = keys?.ProjectedCSTypeGeoKey || keys?.GeographicTypeGeoKey;
        e.crs = crs ? `EPSG:${crs}` : "Unknown / 未定义";
        if (!crs) {
          e.ready = false;
          e.issue = "Missing spatial reference / 缺少空间参考";
        }
      } else {
        const data = JSON.parse(await file.text());
        if (data.type !== "FeatureCollection" || !Array.isArray(data.features))
          throw new Error("Expected GeoJSON FeatureCollection");
        e.format = "GeoJSON";
        e.type = geometryType(data.features);
        e.count = data.features.length;
        e.crs = data.crs?.properties?.name || "EPSG:4326";
      }
    } catch (err) {
      e.ready = false;
      e.type = e.type || "unknown";
      e.issue = err.message;
    }
    entries.push(e);
  }
  for (const e of groups.values()) {
    if (!e.parts.shp) continue;
    e.files = Object.values(e.parts);
    e.missing = ["shp", "shx", "dbf", "prj"].filter((k) => !e.parts[k]);
    e.ready = !e.missing.length;
    try {
      e.type = shapeType(await e.parts.shp.slice(0, 100).arrayBuffer());
      if (e.parts.dbf) {
        const b = await e.parts.dbf.slice(0, 32).arrayBuffer();
        if (b.byteLength < 32) throw new Error("Invalid DBF");
        e.count = new DataView(b).getUint32(4, true);
      }
      if (e.parts.prj) {
        const wkt = (await e.parts.prj.text()).trim();
        e.crs =
          wkt.match(/^(?:PROJCS|GEOGCS|PROJCRS|GEOGCRS)\["([^"]+)"/)?.[1] ||
          wkt.slice(0, 100);
        if (!wkt) throw new Error("Empty PRJ / PRJ 为空");
      }
    } catch (err) {
      e.ready = false;
      e.type = e.type || "unknown";
      e.issue = err.message;
    }
    if (e.missing.length)
      e.issue = `Missing / 缺少：${e.missing.map((k) => "." + k).join(" ")}`;
    entries.push(e);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}
