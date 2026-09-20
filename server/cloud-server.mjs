import http from "node:http";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
const port = Number(process.env.PORT || 8790),
  root = dirname(fileURLToPath(import.meta.url)),
  dataDir = process.env.GEOCIM_DATA || join(root, "data");
const origins = new Set([
  "https://geocimplus.com",
  "https://www.geocimplus.com",
  "http://127.0.0.1:8766",
  "http://localhost:8766",
]);
let active = false;
const rates = new Map();
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
};
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && !origins.has(origin)) {
    send(res, 403, { error: "Origin not allowed." });
    return;
  }
  const cors = origin
    ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
    : {};
  if (req.method === "OPTIONS") {
    send(res, 204, "", {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return;
  }
  if (req.url === "/cloud-v2/health" && req.method === "GET") {
    send(
      res,
      200,
      {
        ready: true,
        example: "shatou-v2",
        compute: "server",
        storage: "fixed-example-only",
        busy: active,
      },
      cors,
    );
    return;
  }
  if (req.url !== "/cloud-v2/run" || req.method !== "POST") {
    send(res, 404, { error: "Not found." }, cors);
    return;
  }
  if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
    send(res, 415, { error: "JSON parameters required." }, cors);
    return;
  }
  const key = req.headers["x-real-ip"] || req.socket.remoteAddress,
    now = Date.now();
  for (const [k, v] of rates) if (now - v.start > 60000) rates.delete(k);
  const rate = rates.get(key) || { start: now, count: 0 };
  rate.count++;
  rates.set(key, rate);
  if (rate.count > 8 || rates.size > 1000) {
    send(
      res,
      429,
      { error: "Please wait before another cloud run." },
      { ...cors, "Retry-After": "60" },
    );
    return;
  }
  if (active) {
    send(
      res,
      429,
      {
        error:
          "The example server is busy. Retry shortly or use local analysis.",
      },
      { ...cors, "Retry-After": "5" },
    );
    return;
  }
  if (Number(req.headers["content-length"] || 0) > 65536) {
    send(res, 413, { error: "Request too large." }, cors);
    return;
  }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      chunks.push(chunk);
      bytes += chunk.length;
      if (bytes > 65536) {
        send(res, 413, { error: "Request too large." }, cors);
        return;
      }
    }
  } catch {
    return;
  }
  let request;
  try {
    request = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    send(res, 400, { error: "Invalid JSON." }, cors);
    return;
  }
  if (active) {
    send(
      res,
      429,
      { error: "The example server is busy. Retry shortly." },
      { ...cors, "Retry-After": "5" },
    );
    return;
  }
  active = true;
  const runId = randomUUID();
  let worker;
  try {
    worker = new Worker(join(root, "cloud-worker.mjs"), {
      workerData: { request, dataDir },
      resourceLimits: {
        maxOldGenerationSizeMb: 256,
        maxYoungGenerationSizeMb: 32,
      },
    });
  } catch {
    active = false;
    send(res, 503, { error: "Compute service unavailable." }, cors);
    return;
  }
  let completed = false;
  const finish = async (status, data, bytes = false) => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    await worker.terminate().catch(() => {});
    active = false;
    if (res.destroyed) return;
    if (bytes) {
      res.writeHead(status, {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-GeoCIM-Execution": "server",
        "X-GeoCIM-Run": runId,
        ...cors,
      });
      res.end(data);
    } else send(res, status, data, cors);
  };
  const timer = setTimeout(
    () =>
      finish(504, {
        error: "Cloud example timed out. Use a coarser grid or local analysis.",
      }),
    45000,
  );
  worker.on("message", (m) =>
    m.error ? finish(422, { error: m.error }) : finish(200, m.bytes, true),
  );
  worker.on("error", () =>
    finish(500, { error: "Cloud example could not complete." }),
  );
  worker.on("exit", (code) => {
    if (!completed) finish(500, { error: "Cloud worker ended early." });
  });
  res.on("close", () => {
    if (!res.writableEnded) finish(499, { error: "Cancelled." });
  });
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.listen(port, "127.0.0.1", () =>
  console.log(`GeoCIM fixed-example computation on 127.0.0.1:${port}`),
);
