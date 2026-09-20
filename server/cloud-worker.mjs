import { parentPort, workerData } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readRaster, makeGrid, stats } from "../src/v2/raster-grid.mjs";
import { resampleGrid } from "../src/v2/resample.mjs";
import { flattenGround, clipGrid } from "../src/v2/ground.mjs";
import { formulaGrid } from "../src/v2/formula.mjs";
import { parseEPW } from "../src/v2/epw.mjs";
import { evaluateGraph } from "../src/v2/circuit.mjs";
import { analyze } from "../src/spatial-analysis.mjs";
import { packProject } from "../src/v2/project.mjs";
import { validateCloudRequest } from "./cloud-validation.mjs";
const started = Date.now();
try {
  const request = validateCloudRequest(workerData.request),
    catalog = JSON.parse(
      await readFile(join(workerData.dataDir, "catalog.json"), "utf8"),
    ),
    layers = [];
  for (const source of catalog.sources) {
    const bytes = await readFile(join(workerData.dataDir, source.url));
    const meta = {
      ...source,
      bucket: "analysis",
      visible: true,
      cloudSource: source.id,
    };
    if (source.kind === "raster")
      layers.push(
        await readRaster(
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          meta,
        ),
      );
    else if (source.kind === "epw")
      layers.push({ ...meta, data: parseEPW(bytes.toString("utf8")) });
    else layers.push({ ...meta, data: JSON.parse(bytes.toString("utf8")) });
  }
  const execute = async (type, p) => {
    if (type === "grid") {
      if (!p.grid && (!Number.isFinite(p.size) || p.size < 30 || p.size > 1000))
        throw new Error("Cloud grid size must be 30–1000 m.");
      const g = p.grid || makeGrid(p.raster, p.size, p.crs);
      if (g.cols * g.rows > 30000 || g.size < 30)
        throw new Error(
          "Cloud example uses 30 m or coarser grids, up to 30,000 cells.",
        );
      return resampleGrid(p.raster, g, p.method || "mean");
    }
    if (type === "ground") return flattenGround(p.grid, p.features);
    if (type === "clip") return clipGrid(p.grid, p.features);
    if (type === "formula") return formulaGrid(p.grid, p.expression, p.unit);
    throw new Error("This operation is not offered by the cloud example.");
  };
  let outcome;
  if (request.action === "grid") {
    const raster = layers.find(
      (l) => l.id === request.source && l.kind === "raster",
    );
    if (!raster) throw new Error("Unknown example raster.");
    const grid = await execute("grid", {
      raster,
      size: request.size,
      crs: catalog.analysisCRS,
      method: request.method,
    });
    outcome = { convertedGrid: grid };
  } else
    outcome = await evaluateGraph(
      request.graph,
      layers,
      () => {},
      execute,
      async (p) => {
        if (p.options.operation === "kde" && p.options.cellSize < 30)
          throw new Error("Cloud density cell size must be at least 30 m.");
        return analyze(p.data, p.options);
      },
    );
  const execution = {
    location: "server",
    example: "shatou-v2",
    durationMs: Date.now() - started,
    computedAt: new Date().toISOString(),
    stored: false,
  };
  const bytes = packProject({
    layers: [],
    ...(outcome.grid ? { scene: outcome } : outcome),
    execution,
  });
  parentPort.postMessage({ bytes }, [bytes.buffer]);
} catch (e) {
  parentPort.postMessage({ error: e.message });
}
