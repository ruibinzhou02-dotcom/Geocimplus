import React from "react";
import { directorySupport } from "./local-files.mjs";
export default function ProjectIO({
  mode,
  setMode,
  isDemo,
  ready,
  io,
  onChoose,
  onRead,
  t,
}) {
  return (
    <div className="v2-project-io">
      <h3>{t("Project workspace", "项目工作区")}</h3>
      <label>
        {t("Compute location", "分析位置")}
        <select
          aria-label="Compute location"
          value={mode}
          onChange={(e) => setMode(e.target.value)}
        >
          <option value="local">{t("Local analysis", "本地分析")}</option>
          <option value="cloud" disabled={!isDemo || !ready}>
            {t("Cloud analysis · example only", "云分析 · 仅固定示例")}
          </option>
        </select>
      </label>
      <p>
        {mode === "cloud"
          ? t(
              "Fixed Shatou inputs run on the server. Results return here without cloud storage.",
              "固定沙头数据在服务器计算，结果返回本机，不在云端存储。",
            )
          : t(
              "New and edited data stays on this computer.",
              "新建与编辑的数据均留在本机。",
            )}
      </p>
      <dl>
        <dt>{t("Input", "输入")}</dt>
        <dd>{io.input || t("Selected local files", "已选择的本地文件")}</dd>
        <dt>{t("Output", "输出")}</dt>
        <dd>{io.output || t("Browser download folder", "浏览器下载目录")}</dd>
      </dl>
      <div className="v2-io-buttons">
        <button
          disabled={!directorySupport()}
          onClick={() => onChoose("input")}
        >
          {t("Choose input folder", "选择输入文件夹")}
        </button>
        <button
          disabled={!directorySupport()}
          onClick={() => onChoose("output")}
        >
          {t("Choose output folder", "选择输出文件夹")}
        </button>
      </div>
      {io.input && (
        <button className="v2-wide" onClick={onRead}>
          {t("Import files from input folder", "导入输入文件夹中的数据")}
        </button>
      )}
      <small>
        {directorySupport()
          ? t(
              "Source files are read-only. Exports create new timestamped files. Folder permissions must be chosen again after reopening.",
              "源文件只读，导出创建带时间戳的新文件。重新打开项目后需重新选择文件夹。",
            )
          : t(
              "This browser uses file selection and downloads. Chrome / Edge can grant direct folder access.",
              "当前浏览器使用选文件和下载；Chrome / Edge 可直接授权文件夹。",
            )}
      </small>
    </div>
  );
}
