import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import {
  aggregate,
  makeGrid,
  readRaster,
  stats,
  gridGeoJSON,
} from "../src/v2/raster-grid.mjs";
import {
  terrainMesh,
  heightAt,
  recoverGround,
  colorAt,
} from "../src/v2/terrain-mesh.mjs";
import { compileFormula, formulaGrid } from "../src/v2/formula.mjs";
import { parseEPW } from "../src/v2/epw.mjs";
import { packProject, unpackProject } from "../src/v2/project.mjs";
import { defaultGraph, validateGraph } from "../src/v2/circuit.mjs";
import { flattenGround, clipGrid } from "../src/v2/ground.mjs";
import { buildingModels } from "../src/v2/model.mjs";
import { encodeRhino } from "../src/v2/rhino-export.mjs";
const grid = {
  cols: 2,
  rows: 2,
  size: 10,
  origin: [500000, 2500000],
  bounds: [500000, 2500000, 500020, 2500020],
  crs: "EPSG:32650",
};
const raster = {
  width: 2,
  height: 2,
  extent: grid.bounds,
  crs: grid.crs,
  values: new Float32Array([10, 20, 0, NaN]),
  unit: "m",
  id: "test",
};
test("V2 refuses degree-based analysis grids and clips by actual polygon overlap", () => {
  assert.throws(() => makeGrid(raster, 30, "EPSG:4326"));
  const g = aggregate(raster, grid),
    boundary = gridGeoJSON(g, [0]);
  const clipped = clipGrid(g, boundary.features);
  assert.equal(stats(clipped.mean).count, 1);
  assert.equal(clipped.mean[0], 0);
  assert.equal(stats(g.mean).count, 3);
});
test("V2 grid preserves zero, masks, weights and south-up order", () => {
  const g = aggregate(raster, grid);
  assert.deepEqual(Array.from(g.mean), [0, NaN, 10, 20]);
  assert.equal(g.count[0], 1);
  assert.equal(g.coverage[1], 0);
  assert.equal(g.nodataRatio[1], 1);
  const coarse = aggregate(raster, { ...grid, cols: 1, rows: 1, size: 20 });
  assert.equal(coarse.mean[0], 10);
  assert.equal(coarse.coverage[0], 0.75);
  assert.equal(coarse.nodataRatio[0], 0.25);
});
test("V2 coarse pixels intersect smaller cells without false holes", () => {
  const g = aggregate(
    { ...raster, width: 1, height: 1, values: new Float32Array([12]) },
    grid,
  );
  assert.deepEqual([...g.mean], [12, 12, 12, 12]);
  assert.deepEqual([...g.coverage], [1, 1, 1, 1]);
});
test("V2 continuous surface shares vertices, leaves NoData holes, handles invalid colours", () => {
  const g = aggregate(raster, grid),
    m = terrainMesh(g);
  assert.equal(m.positions.length, 27);
  assert.equal(m.indices.length, 18);
  assert.equal(m.z[4], 10);
  assert.equal(heightAt(g, m, 15, 5), null);
  assert.ok(Number.isFinite(heightAt(g, m, 5, 5)));
  assert.deepEqual(colorAt(NaN, 0, 10), [0.7, 0.7, 0.7]);
});
test("V2 ground recovery never replaces unresolved with zero", () => {
  const g = aggregate(raster, grid),
    r = recoverGround(g, new Uint8Array([1, 1, 1, 1]));
  assert.ok([...r.mean].every(Number.isNaN));
  assert.ok([...r.groundStatus].every((x) => x === 2));
  assert.equal(g.mean[0], 0);
});
test("V2 formula language rejects code and protects masks", () => {
  assert.equal(compileFormula("clamp((x-25)/15, 0, 1)")(32.5), 0.5);
  for (const s of [
    'globalThis.fetch("x")',
    "x.constructor",
    "while(true){}",
    "Math.abs(x)",
    "process.exit()",
    "x;1",
    "constructor(x)",
  ])
    assert.throws(() => compileFormula(s));
  assert.ok(Number.isNaN(compileFormula("x/0")(2)));
  const g = formulaGrid(aggregate(raster, grid), "x+2");
  assert.equal(g.mean[0], 2);
  assert.ok(Number.isNaN(g.mean[1]));
});
test("V2 project round-trip retains Float32 NaN and IDs", () => {
  const p = unpackProject(
    packProject({
      layers: [{ kind: "raster", ...raster }],
      graph: defaultGraph(),
      id: "a",
    }),
  );
  assert.ok(p.layers[0].values instanceof Float32Array);
  assert.ok(Number.isNaN(p.layers[0].values[3]));
  assert.equal(p.id, "a");
});
test("V2 Circuit enforces typed inputs and acyclic connections", () => {
  const g = defaultGraph();
  assert.equal(validateGraph(g).length, g.nodes.length);
  assert.throws(() =>
    validateGraph({
      ...g,
      edges: [
        ...g.edges,
        { source: "weather", target: "grid", targetHandle: "raster" },
      ],
    }),
  );
  assert.throws(() =>
    validateGraph({
      ...g,
      edges: [
        ...g.edges,
        { source: "lstgrid", target: "grid", targetHandle: "align" },
      ],
    }),
  );
});
test("V2 GeoJSON exports selected zero-valued cells in longitude/latitude", () => {
  const out = gridGeoJSON(aggregate(raster, grid), [0]);
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].properties.mean_value, 0);
  assert.ok(
    Math.abs(out.features[0].geometry.coordinates[0][0][0] - 117) < 0.001,
  );
});
test(
  "V2 real local data and layered 3DM readback",
  { skip: !process.env.GEOCIM_REAL_DATA, timeout: 120000 },
  async () => {
    const root = new URL("../data/v2/shatou/", import.meta.url),
      bytes = readFileSync(new URL("dem.tif", root));
    const dem = await readRaster(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { id: "dem", unit: "m" },
    );
    assert.equal(stats(dem.values).count, 529246);
    assert.equal(dem.values.filter((v) => v === 0).length, 3792);
    const eb = readFileSync(new URL("lst.tif", root)),
      lst = await readRaster(
        eb.buffer.slice(eb.byteOffset, eb.byteOffset + eb.byteLength),
        { id: "lst", unit: "°C" },
      );
    assert.equal(stats(lst.values).count, 16570);
    const epw = parseEPW(readFileSync(new URL("weather.epw", root), "utf8"));
    assert.equal(epw.records.length, 8760);
    assert.equal(epw.station, "Shenzhen");
    assert.equal(epw.timezone, 8);
    assert.equal(epw.typicalYear, true);
    const buildingLayer = {
      id: "buildings",
      kind: "vector",
      heightField: "BLDG_HEIGH",
      data: JSON.parse(
        readFileSync(new URL("buildings.geojson", root), "utf8"),
      ),
    };
    assert.equal(buildingLayer.data.features.length, 3369);
    assert.equal(
      typeof buildingLayer.data.features[0].properties.BLDG_NO,
      "string",
    );
    const g0 = aggregate(dem, makeGrid(dem, 30, "EPSG:32650")),
      g = flattenGround(g0, buildingLayer.data.features),
      a = aggregate(lst, g0),
      terrain = terrainMesh(g),
      buildings = buildingModels([buildingLayer], g, terrain);
    assert.ok(buildings.models.length > 3000);
    const { default: init } = await import("rhino3dm");
    const rhino = await init();
    const result = await encodeRhino(
      rhino,
      { grid: g, lst: a, terrain, buildings },
      [buildingLayer],
      {
        wire: false,
        wireColor: "#645078",
        buildingColor: "#e4dfee",
        ramp: "thermal",
        min: 25,
        max: 39,
        zScale: 3,
      },
    );
    assert.ok(result.bytes.length > 1000);
    const read = rhino.File3dm.fromByteArray(result.bytes);
    assert.equal(read.layers().count, 8);
    assert.equal(read.settings().modelUnitSystem, rhino.UnitSystem.Meters);
    const georef = JSON.parse(read.strings().getvalue("GeoCIM:georeference"));
    assert.equal(georef.verticalScaleExport, 1);
    assert.ok(read.objects().count > 3000);
    read.delete();
    mkdirSync(new URL("../reports/v2/", import.meta.url), { recursive: true });
    writeFileSync(
      new URL("../reports/v2/test-export.3dm", import.meta.url),
      result.bytes,
    );
    writeFileSync(
      new URL("../reports/v2/integration-test.json", import.meta.url),
      JSON.stringify(
        {
          terrainCells: stats(g.mean).count,
          lstCells: stats(a.mean).count,
          buildingParts: buildings.models.length,
          skippedBuildingParts: buildings.skipped,
          rhino: result.meta.verified,
          epwHours: epw.records.length,
        },
        null,
        2,
      ),
    );
  },
);
