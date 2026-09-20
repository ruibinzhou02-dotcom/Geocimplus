import React, { useState, useRef, useEffect, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { job } from "./jobs.mjs";
import { runJob } from "../jobs.mjs";
import { metricCRS, transform } from "./geo.mjs";
import { stats } from "./raster-grid.mjs";
import { terrainMesh, buildingModels } from "./model.mjs";
import { defaultGraph, evaluateGraph, validateGraph } from "./circuit.mjs";
import {
  packProject,
  unpackProject,
  download,
  jsonDownload,
  localProjects,
} from "./project.mjs";
import { RAMPS } from "./terrain-mesh.mjs";
import Scene from "./Scene.jsx";
import Climate from "./Climate.jsx";
import Attributes from "./Attributes.jsx";
import "./style.css";
const Circuit = lazy(() => import("./Circuit.jsx"));
const initialStyle = {
  terrain: true,
  lst: true,
  wire: false,
  wireColor: "#645078",
  wireWidth: 1,
  wireOpacity: 0.45,
  zScale: 1,
  buildings: true,
  buildingColor: "#e4dfee",
  buildingOpacity: 0.95,
  ramp: "thermal",
  min: 25,
  max: 39,
  opacity: 0.8,
  imagery: true,
  imageryOpacity: 1,
};
function App() {
  const [mapSelection, setMapSelection] = useState(null);
  const [dockHeight, setDockHeight] = useState(360);
  const [lang, setLang] = useState(
      () => localStorage.getItem("geocim-v2-lang") || "en",
    ),
    t = (en, zh) => (lang === "zh" ? zh : en);
  const [screen, setScreen] = useState("home"),
    [name, setName] = useState("Untitled project"),
    [layers, setLayers] = useState([]),
    [model, setModel] = useState(null),
    [style, setStyle] = useState(initialStyle),
    [size, setSize] = useState(30),
    [ground, setGround] = useState(true),
    [graph, setGraph] = useState(defaultGraph),
    [circuit, setCircuit] = useState(false),
    [nodeStatus, setNodeStatus] = useState({}),
    [tab, setTab] = useState("style"),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [table, setTable] = useState(false),
    [tableLayer, setTableLayer] = useState("grid"),
    [selection, setSelection] = useState([]),
    [picked, setPicked] = useState(null),
    [recent, setRecent] = useState([]),
    [id, setId] = useState(() => crypto.randomUUID()),
    [weather, setWeather] = useState(null),
    [chat, setChat] = useState([]),
    [prompt, setPrompt] = useState(""),
    [inputLayer, setInputLayer] = useState(""),
    [operation, setOperation] = useState("measure"),
    [field, setField] = useState(""),
    [distance, setDistance] = useState(100),
    [result, setResult] = useState(null);
  const fileInput = useRef(null),
    projectInput = useRef(null),
    sceneAPI = useRef(null);
  useEffect(() => {
    localProjects("list")
      .then(setRecent)
      .catch(() => {});
  }, [screen]);
  const changeStyle = (p) => setStyle((s) => ({ ...s, ...p }));
  const guard = async (fn) => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.error(e);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const construct = async (ls, options = {}) => {
    let dem = ls.find((l) => l.kind === "raster" && l.role === "dem"),
      lst = ls.find((l) => l.kind === "raster" && l.role === "lst");
    if (!dem) {
      const base = lst || ls.find((l) => l.kind === "raster");
      if (base)
        dem = {
          ...base,
          values: new Float32Array(base.values.length),
          unit: "m",
          id: "flat-reference",
        };
      else {
        const coords = [];
        const walk = (a) => {
          if (typeof a?.[0] === "number") coords.push(a);
          else if (Array.isArray(a)) a.forEach(walk);
        };
        ls.filter((l) => l.kind === "vector").forEach((l) =>
          l.data.features.forEach((f) => walk(f.geometry.coordinates)),
        );
        if (!coords.length) {
          setModel(null);
          setWeather(ls.find((l) => l.kind === "epw") || null);
          return;
        }
        const b = [Infinity, Infinity, -Infinity, -Infinity];
        for (const [x, y] of coords) {
          b[0] = Math.min(b[0], x);
          b[1] = Math.min(b[1], y);
          b[2] = Math.max(b[2], x);
          b[3] = Math.max(b[3], y);
        }
        if (b[0] === b[2]) {
          b[0] -= 0.001;
          b[2] += 0.001;
        }
        if (b[1] === b[3]) {
          b[1] -= 0.001;
          b[3] += 0.001;
        }
        dem = {
          id: "flat-reference",
          width: 1,
          height: 1,
          extent: b,
          crs: "EPSG:4326",
          values: new Float32Array([0]),
          unit: "m",
        };
      }
    }
    const ll = transform(
        dem.crs,
        "EPSG:4326",
      )([
        (dem.extent[0] + dem.extent[2]) / 2,
        (dem.extent[1] + dem.extent[3]) / 2,
      ]),
      crs = metricCRS(...ll);
    setNotice(
      t("Aggregating terrain pixels locally…", "正在本地汇总高程像元…"),
    );
    let g = await job(
      "grid",
      { raster: dem, size: options.size ?? size, crs },
      (p) => setNotice(`${t("Terrain grid", "地形网格")} ${p}%`),
    );
    const raw = g;
    if ((options.ground ?? ground) && dem.id !== "flat-reference") {
      setNotice(
        t(
          "Estimating flat ground under buildings…",
          "正在估算建筑下方的平整地面…",
        ),
      );
      g = await job("ground", {
        grid: g,
        features: ls
          .filter((l) => l.heightField)
          .flatMap((l) => l.data.features),
      });
    }
    let analysis = null;
    if (lst) {
      setNotice(
        t(
          "Aggregating LST pixels on the same grid…",
          "正在同一网格上汇总 LST 像元…",
        ),
      );
      analysis = await job("grid", { raster: lst, grid: raw });
    }
    await finishModel(
      { grid: g, lst: analysis, weather: ls.find((l) => l.kind === "epw") },
      ls,
    );
    if (dem.id === "flat-reference")
      setNotice(
        t(
          "Flat reference plane · no measured elevation supplied.",
          "参考平面 · 尚未提供实测高程。",
        ),
      );
  };
  const finishModel = async (scene, ls) => {
    const terrain = terrainMesh(scene.grid),
      buildings = buildingModels(
        scene.buildingIds
          ? ls.filter((l) => scene.buildingIds.includes(l.id))
          : ls,
        scene.grid,
        terrain,
      ),
      imagery = ls.find((l) => l.role === "imagery");
    const texture = imagery
      ? await job("texture", { raster: imagery, grid: scene.grid })
      : null;
    setModel({ ...scene, terrain, buildings, texture });
    setWeather(scene.weather || ls.find((l) => l.kind === "epw") || null);
    setPicked(null);
    setSelection([]);
    const s = scene.lst && stats(scene.lst.mean);
    if (s?.count)
      setStyle((v) => ({
        ...v,
        ramp: scene.lst.ramp || v.ramp,
        min: s.min,
        max: s.max,
      }));
    setNotice(
      t(
        `Ready · ${stats(scene.grid.mean).count.toLocaleString()} terrain cells · ${buildings.models.length.toLocaleString()} building parts`,
        `已完成 · ${stats(scene.grid.mean).count.toLocaleString()} 个地形网格 · ${buildings.models.length.toLocaleString()} 个建筑体块`,
      ),
    );
  };
  const demo = () =>
    guard(async () => {
      setNotice(
        t("Reading the local Shatou example…", "正在读取本地沙头示例…"),
      );
      const r = await fetch("/v2-data/catalog.json");
      if (!r.ok)
        throw new Error(
          t(
            "Local example not found. Run the V2 data preparation and local preview scripts.",
            "未找到本地示例，请运行 V2 数据准备和本地预览脚本。",
          ),
        );
      const catalog = await r.json(),
        ls = [];
      for (const source of catalog.sources) {
        const f = await fetch("/v2-data/" + source.url);
        if (!f.ok) throw new Error(source.url + " unavailable");
        const meta = { ...source, visible: true };
        if (source.kind === "raster")
          ls.push(
            await job("readRaster", { buffer: await f.arrayBuffer(), meta }),
          );
        else if (source.kind === "epw")
          ls.push({
            ...meta,
            data: await job("epw", { text: await f.text() }),
          });
        else ls.push({ ...meta, data: await f.json() });
      }
      setName(t("Shatou · Urban Regeneration", "沙头 · 城市更新"));
      setId(crypto.randomUUID());
      setLayers(ls);
      setGraph(defaultGraph());
      setScreen("workspace");
      setStyle(initialStyle);
      await construct(ls, { size: 30, ground: true });
    });
  const newProject = () => {
    setName(t("Untitled project", "未命名项目"));
    setId(crypto.randomUUID());
    setLayers([]);
    setModel(null);
    setWeather(null);
    setGraph({ version: 2, nodes: [], edges: [] });
    setStyle(initialStyle);
    setScreen("workspace");
    setNotice("");
    setError("");
    setPicked(null);
    setTable(false);
    setCircuit(false);
  };
  const importData = (files) =>
    guard(async () => {
      if (
        files.length > 512 ||
        files.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024
      )
        throw new Error("Import up to 128 MiB / 512 files at a time.");
      if (layers.length >= 24)
        throw new Error(
          t("Remove a layer before importing more.", "请先移除部分图层。"),
        );
      let ls = [];
      const vectorFiles = [];
      for (const f of files) {
        if (/\.epw$/i.test(f.name))
          ls.push({
            id: crypto.randomUUID(),
            name: f.name,
            kind: "epw",
            data: await job("epw", { text: await f.text() }),
            visible: true,
          });
        else if (/\.tiff?$/i.test(f.name))
          ls.push(
            await job("readRaster", {
              buffer: await f.arrayBuffer(),
              meta: {
                id: crypto.randomUUID(),
                name: f.name,
                visible: true,
                role: "dem",
              },
            }),
          );
        else vectorFiles.push(f);
      }
      if (vectorFiles.length) {
        const items = await runJob({ job: "import", files: vectorFiles })
          .promise;
        ls.push(
          ...items.map((i) => ({ ...i, visible: true, heightField: "" })),
        );
      }
      const all = [...layers, ...ls];
      if (all.length > 24) throw new Error("Project limit: 24 layers.");
      setLayers(all);
      setScreen("workspace");
      await construct(all);
    });
  const restore = async (p) => {
    validateGraph(p.graph);
    setId(p.id);
    setName(p.name);
    setLayers(p.layers);
    setGraph(p.graph);
    setStyle({ ...initialStyle, ...p.style });
    setSize(p.size || 30);
    setGround(!!p.ground);
    setScreen("workspace");
    setTable(false);
    if (p.scene) await finishModel(p.scene, p.layers);
    else await construct(p.layers, { size: p.size || 30, ground: !!p.ground });
    setStyle({ ...initialStyle, ...p.style });
  };
  const save = () =>
    guard(async () => {
      const bytes = packProject({
        id,
        name,
        layers,
        graph,
        style,
        size,
        ground,
        scene: model
          ? {
              grid: model.grid,
              lst: model.lst,
              weather,
              buildingIds: model.buildingIds,
            }
          : null,
      });
      await localProjects("save", {
        id,
        name,
        saved: new Date().toISOString(),
        bytes,
      });
      download(bytes, `${name.replace(/[\\/:*?"<>|]/g, "_")}.geocim`);
      setNotice(
        t(
          "Saved on this browser and downloaded as a portable project.",
          "已保存到此浏览器，并下载可迁移项目包。",
        ),
      );
    });
  const runCircuit = () =>
    guard(async () => {
      setNodeStatus({});
      const scene = await evaluateGraph(graph, layers, (id, status) => {
        setNodeStatus((s) => ({ ...s, [id]: status }));
        setNotice(
          `${status === "running" ? "▶" : "✓"} ${graph.nodes.find((n) => n.id === id)?.data.component}`,
        );
      });
      await finishModel(scene, layers);
    });
  const export3dm = () =>
    guard(async () => {
      if (!model) return;
      setNotice(
        t(
          "Creating layered Rhino file locally…",
          "正在本地生成分层 Rhino 文件…",
        ),
      );
      const r = await job("rhino", { model, layers, style });
      download(r.zip, "GeoCIM-Rhino.zip");
      setNotice(
        t(
          `Rhino ZIP exported · ${r.meta.verified.objects} objects, ${r.meta.verified.layers} layers; elevations at true scale.`,
          `Rhino ZIP 已导出 · ${r.meta.verified.objects} 个对象、${r.meta.verified.layers} 个图层；高程使用真实比例。`,
        ),
      );
    });
  const png = () => {
    const image = sceneAPI.current?.png();
    if (image) {
      const a = document.createElement("a");
      a.href = image;
      a.download = "GeoCIM-scene.png";
      a.click();
    }
  };
  const tableOpen = (l) => {
    setTableLayer(l || "grid");
    setTable(true);
    setCircuit(false);
  };
  const sendChat = () => {
    const text = prompt.trim();
    if (!text) return;
    let reply;
    if (/属性|attribute|table/i.test(text)) {
      tableOpen(
        layers.find((l) => l.kind === "vector" && text.includes(l.name))?.id ||
          "grid",
      );
      reply = t("Opened the attribute table.", "已打开属性表。");
    } else if (/隐藏.*(网格|边框)|hide.*(grid|border)/i.test(text)) {
      changeStyle({ wire: false });
      reply = t("Grid borders hidden.", "已隐藏网格边框。");
    } else if (/显示.*(网格|边框)|show.*(grid|border)/i.test(text)) {
      changeStyle({ wire: true });
      reply = t("Grid borders visible.", "已显示网格边框。");
    } else if (/气象|天气|weather|epw/i.test(text)) {
      setTab("climate");
      reply = t("Opened the weather reader.", "已打开气象读取器。");
    } else if (/俯视|top view/i.test(text)) {
      sceneAPI.current?.top();
      reply = t("Switched to top view.", "已切换俯视图。");
    } else if (/缩放|fit|全图/i.test(text)) {
      sceneAPI.current?.fit();
      reply = t("Fit the scene to the viewport.", "已定位场景。");
    } else
      reply = t(
        "Local presets: open attributes, show grid, hide grid, weather, top view, fit scene. Model/API connection is not enabled.",
        "本地预设：打开属性表、显示网格、隐藏网格、天气、俯视、全图。尚未启用模型/API 连接。",
      );
    setChat((c) => [...c, { text, reply }]);
    setPrompt("");
  };
  const basic = () =>
    guard(async () => {
      const l =
        layers.find((l) => l.id === inputLayer) ||
        layers.find((l) => l.kind === "vector");
      if (!l) throw new Error("Import a vector layer first.");
      const r = await runJob({
        job: "analysis",
        data: l.data,
        options: {
          operation,
          field,
          distance,
          bandwidth: distance,
          cellSize: Math.min(size, distance),
          sourceName: l.name,
          sourceId: l.id,
          id: crypto.randomUUID(),
        },
      }).promise;
      if (r.kind === "summary") setResult(r);
      else {
        const all = [
          ...layers,
          { ...r, name: `${operation} · ${l.name}`, visible: true },
        ];
        setLayers(all);
        await construct(all);
      }
    });
  const selectedInput =
    layers.find((l) => l.id === inputLayer) ||
    layers.find((l) => l.kind === "vector");
  const st = model?.lst ? stats(model.lst.mean) : null;
  const chooser = (
    <>
      <input
        ref={fileInput}
        type="file"
        hidden
        multiple
        accept=".shp,.shx,.dbf,.prj,.cpg,.zip,.geojson,.json,.tif,.tiff,.epw"
        onChange={(e) => {
          importData(Array.from(e.target.files));
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        type="file"
        hidden
        accept=".geocim"
        onChange={(e) => {
          const f = e.target.files[0];
          if (f)
            guard(async () =>
              restore(unpackProject(new Uint8Array(await f.arrayBuffer()))),
            );
          e.target.value = "";
        }}
      />
    </>
  );
  const language = (
    <button
      className="v2-lang"
      onClick={() => {
        const l = lang === "en" ? "zh" : "en";
        setLang(l);
        localStorage.setItem("geocim-v2-lang", l);
        document.documentElement.lang = l;
      }}
    >
      {lang === "en" ? "EN / 中文" : "中文 / EN"}
    </button>
  );
  if (screen === "home")
    return (
      <div className="v2-app v2-home">
        {chooser}
        <header className="v2-header">
          <a className="v2-logo">
            ◈{" "}
            <b>
              GeoCIM<span>+</span>
            </b>
          </a>
          <span className="v2-version">LOCAL STUDIO / V2</span>
          {language}
        </header>
        <main>
          <div className="v2-home-title">
            <span className="eyebrow">A PLACE TO EXPLORE</span>
            <h1>{t("Your city. Your data.", "探索城市，从你的数据开始。")}</h1>
            <p>
              {t(
                "Build a scene, connect an idea, discover what changes.",
                "搭建场景，连接电池，发现数据背后的变化。",
              )}
            </p>
          </div>
          <div className="v2-section-title">
            <h2>{t("Example projects", "示例项目")}</h2>
            <span>{t("Curated starting points", "场景起点")}</span>
          </div>
          <div className="v2-project-cards">
            {[
              [
                "shatou",
                "01",
                "Shatou",
                "沙头",
                "Urban Regeneration",
                "城市更新",
              ],
              [
                "mobility",
                "02",
                "Urban Mobility",
                "城市交通",
                "Road · Rail · Low-altitude",
                "道路 · 轨道 · 低空",
              ],
              [
                "campus",
                "03",
                "Campus Digital Twin",
                "校园数字孪生",
                "Campus · Live data",
                "校园 · 实时数据",
              ],
            ].map(([kind, num, en, zh, sub, subzh]) => (
              <button
                className={"v2-project-card " + kind}
                key={kind}
                disabled={busy || kind !== "shatou"}
                onClick={demo}
              >
                <div className="v2-card-art">
                  <div className="v2-art-grid" />
                  <div className="v2-art-buildings">
                    {Array.from(
                      { length: kind === "shatou" ? 28 : 12 },
                      (_, i) => (
                        <i
                          key={i}
                          style={{
                            left: `${12 + ((i * 19) % 75)}%`,
                            top: `${16 + ((i * 23) % 62)}%`,
                            height: 18 + ((i * 11) % 65),
                            width: 12 + ((i * 7) % 23),
                          }}
                        />
                      ),
                    )}
                  </div>
                  <span className="v2-card-number">{num}</span>
                  <span className="v2-card-badge">
                    {kind === "shatou"
                      ? t("LOCAL EXAMPLE", "本地示例")
                      : t("COMING LATER", "后续开发")}
                  </span>
                </div>
                <div className="v2-card-caption">
                  <h3>
                    {t(en, zh)} <span>↗</span>
                  </h3>
                  <p>{t(sub, subzh)}</p>
                </div>
              </button>
            ))}
          </div>
          <div className="v2-home-bottom">
            <section>
              <h2>{t("New project", "新建项目")}</h2>
              <button className="v2-new" onClick={newProject}>
                <span>＋</span>
                <div>
                  <b>{t("Start with your local data", "从本地数据开始")}</b>
                  <p>Shapefile · GeoJSON · GeoTIFF · EPW</p>
                </div>
                ↗
              </button>
            </section>
            <section>
              <h2>{t("Local projects", "本地项目")}</h2>
              <button
                className="v2-open"
                onClick={() => projectInput.current.click()}
              >
                ↥ {t("Open a .geocim project", "打开 .geocim 项目")}
              </button>
              {recent.length ? (
                recent.map((p) => (
                  <button
                    className="v2-recent"
                    key={p.id}
                    onClick={() => guard(() => restore(unpackProject(p.bytes)))}
                  >
                    <b>{p.name}</b>
                    <span>{p.saved.slice(0, 10)} ↗</span>
                  </button>
                ))
              ) : (
                <p className="muted">
                  {t(
                    "Projects saved in this browser appear here.",
                    "在此浏览器保存的项目会显示在这里。",
                  )}
                </p>
              )}
            </section>
          </div>
          <footer>
            {t("LOCAL FIRST", "本地优先")} <span>·</span>{" "}
            {t(
              "Your new projects stay on your computer.",
              "新建项目的数据与计算留在你的电脑。",
            )}
          </footer>
          {notice && (
            <div className="v2-notice">
              {busy ? "◌ " : ""}
              {notice}
            </div>
          )}
          {error && (
            <div className="v2-error" role="alert">
              {error}
            </div>
          )}
        </main>
      </div>
    );
  return (
    <div className="v2-app v2-workspace">
      {chooser}
      <header className="v2-header">
        <button className="v2-logo" onClick={() => setScreen("home")}>
          ◈{" "}
          <b>
            GeoCIM<span>+</span>
          </b>
        </button>
        <span className="v2-divider" />
        <input
          className="v2-project-name"
          aria-label="Project name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="v2-local-dot">● {t("Local", "本地")}</span>
        <nav>
          <button
            onClick={() => {
              setCircuit(!circuit);
              setTable(false);
            }}
          >
            ◈ CIRCUIT 2
          </button>
          <button disabled={busy} onClick={() => fileInput.current.click()}>
            ＋ {t("Import", "导入")}
          </button>
          <button disabled={busy} onClick={save}>
            {t("Save project", "保存项目")}
          </button>
          <button disabled={busy || !model} onClick={export3dm}>
            Rhino ↓
          </button>
          {language}
        </nav>
      </header>
      <main className="v2-workbench">
        <aside className="v2-layers">
          <div className="v2-panel-heading">
            <b>{t("Layers", "图层")}</b>
            <button disabled={busy} onClick={() => fileInput.current.click()}>
              ＋
            </button>
          </div>
          {!layers.length && (
            <p>{t("Import your first dataset.", "导入第一份数据。")}</p>
          )}
          {layers.map((l) => (
            <div key={l.id} className="v2-layer">
              <div>
                <span className={"v2-layer-icon " + l.kind}>
                  {l.kind === "epw"
                    ? "☀"
                    : l.kind === "raster"
                      ? "▧"
                      : /Point/.test(l.data.features[0]?.geometry.type)
                        ? "•"
                        : /Line/.test(l.data.features[0]?.geometry.type)
                          ? "╱"
                          : "⬡"}
                </span>
                <b>{l.name}</b>
              </div>
              <small>
                {l.kind === "raster"
                  ? `${l.width} × ${l.height} · ${l.crs}`
                  : l.kind === "epw"
                    ? `${l.data.records.length} hours`
                    : l.data.features.length.toLocaleString() + " features"}
              </small>
              {l.kind === "raster" && (
                <select
                  aria-label={"Role " + l.name}
                  disabled={busy}
                  value={l.role}
                  onChange={(e) =>
                    setLayers((ls) =>
                      ls.map((x) =>
                        x.id === l.id ? { ...x, role: e.target.value } : x,
                      ),
                    )
                  }
                >
                  <option value="dem">{t("Elevation", "高程")}</option>
                  <option value="lst">
                    {t("Analysis / LST", "分析 / LST")}
                  </option>
                  <option value="imagery">{t("Base imagery", "底图")}</option>
                </select>
              )}
              {l.kind === "raster" && l.role !== "imagery" && (
                <details>
                  <summary>
                    {t("Value unit", "数值单位")}: {l.unit}
                  </summary>
                  <input
                    aria-label={"Unit " + l.name}
                    value={l.unit || ""}
                    onChange={(e) =>
                      setLayers((ls) =>
                        ls.map((x) =>
                          x.id === l.id ? { ...x, unit: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  <small>
                    {t(
                      "Use m for elevation; rebuild after confirmation.",
                      "高程使用 m；确认后重新构建。",
                    )}
                  </small>
                </details>
              )}
              {l.kind === "vector" && (
                <div className="v2-layer-actions">
                  <button onClick={() => tableOpen(l.id)}>
                    {t("Attributes", "属性表")}
                  </button>
                  <button
                    aria-label={"Toggle " + l.name}
                    onClick={() =>
                      setLayers((ls) =>
                        ls.map((x) =>
                          x.id === l.id
                            ? { ...x, visible: x.visible === false }
                            : x,
                        ),
                      )
                    }
                  >
                    {l.visible === false ? "○" : "●"}
                  </button>
                </div>
              )}
              {l.kind === "vector" && (
                <details>
                  <summary>{t("Height field", "高度字段")}</summary>
                  <select
                    value={l.heightField || ""}
                    disabled={busy}
                    onChange={(e) =>
                      setLayers((ls) =>
                        ls.map((x) =>
                          x.id === l.id
                            ? { ...x, heightField: e.target.value }
                            : x,
                        ),
                      )
                    }
                  >
                    <option value="">{t("No extrusion", "不拉伸")}</option>
                    {Object.keys(l.data.features[0]?.properties || {}).map(
                      (f) => (
                        <option key={f}>{f}</option>
                      ),
                    )}
                  </select>
                </details>
              )}
              <button
                className="v2-remove"
                disabled={busy}
                onClick={() => {
                  const ls = layers.filter((x) => x.id !== l.id);
                  setLayers(ls);
                  guard(() => construct(ls));
                }}
                aria-label={"Remove " + l.name}
              >
                ×
              </button>
            </div>
          ))}
          <div className="v2-layer-footer">
            {t(
              "Analysis and imagery are separate layers.",
              "分析图层与底图独立管理。",
            )}
            <br />
            {t("Change roles, then rebuild.", "调整角色后，重新构建。")}
          </div>
        </aside>
        <section
          className="v2-center"
          style={{ paddingBottom: circuit ? dockHeight : 0 }}
        >
          <div className="v2-viewport">
            <Scene
              selection={mapSelection}
              model={model}
              style={style}
              layers={layers}
              onPick={(k) => setPicked(k)}
              onReady={(api) => {
                sceneAPI.current = api;
              }}
            />
            {!model && (
              <div className="v2-scene-empty">
                <span>◈</span>
                <h2>
                  {t("A new perspective starts here", "从这里建立新的视角")}
                </h2>
                <p>
                  {t(
                    "Import local GIS data to build your scene.",
                    "导入本地 GIS 数据，构建你的场景。",
                  )}
                </p>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => fileInput.current.click()}
                >
                  {t("Import local data", "导入本地数据")}
                </button>
              </div>
            )}
            <div className="v2-map-tools">
              <button onClick={() => sceneAPI.current?.fit()}>
                {t("Fit scene", "全图")}
              </button>
              <button onClick={() => sceneAPI.current?.top()}>
                {t("Top", "俯视")}
              </button>
              <button onClick={png} disabled={!model}>
                PNG ↓
              </button>
              <button onClick={() => tableOpen("grid")} disabled={!model}>
                {t("Attributes", "属性表")}
              </button>
            </div>
            {model && (
              <>
                <div className="v2-north">N ↑</div>
                <div className="v2-map-caption">
                  {t(
                    "Right-drag to orbit · Left-drag to pan",
                    "右键拖动旋转 · 左键拖动平移",
                  )}
                  <br />
                  {model.grid.crs} · {model.grid.size} m {t("grid", "网格")} · Z
                  ×{style.zScale}
                </div>
                {model.lst && style.lst && (
                  <div className="v2-legend">
                    <b>
                      {t("Grid mean", "网格均值")} · {model.lst.unit}
                    </b>
                    <div
                      style={{
                        background: `linear-gradient(90deg,${RAMPS[style.ramp].join(",")})`,
                      }}
                    />
                    <span>
                      {Number(style.min).toFixed(1)}
                      <em>{Number(style.max).toFixed(1)}</em>
                    </span>
                  </div>
                )}
                {picked !== null && (
                  <div className="v2-pick">
                    <button onClick={() => setPicked(null)}>×</button>
                    <b>Cell {picked}</b>
                    <p>
                      Z{" "}
                      {Number.isFinite(model.grid.mean[picked])
                        ? model.grid.mean[picked].toFixed(2) + " m"
                        : "NoData"}
                      <br />
                      LST{" "}
                      {Number.isFinite(model.lst?.mean[picked])
                        ? model.lst.mean[picked].toFixed(2) +
                          " " +
                          model.lst.unit
                        : "NoData"}
                      <br />
                      {t("Coverage", "有效覆盖")}{" "}
                      {(model.grid.coverage[picked] * 100).toFixed(0)}%
                    </p>
                  </div>
                )}
              </>
            )}
            {busy && <div className="v2-progress">◌ {notice}</div>}
          </div>
          {table && (
            <Attributes
              onSelection={(layer, ids) => setMapSelection({ layer, ids })}
              key={tableLayer}
              initial={tableLayer}
              model={model}
              layers={layers}
              t={t}
              close={() => setTable(false)}
              selection={selection}
              setSelection={setSelection}
            />
          )}
        </section>
        <aside className="v2-inspector">
          <div className="v2-tabs">
            {[
              ["style", "Scene", "场景"],
              ["climate", "Weather", "气象"],
              ["analysis", "Analysis", "分析"],
              ["info", "Data", "数据"],
            ].map(([id, en, zh]) => (
              <button
                key={id}
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
              >
                {t(en, zh)}
              </button>
            ))}
          </div>
          <div className="v2-inspector-content">
            {tab === "style" && (
              <>
                <span className="eyebrow">TERRAIN / SANDBOX</span>
                <h2>{t("Shape the scene", "构建场景")}</h2>
                <label>
                  {t("Grid size · metres", "网格大小 · 米")}
                  <div className="v2-fields">
                    <select
                      value={
                        [10, 20, 30, 50, 100].includes(size) ? size : "custom"
                      }
                      onChange={(e) =>
                        e.target.value !== "custom" && setSize(+e.target.value)
                      }
                    >
                      {[10, 20, 30, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n} m
                        </option>
                      ))}
                      <option value="custom">{t("Custom", "自定义")}</option>
                    </select>
                    <input
                      aria-label="Cell size"
                      type="number"
                      min="5"
                      max="5000"
                      value={size}
                      onChange={(e) => setSize(+e.target.value)}
                    />
                  </div>
                </label>
                <label className="v2-check">
                  <input
                    type="checkbox"
                    checked={ground}
                    onChange={(e) => setGround(e.target.checked)}
                  />
                  {t("Flatten ground under buildings", "平整建筑下方地面")}
                </label>
                <small>
                  {t(
                    "Estimated from neighbouring non-building cells.",
                    "使用邻近非建筑网格估算。",
                  )}
                </small>
                <button
                  className="primary v2-wide"
                  disabled={busy || !layers.length}
                  onClick={() => guard(() => construct(layers))}
                >
                  {t("Rebuild local scene", "重新构建本地场景")}
                </button>
                <hr />
                <h3>{t("Display layers", "显示图层")}</h3>
                {[
                  ["terrain", "Terrain surface", "地形曲面"],
                  ["lst", "Analysis colours", "分析色带"],
                  ["buildings", "Buildings", "建筑"],
                  ["imagery", "Base imagery", "底图"],
                  ["wire", "Grid borders", "网格边框"],
                ].map(([k, en, zh]) => (
                  <label className="v2-check" key={k}>
                    <input
                      type="checkbox"
                      checked={style[k]}
                      onChange={(e) => changeStyle({ [k]: e.target.checked })}
                    />
                    {t(en, zh)}
                  </label>
                ))}
                {style.wire && (
                  <div className="v2-fields">
                    <label>
                      {t("Border colour", "边框颜色")}
                      <input
                        aria-label="Border colour"
                        type="color"
                        value={style.wireColor}
                        onChange={(e) =>
                          changeStyle({ wireColor: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      {t("Width · px", "宽度 · px")}
                      <input
                        type="number"
                        min=".5"
                        max="5"
                        step=".5"
                        value={style.wireWidth}
                        onChange={(e) =>
                          changeStyle({ wireWidth: +e.target.value })
                        }
                      />
                    </label>
                  </div>
                )}
                <label>
                  {t("Colour ramp", "色带")}
                  <select
                    value={style.ramp}
                    onChange={(e) => changeStyle({ ramp: e.target.value })}
                  >
                    {Object.keys(RAMPS).map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <div className="v2-fields">
                  <label>
                    {t("Minimum", "最小值")}
                    <input
                      type="number"
                      value={style.min}
                      onChange={(e) => changeStyle({ min: +e.target.value })}
                    />
                  </label>
                  <label>
                    {t("Maximum", "最大值")}
                    <input
                      type="number"
                      value={style.max}
                      onChange={(e) => changeStyle({ max: +e.target.value })}
                    />
                  </label>
                </div>
                {[
                  ["opacity", "Analysis opacity", "分析不透明度", 1, 0.05],
                  [
                    "buildingOpacity",
                    "Building opacity",
                    "建筑不透明度",
                    1,
                    0.05,
                  ],
                  ["wireOpacity", "Border opacity", "边框不透明度", 1, 0.05],
                  ["zScale", "Vertical exaggeration", "高程显示倍率", 10, 0.1],
                ].map(([key, en, zh, max, step]) => (
                  <label key={key}>
                    {t(en, zh)} <b>{style[key]}</b>
                    <input
                      type="range"
                      min={key === "zScale" ? 0.1 : 0}
                      max={max}
                      step={step}
                      value={style[key]}
                      onChange={(e) => changeStyle({ [key]: +e.target.value })}
                    />
                  </label>
                ))}
                <small>
                  {t(
                    "Rhino exports true elevations; display exaggeration is separate.",
                    "Rhino 导出真实高程，显示倍率不写入数据。",
                  )}
                </small>
              </>
            )}
            {tab === "climate" && <Climate weather={weather} t={t} />}{" "}
            {tab === "analysis" && (
              <>
                <h2>{t("Analysis workbench", "分析工作台")}</h2>
                <details open>
                  <summary>{t("Basic analysis", "基础分析")}</summary>
                  <label>
                    {t("Input layer", "输入图层")}
                    <select
                      value={selectedInput?.id || ""}
                      onChange={(e) => setInputLayer(e.target.value)}
                    >
                      {layers
                        .filter((l) => l.kind === "vector")
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    {t("Operation", "操作")}
                    <select
                      value={operation}
                      onChange={(e) => setOperation(e.target.value)}
                    >
                      {[
                        ["measure", "Area / length", "面积 / 长度"],
                        ["statistics", "Field statistics", "字段统计"],
                        ["centroid", "Representative points", "代表点"],
                        ["buffer", "Buffer", "缓冲区"],
                        ["kde", "Point kernel density", "点核密度"],
                      ].map(([id, en, zh]) => (
                        <option key={id} value={id}>
                          {t(en, zh)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {operation === "statistics" && (
                    <label>
                      {t("Field", "字段")}
                      <select
                        value={field}
                        onChange={(e) => setField(e.target.value)}
                      >
                        <option value="">{t("Select…", "请选择…")}</option>
                        {Object.keys(
                          selectedInput?.data.features[0]?.properties || {},
                        ).map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  {["buffer", "kde"].includes(operation) && (
                    <label>
                      {t("Distance / bandwidth · m", "距离 / 带宽 · 米")}
                      <input
                        type="number"
                        min="10"
                        max="5000"
                        value={distance}
                        onChange={(e) => setDistance(+e.target.value)}
                      />
                    </label>
                  )}
                  <button
                    disabled={busy || !selectedInput}
                    className="primary v2-wide"
                    onClick={basic}
                  >
                    {t("Run locally", "在本地运行")}
                  </button>
                  {result && (
                    <pre>{JSON.stringify(result.values, null, 2)}</pre>
                  )}
                </details>
                <details>
                  <summary>{t("Chat with GeoCIM", "与GeoCIM对话")}</summary>
                  <span className="v2-chip">
                    {t("LOCAL PRESETS", "本地预设")}
                  </span>
                  <div className="v2-chat">
                    {chat.map((m, i) => (
                      <div key={i}>
                        <b>{m.text}</b>
                        <p>{m.reply}</p>
                      </div>
                    ))}
                  </div>
                  <div className="v2-prompts">
                    {[
                      ["Open attributes", "打开属性表"],
                      ["Show grid", "显示网格"],
                      ["Top view", "俯视"],
                    ].map(([en, zh]) => (
                      <button key={en} onClick={() => setPrompt(t(en, zh))}>
                        {t(en, zh)}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder={t(
                      "Ask for a local operation…",
                      "输入本地操作…",
                    )}
                  />
                  <button onClick={sendChat} className="primary">
                    {t("Run preset", "执行预设")}
                  </button>
                  <p>
                    {t(
                      "API connection and unrestricted code execution are not active.",
                      "API 连接与任意代码执行尚未启用。",
                    )}
                  </p>
                </details>
              </>
            )}
            {tab === "info" && (
              <>
                <span className="eyebrow">DATA / PROVENANCE</span>
                <h2>{t("Know your inputs", "了解输入数据")}</h2>
                <p>
                  {t(
                    "All computations run on this computer. No imported dataset is sent to a server.",
                    "计算在此电脑执行，导入数据不会发送到服务器。",
                  )}
                </p>
                {layers.map((l) => (
                  <details key={l.id}>
                    <summary>{l.name}</summary>
                    <p>
                      {l.kind} · {l.crs || "WGS84 / station metadata"}
                      <br />
                      {l.unit || ""}
                      <br />
                      {l.acquisition || ""}
                    </p>
                    {l.kind === "raster" && (
                      <pre>
                        {JSON.stringify(
                          { ...stats(l.values), extent: l.extent },
                          null,
                          2,
                        )}
                      </pre>
                    )}
                  </details>
                ))}
                {model && (
                  <>
                    <h3>{t("Result provenance", "结果说明")}</h3>
                    <p>
                      {model.grid.crs} · {model.grid.size} m<br />
                      {model.grid.method}
                    </p>
                    <p>
                      {t(
                        "DEM vertical datum is unknown. Ground under buildings is an estimate; unresolved areas remain gaps.",
                        "DEM 垂直基准待确认。建筑下方地面是估算值，无法估算的区域保留空洞。",
                      )}
                    </p>
                    <p>
                      {t(
                        "Building parts outside valid terrain",
                        "有效地形外的建筑部分",
                      )}
                      : {model.buildings.skipped}
                    </p>
                    <button
                      onClick={() =>
                        jsonDownload(
                          {
                            crs: model.grid.crs,
                            origin: model.grid.origin,
                            size: model.grid.size,
                            method: model.grid.method,
                            ground: model.grid.groundMethod,
                            lst: st,
                          },
                          "analysis-provenance.json",
                        )
                      }
                    >
                      {t("Export parameters", "导出参数")}
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </aside>
      </main>
      <footer className="v2-status">
        <span>
          {busy ? "◌ " : "● "}
          {notice || t("Local workspace ready", "本地工作空间已就绪")}
        </span>
        <span>
          GeoCIM+ V2 · {layers.length} {t("layers", "图层")}
        </span>
      </footer>
      {error && (
        <div className="v2-error" role="alert">
          <button onClick={() => setError("")}>×</button>
          {error}
        </div>
      )}
      {circuit && (
        <Suspense fallback={<div className="v2-notice">Loading Circuit…</div>}>
          <Circuit
            onDockHeight={setDockHeight}
            graph={graph}
            setGraph={setGraph}
            layers={layers}
            onRun={runCircuit}
            busy={busy}
            status={nodeStatus}
            close={() => setCircuit(false)}
            t={t}
          />
        </Suspense>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
