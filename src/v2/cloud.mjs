import { unpackProject } from "./project.mjs";
import { canAnalyze } from "./layer-policy.mjs";
const endpoint = () =>
  location.hostname === "127.0.0.1" || location.hostname === "localhost"
    ? "https://geocimplus.com"
    : "";
export async function cloudHealth() {
  try {
    const r = await fetch(`${endpoint()}/cloud-v2/health`, {
      signal: AbortSignal.timeout(6000),
    });
    return r.ok && (await r.json()).compute === "server";
  } catch {
    return false;
  }
}
export function cloudGraph(graph, layers) {
  return {
    ...graph,
    nodes: graph.nodes.map((n) => {
      if (n.type === "group") return n;
      const p = n.data?.params || {};
      if (!p.layer) return n;
      const l = layers.find((l) => l.id === p.layer);
      if (!canAnalyze(l) || !l.cloudSource || l.modified)
        throw new Error(
          "Cloud runs use unedited example working copies. Switch to local analysis for uploaded or edited data.",
        );
      return {
        ...n,
        data: { ...n.data, params: { ...p, layer: l.cloudSource } },
      };
    }),
  };
}
export async function cloudRequest(request) {
  const r = await fetch(`${endpoint()}/cloud-v2/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ example: "shatou-v2", ...request }),
    signal: AbortSignal.timeout(55000),
  });
  if (!r.ok) {
    let message = `Cloud analysis: HTTP ${r.status}`;
    try {
      message = (await r.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  const payload = unpackProject(new Uint8Array(await r.arrayBuffer()));
  if (payload.execution?.location !== "server")
    throw new Error("Cloud execution could not be verified.");
  return payload;
}
