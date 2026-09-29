// Post-build: compile src/ui.tsx with Solid Universal and bundle to dist/tui.js & dist/ui.js.
//
// Why this exists
// ---------------
// Solid JS JSX components require the Solid Universal transform (`babel-preset-solid` with
// `{ moduleName: "@opentui/solid", generate: "universal" }`) so that dynamic attributes like
// `<Show when={...}>` produce Solid getters (`get when() { ... }`) and call `@opentui/solid`
// element/node primitives rather than React-style `_jsx()` calls.
//
// `tsc` and plain `esbuild` do not know Solid universal transform, which caused components to
// lose reactivity. This script transforms with Babel first, then bundles with esbuild for ESM Node.

import { transformSync } from "@babel/core";
import babelPresetSolid from "babel-preset-solid";
import babelPresetTypescript from "@babel/preset-typescript";
import { buildSync } from "esbuild";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const sourcePath = path.join(root, "src", "ui.tsx");

// 1. Transform TSX with Solid Universal compiler
const source = readFileSync(sourcePath, "utf8");
const babelRes = transformSync(source, {
  filename: sourcePath,
  presets: [
    [babelPresetSolid, { moduleName: "@opentui/solid", generate: "universal" }],
    [babelPresetTypescript],
  ],
});

if (!babelRes || !babelRes.code) {
  console.error("[emit-tui] Babel Solid transform failed");
  process.exit(1);
}

// 2. Bundle with esbuild for ESM Node runtime (externalizing solid-js and @opentui)
const esbuildRes = buildSync({
  stdin: {
    contents: babelRes.code,
    resolveDir: path.join(root, "src"),
    sourcefile: "ui.js",
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["solid-js", "@opentui/*", "jsdom", "@opencode-ai/*"],
  write: false,
});

if (!esbuildRes.outputFiles || esbuildRes.outputFiles.length === 0) {
  console.error("[emit-tui] esbuild bundling failed");
  process.exit(1);
}

const bundledCode = esbuildRes.outputFiles[0].text;
const tuiOut = path.join(dist, "tui.js");
const uiOut = path.join(dist, "ui.js");

writeFileSync(tuiOut, bundledCode, "utf8");
writeFileSync(uiOut, bundledCode, "utf8");

for (const file of ["ui.d.ts", "ui.d.ts.map"]) {
  const from = path.join(dist, file);
  if (existsSync(from)) {
    copyFileSync(from, path.join(dist, file.replace(/^ui\./, "tui.")));
  }
}

console.log("[emit-tui] dist/tui.js + dist/ui.js compiled with Solid Universal and emitted successfully");
