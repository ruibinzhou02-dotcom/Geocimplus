import { updateLayer } from "../src/v2/layer-policy.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { zipSync } from "fflate";
import {
  inspectDatasets,
  mergeCatalogFiles,
  shapeType,
  geometryType,
} from "../src/v2/import-catalog.mjs";
import {
  COMPONENTS,
  PORT_TYPES,
  defaultGraph,
  analysisGraph,
  evaluateGraph,
  validateGraph,
} from "../src/v2/circuit.mjs";
import { boundedNumber, numberValue } from "../src/v2/numeric-input.mjs";
import { localLabel, portLabel } from "../src/v2/circuit-labels.mjs";
import { flatImagery } from "../src/v2/flat-imagery.mjs";
import { validateCloudRequest } from "../server/cloud-validation.mjs";
import { analyze } from "../src/spatial-analysis.mjs";
import { encodeRhino } from "../src/v2/rhino-export.mjs";
import { terrainMesh } from "../src/v2/model.mjs";
const fixtures = new URL("./fixtures/browser/", import.meta.url);
const file = async (name, path) => {
  const f = new File([await readFile(new URL(name, fixtures))], name);
  if (path) Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
};
test("Catalog groups SHP sidecars, repairs missing companions, reads geometry rather than Windows association", async () => {
  const shp = await file("points.shp");
  let entries = await inspectDatasets([shp]);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "point");
  assert.equal(entries[0].ready, false);
  assert.deepEqual(entries[0].missing, ["shx", "dbf", "prj"]);
  const parts = await Promise.all(
    ["points.shx", "points.dbf", "points.prj", "points.cpg"].map((n) =>
      file(n),
    ),
  );
  const merged = mergeCatalogFiles([shp], [...parts, shp]);
  assert.equal(merged.length, 5);
  entries = await inspectDatasets(merged);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].ready, true);
  assert.equal(entries[0].count, 2);
  for (const [code, type] of [
    [1, "point"],
    [8, "point"],
    [3, "line"],
    [13, "line"],
    [5, "polygon"],
    [15, "polygon"],
  ]) {
    const b = new ArrayBuffer(100),
      v = new DataView(b);
    v.setInt32(0, 9994);
    v.setInt32(28, 1000, true);
    v.setInt32(32, code, true);
    assert.equal(shapeType(b), type);
  }
  assert.throws(() => shapeType(new ArrayBuffer(99)));
  assert.equal(
    geometryType([{ geometry: { type: "MultiLineString" } }]),
    "line",
  );
});
test("Folder and ZIP catalog keeps equal basenames separate and recognizes ArcInfo Grid as requiring conversion", async () => {
  const parts = [];
  for (const folder of ["a", "b"])
    for (const ext of ["shp", "shx", "dbf", "prj"])
      parts.push(await file("points." + ext, folder + "/points." + ext));
  const entries = await inspectDatasets(parts);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.ready && e.files.length === 4));
  assert.notEqual(entries[0].id, entries[1].id);
  const zipped = {};
  for (const f of parts)
    zipped[f.webkitRelativePath] = new Uint8Array(await f.arrayBuffer());
  const z = await inspectDatasets([new File([zipSync(zipped)], "data.zip")]);
  assert.equal(z.length, 2);
  assert.ok(z.every((e) => e.ready));
  const adf = new File([new Uint8Array(308)], "hdr.adf");
  Object.defineProperty(adf, "webkitRelativePath", { value: "111c2/hdr.adf" });
  const [a] = await inspectDatasets([adf]);
  assert.equal(a.format, "ArcInfo Grid");
  assert.equal(a.type, "raster");
  assert.equal(a.ready, false);
});
test("Catalog detects GeoTIFF and GeoJSON types without converting files", async () => {
  const entries = await inspectDatasets([
    await file("sample.tif"),
    new File(
      [
        JSON.stringify({
          type: "FeatureCollection",
          features: [{ geometry: { type: "Polygon", coordinates: [] } }],
        }),
      ],
      "areas.geojson",
    ),
  ]);
  assert.equal(entries.find((e) => e.format === "GeoJSON").type, "polygon");
  assert.equal(entries.find((e) => e.format === "GeoTIFF").type, "raster");
});
test("Every component, group and port has a Chinese label", () => {
  const zh = (_, z) => z;
  for (const c of Object.values(COMPONENTS)) {
    assert.notEqual(localLabel(c.group, zh), c.group);
    assert.notEqual(localLabel(c.label, zh), c.label);
    for (const [name, type] of Object.entries(c.inputs)) {
      assert.notEqual(portLabel(name, zh), name);
      assert.notEqual(portLabel(type, zh), type);
    }
  }
  for (const s of Object.values(PORT_TYPES))
    assert.notEqual(localLabel(s, zh), s);
});
test("Connected number battery changes actual buffer area, overrides fallback and rejects incompatible links", async () => {
  const layer = {
    id: "p",
    name: "Point",
    kind: "vector",
    bucket: "analysis",
    data: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: [114, 22.5] },
        },
      ],
    },
  };
  const g = analysisGraph(layer, "buffer");
  g.nodes.push({
    id: "number",
    type: "battery",
    position: { x: 0, y: -180 },
    data: {
      component: "number",
      params: { value: 50, min: 0, max: 500, step: 5 },
    },
  });
  g.edges.push({
    id: "numeric",
    source: "number",
    sourceHandle: "out",
    target: "analysis",
    targetHandle: "distance",
  });
  validateGraph(g);
  const run = () =>
    evaluateGraph(
      g,
      [layer],
      () => {},
      undefined,
      async (p) => analyze(p.data, p.options),
    );
  const a = await run();
  g.nodes.at(-1).data.params.value = 100;
  const b = await run();
  const aa = analyze(a.result.data, { operation: "measure" }),
    bb = analyze(b.result.data, { operation: "measure" });
  const fields = Object.keys(aa.data.features[0].properties);
  const field = fields.find((f) => /area/i.test(f));
  assert.ok(field);
  assert.ok(
    bb.data.features[0].properties[field] >
      aa.data.features[0].properties[field] * 3.9,
  );
  const broken = structuredClone(g);
  broken.edges.at(-1).targetHandle = "features";
  assert.throws(() => validateGraph(broken));
});
test("Numbers preserve decimal steps and cannot bypass cloud grid limits", () => {
  assert.equal(boundedNumber(0.26, 0, 1, 0.1), 0.3);
  assert.equal(boundedNumber(999, 0, 100, 5), 100);
  assert.equal(numberValue({ value: 0, min: -10, max: 10 }), 0);
  assert.throws(() => numberValue({ value: Infinity }));
  assert.throws(() => numberValue({ min: 10, max: 5 }));
  const g = defaultGraph();
  validateCloudRequest({ example: "shatou-v2", action: "run", graph: g });
  g.nodes.find((n) => n.id === "resolution").data.params = {
    value: 5,
    min: 0,
    max: 500,
    step: 1,
  };
  assert.throws(
    () =>
      validateCloudRequest({ example: "shatou-v2", action: "run", graph: g }),
    /30/,
  );
});
test("Flat satellite retains all original pixels and a single reference height; Rhino preserves its layer", async () => {
  const g = {
    crs: "EPSG:32650",
    origin: [500000, 2500000],
    bounds: [500000, 2500000, 500020, 2500020],
    size: 10,
    cols: 2,
    rows: 2,
    mean: Float32Array.from([1, 2, 3, 4]),
    unit: "m",
  };
  const r = {
    id: "sat",
    crs: g.crs,
    extent: g.bounds,
    width: 2,
    height: 2,
    values: Float32Array.from([10, 20, 0, NaN]),
  };
  const flat = flatImagery(r, g, -30);
  assert.ok(
    [...flat.mesh.positions]
      .filter((_, i) => i % 3 === 2)
      .every((z) => z === -30),
  );
  assert.deepEqual(
    [...flat.texture.pixels],
    [10, 10, 10, 255, 20, 20, 20, 255, 0, 0, 0, 255, 0, 0, 0, 0],
  );
  assert.deepEqual([...flat.mesh.uv.slice(0, 2)], [0, 0]);
  assert.deepEqual([...flat.mesh.uv.slice(-2)], [1, 1]);
  const { default: init } = await import("rhino3dm"),
    rhino = await init(),
    terrain = terrainMesh(g);
  const encoded = await encodeRhino(
    rhino,
    {
      grid: g,
      terrain,
      flatTexture: flat,
      buildings: { models: [], skipped: 0 },
    },
    [],
    { wire: false, wireColor: "#333333", buildingColor: "#aaaaaa", zScale: 2 },
  );
  const doc = rhino.File3dm.fromByteArray(encoded.bytes);
  assert.equal(doc.layers().get(8).name, "08_FlatBaseMap");
  assert.equal(encoded.meta.flatImageryReferenceZ, -30);
  assert.equal(doc.materials().get(0).name, "GeoCIM flat satellite");
  doc.delete();
});
test(
  "Real road derivative preserves polyline records and longitude/latitude coordinates",
  { skip: !process.env.GEOCIM_REAL_DATA },
  async () => {
    const data = JSON.parse(
      await readFile(
        new URL("../data/v2/shatou/roads.geojson", import.meta.url),
        "utf8",
      ),
    );
    assert.equal(data.features.length, 124);
    assert.ok(
      data.features.every((f) =>
        ["LineString", "MultiLineString"].includes(f.geometry.type),
      ),
    );
    const [x, y] = data.features[0].geometry.coordinates[0];
    assert.ok(x > 113 && x < 115 && y > 22 && y < 23);
  },
);

test("User-renamed layers keep their new name in both languages", () => {
  const l = { name: "Road network", nameZh: "路网", bucket: "analysis" };
  const out = updateLayer(l, { name: "我的测试道路" });
  assert.equal(out.name, "我的测试道路");
  assert.equal(out.nameZh, undefined);
  assert.equal(l.nameZh, "路网");
});
