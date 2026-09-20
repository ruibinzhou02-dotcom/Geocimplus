import React, { useState, useMemo } from "react";
import { WEATHER } from "./epw.mjs";
export default function Climate({ weather, t }) {
  const [month, setMonth] = useState(8),
    [day, setDay] = useState(1),
    [hour, setHour] = useState(14),
    [field, setField] = useState("temperature");
  const records = weather?.data?.records || [],
    daily = records.filter((r) => r.month === month && r.day === day),
    r = daily.find((r) => r.hour === hour),
    values = daily.map((r) => r[field]).filter((v) => v !== null),
    min = Math.min(...values),
    max = Math.max(...values),
    days = [
      ...new Set(records.filter((r) => r.month === month).map((r) => r.day)),
    ];
  if (!weather)
    return (
      <div className="v2-empty-panel">
        {t(
          "Import a local EPW weather file to explore hourly conditions.",
          "导入本地 EPW 气象文件，查看逐时气象。",
        )}
      </div>
    );
  return (
    <section className="v2-climate">
      <span className="eyebrow">CLIMATE / WEATHER READER</span>
      <h2>{weather.data.station}</h2>
      <p>
        {weather.data.latitude}° N · {weather.data.longitude}° E · UTC
        {weather.data.timezone >= 0 ? "+" : ""}
        {weather.data.timezone}
        <br />
        {records.length.toLocaleString()} {t("hourly records", "条逐时记录")} ·{" "}
        {weather.data.typicalYear
          ? t("Typical year", "典型年")
          : t("Weather series", "气象序列")}
      </p>
      <div className="v2-fields">
        <label>
          {t("Month", "月")}
          <select
            value={month}
            onChange={(e) => {
              setMonth(+e.target.value);
              setDay(1);
            }}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Day", "日")}
          <select value={day} onChange={(e) => setDay(+e.target.value)}>
            {days.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t("EPW hour · station local time", "EPW 小时 · 站点当地时间")}
        <input
          type="range"
          min="1"
          max="24"
          value={hour}
          onChange={(e) => setHour(+e.target.value)}
        />
        <b>
          H{String(hour).padStart(2, "0")} · m{r?.minute ?? "—"}
        </b>
      </label>
      <div className="v2-weather-cards">
        {[
          ["temperature", "Air temperature", "气温"],
          ["humidity", "Humidity", "湿度"],
          ["windSpeed", "Wind speed", "风速"],
          ["windDirection", "Wind direction", "风向"],
        ].map(([k, en, zh]) => (
          <div key={k}>
            <small>{t(en, zh)}</small>
            <strong>
              {r?.[k] ?? "—"} <em>{WEATHER[k].unit}</em>
            </strong>
          </div>
        ))}
      </div>
      <label>
        {t("Daily chart", "逐日曲线")}
        <select value={field} onChange={(e) => setField(e.target.value)}>
          {Object.keys(WEATHER).map((k) => (
            <option key={k} value={k}>
              {
                {
                  temperature: t("Air temperature", "气温"),
                  humidity: t("Relative humidity", "相对湿度"),
                  windSpeed: t("Wind speed", "风速"),
                  windDirection: t("Wind direction", "风向"),
                  globalRadiation: t(
                    "Global horizontal radiation",
                    "总水平辐射",
                  ),
                  directRadiation: t("Direct normal radiation", "法向直射辐射"),
                  diffuseRadiation: t(
                    "Diffuse horizontal radiation",
                    "散射水平辐射",
                  ),
                }[k]
              }{" "}
              · {WEATHER[k].unit}
            </option>
          ))}
        </select>
      </label>
      <svg
        className="v2-chart"
        viewBox="0 0 300 150"
        role="img"
        aria-label="24-hour weather chart"
      >
        <line x1="15" x2="285" y1="125" y2="125" stroke="#d5cddd" />
        {daily.map((row, i) => {
          const prev = daily[i - 1];
          return i && row[field] != null && prev[field] != null ? (
            <line
              key={i}
              x1={15 + ((i - 1) * 270) / 23}
              x2={15 + (i * 270) / 23}
              y1={120 - ((prev[field] - min) / (max - min || 1)) * 95}
              y2={120 - ((row[field] - min) / (max - min || 1)) * 95}
              stroke="#8060a9"
              strokeWidth="2.5"
            />
          ) : null;
        })}
        <text x="15" y="145">
          01
        </text>
        <text x="266" y="145">
          24h
        </text>
        <text x="15" y="14">
          {Number.isFinite(min)
            ? `${min.toFixed(1)} – ${max.toFixed(1)} ${WEATHER[field].unit}`
            : "No data"}
        </text>
      </svg>
      <p>
        {t(
          "Radiation values are hourly energy (Wh/m²). EPW is station weather; it is not surface temperature or a calculated outdoor comfort index.",
          "辐射为逐时能量（Wh/m²）。EPW 代表气象站天气，不等同于地表温度或已计算的室外热舒适指数。",
        )}
      </p>
    </section>
  );
}
