import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdirSync, copyFileSync } from "node:fs";
const require = createRequire(import.meta.url),
  viteRequire = createRequire(require.resolve("vite/package.json")),
  esbuild = viteRequire("esbuild");
const out = resolve("releases/cloud-v2");
mkdirSync(out, { recursive: true });
await esbuild.build({
  entryPoints: ["server/cloud-worker.mjs"],
  outdir: out,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  banner: {
    js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
  },
  external: ["node:*"],
});
copyFileSync("server/cloud-server.mjs", resolve(out, "cloud-server.mjs"));
console.log(out);
