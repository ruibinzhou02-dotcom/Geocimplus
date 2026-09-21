/** Close the valid terrain surface down to a display datum; never fill NoData tops. */
export function terrainSolid(surface, referenceZ) {
  const used = [...new Set(surface.indices)],
    lowest = used.reduce(
      (z, i) => Math.min(z, surface.positions[i * 3 + 2]),
      Infinity,
    );
  const baseZ =
    Number.isFinite(referenceZ) && referenceZ < lowest
      ? referenceZ
      : Math.min(0, Number.isFinite(lowest) ? lowest : 0) - 30;
  const positions = [],
    top = [],
    closure = [],
    edges = new Map(),
    map = new Map();
  used.forEach((old, i) => {
    map.set(old, i);
    positions.push(...surface.positions.slice(old * 3, old * 3 + 3));
  });
  const n = used.length;
  for (const old of used)
    positions.push(
      surface.positions[old * 3],
      surface.positions[old * 3 + 1],
      baseZ,
    );
  for (let i = 0; i < surface.indices.length; i += 3) {
    const [a, b, c] = Array.from(surface.indices.slice(i, i + 3), (k) =>
      map.get(k),
    );
    top.push(a, b, c);
    closure.push(c + n, b + n, a + n);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { u, v, count: 1 });
    }
  }
  let boundaryEdges = 0;
  for (const { u, v, count } of edges.values())
    if (count === 1) {
      // Top faces are CCW; wall orientation is outward from the valid region.
      closure.push(u, u + n, v + n, u, v + n, v);
      boundaryEdges++;
    }
  return {
    positions: Float32Array.from(positions),
    indices: Uint32Array.from([...top, ...closure]),
    closureIndices: Uint32Array.from(closure),
    baseZ,
    boundaryEdges,
  };
}
