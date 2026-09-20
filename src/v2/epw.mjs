export const WEATHER = {
  temperature: { column: 6, missing: 99.9, unit: "°C" },
  humidity: { column: 8, missing: 999, unit: "%" },
  windSpeed: { column: 21, missing: 999, unit: "m/s" },
  windDirection: { column: 20, missing: 999, unit: "°" },
  globalRadiation: { column: 13, missing: 9999, unit: "Wh/m²" },
  directRadiation: { column: 14, missing: 9999, unit: "Wh/m²" },
  diffuseRadiation: { column: 15, missing: 9999, unit: "Wh/m²" },
};
function csv(line) {
  return line
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.replace(/^"|"$/g, "").trim());
}
export function parseEPW(text) {
  if (text.length > 8 * 1024 * 1024) throw new Error("EPW exceeds 8 MiB.");
  const lines = text
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (lines.length < 9 || !lines[0].startsWith("LOCATION,"))
    throw new Error("Invalid EPW location/header.");
  const location = csv(lines[0]),
    records = [];
  const seen = new Set();
  for (const line of lines.slice(8)) {
    if (!line.trim()) continue;
    const c = csv(line);
    if (c.length < 35)
      throw new Error("EPW hourly row has fewer than 35 fields.");
    const [year, month, day, hour, minute] = c.slice(0, 5).map(Number);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour < 1 ||
      hour > 24 ||
      ![year, month, day, hour, minute].every(Number.isFinite)
    )
      throw new Error("Invalid EPW date/hour.");
    const key = `${month}-${day}-${hour}`;
    if (seen.has(key))
      throw new Error("Duplicate EPW hour; sub-hour data is not supported.");
    seen.add(key);
    const r = { year, month, day, hour, minute };
    for (const [name, f] of Object.entries(WEATHER)) {
      const v = c[f.column] === "" ? NaN : Number(c[f.column]);
      r[name] = Number.isFinite(v) && v !== f.missing ? v : null;
    }
    records.push(r);
    if (records.length > 8784) throw new Error("EPW exceeds one hourly year.");
  }
  if (records.length > 8784) throw new Error("EPW exceeds one hourly year.");
  return {
    station: location[1],
    latitude: Number(location[6]),
    longitude: Number(location[7]),
    timezone: Number(location[8]),
    elevation: Number(location[9]),
    records,
    typicalYear:
      /TMY|typical/i.test(text.slice(0, 3000)) ||
      new Set(records.map((r) => r.year)).size > 1,
    complete: records.length === 8760 || records.length === 8784,
    source: lines.slice(1, 8).join("\n"),
  };
}
