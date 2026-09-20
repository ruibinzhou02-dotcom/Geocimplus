import { colorAt } from "./terrain-mesh.mjs";
export const CATEGORIES = [
  ["buildings", "Buildings", "建筑", "▥"],
  ["boundary", "Boundary", "边界", "⬡"],
  ["basemap", "Base maps", "底图", "▧"],
  ["terrain", "Terrain", "地形", "▱"],
  ["transport", "Transport", "交通", "╱"],
  ["analysis", "Analysis", "分析", "▦"],
  ["other", "Other data", "其他数据", "◇"],
];
export function categoryOf(l) {
  if (CATEGORIES.some(([id]) => id === l.category)) return l.category;
  if (l.heightField) return "buildings";
  if (l.role === "imagery") return "basemap";
  if (l.role === "dem") return "terrain";
  if (l.id === "boundary" || l.role === "boundary") return "boundary";
  if (l.role === "lst" || l.analysis || l.gridData) return "analysis";
  return "other";
}
export const normalizeLayer = (l) => ({ ...l, category: categoryOf(l) });
export const layerIcon = (l) =>
  l.gridData
    ? "▦"
    : l.kind === "raster"
      ? "▧"
      : /Point/.test(l.data?.features?.[0]?.geometry?.type)
        ? "•"
        : /Line/.test(l.data?.features?.[0]?.geometry?.type)
          ? "╱"
          : "⬡";
export const numeric = (v) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  typeof v === "boolean"
    ? NaN
    : Number(v);
export function fieldNames(l) {
  if (l.kind === "raster") return ["value"];
  return [
    ...new Set(
      l.data?.features?.flatMap((f) => Object.keys(f.properties || {})) || [],
    ),
  ];
}
const rgb = (hex) =>
  /^#[\da-f]{6}$/i.test(hex || "")
    ? [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    : [0.55, 0.42, 0.68];
export function classifyLayer(l) {
  const s = l.symbology || {},
    mode = s.mode || "single",
    field = s.field || "value";
  const values =
    l.kind === "raster"
      ? l.values
      : (l.data?.features || []).map((f) => f.properties?.[field]);
  const ramp = s.ramp || "purple",
    fallback = rgb(s.color || (l.heightField ? "#d6cedf" : "#9474b1"));
  const missing = rgb(s.noDataColor || "#b9b9c1");
  if (mode === "single")
    return {
      color: () => fallback,
      legend: [{ label: "Single colour", color: fallback }],
    };
  if (mode === "categorical") {
    const categories = [
      ...new Set(
        Array.from(values, (v) =>
          v == null || v === "" ? null : String(v),
        ).filter((v) => v !== null),
      ),
    ].sort();
    const shown = categories.slice(0, 20),
      lookup = new Map(
        shown.map((v, i) => [
          v,
          colorAt(i, 0, Math.max(1, shown.length - 1), ramp),
        ]),
      );
    return {
      color: (v) => lookup.get(String(v)) || missing,
      legend: [
        ...shown.map((label) => ({ label, color: lookup.get(label) })),
        { label: "Other / NoData", color: missing },
      ],
    };
  }
  const sorted = Array.from(values, numeric)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  if (!sorted.length)
    return {
      color: () => missing,
      legend: [{ label: "No numeric data", color: missing }],
    };
  const lo = sorted[0],
    hi = sorted.at(-1),
    n = Math.max(2, Math.min(9, Math.round(Number(s.classes) || 5)));
  const bounds = Array.from({ length: n }, (_, i) =>
    mode === "quantile"
      ? sorted[Math.max(0, Math.ceil(((i + 1) * sorted.length) / n) - 1)]
      : lo + ((hi - lo) * (i + 1)) / n,
  );
  const unique = [...new Set(bounds)],
    colors = unique.map((_, i) =>
      colorAt(i, 0, Math.max(1, unique.length - 1), ramp),
    );
  return {
    color: (v) => {
      const x = numeric(v);
      if (!Number.isFinite(x)) return missing;
      let i = unique.findIndex((b) => x <= b);
      return colors[i < 0 ? colors.length - 1 : i];
    },
    legend: [
      ...unique.map((b, i) => ({
        label: `${i ? "(" : "["}${Number(i ? unique[i - 1] : lo).toFixed(2)}, ${Number(b).toFixed(2)}]`,
        color: colors[i],
      })),
      { label: "NoData", color: missing },
    ],
  };
}
export const colorCSS = (c) =>
  `rgb(${c.map((v) => Math.round(v * 255)).join(",")})`;
