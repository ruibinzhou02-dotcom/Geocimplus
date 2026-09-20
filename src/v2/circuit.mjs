import { localLabel } from "./circuit-labels.mjs";
import { numberValue } from "./numeric-input.mjs";
import { canAnalyze } from "./layer-policy.mjs";
import { job } from "./jobs.mjs";
import { runJob } from "../jobs.mjs";
import { metricCRS, transform } from "./geo.mjs";
export const COMPONENTS = {
  number: { group: "Input", label: "Number slider", inputs: {}, out: "number" },
  gridInput: {
    group: "Input",
    label: "Fishnet input",
    inputs: {},
    out: "grid",
  },
  points: { group: "Input", label: "Point input", inputs: {}, out: "points" },
  polygons: {
    group: "Input",
    label: "Polygon input",
    inputs: {},
    out: "polygons",
  },
  measure: {
    group: "Vector analysis",
    label: "Area / length",
    inputs: { features: "vector" },
    out: "vector",
  },
  statistics: {
    group: "Vector analysis",
    label: "Field statistics",
    inputs: { features: "vector" },
    out: "summary",
  },
  centroid: {
    group: "Vector analysis",
    label: "Representative points",
    inputs: { features: "vector" },
    out: "points",
  },
  buffer: {
    group: "Vector analysis",
    label: "Buffer",
    inputs: { features: "vector", distance: "number?" },
    out: "polygons",
  },
  kde: {
    group: "Vector analysis",
    label: "Point kernel density",
    inputs: { features: "points", bandwidth: "number?", cellSize: "number?" },
    out: "polygons",
  },
  publish: {
    group: "Output",
    label: "Result layer",
    inputs: { features: "vector" },
    out: "result",
  },
  report: {
    group: "Output",
    label: "Statistics report",
    inputs: { summary: "summary" },
    out: "result",
  },
  clip: {
    group: "Coordinate / Grid",
    label: "Clip grid by boundary",
    inputs: { grid: "grid", boundary: "polygons" },
    out: "grid",
  },
  raster: { group: "Input", label: "Raster input", inputs: {}, out: "raster" },
  vector: { group: "Input", label: "Vector input", inputs: {}, out: "vector" },
  weather: { group: "Input", label: "EPW input", inputs: {}, out: "weather" },
  grid: {
    group: "Coordinate / Grid",
    label: "Raster → metric grid",
    inputs: { raster: "raster", align: "grid?", size: "number?" },
    out: "grid",
  },
  ground: {
    group: "Terrain",
    label: "Flatten building ground",
    inputs: { grid: "grid", buildings: "polygons" },
    out: "grid",
  },
  terrain: {
    group: "Terrain",
    label: "Continuous surface",
    inputs: { grid: "grid" },
    out: "terrain",
  },
  formula: {
    group: "Sandbox",
    label: "Safe formula",
    inputs: { grid: "grid" },
    out: "grid",
  },
  style: {
    group: "Style",
    label: "Colour ramp",
    inputs: { grid: "grid" },
    out: "grid",
  },
  output: {
    group: "Output",
    label: "Scene preview",
    inputs: {
      terrain: "terrain",
      analysis: "grid?",
      buildings: "vector?",
      weather: "weather?",
    },
    out: "scene",
  },
};
const node = (id, component, x, y, params = {}) => ({
  id,
  type: "battery",
  position: { x, y },
  data: { component, params },
});
const edge = (source, target, targetHandle) => ({
  id: `${source}-${target}-${targetHandle}`,
  source,
  target,
  sourceHandle: "out",
  targetHandle,
});
export function defaultGraph() {
  return {
    version: 2,
    nodes: [
      node("resolution", "number", 0, -230, {
        value: 30,
        min: 30,
        max: 500,
        step: 5,
      }),
      node("dem", "raster", 0, 0, { layer: "dem" }),
      node("lst", "raster", 0, 220, { layer: "lst" }),
      node("buildings", "polygons", 270, -190, { layer: "buildings" }),
      node("weather", "weather", 810, 440, { layer: "epw" }),
      node("grid", "grid", 270, 0, { size: 30, crs: "EPSG:32650" }),
      node("lstgrid", "grid", 540, 220, { size: 30, crs: "EPSG:32650" }),
      node("ground", "ground", 540, 0),
      node("surface", "terrain", 810, 0),
      node("style", "style", 810, 220, { ramp: "thermal" }),
      node("view", "output", 1100, 60),
    ],
    edges: [
      edge("resolution", "grid", "size"),
      edge("dem", "grid", "raster"),
      edge("lst", "lstgrid", "raster"),
      edge("grid", "lstgrid", "align"),
      edge("grid", "ground", "grid"),
      edge("buildings", "ground", "buildings"),
      edge("ground", "surface", "grid"),
      edge("lstgrid", "style", "grid"),
      edge("surface", "view", "terrain"),
      edge("style", "view", "analysis"),
      edge("buildings", "view", "buildings"),
      edge("weather", "view", "weather"),
    ],
  };
}
export const PORT_TYPES = {
  number: "Finite numerical value",
  raster: "Geo-referenced numeric or RGB raster",
  vector: "GeoJSON feature collection (WGS84)",
  points: "Point / MultiPoint features (WGS84)",
  polygons: "Polygon / MultiPolygon features (WGS84)",
  grid: "Aligned metric fishnet: CRS, cell size, values, NoData",
  terrain: "Continuous mesh from a metric grid",
  weather: "EPW station and hourly weather records",
  summary: "Named statistical values",
  scene: "Scene preview",
  result: "Published result",
};
export function acceptsPort(out, input) {
  const t = input?.replace("?", "");
  return out === t || (t === "vector" && ["points", "polygons"].includes(out));
}
export function validateInputLayer(component, layer) {
  if (layer && !canAnalyze(layer))
    throw new Error("Copy display data to Analysis before connecting it.");
  if (!layer) throw new Error("Select a loaded input layer.");
  const expected =
    {
      weather: "epw",
      gridInput: "vector",
      points: "vector",
      polygons: "vector",
    }[component] || component;
  if (layer.kind !== expected) throw new Error("Input layer type mismatch.");
  if (component === "gridInput" && !layer.gridData)
    throw new Error("Select a converted fishnet layer.");
  if (["points", "polygons"].includes(component)) {
    const types =
      component === "points"
        ? ["Point", "MultiPoint"]
        : ["Polygon", "MultiPolygon"];
    if (
      !layer.data.features.length ||
      layer.data.features.some((f) => !types.includes(f.geometry?.type))
    )
      throw new Error(`Expected ${component} geometry.`);
  }
  return component === "gridInput" ? layer.gridData : layer;
}
// Old V2 files used a generic vector source for building/boundary ports.
export function migrateGraph(graph) {
  if (!Array.isArray(graph?.nodes) || !Array.isArray(graph?.edges))
    throw new Error("Invalid Circuit file.");
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.data?.component === "vector" &&
      graph.edges.some(
        (e) =>
          e.source === n.id &&
          ["buildings", "boundary"].includes(e.targetHandle) &&
          ["ground", "clip"].includes(
            graph.nodes.find((x) => x.id === e.target)?.data?.component,
          ),
      )
        ? { ...n, data: { ...n.data, component: "polygons" } }
        : n,
    ),
  };
}
export function analysisGraph(layer, operation = "kde") {
  const isPoint = layer.data.features.every((f) =>
    ["Point", "MultiPoint"].includes(f.geometry.type),
  );
  const nodes = [
      node("source", isPoint ? "points" : "vector", 0, 80, { layer: layer.id }),
    ],
    edges = [];
  let input = "source";
  if (operation === "kde" && !isPoint) {
    nodes.push(node("points", "centroid", 290, 80));
    edges.push(edge(input, "points", "features"));
    input = "points";
  }
  nodes.push(
    node(
      "analysis",
      operation,
      operation === "kde" && !isPoint ? 580 : 290,
      80,
      {
        distance: 100,
        bandwidth: 200,
        cellSize: 50,
        field: layer.heightField || "",
      },
    ),
  );
  edges.push(edge(input, "analysis", "features"));
  nodes.push(
    node(
      "result",
      operation === "statistics" ? "report" : "publish",
      operation === "kde" && !isPoint ? 870 : 580,
      80,
    ),
  );
  edges.push(
    edge(
      "analysis",
      "result",
      operation === "statistics" ? "summary" : "features",
    ),
  );
  return { version: 2, nodes, edges };
}
export function validateGraph(graph) {
  if (
    graph?.version !== 2 ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    graph.nodes.length > 40 ||
    graph.edges.length > 80
  )
    throw new Error(
      "Invalid Circuit 2 file (max 40 components / 80 connections).",
    );
  const map = new Map(),
    ports = new Set();
  const allIds = new Set();
  for (const n of graph.nodes) {
    if (allIds.has(n.id)) throw new Error("Duplicate component or group ID.");
    allIds.add(n.id);
    if (n.type === "group") continue;
    if (
      typeof n.id !== "string" ||
      n.id.length > 80 ||
      map.has(n.id) ||
      !COMPONENTS[n.data?.component]
    )
      throw new Error("Unknown or duplicate component.");
    map.set(n.id, n);
  }
  for (const e of graph.edges) {
    const a = map.get(e.source),
      b = map.get(e.target),
      input = b && COMPONENTS[b.data.component].inputs[e.targetHandle],
      out = a && COMPONENTS[a.data.component].out;
    if (
      !input ||
      !acceptsPort(out, input) ||
      (e.sourceHandle && e.sourceHandle !== "out")
    )
      throw new Error("Incompatible component ports.");
    const k = e.target + ":" + e.targetHandle;
    if (ports.has(k)) throw new Error("Only one connection per input.");
    ports.add(k);
  }
  const order = [],
    pending = new Set(map.keys());
  while (pending.size) {
    const ready = [...pending].filter(
      (id) =>
        !graph.edges.some((e) => e.target === id && pending.has(e.source)),
    );
    if (!ready.length) throw new Error("Circuit contains a cycle.");
    for (const id of ready) {
      pending.delete(id);
      order.push(map.get(id));
    }
  }
  return order;
}
export async function evaluateGraph(
  graph,
  layers,
  onStep = () => {},
  execute = job,
  spatial = (payload) => runJob(payload).promise,
) {
  graph = migrateGraph(graph);
  const order = validateGraph(graph),
    results = new Map();
  let scene = null;
  const outputs = order.filter((n) =>
    ["output", "publish", "report"].includes(n.data.component),
  );
  if (outputs.length !== 1)
    throw new Error(
      "Use exactly one output: Scene preview, Result layer or Statistics report.",
    );
  const needed = new Set([outputs[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of graph.edges)
      if (needed.has(e.target) && !needed.has(e.source)) {
        needed.add(e.source);
        changed = true;
      }
  }
  for (const n of order.filter((n) => needed.has(n.id))) {
    const { component: c, params: p = {} } = n.data,
      def = COMPONENTS[c],
      args = {};
    onStep(n.id, "running");
    try {
      for (const [port, type] of Object.entries(def.inputs)) {
        const e = graph.edges.find(
          (e) => e.target === n.id && e.targetHandle === port,
        );
        if (!e && !type.endsWith("?"))
          throw new Error(`${def.label}: connect ${port}.`);
        args[port] = e ? results.get(e.source) : null;
      }
      let value;
      if (c === "number") value = numberValue(p);
      else if (
        [
          "raster",
          "vector",
          "weather",
          "points",
          "polygons",
          "gridInput",
        ].includes(c)
      ) {
        value = layers.find((l) => l.id === p.layer);
        if (!value) throw new Error(`${def.label}: select a loaded layer.`);
        value = validateInputLayer(c, value);
      } else if (c === "grid")
        value = await execute("grid", {
          raster: args.raster,
          size: Number(args.size ?? p.size ?? 30),
          crs:
            p.crs ||
            metricCRS(
              ...transform(
                args.raster.crs,
                "EPSG:4326",
              )([
                (args.raster.extent[0] + args.raster.extent[2]) / 2,
                (args.raster.extent[1] + args.raster.extent[3]) / 2,
              ]),
            ),
          method: p.method || "mean",
          grid: args.align || null,
        });
      else if (
        ["measure", "statistics", "centroid", "buffer", "kde"].includes(c)
      ) {
        if (c === "kde") validateInputLayer("points", args.features);
        if (
          c === "statistics" &&
          (!p.field ||
            !args.features.data.features.some((f) =>
              Object.hasOwn(f.properties || {}, p.field),
            ))
        )
          throw new Error("Select an existing field for statistics.");
        value = await spatial({
          job: "analysis",
          data: args.features.data,
          options: {
            operation: c,
            field: p.field || "",
            distance: Number(args.distance ?? p.distance ?? 100),
            bandwidth: Number(args.bandwidth ?? p.bandwidth ?? 200),
            cellSize: Number(args.cellSize ?? p.cellSize ?? 50),
            weightField: p.weightField || "",
            sourceId: args.features.id,
            sourceName: args.features.name,
            id: `circuit-${n.id}`,
          },
        });
        value = {
          ...value,
          name: `${def.label} · ${args.features.name}`,
          nameZh: `${localLabel(def.label, (_, zh) => zh)} · ${args.features.nameZh || args.features.name}`,
          category: "analysis",
          heightField: "",
        };
      } else if (c === "publish" || c === "report") {
        scene = { result: args.features || args.summary };
        value = scene;
      } else if (c === "clip")
        value = await execute("clip", {
          grid: args.grid,
          features: args.boundary.data.features,
        });
      else if (c === "ground")
        value =
          p.enabled === false
            ? args.grid
            : await execute("ground", {
                grid: args.grid,
                features: args.buildings.data.features,
              });
      else if (c === "terrain") value = { grid: args.grid };
      else if (c === "formula")
        value = await execute("formula", {
          grid: args.grid,
          expression: p.expression || "x",
          unit: p.unit,
        });
      else if (c === "style")
        value = { ...args.grid, ramp: p.ramp || "thermal" };
      else if (c === "output") {
        scene = {
          grid: args.terrain.grid,
          lst: args.analysis,
          weather: args.weather,
          buildingIds: args.buildings ? [args.buildings.id] : [],
        };
        if (
          scene.lst &&
          (scene.lst.cols !== scene.grid.cols ||
            scene.lst.rows !== scene.grid.rows ||
            scene.lst.crs !== scene.grid.crs ||
            scene.lst.origin.some((v, i) => v !== scene.grid.origin[i]) ||
            scene.lst.size !== scene.grid.size)
        )
          throw new Error("Analysis and terrain grids must share alignment.");
        value = scene;
      }
      results.set(n.id, value);
      onStep(n.id, "done");
    } catch (error) {
      onStep(n.id, "error");
      throw new Error(`${def.label}: ${error.message}`);
    }
  }
  if (!scene) throw new Error("Connect a Scene preview output.");
  return scene;
}
export function groupSelection(graph, label = "Component group") {
  const selected = graph.nodes.filter(
    (n) => n.selected && n.type !== "group" && !n.parentId,
  );
  if (!selected.length)
    throw new Error("Shift-select components before grouping.");
  const x = Math.min(...selected.map((n) => n.position.x)) - 25,
    y = Math.min(...selected.map((n) => n.position.y)) - 40;
  const width = Math.max(...selected.map((n) => n.position.x + 230)) - x,
    height = Math.max(...selected.map((n) => n.position.y + 210)) - y,
    id = crypto.randomUUID();
  const group = {
    id,
    type: "group",
    position: { x, y },
    data: { label },
    style: {
      width,
      height,
      background: "#ad85c511",
      border: "1px dashed #ba9ecc",
      borderRadius: 12,
    },
    zIndex: -1,
  };
  return {
    ...graph,
    nodes: [
      group,
      ...graph.nodes.map((n) =>
        selected.includes(n)
          ? {
              ...n,
              parentId: id,
              position: { x: n.position.x - x, y: n.position.y - y },
              selected: false,
            }
          : n,
      ),
    ],
  };
}
export function ungroup(graph) {
  const groups = new Map(
    graph.nodes.filter((n) => n.type === "group").map((n) => [n.id, n]),
  );
  return {
    ...graph,
    nodes: graph.nodes
      .filter((n) => n.type !== "group")
      .map((n) => {
        const p = groups.get(n.parentId);
        if (!p) return n;
        const { parentId, ...rest } = n;
        return {
          ...rest,
          position: {
            x: n.position.x + p.position.x,
            y: n.position.y + p.position.y,
          },
        };
      }),
  };
}
