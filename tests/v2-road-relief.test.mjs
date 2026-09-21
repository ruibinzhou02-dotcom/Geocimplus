import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { roadRibbon, roadModels, ROAD_DISPLAY } from "../src/v2/road-mesh.mjs";
import { terrainMesh, heightAt } from "../src/v2/terrain-mesh.mjs";
import { readRaster, makeGrid, aggregate } from "../src/v2/raster-grid.mjs";
import { transform } from "../src/v2/geo.mjs";
import { encodeRhino } from "../src/v2/rhino-export.mjs";
const grid = () => ({
  crs: "EPSG:32650",
  origin: [500000, 2500000],
  bounds: [500000, 2500000, 500050, 2500050],
  cols: 5,
  rows: 5,
  size: 10,
  mean: Float32Array.from(
    { length: 25 },
    (_, i) => (i % 5) * 7 + Math.floor(i / 5) * 3,
  ),
  unit: "m",
});
function verify(m, g, terrain) {
  assert.ok(m.indices.length > 0);
  assert.ok([...m.positions].every(Number.isFinite));
  for (let i = 0; i < m.indices.length; i += 3) {
    const ids = [...m.indices.slice(i, i + 3)];
    if (ids.some((k) => k >= m.topVertexCount)) continue;
    const p = [0, 0, 0];
    for (const k of ids)
      for (let d = 0; d < 3; d++) p[d] += m.positions[k * 3 + d] / 3;
    const z = heightAt(g, terrain, p[0], p[1]);
    assert.notEqual(z, null, "Road must not bridge NoData");
    assert.ok(
      Math.abs(p[2] - z - ROAD_DISPLAY.clearance - ROAD_DISPLAY.thickness) <
        0.001,
      "Top follows the actual terrain triangle",
    );
  }
  for (let i = 0; i < m.topVertexCount; i++)
    assert.ok(
      Math.abs(
        m.positions[i * 3 + 2] -
          m.positions[(i + m.topVertexCount) * 3 + 2] -
          ROAD_DISPLAY.thickness,
      ) < 0.001,
    );
}
test("Thin roads follow sloped terrain triangles, preserve positive thickness and form closed shells", () => {
  const g = grid(),
    terrain = terrainMesh(g),
    path = [
      [2, 5],
      [25, 25],
      [48, 45],
    ],
    source = JSON.stringify(path),
    m = roadRibbon(path, g, terrain);
  verify(m, g, terrain);
  assert.equal(JSON.stringify(path), source);
  const edges = new Map();
  for (let i = 0; i < m.indices.length; i += 3) {
    const f = [...m.indices.slice(i, i + 3)];
    for (let j = 0; j < 3; j++) {
      const a = f[j],
        b = f[(j + 1) % 3],
        key = [Math.min(a, b), Math.max(a, b)].join(":");
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  assert.ok(
    [...edges.values()].every((n) => n === 2),
    "All shell edges have exactly two adjacent faces",
  );
});
test("Roads leave NoData empty, ignore duplicate points and do not create zero-height bridges", () => {
  const g = grid();
  for (let y = 0; y < 5; y++) g.mean[y * 5 + 2] = NaN;
  const terrain = terrainMesh(g),
    m = roadRibbon(
      [
        [2, 24],
        [2, 24],
        [48, 24],
      ],
      g,
      terrain,
    );
  verify(m, g, terrain);
  assert.equal(
    roadRibbon(
      [
        [1, 1],
        [1, 1],
      ],
      g,
      terrain,
    ),
    null,
  );
});
test("Road visibility, thematic colours and selection work without changing source data; Rhino exports relief", async () => {
  const g = grid(),
    terrain = terrainMesh(g),
    p = transform(g.crs, "EPSG:4326"),
    l = {
      id: "roads",
      kind: "vector",
      category: "transport",
      name: "Road network",
      visible: true,
      data: {
        features: [
          {
            type: "Feature",
            properties: { name: "Test road", n: 2 },
            geometry: {
              type: "LineString",
              coordinates: [
                [2, 10],
                [48, 35],
              ].map(([x, y]) => p([x + g.origin[0], y + g.origin[1]])),
            },
          },
        ],
      },
    },
    before = JSON.stringify(l);
  const normal = roadModels([l], g, terrain),
    selected = roadModels([l], g, terrain, { layer: "roads", ids: [0] });
  assert.equal(normal.length, 1);
  assert.notDeepEqual(normal[0].colors, selected[0].colors);
  assert.equal(roadModels([{ ...l, visible: false }], g, terrain).length, 0);
  assert.equal(JSON.stringify(l), before);
  const { default: init } = await import("rhino3dm"),
    rhino = await init();
  const out = await encodeRhino(
    rhino,
    { grid: g, terrain, buildings: { models: [], skipped: 0 } },
    [l],
    { zScale: 1, wire: false, wireColor: "#333333", buildingColor: "#aaaaaa" },
  );
  const doc = rhino.File3dm.fromByteArray(out.bytes);
  assert.equal(doc.layers().get(8).name, "09_RoadNetwork");
  const objects = [];
  for (let i = 0; i < doc.objects().count; i++) {
    const o = doc.objects().get(i);
    if (o.attributes().layerIndex === 8) objects.push(o);
  }
  assert.equal(objects.length, 1);
  assert.equal(objects[0].geometry().constructor.name, "Mesh");
  assert.equal(
    objects[0].attributes().getUserString("display_thickness_m"),
    "0.15",
  );
  doc.delete();
});
test(
  "Real 124-road layer produces finite terrain-attached display meshes",
  { skip: !process.env.GEOCIM_REAL_DATA },
  async () => {
    const root = new URL("../data/v2/shatou/", import.meta.url),
      bytes = await readFile(new URL("dem.tif", root)),
      r = await readRaster(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
        { id: "dem", unit: "m" },
      ),
      g = aggregate(r, makeGrid(r, 30, "EPSG:32650")),
      terrain = terrainMesh(g),
      data = JSON.parse(await readFile(new URL("roads.geojson", root), "utf8"));
    const models = roadModels(
      [{ id: "roads", category: "transport", kind: "vector", data }],
      g,
      terrain,
    );
    assert.equal(data.features.length, 124);
    assert.ok(models.length > 100);
    for (const m of models) verify(m, g, terrain);
  },
);
