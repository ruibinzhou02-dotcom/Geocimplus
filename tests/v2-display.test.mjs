import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { terrainSolid } from "../src/v2/terrain-solid.mjs";
import { terrainMesh, RAMPS, colorAt } from "../src/v2/terrain-mesh.mjs";
import { displayTexture, drapeTexture } from "../src/v2/texture.mjs";
import { readRaster } from "../src/v2/raster-grid.mjs";
import { encodeRhino } from "../src/v2/rhino-export.mjs";
const grid = () => ({
  cols: 3,
  rows: 3,
  size: 10,
  crs: "EPSG:32650",
  origin: [500000, 2500000],
  bounds: [500000, 2500000, 500030, 2500030],
  unit: "m",
  mean: Float32Array.from([10, 12, 14, 16, NaN, 20, 22, 24, 26]),
});
function closed(mesh) {
  const edges = new Map();
  let volume = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = [...mesh.indices.slice(i, i + 3)];
    for (let k = 0; k < 3; k++) {
      const a = ids[k],
        b = ids[(k + 1) % 3],
        key = [Math.min(a, b), Math.max(a, b)].join(":");
      const v = edges.get(key) || [0, 0];
      v[0]++;
      v[1] += a < b ? 1 : -1;
      edges.set(key, v);
    }
    const [a, b, c] = ids.map((k) => mesh.positions.slice(k * 3, k * 3 + 3));
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
  }
  assert.ok(
    [...edges.values()].every(
      ([count, balance]) => count === 2 && balance === 0,
    ),
  );
  assert.ok(volume > 0);
}
test("Terrain solid has oriented closed edges, retains source top faces and leaves NoData top holes", () => {
  const g = grid(),
    before = [...g.mean],
    surface = terrainMesh(g),
    solid = terrainSolid(surface, -30);
  closed(solid);
  assert.equal(solid.baseZ, -30);
  assert.equal(solid.boundaryEdges, 16);
  assert.deepEqual([...g.mean], before);
  for (let k = 0; k < surface.indices.length; k++)
    assert.deepEqual(
      [
        ...solid.positions.slice(
          solid.indices[k] * 3,
          solid.indices[k] * 3 + 3,
        ),
      ],
      [
        ...surface.positions.slice(
          surface.indices[k] * 3,
          surface.indices[k] * 3 + 3,
        ),
      ],
    );
  assert.equal(surface.indices.length, 8 * 6);
  assert.ok(
    terrainSolid(surface, 100).baseZ < 10,
    "Reference plane cannot cross the surface",
  );
  const empty = terrainSolid(
    terrainMesh({ ...g, mean: new Float32Array(9).fill(NaN) }),
  );
  assert.equal(empty.indices.length, 0);
});
test("Scientific ramps retain 256 colour samples and valid endpoints; gray display preserves alpha/source", () => {
  for (const name of ["viridis", "magma", "plasma", "inferno"]) {
    assert.equal(RAMPS[name].length, 256);
    assert.ok(RAMPS[name].every((c) => /^#[\da-f]{6}$/.test(c)));
    assert.deepEqual(
      colorAt(0, 0, 1, name),
      [1, 3, 5].map((i) => parseInt(RAMPS[name][0].slice(i, i + 2), 16) / 255),
    );
  }
  const input = {
      width: 2,
      height: 1,
      pixels: Uint8Array.from([0, 20, 80, 255, 150, 30, 90, 0]),
    },
    before = [...input.pixels];
  const gray = displayTexture(input, {
    symbology: { imageryMode: "grayscale" },
  });
  assert.deepEqual([...gray.pixels], [0, 0, 0, 255, 150, 150, 150, 0]);
  assert.deepEqual([...input.pixels], before);
});
test("Rhino terrain exports a closed solid on the terrain layer with an explicit display datum", async () => {
  const { default: init } = await import("rhino3dm");
  const rhino = await init();
  const g = grid(),
    terrain = terrainMesh(g);
  const result = await encodeRhino(
    rhino,
    { grid: g, terrain, buildings: { models: [], skipped: 0 } },
    [],
    {
      wire: false,
      wireColor: "#645078",
      buildingColor: "#e4dfee",
      zScale: 1,
      solidBase: true,
    },
  );
  const file = rhino.File3dm.fromByteArray(result.bytes);
  let found = false;
  for (let i = 0; i < file.objects().count; i++) {
    const o = file.objects().get(i);
    if (o.attributes().name === "Closed terrain to reference plane") {
      found = true;
      assert.equal(o.geometry().isClosed, true);
    }
  }
  assert.ok(found);
  assert.equal(result.meta.terrainBase.z, -30);
  file.delete();
});
test(
  "Real satellite has separate RGB channels, valid alpha and preserves requested flat imagery role",
  { skip: !process.env.GEOCIM_REAL_DATA },
  async () => {
    const bytes = await readFile("data/v2/shatou/basemap.tif");
    const r = await readRaster(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      { role: "flatImagery" },
    );
    assert.equal(r.bands, 4);
    assert.equal(r.role, "flatImagery");
    assert.equal(r.crs, "EPSG:4326");
    assert.ok(
      r.rgb &&
        r.rgb[0].some(
          (v, i) => Number.isFinite(r.values[i]) && v !== r.rgb[1][i],
        ),
    );
    assert.ok(r.values.some(Number.isNaN));
    const tex = drapeTexture(r, {
      crs: r.crs,
      cols: r.width,
      rows: r.height,
      bounds: r.extent,
    });
    assert.ok(tex.pixels.some((v, i) => i % 4 === 3 && v === 0));
  },
);
