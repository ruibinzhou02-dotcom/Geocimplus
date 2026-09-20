import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, gridGeoJSON } from "../src/v2/raster-grid.mjs";
import { resampleGrid } from "../src/v2/resample.mjs";
import { classifyLayer, categoryOf } from "../src/v2/layers.mjs";
import {
  buildingModels,
  terrainMesh,
  vectorSurfaces,
} from "../src/v2/model.mjs";
import { transform } from "../src/v2/geo.mjs";
import {
  defaultGraph,
  validateGraph,
  validateInputLayer,
  analysisGraph,
  evaluateGraph,
  acceptsPort,
  migrateGraph,
} from "../src/v2/circuit.mjs";
import { analyze } from "../src/spatial-analysis.mjs";
import { packProject, unpackProject } from "../src/v2/project.mjs";
const g = {
  cols: 2,
  rows: 2,
  size: 10,
  origin: [500000, 2500000],
  bounds: [500000, 2500000, 500020, 2500020],
  crs: "EPSG:32650",
};
const r = {
  id: "test",
  kind: "raster",
  width: 2,
  height: 2,
  extent: g.bounds,
  crs: g.crs,
  values: Float32Array.from([10, 20, 0, 30]),
  unit: "m",
};
test("resampling samples correct centres, preserves zero and refuses NoData interpolation", () => {
  assert.deepEqual([...resampleGrid(r, g, "nearest").mean], [0, 30, 10, 20]);
  const centre = { ...g, cols: 1, rows: 1, size: 20 };
  assert.equal(resampleGrid(r, centre, "bilinear").mean[0], 15);
  const masked = { ...r, values: Float32Array.from([10, 20, 0, NaN]) };
  assert.ok(Number.isNaN(resampleGrid(masked, centre, "bilinear").mean[0]));
  assert.equal(resampleGrid(masked, centre, "mean").mean[0], 10);
  const outside = { ...g, origin: [499980, 2500000] };
  assert.ok([...resampleGrid(r, outside, "bilinear").mean].every(Number.isNaN));
  assert.throws(() => resampleGrid(r, g, "cubic"));
});
test("classification handles zero, missing values, repeated quantiles and categories", () => {
  const layer = {
    kind: "vector",
    data: {
      features: [0, 10, 20, null, "", 30].map((v) => ({ properties: { v } })),
    },
    symbology: { mode: "equal", field: "v", classes: 3 },
  };
  const c = classifyLayer(layer);
  assert.notDeepEqual(c.color(0), c.color(null));
  assert.notDeepEqual(c.color(0), c.color(30));
  const q = classifyLayer({
    ...layer,
    symbology: { mode: "quantile", field: "v", classes: 3 },
  });
  assert.ok(q.legend.length >= 3);
  const cat = classifyLayer({
    ...layer,
    symbology: { mode: "categorical", field: "v" },
  });
  assert.notDeepEqual(cat.color(0), cat.color(10));
  assert.equal(categoryOf({ ...layer, heightField: "v" }), "buildings");
  assert.equal(
    categoryOf({ ...layer, heightField: "v", category: "analysis" }),
    "analysis",
  );
});
test("building shells have consistently oriented faces for both polygon windings and holes", () => {
  const grid = aggregate({ ...r, values: new Float32Array(4) }, g),
    terrain = terrainMesh(grid),
    toLL = transform(g.crs, "EPSG:4326");
  const ring = [
      [2, 2],
      [18, 2],
      [18, 18],
      [2, 18],
      [2, 2],
    ],
    hole = [
      [7, 7],
      [13, 7],
      [13, 13],
      [7, 13],
      [7, 7],
    ];
  for (const reverse of [true, false]) {
    const coordinates = [ring, hole].map((x) =>
      (reverse ? [...x].reverse() : x).map(([x, y]) =>
        toLL([x + g.origin[0], y + g.origin[1]]),
      ),
    );
    const feature = {
      type: "Feature",
      properties: { height: 20 },
      geometry: { type: "Polygon", coordinates },
    };
    const models = buildingModels(
      [
        {
          id: "b",
          kind: "vector",
          heightField: "height",
          data: { features: [feature] },
        },
      ],
      grid,
      terrain,
    ).models;
    assert.equal(models.length, 1);
    const m = models[0],
      edges = new Map();
    let volume = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const ids = [...m.indices.slice(i, i + 3)],
        v = ids.map((id) => [...m.positions.slice(id * 3, id * 3 + 3)]);
      for (let j = 0; j < 3; j++) {
        const a = ids[j],
          b = ids[(j + 1) % 3],
          key = [Math.min(a, b), Math.max(a, b)].join(":");
        const e = edges.get(key) || [];
        e.push(a < b ? 1 : -1);
        edges.set(key, e);
      }
      const [a, b, c] = v;
      volume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) +
          a[1] * (b[2] * c[0] - b[0] * c[2]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) /
        6;
      if (v.every((q) => q[2] === 20))
        assert.ok(
          (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0,
        );
    }
    for (const pair of edges.values()) {
      assert.equal(pair.length, 2);
      assert.equal(pair[0] + pair[1], 0);
    }
    assert.ok(Math.abs(volume - (256 - 36) * 20) < 1);
  }
});
test("typed ports reject raster-vector and general vector-point connections; legacy graph migrates", () => {
  assert.ok(acceptsPort("points", "vector"));
  assert.ok(!acceptsPort("vector", "points"));
  assert.ok(!acceptsPort("raster", "grid"));
  const graph = defaultGraph();
  validateGraph(graph);
  graph.nodes.find((n) => n.id === "buildings").data.component = "vector";
  assert.throws(() => validateGraph(graph));
  validateGraph(migrateGraph(graph));
  assert.throws(() =>
    validateInputLayer("points", {
      kind: "vector",
      data: { features: [{ geometry: { type: "Polygon" } }] },
    }),
  );
});
test("local analytical batteries execute and publish a layer or statistics report", async () => {
  const data = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { value: 7 },
        geometry: { type: "Point", coordinates: [114, 22.5] },
      },
    ],
  };
  const layer = { id: "p", kind: "vector", name: "Synthetic point", data };
  const local = async ({ data, options }) => analyze(data, options);
  const result = await evaluateGraph(
    analysisGraph(layer, "buffer"),
    [layer],
    () => {},
    null,
    local,
  );
  assert.equal(result.result.data.features.length, 1);
  assert.equal(result.result.data.features[0].geometry.type, "Polygon");
  const graph = analysisGraph(layer, "statistics");
  graph.nodes.find((n) => n.id === "analysis").data.params.field = "value";
  const report = await evaluateGraph(graph, [layer], () => {}, null, local);
  assert.equal(report.result.values.mean, 7);
});
test("fishnet layer retains grid metadata and symbology through local project export", () => {
  const grid = aggregate(r, g),
    l = {
      id: "result",
      kind: "vector",
      category: "analysis",
      data: gridGeoJSON(grid),
      gridData: grid,
      symbology: {
        mode: "equal",
        field: "mean_value",
        classes: 5,
        outline: false,
      },
    };
  const restored = unpackProject(
    packProject({ layers: [l], graph: defaultGraph() }),
  ).layers[0];
  assert.ok(restored.gridData.mean instanceof Float32Array);
  assert.deepEqual([...restored.gridData.mean], [0, 30, 10, 20]);
  assert.equal(restored.symbology.outline, false);
});
test("selected fishnet is highlighted without altering its properties or class colours", () => {
  const grid = aggregate(r, g),
    data = gridGeoJSON(grid),
    before = JSON.stringify(data),
    layer = {
      id: "v",
      kind: "vector",
      category: "analysis",
      data,
      symbology: { mode: "equal", field: "mean_value" },
    };
  const surfaces = vectorSurfaces([layer], grid, terrainMesh(grid), [1]);
  assert.ok(Math.abs(surfaces.models[1].colors[0] - 1) < 1e-6);
  assert.ok(Math.abs(surfaces.models[1].colors[1] - 0.75) < 1e-6);
  assert.equal(JSON.stringify(data), before);
  assert.notDeepEqual(
    [...surfaces.models[0].colors.slice(0, 3)],
    [1, 0.75, 0.15],
  );
});
test("invalid saved fishnet arrays are refused and runtime failures mark the component", async () => {
  const grid = aggregate(r, g),
    l = {
      id: "r",
      kind: "vector",
      data: gridGeoJSON(grid),
      gridData: { ...grid, mean: new Float32Array(1) },
    };
  assert.throws(
    () => unpackProject(packProject({ layers: [l] })),
    /size mismatch/,
  );
  const point = {
    id: "point",
    kind: "vector",
    data: { features: [{ geometry: { type: "Point" } }] },
  };
  const graph = analysisGraph(point, "buffer");
  graph.nodes.find((n) => n.id === "source").data.params.layer = "absent";
  const steps = [];
  await assert.rejects(
    () => evaluateGraph(graph, [], (id, state) => steps.push([id, state])),
    /select a loaded layer/,
  );
  assert.deepEqual(steps.at(-1), ["source", "error"]);
});
