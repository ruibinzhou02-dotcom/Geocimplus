import { job } from "./jobs.mjs";
import { formulaGrid } from "./formula.mjs";
export const COMPONENTS = {
  clip: {
    group: "Coordinate / Grid",
    label: "Clip grid by boundary",
    inputs: { grid: "grid", boundary: "vector" },
    out: "grid",
  },
  raster: { group: "Input", label: "Raster input", inputs: {}, out: "raster" },
  vector: { group: "Input", label: "Vector input", inputs: {}, out: "vector" },
  weather: { group: "Input", label: "EPW input", inputs: {}, out: "weather" },
  grid: {
    group: "Coordinate / Grid",
    label: "Raster → metric grid",
    inputs: { raster: "raster", align: "grid?" },
    out: "grid",
  },
  ground: {
    group: "Terrain",
    label: "Flatten building ground",
    inputs: { grid: "grid", buildings: "vector" },
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
      node("dem", "raster", 0, 0, { layer: "dem" }),
      node("lst", "raster", 0, 220, { layer: "lst" }),
      node("buildings", "vector", 270, -190, { layer: "buildings" }),
      node("weather", "weather", 810, 440, { layer: "epw" }),
      node("grid", "grid", 270, 0, { size: 30, crs: "EPSG:32650" }),
      node("lstgrid", "grid", 540, 220, { size: 30, crs: "EPSG:32650" }),
      node("ground", "ground", 540, 0),
      node("surface", "terrain", 810, 0),
      node("style", "style", 810, 220, { ramp: "thermal" }),
      node("view", "output", 1100, 60),
    ],
    edges: [
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
    if (!input || out !== input.replace("?", ""))
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
export async function evaluateGraph(graph, layers, onStep = () => {}) {
  const order = validateGraph(graph),
    results = new Map();
  let scene = null;
  const outputs = order.filter((n) => n.data.component === "output");
  if (outputs.length !== 1)
    throw new Error("Use exactly one Scene preview output per circuit.");
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
    for (const [port, type] of Object.entries(def.inputs)) {
      const e = graph.edges.find(
        (e) => e.target === n.id && e.targetHandle === port,
      );
      if (!e && !type.endsWith("?"))
        throw new Error(`${def.label}: connect ${port}.`);
      args[port] = e ? results.get(e.source) : null;
    }
    let value;
    if (["raster", "vector", "weather"].includes(c)) {
      value = layers.find((l) => l.id === p.layer);
      if (!value) throw new Error(`${def.label}: select a loaded layer.`);
      if ((c === "weather" ? "epw" : c) !== value.kind)
        throw new Error("Input layer type mismatch.");
    } else if (c === "grid")
      value = await job("grid", {
        raster: args.raster,
        size: Number(p.size || 30),
        crs: p.crs || "EPSG:32650",
        grid: args.align || null,
      });
    else if (c === "clip")
      value = await job("clip", {
        grid: args.grid,
        features: args.boundary.data.features,
      });
    else if (c === "ground")
      value =
        p.enabled === false
          ? args.grid
          : await job("ground", {
              grid: args.grid,
              features: args.buildings.data.features,
            });
    else if (c === "terrain") value = { grid: args.grid };
    else if (c === "formula")
      value = await job("formula", {
        grid: args.grid,
        expression: p.expression || "x",
        unit: p.unit,
      });
    else if (c === "style") value = { ...args.grid, ramp: p.ramp || "thermal" };
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
