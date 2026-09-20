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
              style={{ top: 70 + i * 23 }}
            />
            {k}
            <em>{v}</em>
          </div>
        ))}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        style={{ top: 40 }}
      />
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
              const g = JSON.parse(await f.text());
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
          {[...new Set(Object.values(COMPONENTS).map((d) => d.group))].map(
            (group) => (
              <section key={group}>
                <small>{group}</small>
                {Object.entries(COMPONENTS)
                  .filter(([, d]) => d.group === group)
                  .map(([key, d]) => (
                    <button key={key} onClick={() => add(key)}>
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
          minZoom={0.15}
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
                "Select a component. Connect matching typed ports.",
                "选择电池，连接相同类型的端口。",
              )}
            </p>
          )}
          {n && (
            <>
              {["raster", "vector", "weather"].includes(n.data.component) && (
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
                            : n.data.component),
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
                      value={params.crs || "EPSG:32650"}
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
          {message && <p role="alert">{message}</p>}
          <p>{t("Food4CIM · future extension", "Food4CIM · 后续扩展")}</p>
        </aside>
      </div>
    </section>
  );
}
