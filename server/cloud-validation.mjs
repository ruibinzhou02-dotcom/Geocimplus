import { validateGraph, migrateGraph } from "../src/v2/circuit.mjs";
const SOURCES = new Set([
  "dem",
  "lst",
  "buildings",
  "boundary",
  "basemap",
  "epw",
]);
const PARAMS = new Set([
  "layer",
  "size",
  "crs",
  "method",
  "enabled",
  "expression",
  "unit",
  "ramp",
  "field",
  "distance",
  "bandwidth",
  "cellSize",
  "weightField",
]);
export function validateCloudRequest(body) {
  if (
    !body ||
    body.example !== "shatou-v2" ||
    !["run", "grid"].includes(body.action)
  )
    throw new Error("Only the fixed Shatou example is available.");
  if (
    Object.keys(body).some(
      (k) =>
        !["example", "action", "graph", "source", "size", "method"].includes(k),
    )
  )
    throw new Error("File and dataset uploads are not accepted.");
  if (body.action === "grid") {
    if (
      !["dem", "lst"].includes(body.source) ||
      !Number.isFinite(body.size) ||
      body.size < 30 ||
      body.size > 1000 ||
      !["mean", "bilinear", "nearest"].includes(body.method)
    )
      throw new Error("Invalid cloud raster parameters.");
    return body;
  }
  const g = migrateGraph(body.graph);
  validateGraph(g);
  for (const n of g.nodes) {
    if (n.type === "group") continue;
    const p = n.data.params || {};
    if (Object.keys(p).some((k) => !PARAMS.has(k)))
      throw new Error("Unknown component parameter.");
    for (const v of Object.values(p)) {
      if (v !== null && !["string", "number", "boolean"].includes(typeof v))
        throw new Error("Only simple component parameters are accepted.");
      if (typeof v === "string" && v.length > 256)
        throw new Error("Component text is too long.");
      if (typeof v === "number" && !Number.isFinite(v))
        throw new Error("Invalid number.");
    }
    if (
      ["raster", "vector", "points", "polygons", "weather"].includes(
        n.data.component,
      ) &&
      !SOURCES.has(p.layer)
    )
      throw new Error("Cloud inputs must reference fixed example layers.");
    if (n.data.component === "gridInput")
      throw new Error("Uploaded result grids run locally.");
    if (p.size != null && (p.size < 30 || p.size > 1000))
      throw new Error("Cloud grid size must be 30–1000 m.");
    if (p.crs && p.crs !== "EPSG:32650")
      throw new Error("The Shatou cloud example uses EPSG:32650.");
    if (p.cellSize != null && p.cellSize < 30)
      throw new Error("Cloud density cell size must be at least 30 m.");
  }
  return { ...body, graph: g };
}
