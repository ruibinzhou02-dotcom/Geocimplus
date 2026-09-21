import React, { useState } from "react";
import {
  CATEGORIES,
  categoryOf,
  layerIcon,
  fieldNames,
  classifyLayer,
  colorCSS,
} from "./layers.mjs";
import { ROOT_LAYERS, bucketOf, canEdit } from "./layer-policy.mjs";
import { jsonDownload } from "./project.mjs";
import { RAMPS } from "./terrain-mesh.mjs";
export function LayerTree({
  layers,
  setLayers,
  selected,
  onSelect,
  onTable,
  t,
}) {
  const leaf = (l) => (
    <div
      className={"v2-tree-child " + (selected === l.id ? "selected" : "")}
      key={l.id}
    >
      <input
        type="checkbox"
        aria-label={"Toggle " + l.name}
        checked={l.visible !== false}
        onChange={(e) =>
          setLayers((ls) =>
            ls.map((x) =>
              x.id === l.id ? { ...x, visible: e.target.checked } : x,
            ),
          )
        }
      />
      <button
        title={t(l.name, l.nameZh || l.name)}
        onClick={() => onSelect(l.id)}
      >
        <span>{layerIcon(l)}</span> {t(l.name, l.nameZh || l.name)}
      </button>
      {!canEdit(l) && <span title={t("Read-only data", "数据只读")}>▣</span>}
      {l.kind === "vector" && (
        <button
          aria-label={"Attributes " + l.name}
          title={t("Attributes", "属性表")}
          onClick={() => onTable(l.id)}
        >
          ▤
        </button>
      )}
    </div>
  );
  return (
    <>
      {ROOT_LAYERS.map(([root, en, zh, icon]) => {
        const children = layers.filter(
            (l) => l.kind !== "epw" && bucketOf(l) === root,
          ),
          visible = children.filter((l) => l.visible !== false).length;
        return (
          <details className="v2-layer-group" open key={root}>
            <summary>
              <input
                type="checkbox"
                aria-label={`Toggle group ${en}`}
                checked={!!children.length && visible === children.length}
                ref={(el) => {
                  if (el)
                    el.indeterminate = visible > 0 && visible < children.length;
                }}
                disabled={!children.length}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  setLayers((ls) =>
                    ls.map((l) =>
                      bucketOf(l) === root
                        ? { ...l, visible: e.target.checked }
                        : l,
                    ),
                  )
                }
              />
              <span>
                {icon} {t(en, zh)}
              </span>
              <small>{children.length}</small>
            </summary>
            {root === "display" ? (
              CATEGORIES.map(([id, en, zh]) => {
                const sub = children.filter((l) => categoryOf(l) === id);
                return sub.length ? (
                  <details className="v2-layer-subgroup" open key={id}>
                    <summary>
                      {t(en, zh)} <small>{sub.length}</small>
                    </summary>
                    {sub.map(leaf)}
                  </details>
                ) : null;
              })
            ) : (
              <div>
                {root === "analysis" && children.length > 0 && (
                  <small className="v2-tree-empty">
                    {t("Source / working data", "原始 / 工作数据")}
                  </small>
                )}
                {children.map(leaf)}
              </div>
            )}
            {!children.length && (
              <small className="v2-tree-empty">
                {t("No layers", "暂无图层")}
              </small>
            )}
          </details>
        );
      })}
    </>
  );
}
export function LayerStyle({
  layer: l,
  layers = [],
  onSelect,
  onChange,
  onTable,
  onRemove,
  t,
}) {
  const picker = (
    <label className="v2-symbol-layer">
      {t("Layer", "图层")}
      <select
        aria-label="Symbology layer"
        value={l?.id || ""}
        onChange={(e) => onSelect(e.target.value)}
      >
        {!l && <option value="">{t("Select a layer", "选择图层")}</option>}
        {ROOT_LAYERS.map(([id, en, zh]) => (
          <optgroup key={id} label={t(en, zh)}>
            {layers
              .filter((x) => x.kind !== "epw" && bucketOf(x) === id)
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {t(x.name, x.nameZh || x.name)}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
  if (!l)
    return (
      <p>
        {t(
          "Select a child layer to set its colours and attributes.",
          "选择子图层，设置属性与色彩。",
        )}
      </p>
    );
  if (l.kind === "summary")
    return (
      <div className="v2-layer-style">
        {picker}
        <h2>{t(l.name, l.nameZh || l.name)}</h2>
        <span className="v2-chip">{t("Result report", "结果报告")}</span>
        <dl className="v2-stat-report">
          {Object.entries(l.data.values || {}).map(([k, v]) => (
            <React.Fragment key={k}>
              <dt>{k}</dt>
              <dd>
                {typeof v === "number"
                  ? Number(v.toFixed(4))
                  : String(v ?? "—")}
              </dd>
            </React.Fragment>
          ))}
        </dl>
        <button
          onClick={() =>
            jsonDownload(l.data, `${t(l.name, l.nameZh || l.name)}.json`)
          }
        >
          {t("Export report", "导出报告")}
        </button>
      </div>
    );
  const s = l.symbology || {},
    fields = fieldNames(l),
    set = (p) => onChange({ symbology: { ...s, ...p } }),
    classified = classifyLayer(l);
  return (
    <div className="v2-layer-style">
      {picker}
      <h2>{t(l.name, l.nameZh || l.name)}</h2>
      <span className="v2-chip">
        {t(...ROOT_LAYERS.find(([id]) => id === bucketOf(l)).slice(1, 3))} ·{" "}
        {canEdit(l)
          ? t("Working data", "工作数据")
          : t("Read-only data", "只读数据")}
      </span>
      <small>
        {l.crs || "EPSG:4326"} ·{" "}
        {l.kind === "raster"
          ? `${l.width} × ${l.height}`
          : `${l.data.features.length.toLocaleString()} ${t("features", "个要素")}`}
      </small>
      <h3>{t("Symbology", "图层样式")}</h3>
      {["imagery", "flatImagery"].includes(l.role) ? (
        <>
          <label>
            {t("Image display", "影像显示")}
            <select
              aria-label="Image display"
              value={s.imageryMode || (l.rgb ? "rgb" : "grayscale")}
              onChange={(e) => set({ imageryMode: e.target.value })}
            >
              <option value="rgb" disabled={!l.rgb}>
                {t("Colour composite", "彩色合成")}
              </option>
              <option value="grayscale">
                {t("First-band grayscale", "第一通道灰度")}
              </option>
            </select>
          </label>
          {l.rgbStatus === "provisional" && (
            <small>
              {t(
                "R=C1, G=C2, B=C3 · channel identities unverified",
                "R=C1、G=C2、B=C3 · 原始通道含义待核实",
              )}
            </small>
          )}
        </>
      ) : (
        <>
          <label>
            {t("Colour by", "着色方式")}
            <select
              aria-label="Colour by"
              value={s.mode || "single"}
              onChange={(e) =>
                set({ mode: e.target.value, field: s.field || fields[0] })
              }
            >
              <option value="single">{t("Single colour", "单一颜色")}</option>
              <option value="equal">
                {t("Equal intervals", "等间隔分级")}
              </option>
              <option value="quantile">{t("Quantiles", "分位数分级")}</option>
              <option value="categorical">
                {t("Unique values", "唯一值分类")}
              </option>
            </select>
          </label>
          {s.mode && s.mode !== "single" ? (
            <>
              <label>
                {t("Attribute field", "属性字段")}
                <select
                  aria-label="Colour field"
                  value={s.field || fields[0] || ""}
                  onChange={(e) => set({ field: e.target.value })}
                >
                  {fields.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                {t("Colour ramp", "色带")}
                <select
                  value={s.ramp || "purple"}
                  onChange={(e) => set({ ramp: e.target.value })}
                >
                  {Object.keys(RAMPS).map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </label>
              <div
                className="v2-ramp-preview"
                aria-label="Colour ramp preview"
                style={{
                  height: 10,
                  borderRadius: 4,
                  background: `linear-gradient(90deg,${(RAMPS[s.ramp || "purple"] || RAMPS.purple).join(",")})`,
                }}
              />
              {s.mode !== "categorical" && (
                <label>
                  {t("Classes", "分级数")}
                  <input
                    type="number"
                    min="2"
                    max="9"
                    value={s.classes || 5}
                    onChange={(e) => set({ classes: +e.target.value })}
                  />
                </label>
              )}
            </>
          ) : (
            <label>
              {t("Colour", "颜色")}
              <input
                type="color"
                value={s.color || (l.heightField ? "#d6cedf" : "#9474b1")}
                onChange={(e) => set({ color: e.target.value })}
              />
            </label>
          )}
        </>
      )}
      <label>
        {t("Opacity", "不透明度")} · {Math.round((s.opacity ?? 1) * 100)}%
        <input
          aria-label="Layer opacity"
          type="range"
          min="0"
          max="1"
          step=".05"
          value={s.opacity ?? 1}
          onChange={(e) => set({ opacity: +e.target.value })}
        />
      </label>
      {l.kind === "vector" && !l.heightField && (
        <>
          <label className="v2-check">
            <input
              type="checkbox"
              checked={s.outline !== false}
              onChange={(e) => set({ outline: e.target.checked })}
            />
            {t("Outline", "边框")}
          </label>
          {s.outline !== false && (
            <label>
              {t("Outline colour", "边框颜色")}
              <input
                type="color"
                value={s.outlineColor || "#7855a8"}
                onChange={(e) => set({ outlineColor: e.target.value })}
              />
            </label>
          )}
        </>
      )}
      {!["imagery", "flatImagery"].includes(l.role) && (
        <div className="v2-class-legend">
          {classified.legend.map((v, i) => (
            <div key={i}>
              <i style={{ background: colorCSS(v.color) }} />
              <span>{v.label}</span>
            </div>
          ))}
        </div>
      )}
      {l.kind === "vector" && (
        <button onClick={() => onTable(l.id)}>
          {t("Open attribute table", "打开属性表")}
        </button>
      )}
      <small>
        {t(
          "Change parent layers and data settings in Upload.",
          "所属母图层与数据设置在上传页管理。",
        )}
      </small>
    </div>
  );
}

export function UploadPanel({
  category,
  setCategory,
  bucket,
  setBucket,
  role,
  setRole,
  unit,
  setUnit,
  onUpload,
  busy,
  layers,
  t,
}) {
  return (
    <>
      <span className="eyebrow">LOCAL FILES</span>
      <h2>{t("Upload", "上传")}</h2>
      <p>
        {t(
          "Choose Analysis, Display or Results, then add files. Display data becomes read-only.",
          "先选择分析、展示或结果母图层，再添加文件。展示数据导入后只读。",
        )}
      </p>
      <label>
        {t("Parent layer", "母图层")}
        <select
          aria-label="Upload parent"
          value={bucket}
          onChange={(e) => setBucket(e.target.value)}
        >
          {ROOT_LAYERS.map(([id, en, zh]) => (
            <option key={id} value={id}>
              {t(en, zh)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Data category", "数据类别")}
        <select
          aria-label="Upload category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {CATEGORIES.map(([id, en, zh]) => (
            <option key={id} value={id}>
              {t(en, zh)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Raster role", "栅格角色")}
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="data">{t("Data only", "仅数据")}</option>
          <option value="dem">{t("Elevation", "高程")}</option>
          <option value="lst">LST</option>
          <option value="imagery">{t("Base imagery", "底图")}</option>
          <option value="flatImagery">
            {t("Flat satellite reference", "平面卫星底图")}
          </option>
        </select>
      </label>
      <label>
        {t("Raster unit, if known", "栅格单位（已知时填写）")}
        <input
          placeholder="m / °C"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </label>
      <button className="primary v2-wide" disabled={busy} onClick={onUpload}>
        ＋ {t("Choose local files", "选择本地文件")}
      </button>
      <p>Shapefile · GeoJSON · GeoTIFF · EPW</p>
      <small>
        {t(
          "Shapefile: select .shp, .shx, .dbf, .prj and .cpg together, or a ZIP. EPW files go to the Weather plugin.",
          "Shapefile 请同时选择 .shp、.shx、.dbf、.prj、.cpg，或选择 ZIP。EPW 文件进入气象插件。",
        )}
      </small>
      <hr />
      <p>
        {t(
          "Files and computations stay on this computer.",
          "文件与计算均留在本机。",
        )}
      </p>
      {layers
        .filter((l) => l.kind === "raster")
        .map((l) => (
          <details key={l.id}>
            <summary>{t(l.name, l.nameZh || l.name)}</summary>
            <p>
              {l.crs} · {l.unit || t("Unit not specified", "单位待确认")}
              <br />
              {l.acquisition || ""}
            </p>
          </details>
        ))}
    </>
  );
}
export function ConversionPanel({ layers, onConvert, busy, t }) {
  const [id, setId] = useState(""),
    [method, setMethod] = useState("mean"),
    [size, setSize] = useState(30),
    [name, setName] = useState("");
  const rasters = layers.filter(
      (l) =>
        l.kind === "raster" && !["imagery", "flatImagery"].includes(l.role),
    ),
    source = rasters.find((l) => l.id === id) || rasters[0];
  return (
    <details className="v2-conversion" open>
      <summary>{t("Raster → fishnet", "栅格 → 渔网")}</summary>
      <label>
        {t("Source raster", "输入栅格")}
        <select
          aria-label="Conversion source"
          value={source?.id || ""}
          onChange={(e) => setId(e.target.value)}
        >
          {!rasters.length && (
            <option value="">
              {t("Upload a numeric raster", "请上传数值栅格")}
            </option>
          )}
          {rasters.map((l) => (
            <option key={l.id} value={l.id}>
              {t(l.name, l.nameZh || l.name)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Resampling", "重采样方式")}
        <select
          aria-label="Resampling"
          value={method}
          onChange={(e) => setMethod(e.target.value)}
        >
          <option value="mean">
            {t("Area-weighted cell mean", "网格内面积加权均值")}
          </option>
          <option value="bilinear">
            {t("Bilinear at cell centre", "网格中心双线性插值")}
          </option>
          <option value="nearest">{t("Nearest pixel", "最近邻像元")}</option>
        </select>
      </label>
      <label>
        {t("Cell size · metres", "网格大小 · 米")}
        <input
          aria-label="Conversion cell size"
          type="number"
          min="5"
          max="5000"
          value={size}
          onChange={(e) => setSize(+e.target.value)}
        />
      </label>
      <label>
        {t("Result name", "结果名称")}
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("Fishnet result", "渔网结果")}
        />
      </label>
      <button
        className="v2-wide"
        disabled={busy || !source}
        onClick={() => onConvert(source, { method, size, name })}
      >
        {t("Create result layer", "生成结果子图层")}
      </button>
      <small>
        {t(
          "Uses a local UTM grid in metres. NoData remains empty. The result is polygon data with attributes, ready for Circuit and GeoJSON export. Interpolation adds no new measured detail.",
          "采用本地 UTM 米制网格，保留无数据区域。结果为带属性的面数据，可进入 Circuit 并导出 GeoJSON；插值不增加实测细节。",
        )}
      </small>
    </details>
  );
}

export function LayerManager({
  layer: l,
  layers,
  onSelect,
  onChange,
  onCopy,
  onRemove,
  onGeometry,
  t,
}) {
  const [text, setText] = useState(""),
    [editing, setEditing] = useState(false);
  if (!l) return null;
  const editable = canEdit(l);
  return (
    <div className="v2-layer-manager">
      <h3>{t("Manage imported layers", "管理已导入图层")}</h3>
      <select
        aria-label="Managed layer"
        value={l.id}
        onChange={(e) => {
          onSelect(e.target.value);
          setEditing(false);
        }}
      >
        {layers
          .filter((x) => x.kind !== "epw")
          .map((x) => (
            <option value={x.id} key={x.id}>
              {x.name}
            </option>
          ))}
      </select>
      <label>
        {t("Layer name", "图层名称")}
        <input
          disabled={!editable}
          value={t(l.name, l.nameZh || l.name)}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </label>
      <label>
        {t("Parent layer", "母图层")}
        <select
          aria-label="Layer parent"
          disabled={!editable}
          value={bucketOf(l)}
          onChange={(e) => onChange({ bucket: e.target.value })}
        >
          {ROOT_LAYERS.map(([id, en, zh]) => (
            <option value={id} key={id}>
              {t(en, zh)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("Data category", "数据类别")}
        <select
          disabled={!editable}
          value={categoryOf(l)}
          onChange={(e) => onChange({ category: e.target.value })}
        >
          {CATEGORIES.map(([id, en, zh]) => (
            <option value={id} key={id}>
              {t(en, zh)}
            </option>
          ))}
        </select>
      </label>
      <button className="v2-wide" onClick={() => onCopy(l)}>
        {t("Copy to Analysis", "复制到分析图层")}
      </button>
      {!editable && (
        <small>
          {t(
            "Display geometry and attributes are locked. Copy to Analysis to edit or calculate. All layers can be styled in Symbology.",
            "展示图层的几何与属性只读，复制到分析图层后可编辑和计算。所有图层均可在符号系统设置显示样式。",
          )}
        </small>
      )}
      {editable && l.kind === "raster" && (
        <>
          <label>
            {t("Raster role", "栅格角色")}
            <select
              value={l.role || "data"}
              onChange={(e) => onChange({ role: e.target.value })}
            >
              <option value="data">{t("Data only", "仅数据")}</option>
              <option value="dem">{t("Elevation", "高程")}</option>
              <option value="lst">LST</option>
              <option value="imagery">{t("Base imagery", "底图")}</option>
              <option value="flatImagery">
                {t("Flat satellite reference", "平面卫星底图")}
              </option>
            </select>
          </label>
          <label>
            {t("Unit", "单位")}
            <input
              value={l.unit || ""}
              onChange={(e) => onChange({ unit: e.target.value })}
            />
          </label>
        </>
      )}
      {editable && l.kind === "vector" && (
        <>
          <label>
            {t("Building height field · metres", "建筑离地高度字段 · 米")}
            <select
              value={l.heightField || ""}
              onChange={(e) => onChange({ heightField: e.target.value })}
            >
              <option value="">{t("No extrusion", "不拉伸")}</option>
              {fieldNames(l).map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <button
            className="v2-wide"
            onClick={() => {
              setText(JSON.stringify(l.data, null, 2));
              setEditing(true);
            }}
          >
            {t("Edit GeoJSON copy", "编辑 GeoJSON 副本")}
          </button>
          {editing && (
            <>
              <textarea
                aria-label="GeoJSON editor"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              <button
                onClick={async () => {
                  if (await onGeometry(l, text)) setEditing(false);
                }}
              >
                {t("Validate and apply", "校验并应用")}
              </button>
              <button onClick={() => setEditing(false)}>
                {t("Cancel", "取消")}
              </button>
            </>
          )}
          <small>
            {t(
              "Attributes can also be edited on selected rows in the attribute table. Source files are never overwritten.",
              "也可在属性表编辑选中行。原始文件不会被覆盖。",
            )}
          </small>
        </>
      )}
      {editable && (
        <button className="v2-wide" onClick={onRemove}>
          {t("Remove layer", "移除图层")}
        </button>
      )}
    </div>
  );
}
