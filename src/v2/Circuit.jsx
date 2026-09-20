import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  COMPONENTS,
  PORT_TYPES,
  analysisGraph,
  defaultGraph,
  migrateGraph,
  validateGraph,
  groupSelection,
  ungroup,
} from "./circuit.mjs";
import { jsonDownload } from "./project.mjs";
function Battery({ data, selected }) {
  const def = COMPONENTS[data.component];
  return (
    <div
      className={
        "v2-battery " + (selected ? "selected " : "") + (data.status || "")
      }
    >
      <small>{def.group}</small>
      <b>{def.label}</b>
      <div className="v2-ports">
        {Object.entries(def.inputs).map(([k, v], i) => (
          <div key={k}>
            <Handle
              type="target"
              position={Position.Left}
              id={k}
              title={PORT_TYPES[v.replace("?", "")]}
              style={{ top: 80 + i * 25 }}
            />
            {k}
            <em title={PORT_TYPES[v.replace("?", "")]}>{v}</em>
          </div>
        ))}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ top: 40 }}
      />
      <span className="v2-out-type" title={PORT_TYPES[def.out]}>
        {def.out} →
      </span>
      <footer>
        {data.params?.layer ||
          data.params?.expression ||
          data.params?.crs ||
          def.out}
      </footer>
    </div>
  );
}
const nodeTypes = { battery: Battery };
export default function Circuit({
  graph,
  setGraph,
  layers,
  onRun,
  busy,
  status,
  result,
  preferredLayer,
  close,
  t,
  onDockHeight,
}) {
  const graphFile = useRef(null);
  const [selected, setSelected] = useState(null),
    [message, setMessage] = useState(""),
    [height, setHeight] = useState(360),
    [floating, setFloating] = useState(false),
    [pos, setPos] = useState({ left: 40, top: 130 });
  useEffect(() => {
    onDockHeight?.(floating ? 0 : height);
  }, [floating, height, onDockHeight]);
  const n = graph.nodes.find((n) => n.id === selected && n.type !== "group"),
    params = n?.data.params || {};
  const update = (p) =>
    setGraph((g) => ({
      ...g,
      nodes: g.nodes.map((x) =>
        x.id === selected
          ? { ...x, data: { ...x.data, params: { ...x.data.params, ...p } } }
          : x,
      ),
    }));
  const connect = useCallback(
    (e) => {
      try {
        setGraph((g) => {
          const next = { ...g, edges: addEdge(e, g.edges) };
          try {
            validateGraph(next);
            return next;
          } catch (err) {
            setMessage(err.message);
            return g;
          }
        });
      } catch (err) {
        setMessage(err.message);
      }
    },
    [setGraph],
  );
  const drag = (e) => {
    if (!floating || e.target.closest("button")) return;
    const x = e.clientX,
      y = e.clientY,
      start = pos;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.onpointermove = (ev) =>
      setPos({
        left: Math.max(
          0,
          Math.min(window.innerWidth - 400, start.left + ev.clientX - x),
        ),
        top: Math.max(
          0,
          Math.min(window.innerHeight - 120, start.top + ev.clientY - y),
        ),
      });
    e.currentTarget.onpointerup = (ev) => {
      ev.currentTarget.onpointermove = null;
    };
  };
  const resize = (e) => {
    const y = e.clientY,
      h = height;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.onpointermove = (ev) =>
      setHeight(
        Math.max(180, Math.min(window.innerHeight - 100, h + y - ev.clientY)),
      );
    e.currentTarget.onpointerup = (ev) => {
      ev.currentTarget.onpointermove = null;
    };
  };
  const add = (component) => {
    if (graph.nodes.length >= 40) return;
    const id = crypto.randomUUID();
    setGraph((g) => ({
      ...g,
      nodes: [
        ...g.nodes,
        {
          id,
          type: "battery",
          position: { x: 150 + g.nodes.length * 25, y: 100 },
          data: { component, params: {} },
        },
      ],
    }));
    setSelected(id);
  };
  return (
    <section
      className={"v2-circuit " + (floating ? "floating" : "docked")}
      style={{ height, ...(floating ? pos : {}) }}
    >
      <div
        className="v2-resize"
        onPointerDown={resize}
        role="separator"
        aria-label="Resize Circuit"
      />
      <header onPointerDown={drag}>
        <input
          type="file"
          accept=".json"
          hidden
          ref={graphFile}
          onChange={async (e) => {
            const f = e.target.files[0];
            try {
              if (f.size > 200000)
                throw new Error("Circuit JSON exceeds 200 KB.");
              const g = migrateGraph(JSON.parse(await f.text()));
              validateGraph(g);
              setGraph(g);
              setSelected(null);
              setMessage("");
            } catch (err) {
              setMessage(err.message);
            }
            e.target.value = "";
          }}
        />
        <b>
          ◈ CIRCUIT 2 <span>{t("Local components", "本地电池")}</span>
        </b>
        <div>
          <button
            onClick={() => {
              try {
                setGraph(groupSelection(graph));
              } catch (e) {
                setMessage(e.message);
              }
            }}
          >
            {t("Group", "分组")}
          </button>
          <button onClick={() => setGraph(ungroup(graph))}>
            {t("Ungroup", "解组")}
          </button>
          <button onClick={() => jsonDownload(graph, "Circuit-v2.json")}>
            JSON ↓
          </button>
          <button disabled={busy} onClick={() => graphFile.current.click()}>
            JSON ↑
          </button>
          <button onClick={() => setFloating(!floating)}>
            {floating ? t("Dock below", "停靠下方") : t("Float", "浮动")}
          </button>
          <button className="primary" disabled={busy} onClick={onRun}>
            ▶ {t("Run circuit", "运行流程")}
          </button>
          <button onClick={close}>×</button>
        </div>
      </header>
      <div className="v2-circuit-body">
        <nav>
          <label>
            {t("Start a circuit", "新建流程")}
            <select
              aria-label="Circuit template"
              value=""
              disabled={busy}
              onChange={(e) => {
                if (!e.target.value) return;
                if (e.target.value === "empty")
                  setGraph({ version: 2, nodes: [], edges: [] });
                else if (e.target.value === "scene") setGraph(defaultGraph());
                else {
                  const layer =
                    layers.find(
                      (l) => l.id === preferredLayer && l.kind === "vector",
                    ) || layers.find((l) => l.kind === "vector");
                  if (!layer) {
                    setMessage(
                      t("Upload a vector layer first.", "请先上传矢量图层。"),
                    );
                    return;
                  }
                  setGraph(analysisGraph(layer, e.target.value));
                }
                setSelected(null);
                setMessage("");
              }}
            >
              <option value="">{t("Choose template…", "选择模板…")}</option>
              {[
                ["empty", "Empty circuit", "空白流程"],
                ["scene", "Shatou scene", "沙头场景"],
                ["measure", "Area / length", "面积 / 长度"],
                ["statistics", "Field statistics", "字段统计"],
                ["centroid", "Representative points", "代表点"],
                ["buffer", "Buffer", "缓冲区"],
                ["kde", "Point density", "点核密度"],
              ].map(([id, en, zh]) => (
                <option key={id} value={id}>
                  {t(en, zh)}
                </option>
              ))}
            </select>
          </label>
          {[...new Set(Object.values(COMPONENTS).map((d) => d.group))].map(
            (group) => (
              <section key={group}>
                <small>{group}</small>
                {Object.entries(COMPONENTS)
                  .filter(([, d]) => d.group === group)
                  .map(([key, d]) => (
                    <button key={key} disabled={busy} onClick={() => add(key)}>
                      ＋ {d.label}
                    </button>
                  ))}
              </section>
            ),
          )}
        </nav>
        <ReactFlow
          nodes={graph.nodes.map((n) => ({
            ...n,
            data: { ...n.data, status: status[n.id] },
          }))}
          edges={graph.edges}
          nodeTypes={nodeTypes}
          onNodesChange={(c) =>
            setGraph((g) => ({ ...g, nodes: applyNodeChanges(c, g.nodes) }))
          }
          onEdgesChange={(c) =>
            setGraph((g) => ({ ...g, edges: applyEdgeChanges(c, g.edges) }))
          }
          onConnect={connect}
          onNodeClick={(_, n) => setSelected(n.id)}
          fitView
          fitViewOptions={{ minZoom: 0.55, maxZoom: 0.9, padding: 0.12 }}
          minZoom={0.25}
          maxZoom={2}
          deleteKeyCode={["Backspace", "Delete"]}
        >
          <Background gap={20} color="#d8d2e1" />
          <Controls />
        </ReactFlow>
        <aside>
          <b>
            {n
              ? COMPONENTS[n.data.component].label
              : t("Component settings", "电池参数")}
          </b>
          {!n && (
            <p>
              {t(
                "Connect matching types. Drag the canvas to pan; scroll to zoom.",
                "连接相容类型的端口；拖动画布平移，滚轮缩放。",
              )}
            </p>
          )}
          {n && (
            <>
              {[
                "raster",
                "vector",
                "weather",
                "points",
                "polygons",
                "gridInput",
              ].includes(n.data.component) && (
                <label>
                  {t("Input layer", "输入图层")}
                  <select
                    value={params.layer || ""}
                    onChange={(e) => update({ layer: e.target.value })}
                  >
                    <option value="">{t("Select…", "请选择…")}</option>
                    {layers
                      .filter(
                        (l) =>
                          l.kind ===
                            (n.data.component === "weather"
                              ? "epw"
                              : ["points", "polygons", "gridInput"].includes(
                                    n.data.component,
                                  )
                                ? "vector"
                                : n.data.component) &&
                          (n.data.component !== "gridInput" || l.gridData),
                      )
                      .map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              {n.data.component === "grid" && (
                <>
                  <label>
                    {t("Cell size · m", "网格大小 · 米")}
                    <input
                      type="number"
                      min="5"
                      max="5000"
                      value={params.size || 30}
                      onChange={(e) => update({ size: +e.target.value })}
                    />
                  </label>
                  <label>
                    CRS
                    <input
                      placeholder="Auto UTM"
                      value={params.crs || ""}
                      onChange={(e) => update({ crs: e.target.value })}
                    />
                  </label>
                  <p>
                    {t(
                      "The align input uses the upstream grid extent, size and CRS.",
                      "连接 align 后沿用上游格网的范围、尺寸和坐标系。",
                    )}
                  </p>
                </>
              )}
              {n.data.component === "grid" && (
                <label>
                  {t("Resampling", "重采样")}
                  <select
                    value={params.method || "mean"}
                    onChange={(e) => update({ method: e.target.value })}
                  >
                    <option value="mean">
                      {t("Area-weighted mean", "面积加权均值")}
                    </option>
                    <option value="bilinear">
                      {t("Bilinear", "双线性插值")}
                    </option>
                    <option value="nearest">{t("Nearest", "最近邻")}</option>
                  </select>
                </label>
              )}
              {n.data.component === "statistics" && (
                <label>
                  {t("Attribute field", "属性字段")}
                  <input
                    value={params.field || ""}
                    onChange={(e) => update({ field: e.target.value })}
                  />
                </label>
              )}
              {n.data.component === "buffer" && (
                <label>
                  {t("Distance · m", "距离 · 米")}
                  <input
                    type="number"
                    min="1"
                    max="5000"
                    value={params.distance ?? 100}
                    onChange={(e) => update({ distance: +e.target.value })}
                  />
                </label>
              )}
              {n.data.component === "kde" && (
                <>
                  {[
                    ["bandwidth", "Bandwidth · m", "带宽 · 米", 200],
                    ["cellSize", "Cell size · m", "网格大小 · 米", 50],
                  ].map(([k, en, zh, d]) => (
                    <label key={k}>
                      {t(en, zh)}
                      <input
                        type="number"
                        min="5"
                        max="5000"
                        value={params[k] ?? d}
                        onChange={(e) => update({ [k]: +e.target.value })}
                      />
                    </label>
                  ))}
                  <label>
                    {t("Weight field · optional", "权重字段 · 可选")}
                    <input
                      value={params.weightField || ""}
                      onChange={(e) => update({ weightField: e.target.value })}
                    />
                  </label>
                </>
              )}
              {n.data.component === "ground" && (
                <label>
                  <input
                    type="checkbox"
                    checked={params.enabled !== false}
                    onChange={(e) => update({ enabled: e.target.checked })}
                  />
                  {t("Estimate flat ground", "估算平整地面")}
                </label>
              )}
              {n.data.component === "formula" && (
                <>
                  <label>
                    {t("Expression · x = cell mean", "表达式 · x 为网格均值")}
                    <input
                      value={params.expression || "x"}
                      onChange={(e) => update({ expression: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("Result unit", "结果单位")}
                    <input
                      value={params.unit || ""}
                      onChange={(e) => update({ unit: e.target.value })}
                    />
                  </label>
                  <p>
                    x, + − × / ^, abs, sqrt, min, max, clamp.
                    <br />
                    {t(
                      "Example: clamp((x - 25) / 15, 0, 1). Runs locally in a restricted expression language.",
                      "示例：clamp((x - 25) / 15, 0, 1)。仅运行本地受限表达式。",
                    )}
                  </p>
                </>
              )}
              {n.data.component === "style" && (
                <label>
                  {t("Colour ramp", "色带")}
                  <select
                    value={params.ramp || "thermal"}
                    onChange={(e) => update({ ramp: e.target.value })}
                  >
                    <option>thermal</option>
                    <option>purple</option>
                    <option>terrain</option>
                  </select>
                </label>
              )}
              <button
                onClick={() => {
                  setGraph((g) => ({
                    ...g,
                    nodes: g.nodes.filter((x) => x.id !== n.id),
                    edges: g.edges.filter(
                      (e) => e.source !== n.id && e.target !== n.id,
                    ),
                  }));
                  setSelected(null);
                }}
              >
                {t("Remove component", "删除电池")}
              </button>
            </>
          )}
          {result && (
            <details open>
              <summary>{t("Last statistics result", "最近的统计结果")}</summary>
              <pre>{JSON.stringify(result.values, null, 2)}</pre>
              <button
                onClick={() => jsonDownload(result, "circuit-statistics.json")}
              >
                {t("Export report", "导出统计")}
              </button>
            </details>
          )}
          {n && (
            <details>
              <summary>{t("Data contract", "数据类型约定")}</summary>
              {Object.entries(COMPONENTS[n.data.component].inputs).map(
                ([port, type]) => (
                  <p key={port}>
                    <b>
                      {port} · {type}
                    </b>
                    <br />
                    {PORT_TYPES[type.replace("?", "")]}{" "}
                    {type.endsWith("?") ? "(optional)" : "(required)"}
                  </p>
                ),
              )}
              <p>
                out · {COMPONENTS[n.data.component].out}
                <br />
                {PORT_TYPES[COMPONENTS[n.data.component].out]}
              </p>
            </details>
          )}
          {message && <p role="alert">{message}</p>}
          <p>{t("Food4CIM · future extension", "Food4CIM · 后续扩展")}</p>
        </aside>
      </div>
    </section>
  );
}
