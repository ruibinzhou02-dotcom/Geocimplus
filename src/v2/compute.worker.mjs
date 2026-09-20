import { readRaster, makeGrid, aggregate } from "./raster-grid.mjs";
import { parseEPW } from "./epw.mjs";
import { flattenGround, clipGrid } from "./ground.mjs";
import { drapeTexture } from "./texture.mjs";
import { formulaGrid } from "./formula.mjs";
self.onmessage = async ({ data: { id, type, payload } }) => {
  try {
    let result;
    if (type === "readRaster")
      result = await readRaster(payload.buffer, payload.meta);
    else if (type === "grid") {
      const g =
        payload.grid || makeGrid(payload.raster, payload.size, payload.crs);
      result = aggregate(payload.raster, g, (percent) =>
        self.postMessage({ id, progress: percent }),
      );
    } else if (type === "clip")
      result = clipGrid(payload.grid, payload.features);
    else if (type === "ground")
      result = flattenGround(payload.grid, payload.features);
    else if (type === "texture")
      result = drapeTexture(payload.raster, payload.grid);
    else if (type === "epw") result = parseEPW(payload.text);
    else if (type === "rhino") {
      const { exportRhino } = await import("./rhino-export.mjs");
      const r = await exportRhino(payload.model, payload.layers, payload.style);
      result = { zip: r.zip, meta: r.meta };
    } else if (type === "formula")
      result = formulaGrid(payload.grid, payload.expression, payload.unit);
    else throw new Error("Unknown local operation");
    self.postMessage({ id, result });
  } catch (e) {
    self.postMessage({ id, error: e.message });
  }
};
