import test from "node:test";
import assert from "node:assert/strict";
import {
  copyToAnalysis,
  updateLayer,
  editAttribute,
  canAnalyze,
  demoWorkingLayers,
  remapDemoGraph,
} from "../src/v2/layer-policy.mjs";
import { cloudGraph } from "../src/v2/cloud.mjs";
import {
  defaultGraph,
  analysisGraph,
  evaluateGraph,
} from "../src/v2/circuit.mjs";
import { validateCloudRequest } from "../server/cloud-validation.mjs";
import { packProject, unpackProject } from "../src/v2/project.mjs";
import { safeOutputName } from "../src/v2/local-files.mjs";
const fixture = () => ({
  id: "buildings",
  name: "Buildings",
  kind: "vector",
  bucket: "display",
  heightField: "height",
  cloudSource: "buildings",
  data: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { height: 12 },
        geometry: { type: "Point", coordinates: [114, 22.5] },
      },
    ],
  },
});
test("Display metadata and attributes remain locked, styling remains available", () => {
  const l = fixture();
  assert.equal(canAnalyze(l), false);
  assert.throws(() => updateLayer(l, { bucket: "analysis" }), /read-only/);
  assert.throws(
    () => editAttribute(l, [0], "height", "20", "number"),
    /read-only/,
  );
  assert.equal(
    updateLayer(l, { symbology: { opacity: 0.4 } }).symbology.opacity,
    0.4,
  );
});
test("Independent working copy edits preserve display geometry and properties", () => {
  const source = fixture(),
    copy = copyToAnalysis(source, "work");
  copy.data.features[0].geometry.coordinates[0] = 113;
  const edited = editAttribute(copy, [0], "height", "20", "number");
  assert.equal(source.data.features[0].properties.height, 12);
  assert.equal(source.data.features[0].geometry.coordinates[0], 114);
  assert.equal(edited.data.features[0].properties.height, 20);
  assert.equal(edited.cloudSource, null);
  assert.equal(edited.modified, true);
  assert.throws(
    () => editAttribute(copy, [4], "height", 10, "number"),
    /selection/,
  );
  assert.throws(
    () => editAttribute(copy, [0], "height", "NaN", "number"),
    /finite/,
  );
});
test("Typed Circuit refuses display inputs", async () => {
  await assert.rejects(
    evaluateGraph(
      analysisGraph(fixture(), "statistics"),
      [fixture()],
      () => {},
      () => {},
      () => {},
    ),
    /Copy|copy|Display|display/,
  );
});
test("Demo graph sends only fixed source references, never features", () => {
  const ls = demoWorkingLayers(
    ["dem", "lst", "buildings", "boundary", "basemap", "epw"].map((id) => ({
      ...fixture(),
      id,
    })),
  );
  const graph = cloudGraph(remapDemoGraph(defaultGraph(), ls), ls);
  assert.doesNotMatch(JSON.stringify(graph), /FeatureCollection|coordinates/);
  assert.doesNotThrow(() =>
    validateCloudRequest({ example: "shatou-v2", action: "run", graph }),
  );
  ls.find((l) => l.id === "work-buildings").modified = true;
  assert.throws(
    () => cloudGraph(remapDemoGraph(defaultGraph(), ls), ls),
    /local|fixed|modified/i,
  );
});
test("Cloud rejects uploads, foreign data paths and undersized grids", () => {
  const valid = {
    example: "shatou-v2",
    action: "grid",
    source: "dem",
    size: 30,
    method: "mean",
  };
  assert.doesNotThrow(() => validateCloudRequest(valid));
  assert.throws(
    () => validateCloudRequest({ ...valid, data: { features: [] } }),
    /uploads/,
  );
  assert.throws(
    () => validateCloudRequest({ ...valid, source: "../../private" }),
    /Invalid/,
  );
  assert.throws(() => validateCloudRequest({ ...valid, size: 10 }), /Invalid/);
});
test("Summary results and parent groups survive project export", () => {
  const p = unpackProject(
    packProject({
      layers: [
        fixture(),
        {
          id: "report",
          kind: "summary",
          bucket: "results",
          data: { values: { mean: 21 } },
        },
      ],
    }),
  );
  assert.equal(p.layers[0].bucket, "display");
  assert.equal(p.layers[1].data.values.mean, 21);
  assert.equal(safeOutputName("../bad:data.json"), ".._bad_data.json");
});
