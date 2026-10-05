// Post-build: compile src/ui.tsx with Solid Universal and bundle dual targets:
// 1. dist/tui-runtime.js (compiled with opentui:runtime-module for OpenCode TUI host)
// 2. dist/ui.js (compiled with standalone @opentui/solid for Node/testing)
// 3. dist/tui.js (adaptive loader that prefers host opentui:runtime-module with fallback)
//
// Why this exists
// ---------------
// Solid JS JSX components require the Solid Universal transform (`babel-preset-solid` with
// `{ moduleName: "@opentui/solid", generate: "universal" }`) so that dynamic attributes like
// `<Show when={...}>` produce Solid getters (`get when() { ... }`) and call `@opentui/solid`
// element/node primitives rather than React-style `_jsx()` calls.
//
// Inside OpenCode TUI, the host provides a single shared Solid runtime and RendererContext via
// `opentui:runtime-module:%40opentui%2Fsolid` and `opentui:runtime-module:solid-js`.
// Using bare module specifiers inside a plugin causes a secondary Solid runtime instance to load,
// which throws "No renderer found" when creating elements because the RendererContext is missing.
//
// This script compiles both runtime and standalone variants, providing seamless OpenCode TUI
// integration and plain Node/unit-test compatibility.

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

const source = readFileSync(sourcePath, "utf8");

// 1. Transform TSX for OpenCode host runtime (opentui:runtime-module)
const babelRuntimeRes = transformSync(source, {
  filename: sourcePath,
  presets: [
    [
      babelPresetSolid,
      {
        moduleName: "opentui:runtime-module:%40opentui%2Fsolid",
        generate: "universal",
      },
    ],
    [babelPresetTypescript],
  ],
});

if (!babelRuntimeRes || !babelRuntimeRes.code) {
  console.error("[emit-tui] Babel Solid transform for runtime failed");
  process.exit(1);
}

let runtimeTransformed = babelRuntimeRes.code;
runtimeTransformed = runtimeTransformed.replace(
  /from\s+["']solid-js["']/g,
  'from "opentui:runtime-module:solid-js"'
);
runtimeTransformed = runtimeTransformed.replace(
  /from\s+["']@opentui\/core["']/g,
  'from "opentui:runtime-module:%40opentui%2Fcore"'
);

const esbuildRuntimeRes = buildSync({
  stdin: {
    contents: runtimeTransformed,
    resolveDir: path.join(root, "src"),
    sourcefile: "tui-runtime.js",
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["opentui:*", "solid-js", "@opentui/*", "jsdom", "@opencode-ai/*", "@opencode/*"],
  write: false,
});

if (!esbuildRuntimeRes.outputFiles || esbuildRuntimeRes.outputFiles.length === 0) {
  console.error("[emit-tui] esbuild runtime bundling failed");
  process.exit(1);
}

const runtimeBundled = esbuildRuntimeRes.outputFiles[0].text;
const runtimeOut = path.join(dist, "tui-runtime.js");
writeFileSync(runtimeOut, runtimeBundled, "utf8");

// 2. Transform TSX for Standalone / Node / Test runtime
const babelStandaloneRes = transformSync(source, {
  filename: sourcePath,
  presets: [
    [
      babelPresetSolid,
      {
        moduleName: "@opentui/solid",
        generate: "universal",
      },
    ],
    [babelPresetTypescript],
  ],
});

if (!babelStandaloneRes || !babelStandaloneRes.code) {
  console.error("[emit-tui] Babel Solid transform for standalone failed");
  process.exit(1);
}

const esbuildStandaloneRes = buildSync({
  stdin: {
    contents: babelStandaloneRes.code,
    resolveDir: path.join(root, "src"),
    sourcefile: "ui.js",
    loader: "js",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  external: ["solid-js", "@opentui/*", "jsdom", "@opencode-ai/*", "@opencode/*"],
  write: false,
});

if (!esbuildStandaloneRes.outputFiles || esbuildStandaloneRes.outputFiles.length === 0) {
  console.error("[emit-tui] esbuild standalone bundling failed");
  process.exit(1);
}

const standaloneBundled = esbuildStandaloneRes.outputFiles[0].text;
const uiOut = path.join(dist, "ui.js");
const standaloneOut = path.join(dist, "tui-standalone.js");
writeFileSync(uiOut, standaloneBundled, "utf8");
writeFileSync(standaloneOut, standaloneBundled, "utf8");

// 3. Generate adaptive loader dist/tui.js
const loaderCode = `// Adaptive TUI loader: prefers OpenCode host OpenTUI virtual runtime registry
// with seamless fallback to standalone implementation for plain Node/test environments.
let hostRuntimeAvailable = false;
try {
  await import("opentui:runtime-module:" + encodeURIComponent("@opentui/solid"));
  hostRuntimeAvailable = true;
} catch {
  // Plain Node/test runtimes do not expose OpenCode's virtual runtime registry.
}

const mod = hostRuntimeAvailable
  ? await import("./tui-runtime.js")
  : await import("./ui.js");

export default mod.default;
export const tui = mod.tui;
export const setup = mod.setup;
export const SmartQuestionOverlay = mod.SmartQuestionOverlay;
export const detectRecommendations = mod.detectRecommendations;
export const formatCountdown = mod.formatCountdown;
export const loadConfig = mod.loadConfig;
export const resolveAgentName = mod.resolveAgentName;
export const stripMarker = mod.stripMarker;
`;

const tuiOut = path.join(dist, "tui.js");
writeFileSync(tuiOut, loaderCode, "utf8");

// 4. Root convenience entries (tui.js, server.js, index.js)
const rootTuiCode = `export * from "./dist/tui.js";
export { default } from "./dist/tui.js";
`;
writeFileSync(path.join(root, "tui.js"), rootTuiCode, "utf8");

const rootServerCode = `export * from "./dist/index.js";
export { default } from "./dist/index.js";
`;
writeFileSync(path.join(root, "server.js"), rootServerCode, "utf8");

const rootIndexCode = `export * from "./dist/index.js";
export { default } from "./dist/index.js";
`;
writeFileSync(path.join(root, "index.js"), rootIndexCode, "utf8");

// 5. Types mirroring
for (const file of ["ui.d.ts", "ui.d.ts.map"]) {
  const from = path.join(dist, file);
  if (existsSync(from)) {
    copyFileSync(from, path.join(dist, file.replace(/^ui\./, "tui.")));
    copyFileSync(from, path.join(dist, file.replace(/^ui\./, "tui-runtime.")));
  }
}

console.error("[emit-tui] dist/tui-runtime.js (host), dist/ui.js (standalone), dist/tui.js (loader) emitted successfully");
