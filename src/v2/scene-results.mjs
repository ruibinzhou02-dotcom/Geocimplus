import { gridGeoJSON } from "./raster-grid.mjs";
import { canEdit } from "./layer-policy.mjs";
// Hidden snapshots preserve editable numerical outputs separately from the live scene.
export function sceneResultLayers(scene, layers) {
  const out = [...layers];
  for (const [key, grid] of [
    ["terrain", scene.grid],
    ["lst", scene.lst],
  ]) {
    if (!grid || (key === "terrain" && grid.source === "flat-reference"))
      continue;
    const existing = out.find(
      (l) => l.sceneSnapshot === key && canEdit(l) && !l.modified,
    );
    const result = {
      id: existing?.id || crypto.randomUUID(),
      name: key === "terrain" ? "Terrain · result grid" : "LST · result grid",
      nameZh: key === "terrain" ? "地形 · 结果网格" : "地表温度 · 结果网格",
      kind: "vector",
      bucket: "results",
      category: "analysis",
      sceneSnapshot: key,
      visible: existing?.visible ?? false,
      heightField: "",
      data: gridGeoJSON(grid),
      gridData: grid,
      crs: "EPSG:4326",
      unit: grid.unit,
      symbology: existing?.symbology || {
        mode: "equal",
        field: "mean_value",
        ramp: key === "lst" ? "thermal" : "terrain",
        classes: 5,
        outline: false,
      },
      analysis: { source: grid.source, method: grid.method, crs: grid.crs },
    };
    if (existing) out[out.indexOf(existing)] = result;
    else out.push(result);
  }
  return out;
}
