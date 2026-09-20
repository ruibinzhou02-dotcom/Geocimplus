import React from "react";
import { DATA_TYPES, suggestedCategory } from "./import-catalog.mjs";
import { CATEGORIES } from "./layers.mjs";
export default function DatasetBrowser({
  entries,
  selected,
  setSelected,
  categories,
  setCategories,
  busy,
  onFiles,
  onFolder,
  onImport,
  onClose,
  t,
}) {
  return (
    <div className="v2-dataset-overlay">
      <section
        className="v2-dataset-browser"
        role="dialog"
        aria-label="Data catalog"
      >
        <header>
          <div>
            <span className="eyebrow">{t("LOCAL DATA", "本地数据")}</span>
            <h2>{t("Add data", "添加数据")}</h2>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Close data catalog"
          >
            ×
          </button>
        </header>
        <div className="v2-catalog-actions">
          <button onClick={onFolder} disabled={busy}>
            {t("Browse folder", "浏览数据文件夹")}
          </button>
          <button onClick={onFiles} disabled={busy}>
            {t("Add files / companions", "添加文件 / 配套文件")}
          </button>
        </div>
        <div className="v2-catalog-list">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>{t("Dataset", "数据集")}</th>
                <th>{t("Type", "类型")}</th>
                <th>{t("Spatial reference", "空间参考")}</th>
                <th>{t("Category", "类别")}</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>
                    <input
                      aria-label={"Import " + e.name}
                      type="checkbox"
                      checked={selected.includes(e.id)}
                      disabled={!e.ready || busy}
                      onChange={(v) =>
                        setSelected((s) =>
                          v.target.checked
                            ? [...s, e.id]
                            : s.filter((id) => id !== e.id),
                        )
                      }
                    />
                  </td>
                  <td>
                    <b>
                      {DATA_TYPES[e.type]?.[2]} {e.name}
                    </b>
                    <small>
                      {e.format}
                      {e.count != null ? ` · ${e.count}` : ""}
                    </small>
                    {e.folder && <small title={e.folder}>{e.folder}</small>}
                    {e.issue && (
                      <small className="v2-catalog-issue">{e.issue}</small>
                    )}
                    {e.parts && (
                      <small>
                        {Object.keys(e.parts)
                          .map((k) => "." + k)
                          .join(" · ")}
                      </small>
                    )}
                  </td>
                  <td>{t(...DATA_TYPES[e.type || "unknown"].slice(0, 2))}</td>
                  <td>{e.crs || "—"}</td>
                  <td>
                    {e.ready && e.type !== "weather" && (
                      <select
                        aria-label={"Category " + e.name}
                        value={categories[e.id] || suggestedCategory(e)}
                        onChange={(v) =>
                          setCategories((c) => ({
                            ...c,
                            [e.id]: v.target.value,
                          }))
                        }
                      >
                        {CATEGORIES.map(([id, en, zh]) => (
                          <option key={id} value={id}>
                            {t(en, zh)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!entries.length && (
            <p>
              {t("Choose a dataset folder or files.", "选择数据文件夹或文件。")}
            </p>
          )}
        </div>
        <footer>
          <span>
            {selected.length} {t("selected", "已选")}
          </span>
          <button
            className="primary"
            disabled={busy || !selected.length}
            onClick={onImport}
          >
            {busy
              ? t("Reading…", "正在读取…")
              : t("Add selected data", "添加选中数据")}
          </button>
        </footer>
      </section>
    </div>
  );
}
