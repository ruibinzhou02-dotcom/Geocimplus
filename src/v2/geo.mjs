import proj4 from "proj4";
proj4.defs("EPSG:4490", "+proj=longlat +ellps=GRS80 +no_defs");
export function defineCRS(crs) {
  const n = Number(String(crs).replace("EPSG:", ""));
  if (n >= 32601 && n <= 32760 && n % 100 >= 1 && n % 100 <= 60)
    proj4.defs(
      crs,
      `+proj=utm +zone=${n % 100} ${n >= 32700 ? "+south" : ""} +datum=WGS84 +units=m +no_defs`,
    );
  if (!proj4.defs(crs))
    throw new Error(
      `Unsupported CRS ${crs}. Supply a north-up GeoTIFF in WGS84, CGCS2000, Web Mercator or WGS84 UTM.`,
    );
  return crs;
}
export function transform(from, to) {
  defineCRS(from);
  defineCRS(to);
  return proj4(from, to).forward;
}
export function metricCRS(lon, lat) {
  return (
    "EPSG:" +
    ((lat < 0 ? 32700 : 32600) +
      Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1)))
  );
}
export function projectedBounds(r, crs) {
  const project = transform(r.crs, crs),
    b = [Infinity, Infinity, -Infinity, -Infinity],
    e = r.extent;
  for (let i = 0; i <= 16; i++)
    for (const p of [
      [e[0] + ((e[2] - e[0]) * i) / 16, e[1]],
      [e[0] + ((e[2] - e[0]) * i) / 16, e[3]],
      [e[0], e[1] + ((e[3] - e[1]) * i) / 16],
      [e[2], e[1] + ((e[3] - e[1]) * i) / 16],
    ]) {
      const q = project(p);
      b[0] = Math.min(b[0], q[0]);
      b[1] = Math.min(b[1], q[1]);
      b[2] = Math.max(b[2], q[0]);
      b[3] = Math.max(b[3], q[1]);
    }
  return b;
}
