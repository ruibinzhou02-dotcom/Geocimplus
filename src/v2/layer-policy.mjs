export const ROOT_LAYERS = [
  ["analysis", "Analysis layers", "分析图层", "◇"],
  ["display", "Display layers", "展示图层", "▧"],
  ["results", "Result layers", "结果图层", "▦"],
];
export function bucketOf(l) {
  if (ROOT_LAYERS.some(([id]) => id === l.bucket)) return l.bucket;
  if (l.analysis || l.gridData || l.id?.startsWith("circuit-"))
    return "results";
  return "analysis";
}
export const canEdit = (l) => !!l && bucketOf(l) !== "display";
export const canAnalyze = (l) => !!l && bucketOf(l) !== "display";
export function assertEditable(l) {
  if (!canEdit(l))
    throw new Error("Display data is read-only. Copy it to Analysis first.");
}
export function copyToAnalysis(l, id = crypto.randomUUID()) {
  const copy = structuredClone(l);
  return {
    ...copy,
    id,
    name: `${l.name} · working copy`,
    bucket: "analysis",
    visible: false,
    sourceDisplayId: l.id,
    cloudSource: l.cloudSource || null,
    provenance: {
      ...l.provenance,
      copiedFrom: l.id,
      copiedAt: new Date().toISOString(),
    },
  };
}
export function updateLayer(l, patch) {
  const allowed = canEdit(l)
    ? [
        "name",
        "category",
        "bucket",
        "role",
        "unit",
        "heightField",
        "visible",
        "symbology",
      ]
    : ["visible", "symbology"];
  for (const key of Object.keys(patch))
    if (!allowed.includes(key))
      throw new Error("This layer setting is read-only.");
  if (patch.bucket && !ROOT_LAYERS.some(([id]) => id === patch.bucket))
    throw new Error("Invalid parent layer.");
  const dataChanged = ["role", "unit", "heightField"].some(
    (k) => Object.hasOwn(patch, k) && patch[k] !== l[k],
  );
  return {
    ...l,
    ...patch,
    ...(dataChanged ? { cloudSource: null, modified: true } : {}),
  };
}
export function editAttribute(l, indices, field, raw, type = "text") {
  assertEditable(l);
  if (l.kind !== "vector") throw new Error("Choose a vector layer.");
  if (
    !field ||
    field.length > 128 ||
    ["__proto__", "constructor", "prototype", "__index"].includes(field)
  )
    throw new Error("Invalid attribute field.");
  if (!indices.length) throw new Error("Select features first.");
  const selected = new Set(indices);
  if (
    [...selected].some(
      (i) => !Number.isInteger(i) || i < 0 || i >= l.data.features.length,
    )
  )
    throw new Error("Invalid feature selection.");
  let value =
    type === "null" ? null : type === "number" ? Number(raw) : String(raw);
  if (
    type === "number" &&
    (String(raw).trim() === "" ||
      !Number.isFinite(value) ||
      (Number.isInteger(value) && !Number.isSafeInteger(value)))
  )
    throw new Error("Enter a finite numeric value; store long IDs as text.");
  if (typeof value === "string" && value.length > 10000)
    throw new Error("Text exceeds 10,000 characters.");
  const data = {
    ...l.data,
    features: l.data.features.map((f, i) =>
      selected.has(i)
        ? { ...f, properties: { ...f.properties, [field]: value } }
        : f,
    ),
  };
  const fieldCount = new Set(
    data.features.flatMap((f) => Object.keys(f.properties || {})),
  ).size;
  if (fieldCount > 128) throw new Error("Maximum 128 attribute fields.");
  return {
    ...l,
    data,
    gridData: undefined,
    cloudSource: null,
    modified: true,
    visible: true,
  };
}
export function demoWorkingLayers(layers) {
  const display = layers.map((l) => ({
    ...l,
    bucket: "display",
    cloudSource: l.id,
  }));
  const working = display.map((l) => copyToAnalysis(l, `work-${l.id}`));
  return [...display, ...working];
}
export function remapDemoGraph(graph, layers) {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      const source = layers.find(
        (l) =>
          l.bucket === "analysis" && l.cloudSource === n.data?.params?.layer,
      );
      return source
        ? {
            ...n,
            data: { ...n.data, params: { ...n.data.params, layer: source.id } },
          }
        : n;
    }),
  };
}
