import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
const TYPES = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint8ClampedArray,
  Uint32Array,
  Int32Array,
};
export function packProject(project) {
  let i = 0;
  const entries = {};
  const manifest = JSON.stringify(
    { format: "GeoCIM", version: 2, ...project },
    (_, v) => {
      if (ArrayBuffer.isView(v)) {
        const path = `arrays/${i++}.bin`;
        entries[path] = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
        return { arrayFile: path, type: v.constructor.name, length: v.length };
      }
      return v;
    },
  );
  entries["project.json"] = strToU8(manifest);
  return zipSync(entries, { level: 3 });
}
export function unpackProject(bytes) {
  if (bytes.byteLength > 128 * 1024 * 1024)
    throw new Error("Project package exceeds 128 MiB.");
  let total = 0,
    count = 0;
  const seen = new Set(),
    entries = unzipSync(bytes, {
      filter: (f) => {
        if (
          ++count > 4096 ||
          (total += f.originalSize) > 256 * 1024 * 1024 ||
          !Number.isFinite(f.originalSize)
        )
          throw new Error("Project expands beyond the local memory limit.");
        if (
          !/^(project\.json|arrays\/\d+\.bin)$/.test(f.name) ||
          seen.has(f.name)
        )
          throw new Error("Unexpected or duplicate project file.");
        seen.add(f.name);
        return true;
      },
    });
  if (!entries["project.json"]) throw new Error("Missing project.json.");
  const p = JSON.parse(strFromU8(entries["project.json"]), (_, v) => {
    if (v && v.arrayFile) {
      const cls = TYPES[v.type],
        raw = entries[v.arrayFile];
      if (!cls || !raw || v.length * cls.BYTES_PER_ELEMENT !== raw.length)
        throw new Error("Invalid project array.");
      return new cls(raw.slice().buffer);
    }
    return v;
  });
  if (
    p.format !== "GeoCIM" ||
    p.version !== 2 ||
    !Array.isArray(p.layers) ||
    p.layers.length > 24
  )
    throw new Error("Invalid GeoCIM V2 project.");
  for (const l of p.layers) {
    if (
      !["raster", "vector", "epw"].includes(l.kind) ||
      typeof l.id !== "string"
    )
      throw new Error("Invalid layer identity.");
    if (
      l.kind === "raster" &&
      (!(l.values instanceof Float32Array) ||
        l.width * l.height !== l.values.length ||
        l.values.length > 4000000 ||
        !Array.isArray(l.extent) ||
        l.extent.length !== 4)
    )
      throw new Error("Invalid raster in project.");
    if (
      l.kind === "vector" &&
      (!Array.isArray(l.data?.features) || l.data.features.length > 100000)
    )
      throw new Error("Invalid vector in project.");
  }
  for (const g of [
    p.scene?.grid,
    p.scene?.lst,
    ...p.layers.map((l) => l.gridData),
  ].filter(Boolean)) {
    const n = g.cols * g.rows;
    if (
      !Number.isInteger(g.cols) ||
      !Number.isInteger(g.rows) ||
      g.cols < 1 ||
      g.rows < 1 ||
      n > 160000 ||
      g.size < 5 ||
      g.size > 5000 ||
      !g.origin?.every(Number.isFinite) ||
      g.origin.length !== 2 ||
      !g.bounds?.every(Number.isFinite) ||
      g.bounds.length !== 4
    )
      throw new Error("Invalid saved analysis grid.");
    for (const k of ["mean", "min", "max", "count", "coverage", "nodataRatio"])
      if (!ArrayBuffer.isView(g[k]) || g[k].length !== n)
        throw new Error("Saved grid array size mismatch.");
  }
  return p;
}
export function download(data, name, type = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function jsonDownload(data, name) {
  download(JSON.stringify(data, null, 2), name, "application/json");
}
async function database() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("geocim-v2-local", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("projects", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export async function localProjects(action, value) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(
        "projects",
        action === "save" ? "readwrite" : "readonly",
      ),
      store = tx.objectStore("projects"),
      r =
        action === "save"
          ? store.put(value)
          : action === "get"
            ? store.get(value)
            : store.getAll();
    let result;
    r.onsuccess = () => {
      result = r.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
