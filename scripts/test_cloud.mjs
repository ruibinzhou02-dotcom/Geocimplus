import { spawn } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { defaultGraph, analysisGraph } from "../src/v2/circuit.mjs";
import { unpackProject } from "../src/v2/project.mjs";
import assert from "node:assert/strict";
const endpoint = process.env.GEOCIM_CLOUD_URL || "http://127.0.0.1:8791";
const child = process.env.GEOCIM_CLOUD_URL
  ? null
  : spawn(process.execPath, ["releases/cloud-v2/cloud-server.mjs"], {
      env: {
        ...process.env,
        PORT: "8791",
        GEOCIM_DATA: process.cwd() + "/data/v2/shatou",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
try {
  if (child)
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.stderr.on("data", (b) => process.stderr.write(b));
    });
  const requests = [
    ["scene", { action: "run", graph: defaultGraph() }],
    ["grid", { action: "grid", source: "lst", size: 50, method: "bilinear" }],
  ];
  const building = {
    id: "buildings",
    kind: "vector",
    data: JSON.parse(
      readFileSync(
        (process.env.GEOCIM_TEST_DATA || "data/v2/shatou") +
          "/buildings.geojson",
        "utf8",
      ),
    ),
  };
  const graph = analysisGraph(building, "statistics");
  graph.nodes.find((n) => n.data.component === "statistics").data.params.field =
    "BLDG_HEIGH";
  requests.push(["statistics", { action: "run", graph }]);
  const results = [];
  for (const [name, request] of requests) {
    const response = await fetch(endpoint + "/cloud-v2/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ example: "shatou-v2", ...request }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok)
      throw new Error(`${name} ${response.status}: ${await response.text()}`);
    assert.equal(response.headers.get("X-GeoCIM-Execution"), "server");
    const p = unpackProject(new Uint8Array(await response.arrayBuffer()));
    assert.equal(p.execution.location, "server");
    if (name === "scene") {
      assert.ok(p.scene.grid.mean.filter(Number.isFinite).length > 1000);
      assert.deepEqual(p.scene.buildingIds, ["buildings"]);
    }
    if (name === "grid")
      assert.ok(p.convertedGrid.mean.filter(Number.isFinite).length > 1000);
    if (name === "statistics") {
      assert.equal(p.result.values.count, 3369);
      assert.ok(Math.abs(p.result.values.mean - 21.477352) < 0.0001);
    }
    results.push({
      name,
      execution: p.execution,
      values: p.result?.values,
      cells: (p.scene?.grid || p.convertedGrid)?.mean.filter(Number.isFinite)
        .length,
    });
  }
  const bad = await fetch(endpoint + "/cloud-v2/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      example: "shatou-v2",
      action: "grid",
      source: "dem",
      size: 30,
      method: "mean",
      data: { features: [] },
    }),
  });
  assert.equal(bad.status, 422);
  mkdirSync("reports/v2.2", { recursive: true });
  writeFileSync(
    "reports/v2.2/" + (child ? "local" : "production") + "-cloud.json",
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        endpoint,
        results,
        rejectedUpload: bad.status,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(results));
} finally {
  child?.kill();
}
