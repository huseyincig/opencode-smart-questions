// Adaptive TUI loader: prefers OpenCode host OpenTUI virtual runtime registry
// with seamless fallback to standalone implementation for plain Node/test environments.
let mod;
try {
  await import("opentui:runtime-module:" + encodeURIComponent("@opentui/solid"));
  mod = await import("./tui-runtime.js");
} catch {
  mod = await import("./ui.js");
}

export default mod.default;
export const tui = mod.tui;
export const setup = mod.setup;
export const SmartQuestionOverlay = mod.SmartQuestionOverlay;
export const detectRecommendations = mod.detectRecommendations;
export const formatCountdown = mod.formatCountdown;
export const loadConfig = mod.loadConfig;
export const resolveAgentName = mod.resolveAgentName;
export const stripMarker = mod.stripMarker;
