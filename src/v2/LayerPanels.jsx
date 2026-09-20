import React, { useState } from "react";
import {
  CATEGORIES,
  categoryOf,
  layerIcon,
  fieldNames,
  classifyLayer,
  colorCSS,
} from "./layers.mjs";
import { RAMPS } from "./terrain-mesh.mjs";
export function LayerTree({
  layers,
  setLayers,
  selected,
  onSelect,
  onTable,
  t,
}) {
  return (
    <>
      {CATEGORIES.map(([id, en, zh, icon]) => {
        const children = layers.filter(
          (l) => l.kind !== "epw" && categoryOf(l) === id,
        );
        return (
          <details className="v2-layer-group" open key={id}>
            <summary>
              <input
                type="checkbox"
                aria-label={`Toggle group ${en}`}
                checked={
                  !!children.length &&
                  children.every((l) => l.visible !== false)
                }
                disabled={!children.length}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  setLayers((ls) =>
                    ls.map((l) =>
                      categoryOf(l) === id
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
            {children.map((l) => (
              <div
                className={
                  "v2-tree-child " + (selected === l.id ? "selected" : "")
                }
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
                <button title={l.name} onClick={() => onSelect(l.id)}>
                  <span>{layerIcon(l)}</span> {l.name}
                </button>
                {l.kind === "vector" && (
                  <button
                    title={t("Attribute table", "属性表")}
                    aria-label={"Attributes " + l.name}
                    onClick={() => onTable(l.id)}
                  >
                    ▤
                  </button>
                )}
              </div>
            ))}
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
export function LayerStyle({ layer: l, onChange, onTable, onRemove, t }) {
  if (!l)
    return (
      <p>
        {t(
          "Select a child layer to set its colours and attributes.",
          "选择子图层，设置属性与色彩。",
        )}
      </p>
    );
  const s = l.symbology || {},
    fields = fieldNames(l),
    set = (p) => onChange({ symbology: { ...s, ...p } }),
    classified = classifyLayer(l);
  return (
    <div className="v2-layer-style">
      <h2>{l.name}</h2>
      <label>
        {t("Parent layer", "主图层")}
        <select
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
      <small>
        {l.crs || "EPSG:4326"} ·{" "}
        {l.kind === "raster"
          ? `${l.width} × ${l.height}`
          : `${l.data.features.length.toLocaleString()} ${t("features", "个要素")}`}
      </small>
      <h3>{t("Symbology", "图层样式")}</h3>
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
          <option value="equal">{t("Equal intervals", "等间隔分级")}</option>
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
      <div className="v2-class-legend">
        {classified.legend.map((v, i) => (
          <div key={i}>
            <i style={{ background: colorCSS(v.color) }} />
            <span>{v.label}</span>
          </div>
        ))}
      </div>
      {l.kind === "raster" && (
        <>
          <h3>{t("Raster role", "栅格角色")}</h3>
          <select
            aria-label="Raster role"
            value={l.role || "data"}
            onChange={(e) => onChange({ role: e.target.value })}
          >
            <option value="data">{t("Data only", "仅数据")}</option>
            <option value="dem">{t("Elevation", "高程")}</option>
            <option value="lst">{t("Analysis / LST", "分析 / LST")}</option>
            <option value="imagery">{t("Base imagery", "底图")}</option>
          </select>
          <label>
            {t("Unit", "单位")}
            <input
              value={l.unit || ""}
              onChange={(e) => onChange({ unit: e.target.value })}
            />
          </label>
          <small>
            {t(
              "Role changes apply when the scene is rebuilt. Numeric raster colours appear on the scene grid; convert other rasters in Scene.",
              "调整角色后重新构建场景。数值栅格在场景网格上着色；其他栅格请在场景页转换。",
            )}
          </small>
        </>
      )}
      {l.kind === "vector" && (
        <>
          <button onClick={() => onTable(l.id)}>
            {t("Open attribute table", "打开属性表")}
          </button>
          <details>
            <summary>
              {t("Building height · metres", "建筑离地高度 · 米")}
            </summary>
            <select
              value={l.heightField || ""}
              onChange={(e) => onChange({ heightField: e.target.value })}
            >
              <option value="">{t("No extrusion", "不拉伸")}</option>
              {fields.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <small>
              {t(
                "Confirm the field and rebuild the scene.",
                "确认字段后重新构建场景。",
              )}
            </small>
          </details>
        </>
      )}
      {l.gridData && (
        <small>
          {l.gridData.size} m · {l.gridData.crs}
          <br />
          {l.gridData.method}
        </small>
      )}
      <button className="v2-wide" onClick={onRemove}>
        {t("Remove layer", "移除图层")}
      </button>
    </div>
  );
}
export function UploadPanel({
  category,
  setCategory,
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
          "Choose a parent layer, then add files from your computer.",
          "先选择主图层，再添加电脑中的文件。",
        )}
      </p>
      <label>
        {t("Parent layer", "主图层")}
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
          "Shapefile: select .shp, .shx, .dbf, .prj and .cpg together, or a ZIP. One dataset becomes one child layer. EPW files go to the Weather plugin.",
          "Shapefile 请同时选择 .shp、.shx、.dbf、.prj、.cpg，或选择 ZIP。每份数据成为一个子图层；EPW 文件进入气象插件。",
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
            <summary>{l.name}</summary>
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
      (l) => l.kind === "raster" && l.role !== "imagery",
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
              {l.name}
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
        {t("Create analysis layer", "生成分析子图层")}
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
