import { thematicModel, vectorLines } from "./model.mjs";
import { zipSync, strToU8 } from "fflate";
export async function encodeRhino(rhino, model, layers, style) {
  if (model.grid.unit !== "m")
    throw new Error(
      "Confirm elevation units as m and rebuild before exporting a metre-based Rhino model.",
    );
  const file = new rhino.File3dm();
  file.applicationName = "GeoCIM+ V2";
  file.settings().modelUnitSystem = rhino.UnitSystem.Meters;
  const meta = {
    crs: model.grid.crs,
    origin: model.grid.origin,
    unit: "m",
    zDatum: "unknown",
    verticalScaleExport: 1,
    displayVerticalScale: style.zScale,
    cellSize: model.grid.size,
    groundMethod: model.grid.groundMethod || "unaltered raster mean",
    lstUnit: model.lst?.unit || null,
    method: model.grid.method,
    skippedBuildingParts: model.buildings.skipped,
    sourceLayers: layers.map((l) => ({
      id: l.id,
      name: l.name,
      unit: l.unit,
      acquisition: l.acquisition,
      crs: l.crs,
    })),
    flatImageryReferenceZ: model.flatTexture?.referenceZ ?? null,
    created: new Date().toISOString(),
  };
  file.strings().set("GeoCIM:georeference", JSON.stringify(meta));
  const layerIndex = {};
  for (const [name, color] of [
    ["00_Metadata", "#888888"],
    ["01_Boundary", "#7956a8"],
    ["02_BaseMap", "#aaaaaa"],
    ["03_TerrainMesh", "#9daf93"],
    ["04_GridWireframe", style.wireColor],
    ["05_Buildings", style.buildingColor],
    ["06_LST", "#db8565"],
    ["07_Analysis", "#9875bd"],
    ...(model.flatTexture ? [["08_FlatBaseMap", "#aaaaaa"]] : []),
    ...(layers.some((l) => l.id === "roads")
      ? [["09_RoadNetwork", "#d1a878"]]
      : []),
  ]) {
    const l = new rhino.Layer();
    l.name = name;
    l.color = {
      r: parseInt(color.slice(1, 3), 16),
      g: parseInt(color.slice(3, 5), 16),
      b: parseInt(color.slice(5, 7), 16),
      a: 255,
    };
    l.visible = name !== "04_GridWireframe" || style.wire;
    layerIndex[name] = file.layers().add(l);
    l.delete();
  }
  const attrs = (layer, name) => {
    const a = new rhino.ObjectAttributes();
    a.layerIndex = layerIndex[layer];
    a.name = name;
    return a;
  };
  let imageryMaterial = -1;
  if (model.texture) {
    const m = new rhino.Material();
    m.name = "GeoCIM georeferenced imagery";
    m.diffuseColor = { r: 255, g: 255, b: 255, a: 255 };
    m.setBitmapTextureFilename("texture.png");
    imageryMaterial = file.materials().count;
    file.materials().add(m);
    m.delete();
  }
  let flatMaterial = -1;
  if (model.flatTexture) {
    const m = new rhino.Material();
    m.name = "GeoCIM flat satellite";
    m.diffuseColor = { r: 255, g: 255, b: 255, a: 255 };
    m.setBitmapTextureFilename("satellite-flat.png");
    flatMaterial = file.materials().count;
    file.materials().add(m);
    m.delete();
  }
  const mesh = (m, layer, name, extra = {}) => {
    if (!m.indices.length) return;
    const rm = new rhino.Mesh(),
      a = attrs(layer, name);
    if (layer === "02_BaseMap" && imageryMaterial >= 0) {
      a.materialIndex = imageryMaterial;
      a.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
    }
    if (layer === "08_FlatBaseMap" && flatMaterial >= 0) {
      a.materialIndex = flatMaterial;
      a.materialSource = rhino.ObjectMaterialSource.MaterialFromObject;
    }
    for (let i = 0; i < m.positions.length; i += 3)
      rm.vertices().add(m.positions[i], m.positions[i + 1], m.positions[i + 2]);
    for (let i = 0; i < m.indices.length; i += 3)
      rm.faces().addTriFace(m.indices[i], m.indices[i + 1], m.indices[i + 2]);
    if (m.uv)
      for (let i = 0; i < m.uv.length; i += 2)
        rm.textureCoordinates().add(m.uv[i], m.uv[i + 1]);
    if (m.colors)
      for (let i = 0; i < m.colors.length; i += 3)
        rm.vertexColors().add(
          Math.round(m.colors[i] * 255),
          Math.round(m.colors[i + 1] * 255),
          Math.round(m.colors[i + 2] * 255),
        );
    rm.normals().computeNormals();
    for (const [k, v] of Object.entries(extra)) a.setUserString(k, String(v));
    file.objects().addMesh(rm, a);
    rm.delete();
    a.delete();
  };
  mesh(model.terrain, "03_TerrainMesh", "Continuous terrain");
  if (model.lst)
    mesh(
      thematicModel(
        model.lst,
        model.grid,
        model.terrain,
        style.ramp,
        style.min,
        style.max,
      ),
      "06_LST",
      "LST cell means",
      { unit: model.lst.unit },
    );
  for (const m of model.buildings.models)
    mesh(m, "05_Buildings", m.name, {
      ground_z: m.base,
      height_m: m.height,
      source_layer: m.layerId,
    });
  for (const line of vectorLines(layers, model.grid, model.terrain)) {
    if (line.points.length < 2) continue;
    const a = attrs(
      line.layerId === "boundary"
        ? "01_Boundary"
        : line.layerId === "roads"
          ? "09_RoadNetwork"
          : "07_Analysis",
      line.name,
    );
    file.objects().addPolyline(line.points, a);
    a.delete();
  }
  // One grid ribbon mesh avoids tens of thousands of separate CAD objects.
  const p = [],
    ind = [],
    t = model.terrain;
  for (let j = 0; j < t.lines.length; j += 2) {
    const a = t.lines[j] * 3,
      b = t.lines[j + 1] * 3,
      dx = t.positions[b] - t.positions[a],
      dy = t.positions[b + 1] - t.positions[a + 1],
      len = Math.hypot(dx, dy),
      nx = (-dy / len) * 0.1,
      ny = (dx / len) * 0.1,
      k = p.length / 3;
    for (const [i, sign] of [
      [a, 1],
      [b, 1],
      [b, -1],
      [a, -1],
    ])
      p.push(
        t.positions[i] + sign * nx,
        t.positions[i + 1] + sign * ny,
        t.positions[i + 2] + 0.03,
      );
    ind.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  mesh(
    { positions: p, indices: ind },
    "04_GridWireframe",
    "Grid edges · 0.2 m ribbons",
  );
  if (model.texture) {
    const { width, height, pixels } = model.texture,
      colors = new Float32Array(t.positions.length);
    for (let i = 0; i < t.uv.length / 2; i++) {
      const x = Math.min(width - 1, Math.floor(t.uv[i * 2] * width)),
        y = Math.min(height - 1, Math.floor((1 - t.uv[i * 2 + 1]) * height)),
        q = (y * width + x) * 4;
      colors.set(
        [pixels[q] / 255, pixels[q + 1] / 255, pixels[q + 2] / 255],
        i * 3,
      );
    }
    mesh(
      { ...t, colors },
      "02_BaseMap",
      "Georeferenced imagery · vertex-colour fallback",
      {
        texture_file: "texture.png",
        mapping: "shared UV; texture supplied in ZIP",
      },
    );
  }
  if (model.flatTexture) {
    const {
        mesh: m,
        texture: { width, height, pixels },
      } = model.flatTexture,
      colors = new Float32Array(m.positions.length);
    for (let i = 0; i < m.uv.length / 2; i++) {
      const x = Math.min(width - 1, Math.floor(m.uv[i * 2] * width)),
        y = Math.min(height - 1, Math.floor((1 - m.uv[i * 2 + 1]) * height)),
        k = (y * width + x) * 4;
      colors.set(
        [pixels[k] / 255, pixels[k + 1] / 255, pixels[k + 2] / 255],
        i * 3,
      );
    }
    mesh({ ...m, colors }, "08_FlatBaseMap", "Flat satellite reference", {
      texture_file: "satellite-flat.png",
      reference_plane: true,
      z: model.flatTexture.referenceZ,
    });
  }
  const bytes = file.toByteArray(),
    check = rhino.File3dm.fromByteArray(bytes);
  if (!check || check.layers().count < 8 || check.objects().count === 0)
    throw new Error("Rhino read-back verification failed.");
  meta.verified = {
    layers: check.layers().count,
    objects: check.objects().count,
  };
  check.delete();
  file.delete();
  return { bytes, meta };
}
export async function exportRhino(model, layers, style) {
  const [{ default: init }, { default: wasm }] = await Promise.all([
    import("rhino3dm/rhino3dm.module.js"),
    import("rhino3dm/rhino3dm.wasm?url"),
  ]);
  const rhino = await init({ locateFile: () => wasm }),
    result = await encodeRhino(rhino, model, layers, style),
    entries = {
      "GeoCIM.3dm": result.bytes,
      "georeference.json": strToU8(JSON.stringify(result.meta, null, 2)),
    };
  for (const [name, texture] of [
    ["texture.png", model.texture],
    ["satellite-flat.png", model.flatTexture?.texture],
  ]) {
    if (!texture) continue;
    const { width, height, pixels } = texture,
      c = new OffscreenCanvas(width, height);
    c.getContext("2d").putImageData(
      new ImageData(new Uint8ClampedArray(pixels), width, height),
      0,
      0,
    );
    entries[name] = new Uint8Array(
      await (await c.convertToBlob()).arrayBuffer(),
    );
  }
  return { ...result, zip: zipSync(entries, { level: 3 }) };
}
