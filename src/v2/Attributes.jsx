import React, { useState, useMemo, useEffect } from "react";
import { gridGeoJSON } from "./raster-grid.mjs";
import { jsonDownload } from "./project.mjs";
export default function Attributes({
  model,
  layers,
  close,
  t,
  onSelection,
  selection,
  setSelection,
  initial = "grid",
}) {
  const [layer, setLayer] = useState(initial),
    [height, setHeight] = useState(250),
    [field, setField] = useState(""),
    [op, setOp] = useState(">"),
    [value, setValue] = useState(""),
    [page, setPage] = useState(0),
    [filtered, setFiltered] = useState(null);
  const vector = layers.find((l) => l.id === layer),
    g = layer === "lstgrid" ? model?.lst : model?.grid;
  const rows = useMemo(
    () =>
      ["grid", "lstgrid"].includes(layer) && g
        ? Array.from(g.mean, (v, k) =>
            Number.isFinite(v)
              ? {
                  cell_id: k,
                  mean_value: v,
                  min_value: g.min[k],
                  max_value: g.max[k],
                  valid_count: g.count[k],
                  coverage: g.coverage[k],
                  nodata_ratio: g.nodataRatio[k],
                  ground_status: g.groundStatus
                    ? ["original", "estimated", "unresolved"][g.groundStatus[k]]
                    : "original",
                }
              : null,
          ).filter(Boolean)
        : vector?.data?.features?.map((f, i) => ({
            ...f.properties,
            __index: i,
          })) || [],
    [g, vector, layer],
  );
  const fields = Object.keys(rows[0] || {}),
    display = filtered
      ? rows.filter((r) =>
          filtered.has(
            ["grid", "lstgrid"].includes(layer) ? r.cell_id : r.__index,
          ),
        )
      : rows;
  useEffect(() => {
    setPage(0);
    setFiltered(null);
    setField("");
    setSelection([]);
    onSelection?.(layer, []);
  }, [layer, model]);
  const select = () => {
    const key = field || fields[0],
      ids = rows
        .filter((r) => {
          const v = r[key];
          if (op === "contains")
            return String(v ?? "")
              .toLowerCase()
              .includes(value.toLowerCase());
          if (op === "=") return String(v) === value;
          if (value.trim() === "" || v == null || v === "") return false;
          return op === ">"
            ? Number(v) > Number(value)
            : Number(v) < Number(value);
        })
        .map((r) =>
          ["grid", "lstgrid"].includes(layer) ? r.cell_id : r.__index,
        );
    setSelection(ids);
    onSelection?.(layer, ids);
  };
  const exportRows = (only) => {
    const ids = only ? selection : null;
    if (["grid", "lstgrid"].includes(layer))
      jsonDownload(
        gridGeoJSON(g, ids),
        `${layer}${only ? "-selected" : ""}.geojson`,
      );
    else
      jsonDownload(
        {
          ...vector.data,
          features: ids
            ? vector.data.features.filter((_, i) => ids.includes(i))
            : vector.data.features,
        },
        `${vector.name}${only ? "-selected" : ""}.geojson`,
      );
  };
  const resize = (e) => {
    const y = e.clientY,
      h = height;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.onpointermove = (ev) =>
      setHeight(
        Math.max(100, Math.min(window.innerHeight - 150, h + y - ev.clientY)),
      );
    e.currentTarget.onpointerup = (ev) => {
      ev.currentTarget.onpointermove = null;
    };
  };
  return (
    <section className="v2-attributes" style={{ height }}>
      <div
        className="v2-resize"
        role="separator"
        aria-label="Resize attributes"
        onPointerDown={resize}
      />
      <header>
        <b>{t("Attribute table", "属性表")}</b>
        <select value={layer} onChange={(e) => setLayer(e.target.value)}>
          {model && (
            <option value="grid">{t("Terrain grid", "地形网格")}</option>
          )}
          {model?.lst && (
            <option value="lstgrid">{t("LST grid", "LST 网格")}</option>
          )}
          {layers
            .filter((l) => l.kind === "vector")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        <span>
          {display.length.toLocaleString()} {t("rows", "行")} ·{" "}
          {selection.length} {t("selected", "已选")}
        </span>
        <button onClick={() => exportRows(false)} disabled={!rows.length}>
          GeoJSON ↓
        </button>
        <button onClick={() => exportRows(true)} disabled={!selection.length}>
          {t("Export selection", "导出选择")}
        </button>
        <button onClick={close}>×</button>
      </header>
      <div className="v2-table-tools">
        <select
          aria-label="Attribute field"
          value={field || fields[0] || ""}
          onChange={(e) => setField(e.target.value)}
        >
          {fields.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
        <select
          aria-label="Attribute comparison"
          value={op}
          onChange={(e) => setOp(e.target.value)}
        >
          {[">", "<", "=", "contains"].map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
        <input
          aria-label="Attribute value"
          placeholder={t("Value", "值")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button onClick={select}>
          {t("Select by attribute", "按属性选择")}
        </button>
        <button
          onClick={() => {
            setFiltered(new Set(selection));
            setPage(0);
          }}
        >
          {t("Show selected", "显示已选")}
        </button>
        <button
          onClick={() => {
            setFiltered(null);
            setSelection([]);
            onSelection?.(layer, []);
          }}
        >
          {t("Clear", "清除")}
        </button>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹
        </button>
        <span>
          {page + 1} / {Math.max(1, Math.ceil(display.length / 100))}
        </span>
        <button
          disabled={(page + 1) * 100 >= display.length}
          onClick={() => setPage(page + 1)}
        >
          ›
        </button>
      </div>
      <div className="v2-table-scroll">
        <table>
          <thead>
            <tr>
              <th>✓</th>
              {fields.map((f) => (
                <th key={f}>{f}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {display.slice(page * 100, (page + 1) * 100).map((r) => {
              const id = ["grid", "lstgrid"].includes(layer)
                ? r.cell_id
                : r.__index;
              return (
                <tr
                  key={id}
                  className={selection.includes(id) ? "selected" : ""}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selection.includes(id)}
                      onChange={() => {
                        const ids = selection.includes(id)
                          ? selection.filter((i) => i !== id)
                          : [...selection, id];
                        setSelection(ids);
                        onSelection?.(layer, ids);
                      }}
                    />
                  </td>
                  {fields.map((f) => (
                    <td key={f}>
                      {typeof r[f] === "number" && !Number.isInteger(r[f])
                        ? r[f].toFixed(3)
                        : String(r[f] ?? "—")}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
