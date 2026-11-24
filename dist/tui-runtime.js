// src/tui-runtime.js
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { effect as _$effect } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createTextNode as _$createTextNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insertNode as _$insertNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
import fs3 from "node:fs";
import path3 from "node:path";
import { Show, createMemo, createSignal } from "opentui:runtime-module:solid-js";
import { Plugin as OpenCodeV2Tui } from "opentui:runtime-module:%40opencode%2Fplugin%2Ftui";

// src/config.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// src/diagnostics.ts
var INTERNAL_CODES = /* @__PURE__ */ new Set([
  "native-reply-error",
  "native-reply-not-ok",
  "internal-reply-error",
  "internal-reply-not-ok",
  "no-reply-transport",
  "reply-failed"
]);
var OS_CODES = /* @__PURE__ */ new Set([
  "EACCES",
  "EPERM",
  "ENOENT",
  "EEXIST",
  "ENOTDIR",
  "EISDIR",
  "EROFS",
  "ENOSPC",
  "EMFILE",
  "ENFILE",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "ABORT_ERR"
]);
function isSafeInternalCode(code) {
  return INTERNAL_CODES.has(code) || /^HTTP_[1-5]\d\d$/.test(code);
}
function diagnosticErrorCode(error) {
  if (error && typeof error === "object") {
    const code = error.code;
    if (typeof code === "string" && (OS_CODES.has(code) || error.name === "SmartQuestionError" && isSafeInternalCode(code))) {
      return code;
    }
    if (error instanceof SyntaxError) return "syntax-error";
    if (error instanceof TypeError) return "type-error";
    if (error instanceof RangeError) return "range-error";
    if (error instanceof Error) return "error";
    return "object-error";
  }
  if (typeof error === "string") return "string-error";
  if (error === null) return "null-error";
  if (error === void 0) return "undefined-error";
  return `${typeof error}-error`;
}
var DECISION_STATE_SYMBOL = Symbol.for("opencode.smart-questions.decisions.v1");
var MAX_DECISION_HISTORY = 128;
function getDecisionStore() {
  const g = globalThis;
  if (!Array.isArray(g[DECISION_STATE_SYMBOL])) {
    g[DECISION_STATE_SYMBOL] = [];
  }
  return g[DECISION_STATE_SYMBOL];
}
function recordSmartQuestionDecision(record) {
  if (!record || typeof record.formID !== "string" || typeof record.sessionID !== "string") return;
  const store = getDecisionStore();
  store.push({
    formID: record.formID,
    sessionID: record.sessionID,
    status: record.status,
    ...record.reason ? { reason: record.reason } : {},
    ...record.matchedMarker ? { matchedMarker: record.matchedMarker } : {},
    ...typeof record.timeoutMs === "number" ? { timeoutMs: record.timeoutMs } : {},
    timestamp: typeof record.timestamp === "number" ? record.timestamp : Date.now()
  });
  while (store.length > MAX_DECISION_HISTORY) {
    store.shift();
  }
}

// src/config.ts
var DEFAULT_RECOMMENDED_MARKERS = [
  "[SQ:recommended]",
  "(Recommended)",
  "(\xD6nerilen)"
];
var DEFAULT_MANUAL_MARKERS = [
  "[SQ:manual]",
  "[SQ_DECISION:manual]"
];
var DEFAULT_MANUAL_ON_PATTERNS = [
  "rm -rf",
  "force push",
  "force-push",
  "git push --force",
  "git reset --hard",
  "drop database",
  "drop table",
  "truncate table",
  "delete production",
  "deleting production",
  "format disk",
  "mkfs"
];
var DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS = 3;
var MAX_TIMEOUT_MS = 2147483647;
var SMART_QUESTION_CONFIG_KEYS = /* @__PURE__ */ new Set([
  "enabled",
  "timeoutMs",
  "recommendedMarkers",
  "recommendedMarker",
  "manualMarkers",
  "manualMarker",
  "manualOnPatterns",
  "maxUnclassifiedRemediations",
  "unclassifiedQuestionPolicy",
  "unsupportedFieldPolicy",
  "guidanceMode",
  "fallbackToFirstOption",
  "fallbackOnManual",
  "requireExactlyOneRecommendation",
  "uiText",
  "debugLog",
  "configDir",
  "includeSubagents"
]);
function hasSmartQuestionConfigOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) return false;
  if (Object.prototype.hasOwnProperty.call(options, "config")) return true;
  return Object.keys(options).some((key) => SMART_QUESTION_CONFIG_KEYS.has(key));
}
var DEFAULT_UI_TEXT = {
  recommendation: "Recommendation:",
  disabled: "AUTO-SELECTION DISABLED",
  autoReplyFailed: "Auto-selection failed. Please answer manually.",
  agent: "Agent:",
  session: "Session:",
  manualTitle: "Manual Decision Required",
  manualSubtitle: "Auto-selection disabled \u2014 human approval required.",
  unclassifiedTitle: "Unclassified Question Intercepted",
  unclassifiedSubtitle: "Agent was asked to classify the question.",
  remediationFailed: "SQ could not remediate this question. Please answer manually.",
  budgetExhausted: "Automatic remediation stopped for this repeated question. Please answer manually."
};
var DEFAULT_CONFIG = {
  enabled: true,
  timeoutMs: 3e4,
  recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
  recommendedMarker: "[SQ:recommended]",
  manualMarkers: DEFAULT_MANUAL_MARKERS,
  manualMarker: "[SQ:manual]",
  manualOnPatterns: DEFAULT_MANUAL_ON_PATTERNS,
  maxUnclassifiedRemediations: DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS,
  unclassifiedQuestionPolicy: "remediate",
  unsupportedFieldPolicy: "ignore",
  guidanceMode: "full",
  requireExactlyOneRecommendation: true,
  uiText: DEFAULT_UI_TEXT,
  debugLog: ""
};
function normalizeUIText(value) {
  const overrides = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    recommendation: typeof overrides.recommendation === "string" && overrides.recommendation.trim() ? overrides.recommendation : DEFAULT_UI_TEXT.recommendation,
    disabled: typeof overrides.disabled === "string" && overrides.disabled.trim() ? overrides.disabled : DEFAULT_UI_TEXT.disabled,
    autoReplyFailed: typeof overrides.autoReplyFailed === "string" && overrides.autoReplyFailed.trim() ? overrides.autoReplyFailed : DEFAULT_UI_TEXT.autoReplyFailed,
    agent: typeof overrides.agent === "string" && overrides.agent.trim() ? overrides.agent : DEFAULT_UI_TEXT.agent,
    session: typeof overrides.session === "string" && overrides.session.trim() ? overrides.session : DEFAULT_UI_TEXT.session,
    manualTitle: typeof overrides.manualTitle === "string" && overrides.manualTitle.trim() ? overrides.manualTitle : DEFAULT_UI_TEXT.manualTitle,
    manualSubtitle: typeof overrides.manualSubtitle === "string" && overrides.manualSubtitle.trim() ? overrides.manualSubtitle : DEFAULT_UI_TEXT.manualSubtitle,
    unclassifiedTitle: typeof overrides.unclassifiedTitle === "string" && overrides.unclassifiedTitle.trim() ? overrides.unclassifiedTitle : DEFAULT_UI_TEXT.unclassifiedTitle,
    unclassifiedSubtitle: typeof overrides.unclassifiedSubtitle === "string" && overrides.unclassifiedSubtitle.trim() ? overrides.unclassifiedSubtitle : DEFAULT_UI_TEXT.unclassifiedSubtitle,
    remediationFailed: typeof overrides.remediationFailed === "string" && overrides.remediationFailed.trim() ? overrides.remediationFailed : DEFAULT_UI_TEXT.remediationFailed,
    budgetExhausted: typeof overrides.budgetExhausted === "string" && overrides.budgetExhausted.trim() ? overrides.budgetExhausted : DEFAULT_UI_TEXT.budgetExhausted
  };
}
function cleanMarkers(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value.filter((item) => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    )
  );
}
function normalizeConfigMarkers(rawMarkers, legacyMarker) {
  const list = cleanMarkers(rawMarkers);
  if (list.length > 0) return list;
  if (typeof legacyMarker === "string" && legacyMarker.trim().length > 0) {
    return [legacyMarker.trim()];
  }
  return [...DEFAULT_RECOMMENDED_MARKERS];
}
function normalizeParamMarkers(marker) {
  if (Array.isArray(marker)) {
    const list = cleanMarkers(marker);
    return list.length > 0 ? list : [...DEFAULT_RECOMMENDED_MARKERS];
  }
  if (typeof marker === "string" && marker.trim().length > 0) {
    return [marker.trim()];
  }
  return [...DEFAULT_RECOMMENDED_MARKERS];
}
function normalizeSmartQuestionConfig(raw, configDir) {
  if (raw !== void 0 && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
    return null;
  }
  const parsed = raw ?? {};
  if (parsed.enabled === false) return null;
  if (Object.keys(parsed).some((key) => !SMART_QUESTION_CONFIG_KEYS.has(key)) || parsed.enabled !== void 0 && parsed.enabled !== true || parsed.timeoutMs !== void 0 && (typeof parsed.timeoutMs !== "number" || !Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 0 || parsed.timeoutMs > MAX_TIMEOUT_MS) || parsed.requireExactlyOneRecommendation !== void 0 && typeof parsed.requireExactlyOneRecommendation !== "boolean" || parsed.recommendedMarkers !== void 0 && (!Array.isArray(parsed.recommendedMarkers) || parsed.recommendedMarkers.length === 0 || parsed.recommendedMarkers.some((marker) => typeof marker !== "string" || marker.trim().length === 0)) || parsed.recommendedMarker !== void 0 && (typeof parsed.recommendedMarker !== "string" || parsed.recommendedMarker.trim().length === 0) || parsed.debugLog !== void 0 && typeof parsed.debugLog !== "string" || parsed.configDir !== void 0 && (typeof parsed.configDir !== "string" || parsed.configDir.trim().length === 0) || parsed.manualMarkers !== void 0 && (!Array.isArray(parsed.manualMarkers) || parsed.manualMarkers.length === 0 || parsed.manualMarkers.some((marker) => typeof marker !== "string" || marker.trim().length === 0)) || parsed.manualMarker !== void 0 && (typeof parsed.manualMarker !== "string" || parsed.manualMarker.trim().length === 0) || parsed.manualOnPatterns !== void 0 && (!Array.isArray(parsed.manualOnPatterns) || parsed.manualOnPatterns.some((pattern) => typeof pattern !== "string" || pattern.trim().length === 0)) || parsed.maxUnclassifiedRemediations !== void 0 && (typeof parsed.maxUnclassifiedRemediations !== "number" || !Number.isFinite(parsed.maxUnclassifiedRemediations) || parsed.maxUnclassifiedRemediations < 0) || parsed.unclassifiedQuestionPolicy !== void 0 && parsed.unclassifiedQuestionPolicy !== "remediate" && parsed.unclassifiedQuestionPolicy !== "ignore" && parsed.unclassifiedQuestionPolicy !== "fallback-first" && parsed.unclassifiedQuestionPolicy !== "remediate-then-fallback" || parsed.unsupportedFieldPolicy !== void 0 && parsed.unsupportedFieldPolicy !== "ignore" && parsed.unsupportedFieldPolicy !== "manual" && parsed.unsupportedFieldPolicy !== "remediate" || parsed.guidanceMode !== void 0 && parsed.guidanceMode !== "full" && parsed.guidanceMode !== "compact" && parsed.guidanceMode !== "hint" && parsed.guidanceMode !== "off" || parsed.fallbackToFirstOption !== void 0 && typeof parsed.fallbackToFirstOption !== "boolean" || parsed.fallbackOnManual !== void 0 && typeof parsed.fallbackOnManual !== "boolean" || parsed.includeSubagents !== void 0 && typeof parsed.includeSubagents !== "boolean" || parsed.uiText !== void 0 && (parsed.uiText === null || typeof parsed.uiText !== "object" || Array.isArray(parsed.uiText) || Object.values(parsed.uiText).some((value) => typeof value !== "string" || value.trim().length === 0))) {
    return null;
  }
  const recommendedMarkers = normalizeConfigMarkers(
    parsed.recommendedMarkers,
    parsed.recommendedMarker
  );
  const recommendedMarker = recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker ?? "[SQ:recommended]";
  const rawManualMarkers = cleanMarkers(parsed.manualMarkers);
  const manualMarkers = rawManualMarkers.length > 0 ? rawManualMarkers : typeof parsed.manualMarker === "string" && parsed.manualMarker.trim().length > 0 ? [parsed.manualMarker.trim()] : [...DEFAULT_MANUAL_MARKERS];
  const manualMarker = manualMarkers[0] ?? DEFAULT_CONFIG.manualMarker ?? "[SQ:manual]";
  const manualOnPatterns = parsed.manualOnPatterns !== void 0 ? cleanMarkers(parsed.manualOnPatterns) : [...DEFAULT_MANUAL_ON_PATTERNS];
  const maxUnclassifiedRemediations = typeof parsed.maxUnclassifiedRemediations === "number" && Number.isFinite(parsed.maxUnclassifiedRemediations) && parsed.maxUnclassifiedRemediations >= 0 ? Math.floor(parsed.maxUnclassifiedRemediations) : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;
  const unclassifiedQuestionPolicy = parsed.unclassifiedQuestionPolicy === "ignore" ? "ignore" : parsed.unclassifiedQuestionPolicy === "fallback-first" ? "fallback-first" : parsed.unclassifiedQuestionPolicy === "remediate-then-fallback" ? "remediate-then-fallback" : "remediate";
  const unsupportedFieldPolicy = parsed.unsupportedFieldPolicy === "manual" ? "manual" : parsed.unsupportedFieldPolicy === "remediate" ? "remediate" : "ignore";
  const guidanceMode = parsed.guidanceMode === "off" ? "off" : parsed.guidanceMode === "compact" || parsed.guidanceMode === "hint" ? "compact" : "full";
  const timeoutMs = typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs >= 0 && parsed.timeoutMs <= MAX_TIMEOUT_MS ? parsed.timeoutMs : DEFAULT_CONFIG.timeoutMs;
  const normalized = {
    enabled: true,
    timeoutMs,
    recommendedMarkers,
    recommendedMarker,
    manualMarkers,
    manualMarker,
    manualOnPatterns,
    maxUnclassifiedRemediations,
    unclassifiedQuestionPolicy,
    unsupportedFieldPolicy,
    guidanceMode,
    requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === "boolean" ? parsed.requireExactlyOneRecommendation : DEFAULT_CONFIG.requireExactlyOneRecommendation,
    uiText: normalizeUIText(parsed.uiText),
    debugLog: typeof parsed.debugLog === "string" ? parsed.debugLog : DEFAULT_CONFIG.debugLog ?? ""
  };
  if (typeof parsed.fallbackToFirstOption === "boolean") {
    normalized.fallbackToFirstOption = parsed.fallbackToFirstOption;
  }
  if (typeof parsed.fallbackOnManual === "boolean") {
    normalized.fallbackOnManual = parsed.fallbackOnManual;
  }
  if (typeof parsed.includeSubagents === "boolean") {
    normalized.includeSubagents = parsed.includeSubagents;
  }
  const resolvedConfigDir = typeof parsed.configDir === "string" && parsed.configDir ? parsed.configDir : configDir;
  if (resolvedConfigDir) normalized.configDir = resolvedConfigDir;
  return normalized;
}
function resolveSmartQuestionConfig(projectDir, pluginOptions) {
  const directory = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
  const configDir = path.resolve(directory, ".opencode");
  const resolver = pluginOptions && typeof pluginOptions === "object" && !Array.isArray(pluginOptions) && typeof pluginOptions.resolveConfig === "function" ? pluginOptions.resolveConfig : void 0;
  if (resolver) {
    let dynamic;
    try {
      dynamic = resolver(directory);
    } catch {
      return null;
    }
    if (dynamic !== void 0) {
      return normalizeSmartQuestionConfig(dynamic, configDir);
    }
  }
  const staticOptions = pluginOptions && typeof pluginOptions === "object" && !Array.isArray(pluginOptions) && typeof pluginOptions.resolveConfig === "function" ? (() => {
    const { resolveConfig: _ignored, ...rest } = pluginOptions;
    return rest;
  })() : pluginOptions;
  if (staticOptions && Object.prototype.hasOwnProperty.call(staticOptions, "config")) {
    return normalizeSmartQuestionConfig(staticOptions.config, configDir);
  }
  if (hasSmartQuestionConfigOptions(staticOptions)) {
    return normalizeSmartQuestionConfig(staticOptions, configDir);
  }
  return loadConfig(projectDir);
}
var MAX_CONFIG_FILE_CACHE = 64;
var configFileCache = /* @__PURE__ */ new Map();
function cloneSmartQuestionConfig(config) {
  if (!config) return null;
  return {
    ...config,
    recommendedMarkers: [...config.recommendedMarkers],
    ...config.manualMarkers ? { manualMarkers: [...config.manualMarkers] } : {},
    ...config.manualOnPatterns ? { manualOnPatterns: [...config.manualOnPatterns] } : {},
    uiText: { ...config.uiText }
  };
}
function setConfigCache(filePath, entry) {
  if (configFileCache.has(filePath)) {
    configFileCache.delete(filePath);
  }
  configFileCache.set(filePath, entry);
  while (configFileCache.size > MAX_CONFIG_FILE_CACHE) {
    const oldest = configFileCache.keys().next().value;
    if (oldest === void 0) break;
    configFileCache.delete(oldest);
  }
}
function loadConfig(projectDir) {
  const dir = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
  const candidatePaths = [
    path.resolve(dir, ".opencode/smart-question.json"),
    path.resolve(dir, "smart-question.json"),
    path.resolve(os.homedir(), ".config/opencode/smart-question.json")
  ];
  let configPath = null;
  let configStat = null;
  for (const candidate of candidatePaths) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) {
        configPath = candidate;
        configStat = stat;
        break;
      }
    } catch {
    }
  }
  if (!configPath || !configStat) {
    return normalizeSmartQuestionConfig({}, path.resolve(dir, ".opencode"));
  }
  const signature = `${configStat.mtimeMs}:${configStat.ctimeMs}:${configStat.size}`;
  const cached = configFileCache.get(configPath);
  if (cached && cached.signature === signature) {
    return cloneSmartQuestionConfig(cached.config);
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeSmartQuestionConfig(parsed, path.dirname(configPath));
    if (!normalized && parsed?.enabled !== false) {
      console.error("[smart-question] Invalid smart-question config; auto-selection disabled");
    }
    setConfigCache(configPath, {
      signature,
      config: cloneSmartQuestionConfig(normalized)
    });
    return normalized;
  } catch (err) {
    console.error(
      `[smart-question] Failed to load smart-question config (${diagnosticErrorCode(err)}); auto-selection disabled`
    );
    configFileCache.delete(configPath);
    return null;
  }
}

// src/detector.ts
import { createHash } from "node:crypto";
function detectRecommendations(questions, marker = DEFAULT_CONFIG.recommendedMarkers, options = {}) {
  void options;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, reason: "No questions provided in request" };
  }
  const markers = normalizeParamMarkers(marker);
  const markerDesc = markers.length === 1 ? `"${markers[0]}"` : `(accepted: ${markers.map((m) => `"${m}"`).join(", ")})`;
  const answers = [];
  const recommendedOptions = [];
  let matchedMarker;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qIndex = i + 1;
    if (!q) {
      return { ok: false, reason: `Question ${qIndex} is null or undefined` };
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      return { ok: false, reason: `Question ${qIndex} has no options` };
    }
    const matched = q.options.map((opt) => {
      if (!opt || typeof opt.label !== "string") return null;
      const normalizedLabel = opt.label.trimEnd().normalize("NFC");
      const m = markers.find(
        (marker2) => normalizedLabel.endsWith(marker2.normalize("NFC"))
      );
      return m ? { opt, marker: m } : null;
    }).filter((x) => x !== null);
    if (matched.length === 0) {
      return {
        ok: false,
        reason: `Question ${qIndex} has no options ending with marker ${markerDesc}`
      };
    }
    if (!q.multiple && matched.length > 1) {
      return {
        ok: false,
        reason: `Question ${qIndex} has ${matched.length} options ending with marker ${markerDesc} (expected exactly 1)`
      };
    }
    const firstMatch = matched[0];
    if (!firstMatch) {
      return { ok: false, reason: `Question ${qIndex} has no usable recommended option` };
    }
    if (!matchedMarker) {
      matchedMarker = firstMatch.marker;
    }
    if (q.multiple) {
      answers.push(matched.map((m) => m.opt.label));
      recommendedOptions.push(...matched.map((m) => m.opt));
    } else {
      answers.push([firstMatch.opt.label]);
      recommendedOptions.push(firstMatch.opt);
    }
  }
  return { ok: true, answers, recommendedOptions, matchedMarker };
}
function isQuestionExplicitlyManual(q, manualMarkers = DEFAULT_MANUAL_MARKERS, manualOnPatterns = DEFAULT_MANUAL_ON_PATTERNS) {
  if (!q) return { isManual: false };
  const textsToCheck = [];
  if (typeof q.question === "string") textsToCheck.push(q.question);
  if (typeof q.header === "string") textsToCheck.push(q.header);
  if (typeof q.title === "string") {
    textsToCheck.push(q.title);
  }
  if (typeof q.description === "string") {
    textsToCheck.push(q.description);
  }
  if (Array.isArray(q.options)) {
    for (const opt of q.options) {
      if (!opt) continue;
      if (typeof opt.label === "string") textsToCheck.push(opt.label);
      if (typeof opt.description === "string") textsToCheck.push(opt.description);
      if (typeof opt.value === "string") textsToCheck.push(opt.value);
    }
  }
  for (const text of textsToCheck) {
    const normalized = text.normalize("NFC");
    for (const marker of manualMarkers) {
      const normMarker = marker.normalize("NFC");
      if (normalized.includes(normMarker)) {
        return { isManual: true, matchedMarker: marker };
      }
    }
    if (/\[SQ_DECISION:(?:v1\][\s\S]*?mode=)?manual/iu.test(normalized)) {
      return { isManual: true, matchedMarker: "[SQ:manual]" };
    }
  }
  if (Array.isArray(manualOnPatterns) && manualOnPatterns.length > 0) {
    for (const text of textsToCheck) {
      const lower = text.normalize("NFC").toLowerCase();
      for (const pattern of manualOnPatterns) {
        if (typeof pattern !== "string" || !pattern.trim()) continue;
        const normPattern = pattern.trim().normalize("NFC").toLowerCase();
        if (lower.includes(normPattern)) {
          return { isManual: true, matchedMarker: pattern.trim() };
        }
      }
    }
  }
  return { isManual: false };
}
function matchOptionRecommendation(opt, recMarkers, allowCommonFallback = true) {
  if (!opt || typeof opt.label !== "string") return void 0;
  const label = opt.label.trim();
  const normalizedLabel = label.normalize("NFC");
  const desc = typeof opt.description === "string" ? opt.description.trim().normalize("NFC") : "";
  for (const marker of recMarkers) {
    const normM = marker.normalize("NFC");
    if (normalizedLabel.endsWith(normM)) {
      return { opt, marker };
    }
  }
  for (const marker of recMarkers) {
    const normM = marker.normalize("NFC");
    if (normalizedLabel.startsWith(normM)) {
      return { opt, marker };
    }
  }
  const lowerLabel = normalizedLabel.toLowerCase();
  for (const marker of recMarkers) {
    const lowerM = marker.normalize("NFC").toLowerCase();
    if (lowerLabel.endsWith(lowerM) || lowerLabel.startsWith(lowerM)) {
      return { opt, marker };
    }
  }
  for (const marker of recMarkers) {
    const normM = marker.normalize("NFC");
    if (desc.startsWith(normM) || desc.toLowerCase().includes(marker.toLowerCase())) {
      return { opt, marker };
    }
  }
  if (allowCommonFallback) {
    const commonMarkers = ["(recommended)", "[recommended]", "(\xF6nerilen)", "[\xF6nerilen]", "[sq:recommended]"];
    for (const cm of commonMarkers) {
      if (lowerLabel.includes(cm) || desc.toLowerCase().includes(cm)) {
        return { opt, marker: recMarkers[0] ?? "[SQ:recommended]" };
      }
    }
  }
  return void 0;
}
function classifyQuestions(questions, recommendedMarker = DEFAULT_CONFIG.recommendedMarkers, manualMarker = DEFAULT_MANUAL_MARKERS, handoff, options = {}) {
  void options;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { status: "unclassified", reason: "No questions provided in request" };
  }
  if (handoff && typeof handoff === "object" && "autoSelect" in handoff && handoff.autoSelect === "forbidden" && !options.allowFallbackOnManual) {
    return {
      status: "manual",
      reason: "Guardian handoff explicitly forbids auto-selection (auto_select=forbidden)",
      matchedMarker: "[OPENCODE_HANDOFF:auto_select=forbidden]"
    };
  }
  const recMarkers = normalizeParamMarkers(recommendedMarker);
  const manMarkers = normalizeParamMarkers(manualMarker);
  const allowCommonFallback = recMarkers.length === DEFAULT_CONFIG.recommendedMarkers.length && recMarkers.every((m, idx) => m === DEFAULT_CONFIG.recommendedMarkers[idx]);
  const answers = [];
  const recommendedOptions = [];
  let matchedMarker;
  let firstManual = null;
  let firstUnclassified = null;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qIndex = i + 1;
    if (!q) {
      if (!firstUnclassified) {
        firstUnclassified = { index: qIndex, reason: `Question ${qIndex} is null or undefined` };
      }
      continue;
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      if (!firstUnclassified) {
        firstUnclassified = { index: qIndex, reason: `Question ${qIndex} has no options` };
      }
      continue;
    }
    const manualCheck = isQuestionExplicitlyManual(
      q,
      manMarkers,
      options.manualOnPatterns ?? DEFAULT_MANUAL_ON_PATTERNS
    );
    if (manualCheck.isManual && !options.allowFallbackOnManual) {
      if (!firstManual) {
        firstManual = { index: qIndex, marker: manualCheck.matchedMarker };
      }
      continue;
    }
    let matched = q.options.map((opt) => matchOptionRecommendation(opt, recMarkers, allowCommonFallback)).filter((x) => Boolean(x));
    if (matched.length === 0 && options.allowFallback && Array.isArray(q.options) && q.options.length > 0) {
      const defaultOpt = q.options[0];
      if (defaultOpt && typeof defaultOpt.label === "string") {
        matched = [{ opt: defaultOpt, marker: recMarkers[0] ?? "[SQ:recommended]" }];
      }
    }
    if (matched.length === 0) {
      if (!firstUnclassified) {
        firstUnclassified = {
          index: qIndex,
          reason: `Question ${qIndex} has no recommendation marker`
        };
      }
      continue;
    }
    if (!q.multiple && matched.length > 1) {
      if (options.allowFallback) {
        matched = [matched[0]];
      } else {
        if (!firstUnclassified) {
          firstUnclassified = {
            index: qIndex,
            reason: `Question ${qIndex} has ambiguous recommendation markers (${matched.length})`
          };
        }
        continue;
      }
    }
    const firstMatch = matched[0];
    if (!firstMatch) {
      if (!firstUnclassified) {
        firstUnclassified = {
          index: qIndex,
          reason: `Question ${qIndex} has no usable recommendation option`
        };
      }
      continue;
    }
    if (!matchedMarker) {
      matchedMarker = firstMatch.marker;
    }
    if (q.multiple) {
      answers.push(matched.map((m) => m.opt.label));
      recommendedOptions.push(...matched.map((m) => m.opt));
    } else {
      answers.push([firstMatch.opt.label]);
      recommendedOptions.push(firstMatch.opt);
    }
  }
  if (firstManual) {
    return {
      status: "manual",
      reason: `Question ${firstManual.index} is explicitly classified as requiring manual human decision`,
      matchedMarker: firstManual.marker
    };
  }
  if (firstUnclassified) {
    return {
      status: "unclassified",
      reason: firstUnclassified.reason
    };
  }
  return {
    status: "auto",
    answers,
    recommendedOptions,
    matchedMarker
  };
}
function computeQuestionFingerprint(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "empty";
  const normalized = questions.map((q) => ({
    header: typeof q?.header === "string" ? q.header.trim().toLowerCase().normalize("NFC") : "",
    question: typeof q?.question === "string" ? q.question.trim().toLowerCase().normalize("NFC") : "",
    multiple: q?.multiple === true,
    // Preserve option order because fallback-first semantics depend on it.
    options: Array.isArray(q?.options) ? q.options.map((option) => ({
      label: typeof option === "string" ? option.trim().toLowerCase().normalize("NFC") : typeof option?.label === "string" ? option.label.trim().toLowerCase().normalize("NFC") : "",
      value: option && typeof option === "object" && typeof option.value === "string" ? option.value.trim().normalize("NFC") : ""
    })) : []
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 24);
}

// src/draft-guard.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { randomUUID } from "node:crypto";
function resolveLockPath(configDir, requestID) {
  const opencodeDir = typeof configDir === "string" && configDir || path2.resolve(process.cwd(), ".opencode");
  const safeRequestID = encodeURIComponent(typeof requestID === "string" ? requestID : "unknown");
  return path2.join(opencodeDir, `.sq-draft-${safeRequestID}`);
}
function canUseDraftCoordination(configDir, dbg) {
  const opencodeDir = typeof configDir === "string" && configDir || path2.resolve(process.cwd(), ".opencode");
  const probePath = path2.join(opencodeDir, `.sq-draft-probe-${randomUUID()}`);
  try {
    fs2.mkdirSync(opencodeDir, { recursive: true });
    fs2.writeFileSync(probePath, "", { encoding: "utf8", flag: "wx", mode: 384 });
    fs2.unlinkSync(probePath);
    return true;
  } catch (error) {
    try {
      fs2.unlinkSync(probePath);
    } catch {
    }
    dbg?.(`draft coordination unavailable code=${diagnosticErrorCode(error)}`);
    return false;
  }
}
function deleteLockfile(lockPath, dbg) {
  try {
    if (typeof lockPath === "string" && fs2.existsSync(lockPath)) {
      fs2.unlinkSync(lockPath);
      dbg?.(`deleted lockfile file=${path2.basename(lockPath)}`);
    }
  } catch (err) {
    const errCode = err?.code;
    if (errCode !== "ENOENT") {
      dbg?.(`failed to delete lockfile file=${typeof lockPath === "string" ? path2.basename(lockPath) : "unknown"} code=${diagnosticErrorCode(err)}`);
    }
  }
}
function cleanupStaleDrafts(configDir, timeoutMs, dbg) {
  try {
    const opencodeDir = typeof configDir === "string" && configDir || path2.resolve(process.cwd(), ".opencode");
    if (!fs2.existsSync(opencodeDir)) {
      return;
    }
    const effectiveTimeout = typeof timeoutMs === "number" && timeoutMs >= 0 ? timeoutMs : DEFAULT_CONFIG.timeoutMs;
    const staleThresholdMs = Math.max(
      effectiveTimeout * 4,
      DEFAULT_CONFIG.timeoutMs * 4
    );
    const now = Date.now();
    const entries = fs2.readdirSync(opencodeDir);
    for (const entry of entries) {
      if (!entry.startsWith(".sq-draft-")) {
        continue;
      }
      const fullPath = path2.join(opencodeDir, entry);
      try {
        const stat = fs2.statSync(fullPath);
        if (!stat.isFile()) {
          continue;
        }
        const ageMs = now - stat.mtimeMs;
        if (ageMs > staleThresholdMs) {
          fs2.unlinkSync(fullPath);
          dbg?.(
            `cleanupStaleDrafts: deleted stale draft ${entry} (age=${Math.round(ageMs)}ms > threshold=${staleThresholdMs}ms)`
          );
        }
      } catch (fileErr) {
        dbg?.(
          `cleanupStaleDrafts: error processing ${entry} code=${diagnosticErrorCode(fileErr)}`
        );
      }
    }
  } catch (err) {
    dbg?.(`cleanupStaleDrafts: unexpected error code=${diagnosticErrorCode(err)}`);
  }
}

// src/form-adapter.ts
function prepareV2FormFields(fields) {
  const questions = [];
  const selectableFields = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    if (!field) {
      return { ok: false, reason: `Form field ${i + 1} is missing`, questions };
    }
    if (field.hidden === true || field.when !== void 0 && (!Array.isArray(field.when) || field.when.length > 0)) {
      return {
        ok: false,
        reason: `Form field ${i + 1} (${field.key ?? "unknown"}) is hidden or conditional`,
        questions
      };
    }
    const isStringChoice = field.type === "string" && Array.isArray(field.options) && field.options.length > 0;
    const isMultiChoice = field.type === "multiselect" && Array.isArray(field.options) && field.options.length > 0;
    if (!isStringChoice && !isMultiChoice) {
      return {
        ok: false,
        reason: `Form field ${i + 1} (${field.key ?? "unknown"}) is not a supported selectable field`,
        questions
      };
    }
    if (typeof field.key !== "string" || !field.key || seenKeys.has(field.key)) {
      return { ok: false, reason: `Form field ${i + 1} has a missing or duplicate key`, questions };
    }
    seenKeys.add(field.key);
    if (isMultiChoice) {
      const constraints = [field.minItems, field.maxItems].filter(
        (value) => value !== void 0
      );
      if (constraints.some((value) => !Number.isInteger(value) || value < 0) || field.minItems !== void 0 && field.maxItems !== void 0 && field.minItems > field.maxItems) {
        return {
          ok: false,
          reason: `Form field ${i + 1} has invalid multiselect item constraints`,
          questions
        };
      }
    }
    const fieldOptions = field.options;
    if (fieldOptions.some(
      (option) => !option || typeof option.value !== "string" || typeof option.label !== "string"
    )) {
      return {
        ok: false,
        reason: `Form field ${i + 1} contains an invalid option`,
        questions
      };
    }
    const mappedOptions = fieldOptions.map((option) => ({
      label: option.label,
      value: option.value,
      ...typeof option.description === "string" ? { description: option.description } : {}
    }));
    questions.push({
      question: field.description ?? field.title ?? field.key,
      header: field.title ?? field.key,
      key: field.key,
      options: mappedOptions,
      multiple: isMultiChoice
    });
    selectableFields.push({
      key: field.key,
      multiple: isMultiChoice,
      options: fieldOptions,
      ...isMultiChoice && field.minItems !== void 0 ? { minItems: field.minItems } : {},
      ...isMultiChoice && field.maxItems !== void 0 ? { maxItems: field.maxItems } : {}
    });
  }
  return { ok: true, questions, selectableFields };
}
function classifyV2Form(form, markers = DEFAULT_CONFIG.recommendedMarkers, manualMarkers = DEFAULT_MANUAL_MARKERS, handoff, options) {
  if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
    if (options?.unsupportedFieldPolicy === "manual") {
      return {
        status: "manual",
        reason: "Form has no fields",
        questions: [],
        matchedMarker: "[SQ:unsupported]"
      };
    }
    return { status: "unclassified", reason: "Form has no fields", questions: [], unsupported: true };
  }
  const manMarkers = normalizeParamMarkers(manualMarkers);
  const manualPatterns = options?.manualOnPatterns ?? DEFAULT_MANUAL_ON_PATTERNS;
  const formTexts = [];
  if (typeof form.title === "string") formTexts.push(form.title);
  if (typeof form.description === "string") formTexts.push(form.description);
  if (form.metadata && typeof form.metadata === "object") {
    const metaMessage = form.metadata.message;
    const metaDescription = form.metadata.description;
    if (typeof metaMessage === "string") formTexts.push(metaMessage);
    if (typeof metaDescription === "string") formTexts.push(metaDescription);
  }
  let formExplicitlyManual = false;
  let matchedManualMarker;
  for (const text of formTexts) {
    const normalized = text.normalize("NFC");
    for (const marker of manMarkers) {
      if (normalized.includes(marker.normalize("NFC"))) {
        formExplicitlyManual = true;
        matchedManualMarker = marker;
        break;
      }
    }
    if (formExplicitlyManual) break;
    if (/\[SQ_DECISION:(?:v1\][\s\S]*?mode=)?manual/iu.test(normalized)) {
      formExplicitlyManual = true;
      matchedManualMarker = "[SQ:manual]";
      break;
    }
    if (Array.isArray(manualPatterns) && manualPatterns.length > 0) {
      const lower = normalized.toLowerCase();
      for (const pattern of manualPatterns) {
        if (typeof pattern !== "string" || !pattern.trim()) continue;
        if (lower.includes(pattern.trim().normalize("NFC").toLowerCase())) {
          formExplicitlyManual = true;
          matchedManualMarker = pattern.trim();
          break;
        }
      }
    }
    if (formExplicitlyManual) break;
  }
  const prepared = prepareV2FormFields(form.fields);
  if (!prepared.ok) {
    if (options?.unsupportedFieldPolicy === "manual") {
      return {
        status: "manual",
        reason: prepared.reason,
        questions: prepared.questions,
        matchedMarker: "[SQ:unsupported]"
      };
    }
    return {
      status: "unclassified",
      reason: prepared.reason,
      questions: prepared.questions,
      unsupported: true
    };
  }
  const { questions, selectableFields } = prepared;
  if (formExplicitlyManual && !options?.allowFallbackOnManual) {
    return {
      status: "manual",
      reason: "Form title or description is explicitly classified as manual",
      questions,
      matchedMarker: matchedManualMarker
    };
  }
  const classification = classifyQuestions(questions, markers, manualMarkers, handoff, options);
  if (classification.status === "manual") {
    return {
      status: "manual",
      reason: classification.reason,
      questions,
      matchedMarker: classification.matchedMarker
    };
  }
  if (classification.status === "unclassified") {
    return {
      status: "unclassified",
      reason: classification.reason,
      questions
    };
  }
  const answer = {};
  for (let i = 0; i < selectableFields.length; i++) {
    const field = selectableFields[i];
    if (!field) {
      return { status: "unclassified", reason: `Missing normalized field ${i + 1}`, questions };
    }
    const selectedLabels = classification.answers[i] ?? [];
    const selectedValues = selectedLabels.map((label) => {
      const matchingOptions = field.options.filter((candidate) => candidate.label === label);
      return matchingOptions.length === 1 ? matchingOptions[0]?.value : void 0;
    });
    if (selectedValues.length !== selectedLabels.length || selectedValues.some((value) => typeof value !== "string")) {
      return {
        status: "unclassified",
        reason: `Could not map recommended labels to values for field ${field.key}`,
        questions
      };
    }
    if (field.multiple) {
      if (field.minItems !== void 0 && selectedValues.length < field.minItems) {
        return {
          status: "unclassified",
          reason: `Recommended selections for field ${field.key} do not satisfy minItems`,
          questions
        };
      }
      if (field.maxItems !== void 0 && selectedValues.length > field.maxItems) {
        return {
          status: "unclassified",
          reason: `Recommended selections for field ${field.key} exceed maxItems`,
          questions
        };
      }
      Object.defineProperty(answer, field.key, { value: selectedValues, enumerable: true, writable: true, configurable: true });
    } else {
      const value = selectedValues[0];
      if (typeof value !== "string") {
        return {
          status: "unclassified",
          reason: `Missing recommendation value for field ${field.key}`,
          questions
        };
      }
      Object.defineProperty(answer, field.key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return {
    status: "auto",
    answer,
    detection: {
      ok: true,
      answers: classification.answers,
      recommendedOptions: classification.recommendedOptions,
      matchedMarker: classification.matchedMarker
    },
    questions
  };
}

// src/backend.ts
var SQ_REMEDIATION_HEADER = "[Smart Questions protocol remediation]";
function buildUnclassifiedRemediationPrompt(primaryMarker = "[SQ:recommended]", manualMarker = "[SQ:manual]") {
  const recMarker = typeof primaryMarker === "string" && primaryMarker ? primaryMarker : "[SQ:recommended]";
  return [
    SQ_REMEDIATION_HEADER,
    "",
    "This selectable question is unclassified.",
    "",
    "Do not leave a root-agent selectable question waiting indefinitely.",
    "",
    "Either:",
    "",
    "1. mark the safest/recommended option with the canonical",
    `   ${recMarker}`,
    "   token so Smart Questions can continue automatically,",
    "",
    "or",
    "",
    "2. explicitly classify the question as manual approval using",
    `   the Smart Questions manual-decision protocol (${manualMarker}) when human`,
    "   approval is genuinely required.",
    "",
    "Do not ask the same unclassified question again."
  ].join("\n");
}

// src/session-scope.ts
function isAutomationSessionID(sessionID) {
  return typeof sessionID === "string" && /^ses_aut_/i.test(sessionID.trim());
}
function asRecord(value) {
  return value && typeof value === "object" ? value : null;
}
function unwrapSessionInfo(value) {
  const record = asRecord(value);
  if (!record) return null;
  const data = asRecord(record.data);
  if (data) return data;
  const info = asRecord(record.info);
  if (info) return info;
  return record;
}
function classifySessionScope(value) {
  const session = unwrapSessionInfo(value);
  const id = session?.id ?? session?.sessionID;
  if (!session || typeof id !== "string" || !id) {
    return "unknown";
  }
  if (isAutomationSessionID(id)) {
    return "automation";
  }
  const parentID = session.parentID ?? session.parentId;
  if (typeof parentID === "string") {
    return parentID.trim() ? "child" : "root";
  }
  if (parentID === void 0 || parentID === null) {
    return "root";
  }
  return "unknown";
}
function isEligibleSessionScope(scope, includeSubagents = false) {
  if (scope === "root") return true;
  if (includeSubagents && scope === "child") return true;
  return false;
}
function isEligibleSessionInfo(value, includeSubagents = false) {
  return isEligibleSessionScope(classifySessionScope(value), includeSubagents);
}

// src/bridge.ts
import { createHash as createHash2, randomUUID as randomUUID2 } from "node:crypto";
import { types } from "node:util";
var MESH_VERSION = 2;
var MESH_SYMBOL = Symbol.for("opencode.mesh.v2");
var LEGACY_COORDINATION_SYMBOL = Symbol.for("opencode.coordination.v1");
var LEGACY_HANDOFF_STATE_SYMBOL = Symbol.for("opencode.handoff.state.v1");
var MESH_METADATA_KEY = "opencode-mesh";
var MESH_REMEDIATION_MARKER = "[opencode-mesh remediation]";
var MESH_STATE_RPC_ID = "opencode-mesh.state";
var CLOSED_HANDOFF_TTL_MS = 10 * 6e4;
var MAX_BOUNDED_SESSIONS = 512;
var MAX_TOKENS_PER_SESSION = 128;
var MESH_STATE_RPC_DEFINITION = {
  id: MESH_STATE_RPC_ID,
  methods: {
    sessionState: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: 256 }
        },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: {
          waitingOnUser: { type: "boolean" },
          remediating: { type: "boolean" },
          blockingOwner: { type: "string" },
          blockingKind: { type: "string" },
          activeHandoffId: { type: "string" }
        },
        required: ["waitingOnUser", "remediating"],
        additionalProperties: false
      }
    },
    setInteractionLease: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string", minLength: 1, maxLength: 256 },
          owner: { type: "string", minLength: 1, maxLength: 128 },
          active: { type: "boolean" },
          ttlMs: { type: "number" },
          reason: { type: "string", maxLength: 256 }
        },
        required: ["sessionID", "owner", "active"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: {
          ok: { type: "boolean" }
        },
        required: ["ok"],
        additionalProperties: false
      }
    }
  },
  events: {
    updated: {
      schema: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          kind: { type: "string" }
        },
        required: ["sessionID", "kind"],
        additionalProperties: false
      }
    }
  }
};
var LEASE_PRIORITY = {
  user_interaction: 30,
  active_remediation: 20,
  orchestration_dispatch: 10
};
var DEFAULT_LEASE_TTL_MS = {
  user_interaction: 12e4,
  active_remediation: 45e3,
  orchestration_dispatch: 15e3
};
function isRecord(value) {
  return Boolean(
    value && typeof value === "object" && !Array.isArray(value) && !types.isProxy(value)
  );
}
function ownData(obj, key) {
  if (!isRecord(obj)) return void 0;
  const desc = Object.getOwnPropertyDescriptor(obj, key);
  return desc && "value" in desc ? desc.value : void 0;
}
function setBoundedMap(map, key, value, max = MAX_BOUNDED_SESSIONS) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === void 0) break;
    map.delete(oldest);
  }
}
function getMeshState() {
  const g = globalThis;
  let state = g[MESH_SYMBOL];
  if (!state || typeof state !== "object") {
    state = {
      version: MESH_VERSION,
      peersByKey: /* @__PURE__ */ new Map(),
      provenanceBySession: /* @__PURE__ */ new Map(),
      leasesBySession: /* @__PURE__ */ new Map(),
      interventionsBySession: /* @__PURE__ */ new Map(),
      roleResolversByKey: /* @__PURE__ */ new Map(),
      skillProvidersByKey: /* @__PURE__ */ new Map(),
      promptSkillClaims: /* @__PURE__ */ new Map(),
      rpcHostsByDir: /* @__PURE__ */ new Map(),
      remoteInteractionLeases: /* @__PURE__ */ new Map()
    };
    g[MESH_SYMBOL] = state;
  }
  if (typeof state.version !== "number" || state.version < MESH_VERSION) {
    state.version = MESH_VERSION;
  }
  if (!(state.peersByKey instanceof Map)) state.peersByKey = /* @__PURE__ */ new Map();
  if (!(state.provenanceBySession instanceof Map)) state.provenanceBySession = /* @__PURE__ */ new Map();
  if (!(state.leasesBySession instanceof Map)) state.leasesBySession = /* @__PURE__ */ new Map();
  if (!(state.interventionsBySession instanceof Map)) state.interventionsBySession = /* @__PURE__ */ new Map();
  if (!(state.roleResolversByKey instanceof Map)) state.roleResolversByKey = /* @__PURE__ */ new Map();
  if (!(state.skillProvidersByKey instanceof Map)) state.skillProvidersByKey = /* @__PURE__ */ new Map();
  if (!(state.promptSkillClaims instanceof Map)) state.promptSkillClaims = /* @__PURE__ */ new Map();
  if (!(state.rpcHostsByDir instanceof Map)) state.rpcHostsByDir = /* @__PURE__ */ new Map();
  if (!(state.remoteInteractionLeases instanceof Map)) state.remoteInteractionLeases = /* @__PURE__ */ new Map();
  return state;
}
function getLegacyHandoffState() {
  const g = globalThis;
  let state = g[LEGACY_HANDOFF_STATE_SYMBOL];
  if (!state || typeof state !== "object") {
    state = {
      activeHandoffsBySession: /* @__PURE__ */ new Map(),
      closedHandoffIds: /* @__PURE__ */ new Map()
    };
    g[LEGACY_HANDOFF_STATE_SYMBOL] = state;
  }
  if (!(state.activeHandoffsBySession instanceof Map)) {
    state.activeHandoffsBySession = /* @__PURE__ */ new Map();
  }
  if (!(state.closedHandoffIds instanceof Map)) {
    state.closedHandoffIds = /* @__PURE__ */ new Map();
  }
  if (state.consumedHandoffIds instanceof Set && state.consumedHandoffIds.size > 0) {
    const now = Date.now();
    for (const id of state.consumedHandoffIds) {
      state.closedHandoffIds.set(id, now);
    }
    state.consumedHandoffIds.clear();
  }
  return state;
}
var SYNTHETIC_MESH_KINDS = [
  "remediation",
  "visible",
  "handoff",
  "wake",
  "delegation"
];
function stampMeshMetadata(sessionID, options, base = {}) {
  const state = getMeshState();
  const token = randomUUID2();
  const sID = String(sessionID || "global");
  const isSynthetic = options.synthetic ?? (options.kind === "remediation" || options.kind === "visible" || options.kind === "handoff" || options.kind === "wake" || options.kind === "delegation");
  let sessionTokens = state.provenanceBySession.get(sID);
  if (!sessionTokens) {
    sessionTokens = /* @__PURE__ */ new Map();
    setBoundedMap(state.provenanceBySession, sID, sessionTokens, MAX_BOUNDED_SESSIONS);
  } else {
    setBoundedMap(state.provenanceBySession, sID, sessionTokens, MAX_BOUNDED_SESSIONS);
  }
  setBoundedMap(
    sessionTokens,
    token,
    { owner: options.owner, kind: options.kind, synthetic: isSynthetic, createdAt: Date.now() },
    MAX_TOKENS_PER_SESSION
  );
  const isProtected = options.protected ?? (options.kind === "remediation" || options.kind === "handoff" || options.kind === "task-contract" || options.kind === "skill-injection");
  const envelope = {
    v: 2,
    owner: options.owner,
    kind: options.kind,
    token,
    ...options.synthetic === false ? { synthetic: false } : isSynthetic ? { synthetic: true } : {},
    ...isProtected ? { protected: true } : {},
    ...options.sanitizedBy?.length ? { sanitizedBy: [...options.sanitizedBy] } : {},
    ...options.boundedBy ? { boundedBy: options.boundedBy } : {},
    ...options.taskID ? { taskID: options.taskID } : {},
    ...options.requiredSkills?.length ? { requiredSkills: [...options.requiredSkills] } : {}
  };
  const out = {
    ...base,
    [MESH_METADATA_KEY]: envelope
  };
  if (isSynthetic) {
    out.synthetic = true;
  }
  if (options.owner === "opencode-guardian" || options.legacyGuardian) {
    out["opencode-guardian"] = true;
    out["opencode-guardian-provenance"] = token;
    out["opencode-guardian-kind"] = options.kind === "visible" ? "visible" : "remediation";
  }
  if (options.owner === "opencode-smart-questions") {
    out["opencode-smart-questions"] = true;
  }
  if (options.owner === "opencode-hi") {
    out["opencode-hi"] = true;
  }
  if (options.requiredSkills?.length || options.taskID) {
    const existingLazy = isRecord(base.lazySkill) ? base.lazySkill : {};
    out.lazySkill = {
      ...existingLazy,
      ...options.taskID ? { taskId: options.taskID } : {},
      ...options.requiredSkills?.length ? { requiredSkills: [...options.requiredSkills] } : {}
    };
  }
  return out;
}
function extractMetadataRecord(value) {
  if (!isRecord(value)) return void 0;
  const meta = ownData(value, "metadata");
  if (isRecord(meta) && Object.keys(meta).length > 0) return meta;
  const prompt = ownData(value, "prompt");
  const promptMeta = ownData(prompt, "metadata");
  if (isRecord(promptMeta) && Object.keys(promptMeta).length > 0) {
    return promptMeta;
  }
  const info = ownData(value, "info");
  const infoMeta = ownData(info, "metadata");
  if (isRecord(infoMeta) && Object.keys(infoMeta).length > 0) {
    return infoMeta;
  }
  const payload = ownData(value, "payload");
  const payloadMeta = ownData(payload, "metadata");
  if (isRecord(payloadMeta) && Object.keys(payloadMeta).length > 0) {
    return payloadMeta;
  }
  const state = ownData(value, "state");
  const stateMeta = ownData(state, "metadata");
  if (isRecord(stateMeta) && Object.keys(stateMeta).length > 0) {
    return stateMeta;
  }
  if (isRecord(meta)) return meta;
  if (isRecord(promptMeta)) return promptMeta;
  if (isRecord(infoMeta)) return infoMeta;
  if (isRecord(payloadMeta)) return payloadMeta;
  if (isRecord(stateMeta)) return stateMeta;
  if (isRecord(ownData(value, MESH_METADATA_KEY)) || ownData(value, "opencode-guardian") === true || ownData(value, "opencode-smart-questions") === true || ownData(value, "opencode-hi") === true || typeof ownData(value, "hi-internal") === "string" || typeof ownData(value, "hi-message") === "string") {
    return value;
  }
  return void 0;
}
function verifyMeshMetadata(sessionID, valueOrMetadata, expectedKind, expectedOwner) {
  if (!sessionID) return false;
  const meta = extractMetadataRecord(valueOrMetadata);
  if (!meta) return false;
  const state = getMeshState();
  const sessionTokens = state.provenanceBySession.get(sessionID);
  const globalTokens = sessionID !== "global" ? state.provenanceBySession.get("global") : void 0;
  if (!sessionTokens && !globalTokens) return false;
  const meshEnv = isRecord(meta[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : void 0;
  const primaryToken = typeof meshEnv?.token === "string" ? meshEnv.token : void 0;
  const legacyToken = typeof meta["opencode-guardian-provenance"] === "string" ? meta["opencode-guardian-provenance"] : void 0;
  if (!primaryToken && !legacyToken) return false;
  const record = (primaryToken ? sessionTokens?.get(primaryToken) ?? globalTokens?.get(primaryToken) : void 0) ?? (legacyToken ? sessionTokens?.get(legacyToken) ?? globalTokens?.get(legacyToken) : void 0);
  if (!record) return false;
  if (meshEnv) {
    if (typeof meshEnv.owner === "string" && meshEnv.owner !== record.owner) return false;
    if (typeof meshEnv.kind === "string" && meshEnv.kind !== record.kind) return false;
  }
  if (expectedOwner && record.owner !== expectedOwner) return false;
  if (expectedKind) {
    const allowed = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
    if (!allowed.includes(record.kind)) return false;
  }
  return true;
}
function isTrustedMeshMessage(value, sessionID, expectedKind) {
  if (!isRecord(value)) return false;
  const effectiveExpectedKind = expectedKind ?? SYNTHETIC_MESH_KINDS;
  const meta = extractMetadataRecord(value);
  const meshEnv = isRecord(meta?.[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : void 0;
  if (sessionID && verifyMeshMetadata(sessionID, value, effectiveExpectedKind)) {
    if (expectedKind === void 0 && meshEnv?.synthetic === false) {
      return false;
    }
    return true;
  }
  const isHostSynthetic = value.type === "synthetic" || value.synthetic === true || value.ignored === true || meta?.synthetic === true || meta?.internal === true || meta?.autoContinue === true || typeof meta?.["hi-internal"] === "string" || typeof meta?.["hi-message"] === "string";
  if (meshEnv && typeof meshEnv.token === "string" && meshEnv.token.length > 0 && isHostSynthetic && (expectedKind !== void 0 || meshEnv.synthetic !== false)) {
    const allowed = Array.isArray(effectiveExpectedKind) ? effectiveExpectedKind : [effectiveExpectedKind];
    if (typeof meshEnv.kind !== "string" || !allowed.includes(meshEnv.kind)) {
      return false;
    }
    return true;
  }
  if (isHostSynthetic && (meta?.["opencode-guardian"] === true || meta?.["opencode-smart-questions"] === true || meta?.["opencode-hi"] === true || isRecord(meta?.hi))) {
    return true;
  }
  const parts = Array.isArray(value.parts) ? value.parts : Array.isArray(value.content) ? value.content : void 0;
  if (parts?.some((part) => isTrustedMeshMessage(part, sessionID, expectedKind))) {
    return true;
  }
  if (isRecord(value.prompt) && isTrustedMeshMessage(value.prompt, sessionID, expectedKind)) {
    return true;
  }
  if (isRecord(value.message)) {
    return isTrustedMeshMessage(value.message, sessionID, expectedKind);
  }
  return false;
}
function forgetMeshSession(sessionID) {
  if (!sessionID) return;
  const state = getMeshState();
  state.provenanceBySession.delete(sessionID);
  state.leasesBySession.delete(sessionID);
  state.interventionsBySession.delete(sessionID);
  for (const key of state.promptSkillClaims.keys()) {
    if (key.startsWith(`${sessionID}::`)) {
      state.promptSkillClaims.delete(key);
    }
  }
  for (const [key, release] of state.remoteInteractionLeases) {
    if (key.includes(`::${sessionID}::`)) {
      state.remoteInteractionLeases.delete(key);
      try {
        release();
      } catch {
      }
    }
  }
  clearActiveMeshHandoff(sessionID);
  for (const peer of state.peersByKey.values()) {
    if (peer.count <= 0 || !(peer.onSessionForgets instanceof Set)) continue;
    for (const cb of peer.onSessionForgets) {
      try {
        cb(sessionID);
      } catch {
      }
    }
  }
}
function pruneExpiredLeases(state, sessionID, now = Date.now()) {
  const leases = state.leasesBySession.get(sessionID);
  if (!leases) return void 0;
  for (const [key, lease] of leases) {
    if (lease.expiresAt <= now) {
      leases.delete(key);
    }
  }
  if (leases.size === 0) {
    state.leasesBySession.delete(sessionID);
    return void 0;
  }
  return leases;
}
function acquireSessionLease(input) {
  const sID = String(input.sessionID ?? "");
  if (!sID) return () => {
  };
  const state = getMeshState();
  const now = Date.now();
  const ttl = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : DEFAULT_LEASE_TTL_MS[input.kind];
  let leases = pruneExpiredLeases(state, sID, now);
  if (!leases) {
    leases = /* @__PURE__ */ new Map();
    setBoundedMap(state.leasesBySession, sID, leases, MAX_BOUNDED_SESSIONS);
  }
  const key = `${input.owner}::${input.kind}`;
  const lease = {
    sessionID: sID,
    owner: input.owner,
    kind: input.kind,
    priority: LEASE_PRIORITY[input.kind],
    acquiredAt: now,
    expiresAt: now + ttl,
    ...input.reason ? { reason: input.reason } : {}
  };
  leases.set(key, lease);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = state.leasesBySession.get(sID);
    if (!current) return;
    if (current.get(key) === lease) {
      current.delete(key);
    }
    if (current.size === 0) {
      state.leasesBySession.delete(sID);
    }
  };
}
function clearActiveMeshHandoff(sessionID) {
  const sID = String(sessionID ?? "");
  if (!sID) return;
  getLegacyHandoffState().activeHandoffsBySession.delete(sID);
}
async function callMeshRpc(input) {
  if (typeof input.rpcGetter !== "function") return void 0;
  const timeoutMs = input.timeoutMs ?? 1200;
  let timer;
  try {
    const client = input.rpcGetter(input.contract);
    const fn = client?.[input.method];
    if (typeof fn !== "function") return void 0;
    const callOptions = {};
    if (input.directory) callOptions.location = { directory: input.directory };
    if (input.signal) callOptions.signal = input.signal;
    const result = await Promise.race([
      Promise.resolve().then(
        () => fn(input.payload, callOptions)
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(void 0), timeoutMs);
      })
    ]);
    return result;
  } catch {
    return void 0;
  } finally {
    if (timer !== void 0) clearTimeout(timer);
  }
}

// src/handoff.ts
var OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
var GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
var GUARDIAN_PROVENANCE_KEY = "opencode-guardian";
var GUARDIAN_PROVENANCE_TOKEN_KEY = "opencode-guardian-provenance";
var GUARDIAN_KIND_KEY = "opencode-guardian-kind";
var DEFAULT_HANDOFF_TTL_MS = 12e4;
var CLOSED_HANDOFF_TTL_MS2 = 10 * 6e4;
var MAX_CLOSED_HANDOFF_IDS = 512;
var MAX_ACTIVE_HANDOFFS = 512;
var COORDINATION_SYMBOL = Symbol.for("opencode.coordination.v1");
function isRecord2(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function guardianMetadata(value) {
  if (!isRecord2(value)) return void 0;
  const direct = isRecord2(value.metadata) ? value.metadata : void 0;
  const payloadMeta = isRecord2(value.payload) && isRecord2(value.payload.metadata) ? value.payload.metadata : void 0;
  const infoMeta = isRecord2(value.info) && isRecord2(value.info.metadata) ? value.info.metadata : void 0;
  const promptMeta = isRecord2(value.prompt) && isRecord2(value.prompt.metadata) ? value.prompt.metadata : void 0;
  const stateMeta = isRecord2(value.state) && isRecord2(value.state.metadata) ? value.state.metadata : void 0;
  if (direct || payloadMeta || infoMeta || promptMeta || stateMeta) {
    return {
      ...stateMeta,
      ...promptMeta,
      ...infoMeta,
      ...payloadMeta,
      ...direct
    };
  }
  if (isRecord2(value["opencode-mesh"]) || value[GUARDIAN_PROVENANCE_KEY] === true || value["opencode-smart-questions"] === true || value["opencode-hi"] === true || typeof value["hi-internal"] === "string" || typeof value["hi-message"] === "string") {
    return value;
  }
  return void 0;
}
function hasGuardianMetadata(value, expectedKind) {
  const metadata = guardianMetadata(value);
  if (metadata?.[GUARDIAN_PROVENANCE_KEY] !== true) return false;
  const token = metadata[GUARDIAN_PROVENANCE_TOKEN_KEY];
  const kind = metadata[GUARDIAN_KIND_KEY];
  if (token !== void 0 || kind !== void 0) {
    if (typeof token !== "string" || token.length === 0) return false;
    if (kind !== "remediation" && kind !== "visible") return false;
    if (expectedKind && kind !== expectedKind) return false;
    return true;
  }
  return expectedKind !== "visible";
}
function isGuardianOwnedNonHumanMessage(value) {
  if (!isRecord2(value)) return false;
  const kind = guardianMetadata(value)?.[GUARDIAN_KIND_KEY];
  if (hasGuardianMetadata(value) && (value.type === "synthetic" || value.synthetic === true || value.ignored === true || kind === "remediation" || kind === "visible" || guardianMetadata(value)?.[GUARDIAN_PROVENANCE_KEY] === true)) {
    return true;
  }
  const parts = messageParts(value);
  if (parts?.some((part) => {
    if (!isRecord2(part) || !hasGuardianMetadata(part)) return false;
    const partKind = guardianMetadata(part)?.[GUARDIAN_KIND_KEY];
    return part.synthetic === true || part.ignored === true || partKind === "remediation" || partKind === "visible" || guardianMetadata(part)?.[GUARDIAN_PROVENANCE_KEY] === true;
  })) {
    return true;
  }
  return isRecord2(value.message) ? isGuardianOwnedNonHumanMessage(value.message) : false;
}
function isInternalNonHumanPart(part, sessionID) {
  if (!isRecord2(part)) return false;
  if (isTrustedMeshMessage(part, sessionID)) return true;
  const meta = guardianMetadata(part);
  if (part.type === "synthetic" || part.synthetic === true || part.ignored === true || meta?.["opencode-smart-questions"] === true || meta?.[GUARDIAN_PROVENANCE_KEY] === true || meta?.["opencode-hi"] === true || isRecord2(meta?.hi) || typeof meta?.["hi-internal"] === "string" || typeof meta?.["hi-message"] === "string") {
    return true;
  }
  return isRecord2(part.prompt) ? isInternalNonHumanPart(part.prompt, sessionID) : false;
}
function isInternalNonHumanMessage(value, sessionID) {
  if (!isRecord2(value)) return false;
  if (isTrustedMeshMessage(value, sessionID)) return true;
  if (isGuardianOwnedNonHumanMessage(value)) return true;
  const meta = guardianMetadata(value);
  if (value.type === "synthetic" || value.synthetic === true || value.ignored === true || meta?.["opencode-smart-questions"] === true || meta?.[GUARDIAN_PROVENANCE_KEY] === true || meta?.["opencode-hi"] === true || isRecord2(meta?.hi) || typeof meta?.["hi-internal"] === "string" || typeof meta?.["hi-message"] === "string") {
    return true;
  }
  const parts = messageParts(value);
  if (parts?.some((part) => isInternalNonHumanPart(part, sessionID))) {
    return true;
  }
  if (isRecord2(value.prompt) && isInternalNonHumanMessage(value.prompt, sessionID)) {
    return true;
  }
  if (isRecord2(value.info) && isInternalNonHumanMessage(value.info, sessionID)) {
    return true;
  }
  return isRecord2(value.message) ? isInternalNonHumanMessage(value.message, sessionID) : false;
}
function messageRole(value) {
  if (!isRecord2(value)) return void 0;
  if (typeof value.role === "string") return value.role;
  if (typeof value.type === "string" && value.type === "user") return "user";
  if (isRecord2(value.info) && typeof value.info.role === "string") {
    return value.info.role;
  }
  if (isRecord2(value.message)) {
    return messageRole(value.message);
  }
  return void 0;
}
function messageParts(value) {
  if (!isRecord2(value)) return void 0;
  if (Array.isArray(value.parts)) return value.parts;
  if (Array.isArray(value.content)) return value.content;
  if (isRecord2(value.prompt)) {
    const promptParts = messageParts(value.prompt);
    if (promptParts) return promptParts;
  }
  if (isRecord2(value.message)) return messageParts(value.message);
  return void 0;
}
function messageTextCandidates(value) {
  if (!isRecord2(value)) return [];
  const out = [];
  if (typeof value.text === "string") out.push(value.text);
  if (typeof value.content === "string") out.push(value.content);
  if (isRecord2(value.payload) && typeof value.payload.text === "string") {
    out.push(value.payload.text);
  }
  const parts = messageParts(value);
  if (parts) {
    for (const part of parts) {
      if (isRecord2(part) && typeof part.text === "string") {
        out.push(part.text);
      }
    }
  }
  if (isRecord2(value.prompt)) {
    out.push(...messageTextCandidates(value.prompt));
  }
  if (isRecord2(value.message)) {
    out.push(...messageTextCandidates(value.message));
  }
  return out;
}
var SQ_COUNT_SYMBOL = Symbol.for("opencode.coordination.sq.count.v1");
function parseOpenCodeHandoff(text, options) {
  if (typeof text !== "string" || !text.includes(OPENCODE_HANDOFF_HEADER)) return null;
  const requireMarker = typeof options === "boolean" ? options : Boolean(options?.requireRemediationMarker);
  if (requireMarker && !text.includes(GUARDIAN_REMEDIATION_MARKER) && !text.includes(MESH_REMEDIATION_MARKER)) {
    return null;
  }
  const match = /\[OPENCODE_HANDOFF:v1\]\s*([\s\S]*?)(?:\n\n|\r\n\r\n|$)/.exec(text);
  if (!match || !match[1]) return null;
  const lines = match[1].split(/\r?\n/);
  const map = /* @__PURE__ */ new Map();
  for (const line of lines) {
    const eq = line.indexOf("=");
    if (eq > 0) {
      map.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
    }
  }
  const source = map.get("source")?.toLowerCase();
  const action = map.get("action");
  const kind = map.get("kind");
  const autoSelect = map.get("auto_select");
  const handoffId = map.get("handoff_id");
  if (!source || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(source) || action !== "question_required" || !handoffId) {
    return null;
  }
  if (kind !== "clarification" && kind !== "choice" && kind !== "approval") {
    return null;
  }
  if (autoSelect !== "allowed" && autoSelect !== "forbidden") {
    return null;
  }
  return {
    version: "v1",
    source,
    action: "question_required",
    kind,
    autoSelect,
    handoffId
  };
}
function isSyntheticCarrier(value) {
  if (!isRecord2(value)) return false;
  const meta = guardianMetadata(value);
  const meshEnv = isRecord2(meta?.["opencode-mesh"]) ? meta["opencode-mesh"] : void 0;
  const info = isRecord2(value.info) ? value.info : void 0;
  const prompt = isRecord2(value.prompt) ? value.prompt : void 0;
  return value.type === "synthetic" || value.synthetic === true || value.ignored === true || info?.type === "synthetic" || info?.synthetic === true || info?.ignored === true || prompt?.type === "synthetic" || prompt?.synthetic === true || prompt?.ignored === true || meta?.synthetic === true || meta?.internal === true || meta?.autoContinue === true || meshEnv?.synthetic === true || typeof meta?.["hi-internal"] === "string" || typeof meta?.["hi-message"] === "string";
}
function hasMeshHandoffProvenance(value, parentSynthetic = false, sessionID) {
  if (!isRecord2(value)) return false;
  const meta = guardianMetadata(value);
  if (!meta) return false;
  if (meta[GUARDIAN_PROVENANCE_KEY] === true) return false;
  const meshEnv = isRecord2(meta["opencode-mesh"]) ? meta["opencode-mesh"] : void 0;
  if (meshEnv?.owner === "opencode-guardian") return false;
  if (meshEnv?.synthetic === false) return false;
  if (sessionID && verifyMeshMetadata(sessionID, meta, ["remediation", "handoff"])) {
    return true;
  }
  if (!parentSynthetic && !isSyntheticCarrier(value)) return false;
  if (meshEnv && typeof meshEnv.token === "string" && meshEnv.token.length > 0) {
    return meshEnv.kind === "remediation" || meshEnv.kind === "handoff";
  }
  return meta["opencode-hi"] === true || isRecord2(meta.hi) || typeof meta["hi-internal"] === "string" || typeof meta["hi-message"] === "string";
}
function extractHandoffFromParts(parts, options) {
  if (!Array.isArray(parts)) return null;
  const requireMarker = typeof options === "boolean" ? options : options?.requireRemediationMarker ?? true;
  const requireProvenance = typeof options === "boolean" ? true : options?.requireGuardianProvenance ?? true;
  const parentMeshProvenance = typeof options === "object" ? Boolean(options?.parentMeshProvenance) : false;
  const sessionID = typeof options === "object" ? options?.sessionID : void 0;
  for (const part of parts) {
    if (!isRecord2(part) || typeof part.text !== "string") continue;
    const isMeshPart = parentMeshProvenance || hasMeshHandoffProvenance(part, false, sessionID);
    if (requireProvenance && !hasGuardianMetadata(part, "remediation") && !isMeshPart) continue;
    if (requireProvenance && !isMeshPart && part.synthetic !== true && part.ignored !== true && guardianMetadata(part)?.[GUARDIAN_KIND_KEY] !== "remediation") {
      continue;
    }
    const parsed = parseOpenCodeHandoff(part.text, false);
    if (!parsed || typeof parsed !== "object" || !("version" in parsed)) {
      continue;
    }
    const hasMarker = part.text.includes(GUARDIAN_REMEDIATION_MARKER) || part.text.includes(MESH_REMEDIATION_MARKER);
    if (requireMarker && !hasMarker && !(isMeshPart && parsed.source !== "guardian")) {
      continue;
    }
    return parsed;
  }
  return null;
}
function extractTrustedGuardianHandoff(source, sessionID) {
  if (!isRecord2(source)) return null;
  const message = isRecord2(source.message) ? source.message : void 0;
  const prompt = isRecord2(source.prompt) ? source.prompt : void 0;
  const syntheticCarrier = isSyntheticCarrier(source) || isSyntheticCarrier(message) || isSyntheticCarrier(prompt);
  const directProvenance = hasGuardianMetadata(source, "remediation") || hasGuardianMetadata(source.info, "remediation") || hasGuardianMetadata(prompt, "remediation") || hasGuardianMetadata(message, "remediation") || (message ? hasGuardianMetadata(message.info, "remediation") : false);
  const meshProvenance = hasMeshHandoffProvenance(source, syntheticCarrier, sessionID) || hasMeshHandoffProvenance(source.info, syntheticCarrier, sessionID) || hasMeshHandoffProvenance(prompt, syntheticCarrier, sessionID) || hasMeshHandoffProvenance(message, syntheticCarrier, sessionID) || (message ? hasMeshHandoffProvenance(message.info, syntheticCarrier, sessionID) : false);
  const parts = messageParts(source);
  if (parts) {
    const fromParts = extractHandoffFromParts(parts, {
      requireRemediationMarker: true,
      requireGuardianProvenance: !(directProvenance || meshProvenance),
      parentMeshProvenance: meshProvenance && !directProvenance,
      sessionID
    });
    if (fromParts && typeof fromParts === "object" && "version" in fromParts) {
      return fromParts;
    }
  }
  if (directProvenance && isGuardianOwnedNonHumanMessage(source) || meshProvenance) {
    for (const text of messageTextCandidates(source)) {
      const parsed = parseOpenCodeHandoff(text, false);
      if (!parsed || typeof parsed !== "object" || !("version" in parsed)) {
        continue;
      }
      const hasMarker = text.includes(GUARDIAN_REMEDIATION_MARKER) || text.includes(MESH_REMEDIATION_MARKER);
      if (!hasMarker && !(meshProvenance && parsed.source !== "guardian")) {
        continue;
      }
      return parsed;
    }
  }
  return null;
}
function extractCurrentTurnGuardianHandoff(messages, sessionID) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const handoff = extractTrustedGuardianHandoff(message, sessionID);
    if (handoff) {
      return handoff;
    }
    if (messageRole(message) === "user" && !isInternalNonHumanMessage(message, sessionID)) {
      return null;
    }
  }
  return null;
}
var HANDOFF_STATE_SYMBOL = Symbol.for("opencode.handoff.state.v1");
function getHandoffState() {
  const g = globalThis;
  let state = g[HANDOFF_STATE_SYMBOL];
  if (!state) {
    state = {
      activeHandoffsBySession: /* @__PURE__ */ new Map(),
      closedHandoffIds: /* @__PURE__ */ new Map(),
      remediatedFormsById: /* @__PURE__ */ new Map()
    };
    g[HANDOFF_STATE_SYMBOL] = state;
  }
  if (!(state.activeHandoffsBySession instanceof Map)) {
    state.activeHandoffsBySession = /* @__PURE__ */ new Map();
  }
  if (!(state.closedHandoffIds instanceof Map)) {
    state.closedHandoffIds = /* @__PURE__ */ new Map();
  }
  if (!(state.remediatedFormsById instanceof Map)) {
    state.remediatedFormsById = /* @__PURE__ */ new Map();
  }
  if (state.consumedHandoffIds instanceof Set && state.consumedHandoffIds.size > 0) {
    const now = Date.now();
    for (const id of state.consumedHandoffIds) {
      state.closedHandoffIds.set(id, now);
    }
    state.consumedHandoffIds.clear();
  }
  return state;
}
function pruneClosedHandoffs(state, now = Date.now()) {
  for (const [handoffId, closedAt] of state.closedHandoffIds) {
    if (now - closedAt > CLOSED_HANDOFF_TTL_MS2) {
      state.closedHandoffIds.delete(handoffId);
    }
  }
  while (state.closedHandoffIds.size > MAX_CLOSED_HANDOFF_IDS) {
    const oldest = state.closedHandoffIds.keys().next().value;
    if (!oldest) break;
    state.closedHandoffIds.delete(oldest);
  }
}
function closeHandoffId(state, handoffId, now = Date.now()) {
  pruneClosedHandoffs(state, now);
  state.closedHandoffIds.delete(handoffId);
  state.closedHandoffIds.set(handoffId, now);
  pruneClosedHandoffs(state, now);
}
function boundActiveHandoffs(state, now = Date.now()) {
  while (state.activeHandoffsBySession.size > MAX_ACTIVE_HANDOFFS) {
    const oldestSessionID = state.activeHandoffsBySession.keys().next().value;
    if (!oldestSessionID) break;
    const oldest = state.activeHandoffsBySession.get(oldestSessionID);
    state.activeHandoffsBySession.delete(oldestSessionID);
    if (oldest?.handoff.handoffId) {
      closeHandoffId(state, oldest.handoff.handoffId, now);
    }
  }
}
function setActiveHandoff(sessionID, handoff, timestamp) {
  const sID = String(sessionID ?? "");
  const h = handoff;
  if (!sID || !h?.handoffId) return false;
  const state = getHandoffState();
  pruneClosedHandoffs(state);
  if (state.closedHandoffIds.has(h.handoffId)) {
    return false;
  }
  state.activeHandoffsBySession.delete(sID);
  state.activeHandoffsBySession.set(sID, {
    handoff: h,
    createdAt: typeof timestamp === "number" ? timestamp : Date.now()
  });
  boundActiveHandoffs(state);
  return true;
}
function getActiveHandoff(sessionID, maxAgeMs = DEFAULT_HANDOFF_TTL_MS) {
  const sID = String(sessionID ?? "");
  if (!sID) return void 0;
  const state = getHandoffState();
  pruneClosedHandoffs(state);
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return void 0;
  const age = Date.now() - entry.createdAt;
  if (age > maxAgeMs) {
    state.activeHandoffsBySession.delete(sID);
    closeHandoffId(state, entry.handoff.handoffId);
    return void 0;
  }
  return entry.handoff;
}
function consumeActiveHandoff(sessionID) {
  const sID = String(sessionID ?? "");
  if (!sID) return void 0;
  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return void 0;
  closeHandoffId(state, entry.handoff.handoffId);
  state.activeHandoffsBySession.delete(sID);
  return entry.handoff;
}
function invalidateActiveHandoff(sessionID) {
  const sID = String(sessionID ?? "");
  if (!sID) return void 0;
  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return void 0;
  closeHandoffId(state, entry.handoff.handoffId);
  state.activeHandoffsBySession.delete(sID);
  return entry.handoff;
}
function clearActiveHandoff(sessionID) {
  const sID = String(sessionID ?? "");
  if (!sID) return;
  getHandoffState().activeHandoffsBySession.delete(sID);
}
function markFormRemediated(formID, sessionID) {
  if (!formID || !sessionID) return;
  const map = getHandoffState().remediatedFormsById;
  if (map.has(formID)) map.delete(formID);
  map.set(formID, sessionID);
  while (map.size > MAX_ACTIVE_HANDOFFS) {
    const oldest = map.keys().next().value;
    if (!oldest) break;
    map.delete(oldest);
  }
}
function unmarkFormRemediated(formID) {
  if (!formID) return;
  getHandoffState().remediatedFormsById?.delete(formID);
}

// src/view-model.ts
function stripMarker(label, marker) {
  let strLabel = (typeof label === "string" ? label : String(label ?? "")).trim().normalize("NFC");
  const markers = Array.isArray(marker) ? marker.filter((item) => typeof item === "string" && item.length > 0) : typeof marker === "string" && marker.length > 0 ? [marker] : [];
  const lowerLabel = strLabel.toLowerCase();
  let longestSuffix = "";
  for (const candidate of markers) {
    const normalized = candidate.normalize("NFC");
    if (lowerLabel.endsWith(normalized.toLowerCase()) && normalized.length > longestSuffix.length) {
      longestSuffix = normalized;
    }
  }
  if (longestSuffix) {
    strLabel = strLabel.slice(0, -longestSuffix.length).trim();
  }
  const lowerAfterSuffix = strLabel.toLowerCase();
  let longestPrefix = "";
  for (const candidate of markers) {
    const normalized = candidate.normalize("NFC");
    if (lowerAfterSuffix.startsWith(normalized.toLowerCase()) && normalized.length > longestPrefix.length) {
      longestPrefix = normalized;
    }
  }
  if (longestPrefix) {
    strLabel = strLabel.slice(longestPrefix.length).trim();
  }
  return strLabel;
}
function formatCountdown(totalSeconds) {
  const numeric = typeof totalSeconds === "number" && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const clamped = Math.max(0, Math.floor(numeric));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

// src/tui-runtime.js
function loadConfig2(...args) {
  return loadConfig(...args);
}
function detectRecommendations2(...args) {
  return detectRecommendations(args[0], args[1], args[2]);
}
function createDiagnosticLogger(config, prefix) {
  const logPath = typeof config.debugLog === "string" && config.debugLog ? config.debugLog : "";
  return (message) => {
    if (!logPath) return;
    try {
      fs3.appendFileSync(logPath, `[${prefix}] ${(/* @__PURE__ */ new Date()).toISOString()} ${message}
`, {
        encoding: "utf8",
        mode: 384
      });
    } catch {
    }
  };
}
function ensureDraftLock(lockPath, _payload) {
  try {
    fs3.mkdirSync(path3.dirname(lockPath), {
      recursive: true
    });
    fs3.writeFileSync(lockPath, "", {
      encoding: "utf8",
      mode: 384,
      flag: "wx"
    });
    return true;
  } catch {
    return false;
  }
}
function resolveV2TuiConfig(context, directory = context.location?.directory) {
  return resolveSmartQuestionConfig(directory, context.options);
}
function resolveAgentName(sessionInfo, sessionID) {
  if (sessionInfo && typeof sessionInfo === "object") {
    const record = sessionInfo;
    const agent = record.agent;
    if (typeof agent === "string" && agent.trim().length > 0) {
      return {
        name: agent.trim(),
        found: true
      };
    }
  }
  const shortId = sessionID && typeof sessionID === "string" ? sessionID.slice(0, 8) : "unknown";
  return {
    name: shortId,
    found: false
  };
}
function stripMarker2(label, marker) {
  return stripMarker(label, marker);
}
function formatCountdown2(totalSeconds) {
  return formatCountdown(totalSeconds);
}
function SmartQuestionOverlay(props) {
  const active = () => props.state();
  const markers = () => {
    const fromState = active()?.markers;
    if (fromState !== void 0) return fromState;
    const fromProp = typeof props.markers === "function" ? props.markers() : props.markers;
    return fromProp ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers ?? [];
  };
  const labels = () => {
    const fromState = active()?.uiText;
    if (fromState !== void 0) return fromState;
    const fromProp = typeof props.uiText === "function" ? props.uiText() : props.uiText;
    return fromProp ?? DEFAULT_CONFIG.uiText;
  };
  const status = createMemo(() => active()?.status ?? "auto");
  const title = createMemo(() => {
    switch (status()) {
      case "manual":
        return " Smart Question \u2014 Manual Decision ";
      case "unclassified":
        return " Smart Question \u2014 Intercepted ";
      case "error":
        return " Smart Question \u2014 Warning ";
      case "auto":
      default:
        return " Smart Question ";
    }
  });
  const borderColor = createMemo(() => {
    switch (status()) {
      case "manual":
        return "yellow";
      case "unclassified":
        return "cyan";
      case "error":
        return "red";
      case "auto":
      default:
        return "cyan";
    }
  });
  const recommendedChecklist = createMemo(() => {
    const state = active();
    if (!state?.detection?.ok) return "";
    return (state.detection.recommendedOptions ?? []).filter((option) => option && typeof option.label === "string").map((option) => stripMarker2(option.label, markers())).filter(Boolean).map((label) => `\u2713 ${label}`).join("   ");
  });
  const rationale = createMemo(() => {
    const state = active();
    if (!state?.detection?.ok) return "";
    const description = state.detection.recommendedOptions?.[0]?.description;
    return typeof description === "string" ? description : "";
  });
  const countdownText = createMemo(() => {
    const state = active();
    const seconds = typeof props.countdown === "function" ? props.countdown() : state?.countdown ?? 0;
    return formatCountdown2(seconds);
  });
  const badge = createMemo(() => {
    const state = active();
    if (!state) return "";
    return state.agentFound ? `${labels().agent} ${state.agentName}` : `${labels().session} ${state.agentName}`;
  });
  return _$createComponent(Show, {
    get when() {
      return active();
    },
    get children() {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "width", "100%");
      _$setProp(_el$, "border", true);
      _$setProp(_el$, "borderStyle", "rounded");
      _$setProp(_el$, "paddingLeft", 1);
      _$setProp(_el$, "paddingRight", 1);
      _$setProp(_el$, "flexDirection", "column");
      _$insertNode(_el$2, _el$3);
      _$setProp(_el$2, "width", "100%");
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "justifyContent", "flex-end");
      _$setProp(_el$3, "fg", "gray");
      _$insert(_el$3, badge);
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return status() === "auto";
        },
        get fallback() {
          return _$createComponent(Show, {
            get when() {
              return status() === "manual";
            },
            get fallback() {
              return _$createComponent(Show, {
                get when() {
                  return status() === "unclassified";
                },
                get fallback() {
                  return (() => {
                    var _el$29 = _$createElement("box"), _el$30 = _$createElement("box"), _el$31 = _$createElement("text"), _el$32 = _$createElement("b"), _el$33 = _$createElement("text"), _el$34 = _$createElement("b");
                    _$insertNode(_el$29, _el$30);
                    _$setProp(_el$29, "width", "100%");
                    _$setProp(_el$29, "flexDirection", "column");
                    _$insertNode(_el$30, _el$31);
                    _$insertNode(_el$30, _el$33);
                    _$setProp(_el$30, "width", "100%");
                    _$setProp(_el$30, "flexDirection", "row");
                    _$setProp(_el$30, "justifyContent", "space-between");
                    _$insertNode(_el$31, _el$32);
                    _$setProp(_el$31, "fg", "red");
                    _$insert(_el$32, () => active()?.errorMessage ?? labels().remediationFailed ?? "Remediation stopped. Please answer manually.");
                    _$insertNode(_el$33, _el$34);
                    _$setProp(_el$33, "fg", "red");
                    _$insert(_el$34, () => labels().disabled);
                    return _el$29;
                  })();
                },
                get children() {
                  var _el$20 = _$createElement("box"), _el$21 = _$createElement("box"), _el$22 = _$createElement("text"), _el$23 = _$createElement("b"), _el$24 = _$createElement("text"), _el$25 = _$createElement("b"), _el$27 = _$createElement("box"), _el$28 = _$createElement("text");
                  _$insertNode(_el$20, _el$21);
                  _$insertNode(_el$20, _el$27);
                  _$setProp(_el$20, "width", "100%");
                  _$setProp(_el$20, "flexDirection", "column");
                  _$insertNode(_el$21, _el$22);
                  _$insertNode(_el$21, _el$24);
                  _$setProp(_el$21, "width", "100%");
                  _$setProp(_el$21, "flexDirection", "row");
                  _$setProp(_el$21, "justifyContent", "space-between");
                  _$insertNode(_el$22, _el$23);
                  _$setProp(_el$22, "fg", "cyan");
                  _$insert(_el$23, () => labels().unclassifiedTitle ?? "Unclassified Question Intercepted");
                  _$insertNode(_el$24, _el$25);
                  _$setProp(_el$24, "fg", "magenta");
                  _$insertNode(_el$25, _$createTextNode(`WAITING FOR AGENT`));
                  _$insertNode(_el$27, _el$28);
                  _$setProp(_el$27, "width", "100%");
                  _$setProp(_el$27, "flexDirection", "row");
                  _$setProp(_el$28, "fg", "gray");
                  _$insert(_el$28, () => active()?.statusMessage ?? labels().unclassifiedSubtitle ?? "Agent was asked to classify the question.");
                  return _el$20;
                }
              });
            },
            get children() {
              var _el$12 = _$createElement("box"), _el$13 = _$createElement("box"), _el$14 = _$createElement("text"), _el$15 = _$createElement("b"), _el$16 = _$createElement("text"), _el$17 = _$createElement("b"), _el$18 = _$createElement("box"), _el$19 = _$createElement("text");
              _$insertNode(_el$12, _el$13);
              _$insertNode(_el$12, _el$18);
              _$setProp(_el$12, "width", "100%");
              _$setProp(_el$12, "flexDirection", "column");
              _$insertNode(_el$13, _el$14);
              _$insertNode(_el$13, _el$16);
              _$setProp(_el$13, "width", "100%");
              _$setProp(_el$13, "flexDirection", "row");
              _$setProp(_el$13, "justifyContent", "space-between");
              _$insertNode(_el$14, _el$15);
              _$setProp(_el$14, "fg", "yellow");
              _$insert(_el$15, () => labels().manualTitle ?? "Manual Decision Required");
              _$insertNode(_el$16, _el$17);
              _$setProp(_el$16, "fg", "red");
              _$insert(_el$17, () => labels().disabled);
              _$insertNode(_el$18, _el$19);
              _$setProp(_el$18, "width", "100%");
              _$setProp(_el$18, "flexDirection", "row");
              _$setProp(_el$19, "fg", "gray");
              _$insert(_el$19, () => active()?.statusMessage ?? labels().manualSubtitle ?? "Auto-selection disabled \u2014 human approval required.");
              return _el$12;
            }
          });
        },
        get children() {
          return [(() => {
            var _el$4 = _$createElement("box"), _el$5 = _$createElement("text"), _el$6 = _$createElement("b");
            _$insertNode(_el$4, _el$5);
            _$setProp(_el$4, "width", "100%");
            _$setProp(_el$4, "flexDirection", "row");
            _$setProp(_el$4, "justifyContent", "space-between");
            _$insertNode(_el$5, _el$6);
            _$setProp(_el$5, "fg", "green");
            _$insert(_el$6, recommendedChecklist);
            _$insert(_el$4, _$createComponent(Show, {
              get when() {
                return !active()?.focusDisabled;
              },
              get fallback() {
                return (() => {
                  var _el$35 = _$createElement("text"), _el$36 = _$createElement("b");
                  _$insertNode(_el$35, _el$36);
                  _$setProp(_el$35, "fg", "red");
                  _$insert(_el$36, () => labels().disabled);
                  return _el$35;
                })();
              },
              get children() {
                var _el$7 = _$createElement("text"), _el$8 = _$createElement("b");
                _$insertNode(_el$7, _el$8);
                _$setProp(_el$7, "fg", "yellow");
                _$insert(_el$8, countdownText);
                return _el$7;
              }
            }), null);
            return _el$4;
          })(), _$createComponent(Show, {
            get when() {
              return active()?.errorMessage;
            },
            get children() {
              var _el$9 = _$createElement("text");
              _$setProp(_el$9, "fg", "red");
              _$insert(_el$9, () => active()?.errorMessage);
              return _el$9;
            }
          }), _$createComponent(Show, {
            get when() {
              return rationale();
            },
            get children() {
              var _el$0 = _$createElement("box"), _el$1 = _$createElement("text"), _el$10 = _$createTextNode(` `), _el$11 = _$createElement("text");
              _$insertNode(_el$0, _el$1);
              _$insertNode(_el$0, _el$11);
              _$setProp(_el$0, "flexDirection", "row");
              _$insertNode(_el$1, _el$10);
              _$setProp(_el$1, "fg", "gray");
              _$insert(_el$1, () => labels().recommendation, _el$10);
              _$insert(_el$11, rationale);
              return _el$0;
            }
          })];
        }
      }), null);
      _$effect((_p$) => {
        var _v$ = borderColor(), _v$2 = title();
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$, "borderColor", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$, "title", _v$2, _p$.t));
        return _p$;
      }, {
        e: void 0,
        t: void 0
      });
      return _el$;
    }
  });
}
var MAX_REMEDIATED_FORMS = 512;
var MAX_SESSION_CHAINS = 512;
function setBounded(map, key, value, max) {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === void 0) break;
    map.delete(oldest);
  }
}
var setup = async (context) => {
  const formApi = context?.data?.session?.form;
  if (!context || typeof context !== "object" || typeof context.data?.on !== "function" || typeof formApi?.sync !== "function" || typeof formApi?.list !== "function" || typeof formApi?.reply !== "function" || typeof formApi?.invalidate !== "function" || typeof context.renderer?.keyInput?.on !== "function" || typeof context.renderer?.keyInput?.off !== "function" || typeof context.ui?.router?.current !== "function" || typeof context.ui?.slot !== "function") {
    return;
  }
  const pluginOptions = context.options;
  if (typeof pluginOptions?.resolveConfig !== "function" && hasSmartQuestionConfigOptions(pluginOptions)) {
    const explicitConfig = resolveV2TuiConfig(context);
    if (!explicitConfig?.enabled) return;
  }
  let disposed = false;
  const lifecycleController = new AbortController();
  const [activeBySession, setActiveBySession] = createSignal({});
  const pending = /* @__PURE__ */ new Map();
  const inFlightForms = /* @__PURE__ */ new Map();
  const remediatedForms = /* @__PURE__ */ new Map();
  const settledForms = /* @__PURE__ */ new Map();
  const userCancelledForms = /* @__PURE__ */ new Map();
  const sessionChains = /* @__PURE__ */ new Map();
  const uiInteractionLeases = /* @__PURE__ */ new Map();
  const MAX_UI_INTERACTION_LEASES = 512;
  const syncRemoteLease = (sessionID, active, dir, ttlMs, reason) => {
    const rpcFn = context.client?.rpc;
    if (typeof rpcFn !== "function") return;
    void callMeshRpc({
      rpcGetter: rpcFn.bind(context.client),
      contract: MESH_STATE_RPC_DEFINITION,
      method: "setInteractionLease",
      payload: {
        sessionID,
        owner: "opencode-smart-questions",
        active,
        ...ttlMs !== void 0 ? {
          ttlMs
        } : {},
        ...reason ? {
          reason
        } : {}
      },
      directory: dir ?? context.location?.directory
    });
  };
  const setUiInteractionLease = (sessionID, entry) => {
    if (uiInteractionLeases.has(sessionID)) {
      uiInteractionLeases.delete(sessionID);
    }
    uiInteractionLeases.set(sessionID, entry);
    while (uiInteractionLeases.size > MAX_UI_INTERACTION_LEASES) {
      const oldestSessionID = uiInteractionLeases.keys().next().value;
      if (oldestSessionID === void 0) break;
      const oldest = uiInteractionLeases.get(oldestSessionID);
      uiInteractionLeases.delete(oldestSessionID);
      if (oldest) {
        try {
          oldest.release();
        } catch {
        }
        syncRemoteLease(oldestSessionID, false, oldest.dir);
      }
    }
  };
  const releaseUiLease = (sessionID, dir) => {
    const entry = uiInteractionLeases.get(sessionID);
    if (entry) {
      uiInteractionLeases.delete(sessionID);
      try {
        entry.release();
      } catch {
      }
      syncRemoteLease(sessionID, false, entry.dir ?? dir);
    }
  };
  const releaseAllUiLeases = () => {
    for (const sessionID of Array.from(uiInteractionLeases.keys())) {
      releaseUiLease(sessionID);
    }
  };
  const MAX_SETTLED_FORMS = 512;
  const cancelInFlightForSession = (sessionID, options) => {
    for (const [fID, entry] of inFlightForms.entries()) {
      if (entry.sessionID === sessionID) {
        inFlightForms.delete(fID);
        if (options?.recordUserCancel) {
          setBounded(userCancelledForms, fID, sessionID, MAX_SETTLED_FORMS);
        }
      }
    }
  };
  const clearUserCancelledForSession = (sessionID) => {
    for (const [fID, sID] of userCancelledForms.entries()) {
      if (sID === sessionID) {
        userCancelledForms.delete(fID);
      }
    }
  };
  const cleanupSessionRemediations = (sessionID) => {
    for (const [fID, sID] of remediatedForms.entries()) {
      if (sID === sessionID) {
        remediatedForms.delete(fID);
        unmarkFormRemediated(fID);
      }
    }
  };
  const updateSessionState = (sessionID, updater) => {
    setActiveBySession((current) => {
      const prev = current[sessionID];
      const updated = updater(prev);
      if (updated === prev) return current;
      const next = {
        ...current
      };
      if (updated) next[sessionID] = updated;
      else delete next[sessionID];
      return next;
    });
  };
  const clearPending = (formID, options = {}) => {
    const item = pending.get(formID);
    if (!item) return;
    clearTimeout(item.timeout);
    if (item.interval) clearInterval(item.interval);
    item.status = "cancelled";
    pending.delete(formID);
    if (options.removeLock !== false) {
      deleteLockfile(item.lockPath, item.log);
    }
    if (options.removeOverlay !== false) {
      updateSessionState(item.sessionID, (current) => current?.formID === formID ? void 0 : current);
    }
  };
  const clearSessionState = (sessionID) => {
    for (const [id, item] of pending.entries()) {
      if (item.sessionID === sessionID) {
        clearPending(id);
      }
    }
    const existingState = activeBySession()[sessionID];
    if (existingState?.lockPath) {
      deleteLockfile(existingState.lockPath);
    }
    clearUserCancelledForSession(sessionID);
    updateSessionState(sessionID, () => void 0);
  };
  const cancelSessionAutoSelection = (sessionID, reason) => {
    cancelInFlightForSession(sessionID, {
      recordUserCancel: true
    });
    const state = activeBySession()[sessionID];
    if (!state?.formID || state.focusDisabled) return;
    const item = pending.get(state.formID);
    if (!item) return;
    clearTimeout(item.timeout);
    if (item.interval) {
      clearInterval(item.interval);
      item.interval = null;
    }
    item.status = "cancelled";
    ensureDraftLock(item.lockPath, {
      formID: item.formID,
      sessionID,
      ts: Date.now(),
      reason
    });
    updateSessionState(sessionID, (current) => current?.formID === item.formID ? {
      ...current,
      focusDisabled: true
    } : current);
    item.log(`manual interaction form=${item.formID} session=${sessionID} reason=${reason}`);
  };
  const onFormCreated = async (event) => {
    if (disposed) return;
    const form = event?.data?.form ?? event?.properties?.form;
    if (!form?.id || !form.sessionID || form.sessionID === "global") return;
    if (pending.has(form.id) || inFlightForms.has(form.id) || settledForms.has(form.id) || userCancelledForms.has(form.id)) {
      return;
    }
    const flightToken = Symbol(form.id);
    inFlightForms.set(form.id, {
      sessionID: form.sessionID,
      token: flightToken
    });
    const isFlightCurrent = () => !disposed && inFlightForms.get(form.id)?.token === flightToken;
    try {
      let sessionInfo;
      try {
        sessionInfo = context.data.session?.get?.(form.sessionID);
        if (!sessionInfo && typeof context.data.session?.sync === "function") {
          await context.data.session.sync(form.sessionID);
          if (!isFlightCurrent()) return;
          sessionInfo = context.data.session?.get?.(form.sessionID);
        }
      } catch {
        return;
      }
      if (!isFlightCurrent()) return;
      if (!sessionInfo && typeof context.data.session?.root === "function") {
        try {
          const rootID = context.data.session.root(form.sessionID);
          if (typeof rootID === "string" && rootID) {
            sessionInfo = {
              id: form.sessionID,
              parentID: rootID === form.sessionID ? void 0 : rootID
            };
          }
        } catch {
        }
      }
      const sessionLocation = sessionInfo?.location?.directory ?? sessionInfo?.directory;
      const locationDir = event?.location?.directory ?? sessionLocation ?? context.location?.directory;
      const location = event?.location ?? (sessionLocation ? {
        directory: sessionLocation
      } : context.location);
      const config = resolveV2TuiConfig(context, locationDir);
      if (!isEligibleSessionInfo(sessionInfo, config?.includeSubagents === true)) return;
      if (pending.has(form.id)) return;
      for (const [id, existing] of pending.entries()) {
        if (existing.sessionID === form.sessionID) {
          clearPending(id);
        }
      }
      if (!config?.enabled) return;
      releaseUiLease(form.sessionID, locationDir);
      const leaseTtl = Math.max((config.timeoutMs ?? 0) + 15e3, 12e4);
      setUiInteractionLease(form.sessionID, {
        release: acquireSessionLease({
          sessionID: form.sessionID,
          owner: "opencode-smart-questions",
          kind: "user_interaction",
          ttlMs: leaseTtl,
          reason: `form:${form.id}`
        }),
        dir: locationDir,
        formID: form.id
      });
      syncRemoteLease(form.sessionID, true, locationDir, leaseTtl, `form:${form.id}`);
      const log = createDiagnosticLogger(config, "smart-question-v2-ui");
      const effectiveConfigDir = config.configDir || path3.resolve(location?.directory || context.location?.directory || process.cwd(), ".opencode");
      cleanupStaleDrafts(effectiveConfigDir, config.timeoutMs, log);
      const fallbackActive = config.unclassifiedQuestionPolicy === "fallback-first" || config.fallbackToFirstOption === true;
      const classifyOptions = {
        requireExactlyOneRecommendation: config.requireExactlyOneRecommendation,
        allowFallback: fallbackActive,
        allowFallbackOnManual: config.fallbackOnManual === true,
        manualOnPatterns: config.manualOnPatterns,
        unsupportedFieldPolicy: config.unsupportedFieldPolicy
      };
      let handoff = getActiveHandoff(form.sessionID);
      const preliminary = !handoff ? classifyV2Form(form, config.recommendedMarkers, config.manualMarkers, null, classifyOptions) : null;
      const skipMessageSync = preliminary !== null && (preliminary.status === "manual" || preliminary.status === "unclassified" && Boolean(preliminary.unsupported) && config.unsupportedFieldPolicy !== "remediate");
      if (!handoff && !skipMessageSync) {
        try {
          const msgApi = context.data?.session?.message;
          let msgs = msgApi?.list?.(form.sessionID);
          let synced = false;
          if ((!Array.isArray(msgs) || msgs.length === 0) && typeof msgApi?.sync === "function") {
            await msgApi.sync(form.sessionID);
            synced = true;
            if (!isFlightCurrent()) return;
            msgs = msgApi?.list?.(form.sessionID);
          }
          let extracted = Array.isArray(msgs) ? extractCurrentTurnGuardianHandoff(msgs, form.sessionID) : null;
          if (!extracted && !synced && typeof msgApi?.sync === "function") {
            await msgApi.sync(form.sessionID);
            if (!isFlightCurrent()) return;
            msgs = msgApi?.list?.(form.sessionID);
            extracted = Array.isArray(msgs) ? extractCurrentTurnGuardianHandoff(msgs, form.sessionID) : null;
          }
          if (extracted) {
            if (setActiveHandoff(form.sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        } catch {
        }
      }
      if (!isFlightCurrent()) return;
      const agent = resolveAgentName(sessionInfo, form.sessionID);
      let classification = !handoff && preliminary ? preliminary : classifyV2Form(form, config.recommendedMarkers, config.manualMarkers, handoff, classifyOptions);
      if (classification.status === "manual") {
        recordSmartQuestionDecision({
          formID: form.id,
          sessionID: form.sessionID,
          status: "manual",
          reason: classification.reason,
          matchedMarker: classification.matchedMarker,
          timestamp: Date.now()
        });
        sessionChains.delete(form.sessionID);
        const lockPath2 = resolveLockPath(effectiveConfigDir, form.id);
        ensureDraftLock(lockPath2, {
          formID: form.id,
          sessionID: form.sessionID,
          ts: Date.now(),
          reason: "manual"
        });
        const state2 = {
          requestID: form.id,
          formID: form.id,
          sessionID: form.sessionID,
          questions: classification.questions,
          detection: {
            ok: false,
            reason: classification.reason
          },
          agentName: agent.name,
          agentFound: agent.found,
          focusDisabled: true,
          status: "manual",
          statusMessage: config.uiText.manualSubtitle,
          lockPath: lockPath2,
          markers: config.recommendedMarkers,
          uiText: config.uiText
        };
        updateSessionState(form.sessionID, () => state2);
        log(`manual form=${form.id} reason=manual-classification matched=${classification.matchedMarker ?? "none"}`);
        return;
      }
      if (classification.status === "unclassified") {
        if (classification.unsupported && config.unsupportedFieldPolicy !== "remediate") {
          recordSmartQuestionDecision({
            formID: form.id,
            sessionID: form.sessionID,
            status: "unsupported",
            reason: classification.reason,
            timestamp: Date.now()
          });
          log(`unsupported form=${form.id} reason=${classification.reason}`);
          return;
        }
        recordSmartQuestionDecision({
          formID: form.id,
          sessionID: form.sessionID,
          status: "unclassified",
          reason: classification.reason,
          timestamp: Date.now()
        });
        if (config.unclassifiedQuestionPolicy === "ignore") {
          log(`unclassified form=${form.id} ignored per unclassifiedQuestionPolicy`);
          return;
        }
        log(`unclassified form=${form.id} reason=${classification.reason}`);
        if (remediatedForms.has(form.id)) {
          log(`suppress duplicate remediation form=${form.id}`);
          return;
        }
        const fingerprint = computeQuestionFingerprint(classification.questions);
        const maxRemediations = typeof config.maxUnclassifiedRemediations === "number" ? config.maxUnclassifiedRemediations : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;
        const existingChain = sessionChains.get(form.sessionID);
        const isSameChain = existingChain !== void 0 && existingChain.fingerprint === fingerprint;
        const currentCount = isSameChain ? existingChain.consecutiveFailures : 0;
        const lockPath2 = resolveLockPath(effectiveConfigDir, form.id);
        if (currentCount >= maxRemediations) {
          log(`unclassified remediation budget exhausted session=${form.sessionID} fingerprint=${fingerprint} count=${currentCount}/${maxRemediations}`);
          if (config.unclassifiedQuestionPolicy === "remediate-then-fallback") {
            const fallbackClassification = classifyV2Form(form, config.recommendedMarkers, config.manualMarkers, handoff, {
              requireExactlyOneRecommendation: config.requireExactlyOneRecommendation,
              allowFallback: true,
              allowFallbackOnManual: config.fallbackOnManual === true,
              manualOnPatterns: config.manualOnPatterns,
              unsupportedFieldPolicy: config.unsupportedFieldPolicy
            });
            if (fallbackClassification.status === "auto") {
              classification = fallbackClassification;
              sessionChains.delete(form.sessionID);
              log(`remediation budget exhausted, activating fallback form=${form.id}`);
            }
          }
          if (classification.status !== "auto") {
            ensureDraftLock(lockPath2, {
              formID: form.id,
              sessionID: form.sessionID,
              ts: Date.now(),
              reason: "budget-exhausted"
            });
            const state2 = {
              requestID: form.id,
              formID: form.id,
              sessionID: form.sessionID,
              questions: classification.questions,
              detection: {
                ok: false,
                reason: "Remediation budget exhausted"
              },
              agentName: agent.name,
              agentFound: agent.found,
              focusDisabled: true,
              status: "error",
              errorMessage: config.uiText.budgetExhausted,
              lockPath: lockPath2,
              markers: config.recommendedMarkers,
              uiText: config.uiText
            };
            updateSessionState(form.sessionID, () => state2);
            return;
          }
        }
        if (classification.status === "unclassified") {
          setBounded(remediatedForms, form.id, form.sessionID, MAX_REMEDIATED_FORMS);
          markFormRemediated(form.id, form.sessionID);
          setBounded(sessionChains, form.sessionID, {
            fingerprint,
            consecutiveFailures: currentCount + 1
          }, MAX_SESSION_CHAINS);
          ensureDraftLock(lockPath2, {
            formID: form.id,
            sessionID: form.sessionID,
            ts: Date.now(),
            reason: "unclassified"
          });
          const state2 = {
            requestID: form.id,
            formID: form.id,
            sessionID: form.sessionID,
            questions: classification.questions,
            detection: {
              ok: false,
              reason: classification.reason
            },
            agentName: agent.name,
            agentFound: agent.found,
            focusDisabled: true,
            status: "unclassified",
            statusMessage: config.uiText.unclassifiedSubtitle,
            lockPath: lockPath2,
            markers: config.recommendedMarkers,
            uiText: config.uiText
          };
          updateSessionState(form.sessionID, () => state2);
          const promptText = buildUnclassifiedRemediationPrompt(config.recommendedMarker, config.manualMarker);
          let remediationSent = false;
          try {
            if (isFlightCurrent()) {
              const response = await context.client.session.synthetic({
                sessionID: form.sessionID,
                text: promptText,
                description: "Smart Questions protocol remediation",
                metadata: stampMeshMetadata(form.sessionID, {
                  owner: "opencode-smart-questions",
                  kind: "remediation",
                  protected: true
                }),
                delivery: "queue",
                resume: true
              }, {
                signal: lifecycleController.signal
              });
              const rejected = response && typeof response === "object" && !Array.isArray(response) && (Boolean(response.error) || response.ok === false || response.name === "UnknownError");
              remediationSent = !disposed && !rejected;
            }
          } catch (err) {
            log(`remediation send failed form=${form.id} code=${diagnosticErrorCode(err)}`);
          }
          if (!remediationSent) {
            remediatedForms.delete(form.id);
            unmarkFormRemediated(form.id);
            if (settledForms.has(form.id) && uiInteractionLeases.get(form.sessionID)?.formID === form.id) {
              releaseUiLease(form.sessionID, locationDir);
            }
            if (currentCount === 0) {
              sessionChains.delete(form.sessionID);
            } else {
              setBounded(sessionChains, form.sessionID, {
                fingerprint,
                consecutiveFailures: currentCount
              }, MAX_SESSION_CHAINS);
            }
            if (!disposed && !settledForms.has(form.id)) {
              updateSessionState(form.sessionID, (current) => current?.formID === form.id ? {
                ...current,
                status: "error",
                errorMessage: config.uiText.remediationFailed
              } : current);
            }
            log(`remediation not sent form=${form.id}; retry remains allowed`);
          }
          return;
        }
      }
      if (classification.status !== "auto" || !isFlightCurrent()) return;
      if (!canUseDraftCoordination(effectiveConfigDir, log)) {
        log(`skip auto-selection form=${form.id} reason=draft coordination unavailable`);
        return;
      }
      sessionChains.delete(form.sessionID);
      const detection = classification.detection;
      recordSmartQuestionDecision({
        formID: form.id,
        sessionID: form.sessionID,
        status: "auto",
        matchedMarker: detection.matchedMarker,
        timeoutMs: config.timeoutMs,
        timestamp: Date.now()
      });
      const lockPath = resolveLockPath(effectiveConfigDir, form.id);
      const expiresAt = Date.now() + config.timeoutMs;
      const initialCountdown = Math.ceil(config.timeoutMs / 1e3);
      const state = {
        requestID: form.id,
        formID: form.id,
        sessionID: form.sessionID,
        questions: classification.questions,
        detection,
        agentName: agent.name,
        agentFound: agent.found,
        focusDisabled: false,
        status: "auto",
        lockPath,
        countdown: initialCountdown,
        markers: config.recommendedMarkers,
        uiText: config.uiText
      };
      const item = {
        formID: form.id,
        sessionID: form.sessionID,
        answer: classification.answer,
        state,
        expiresAt,
        status: "pending",
        lockPath,
        location,
        log,
        timeout: void 0,
        interval: null
      };
      const fire = async () => {
        if (disposed || pending.get(form.id) !== item || item.status !== "pending") return;
        item.status = "firing";
        if (item.interval) {
          clearInterval(item.interval);
          item.interval = null;
        }
        try {
          try {
            fs3.statSync(lockPath);
            log(`skip reply form=${form.id} reason=draft lockfile present`);
            clearPending(form.id, {
              removeLock: false
            });
            return;
          } catch (lockErr) {
            const lockCode = lockErr?.code;
            if (lockCode !== "ENOENT" || !canUseDraftCoordination(effectiveConfigDir, log)) {
              log(`skip reply form=${form.id} reason=draft coordination check failed`);
              clearPending(form.id, {
                removeLock: false
              });
              return;
            }
          }
          await context.data.session.form.sync(form.sessionID, item.location);
          if (pending.get(form.id) !== item) return;
          if (disposed) {
            clearPending(form.id);
            return;
          }
          const forms = context.data.session.form.list(form.sessionID, item.location);
          const stillPending = Array.isArray(forms) && forms.some((candidate) => candidate.id === form.id);
          if (!stillPending) {
            releaseUiLease(form.sessionID, locationDir);
          }
          if (!stillPending || pending.get(form.id) !== item || item.status !== "firing" || activeBySession()[form.sessionID]?.formID !== form.id || activeBySession()[form.sessionID]?.focusDisabled) {
            log(`skip reply form=${form.id} reason=no longer pending or manual interaction`);
            clearPending(form.id);
            return;
          }
          if (pending.get(form.id) !== item || item.status !== "firing") {
            clearPending(form.id);
            return;
          }
          await context.data.session.form.reply({
            sessionID: form.sessionID,
            formID: form.id,
            answer: item.answer
          }, item.location);
          if (disposed || pending.get(form.id) !== item) return;
          item.status = "replied";
          recordSmartQuestionDecision({
            formID: form.id,
            sessionID: form.sessionID,
            status: "replied",
            matchedMarker: detection.matchedMarker,
            timeoutMs: config.timeoutMs,
            timestamp: Date.now()
          });
          releaseUiLease(form.sessionID, locationDir);
          consumeActiveHandoff(form.sessionID);
          try {
            context.data.session.form.invalidate(form.sessionID, item.location);
          } catch (error) {
            log(`form cache invalidation failed form=${form.id} code=${diagnosticErrorCode(error)}`);
          }
          deleteLockfile(lockPath, log);
          pending.delete(form.id);
          updateSessionState(form.sessionID, (current) => current?.formID === form.id ? void 0 : current);
          log(`reply OK form=${form.id}`);
        } catch (error) {
          const code = diagnosticErrorCode(error);
          log(`reply ERROR form=${form.id} code=${code}`);
          console.error(`[smart-question] Auto-selection failed for form ${form.id} (${code})`);
          if (pending.get(form.id) === item) {
            pending.delete(form.id);
            deleteLockfile(lockPath, log);
            updateSessionState(form.sessionID, (current) => current?.formID === form.id ? {
              ...current,
              focusDisabled: true,
              errorMessage: config.uiText.autoReplyFailed
            } : current);
          }
        }
      };
      item.timeout = setTimeout(() => {
        void fire();
      }, config.timeoutMs);
      if (config.timeoutMs > 0) {
        item.interval = setInterval(() => {
          if (pending.get(form.id) !== item || item.status !== "pending") return;
          const countdown = Math.ceil(Math.max(0, item.expiresAt - Date.now()) / 1e3);
          updateSessionState(form.sessionID, (current) => {
            if (!current || current.formID !== form.id || current.countdown === countdown) {
              return current;
            }
            return {
              ...current,
              countdown
            };
          });
        }, 250);
      }
      pending.set(form.id, item);
      updateSessionState(form.sessionID, () => state);
      log(`schedule form=${form.id} session=${form.sessionID} timeoutMs=${config.timeoutMs}`);
    } finally {
      if (inFlightForms.get(form.id)?.token === flightToken) {
        inFlightForms.delete(form.id);
      }
    }
  };
  const onFormSettled = (event, kind = "replied") => {
    const formID = event?.data?.formID ?? event?.data?.id ?? event?.data?.form?.id ?? event?.properties?.formID ?? event?.properties?.id ?? event?.properties?.form?.id;
    const rawSessionID = event?.data?.sessionID ?? event?.data?.form?.sessionID ?? event?.properties?.sessionID ?? event?.properties?.form?.sessionID;
    const targetSession = typeof rawSessionID === "string" && rawSessionID !== "global" ? rawSessionID : typeof formID === "string" ? pending.get(formID)?.sessionID ?? remediatedForms.get(formID) ?? inFlightForms.get(formID)?.sessionID ?? Object.keys(activeBySession()).find((sId) => activeBySession()[sId]?.formID === formID) ?? Array.from(uiInteractionLeases.entries()).find(([, v]) => v.formID === formID)?.[0] : void 0;
    const currentFormID = targetSession ? uiInteractionLeases.get(targetSession)?.formID ?? activeBySession()[targetSession]?.formID : void 0;
    if (targetSession && typeof formID === "string" && currentFormID && currentFormID !== formID) {
      setBounded(settledForms, formID, true, MAX_SETTLED_FORMS);
      inFlightForms.delete(formID);
      remediatedForms.delete(formID);
      unmarkFormRemediated(formID);
      clearPending(formID);
      const existingState = activeBySession()[targetSession];
      if (existingState?.formID === formID && existingState.lockPath) {
        try {
          deleteLockfile(existingState.lockPath);
        } catch {
        }
      }
      updateSessionState(targetSession, (current) => current?.formID === formID ? void 0 : current);
      return;
    }
    const wasRemediated = typeof formID === "string" && remediatedForms.has(formID);
    if (typeof formID === "string") {
      setBounded(settledForms, formID, true, MAX_SETTLED_FORMS);
      inFlightForms.delete(formID);
      userCancelledForms.delete(formID);
      remediatedForms.delete(formID);
      if (kind !== "cancelled") {
        unmarkFormRemediated(formID);
      }
      clearPending(formID);
    }
    if (targetSession) {
      const existingState = activeBySession()[targetSession];
      if (existingState?.lockPath && (!formID || existingState.formID === formID)) {
        try {
          deleteLockfile(existingState.lockPath);
        } catch {
        }
      }
      if (typeof formID === "string") {
        updateSessionState(targetSession, (current) => current?.formID === formID ? void 0 : current);
      } else {
        updateSessionState(targetSession, () => void 0);
      }
      if (kind === "cancelled" && wasRemediated) {
        const prevDir = uiInteractionLeases.get(targetSession)?.dir ?? event?.location?.directory ?? context.location?.directory;
        releaseUiLease(targetSession, prevDir);
        const remediationTtlMs = 45e3;
        setUiInteractionLease(targetSession, {
          release: acquireSessionLease({
            sessionID: targetSession,
            owner: "opencode-smart-questions",
            kind: "user_interaction",
            ttlMs: remediationTtlMs,
            reason: `remediation:${formID}`
          }),
          dir: prevDir,
          formID: typeof formID === "string" ? formID : void 0
        });
        syncRemoteLease(targetSession, true, prevDir, remediationTtlMs, `remediation:${formID}`);
      } else {
        releaseUiLease(targetSession, event?.location?.directory);
        consumeActiveHandoff(targetSession);
        sessionChains.delete(targetSession);
      }
    }
  };
  const cleanups = [];
  const disposeCleanups = () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
      }
    }
  };
  const NON_INTERVENTION_KEYS = /* @__PURE__ */ new Set(["pageup", "pagedown", "home", "end", "scrollup", "scrolldown", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "shift", "ctrl", "control", "alt", "option", "meta", "super", "hyper", "leftshift", "rightshift", "leftctrl", "rightctrl", "leftalt", "rightalt", "leftmeta", "rightmeta", "leftsuper", "rightsuper", "lefthyper", "righthyper", "iso_level3_shift", "iso_level5_shift", "capslock", "numlock", "scrolllock"]);
  const getCachedSessionInfo = (sessionID) => {
    try {
      let sessionInfo = context.data.session?.get?.(sessionID);
      if (!sessionInfo && typeof context.data.session?.root === "function") {
        const rootID = context.data.session.root(sessionID);
        if (typeof rootID === "string" && rootID) {
          sessionInfo = {
            id: sessionID,
            parentID: rootID === sessionID ? void 0 : rootID
          };
        }
      }
      return sessionInfo;
    } catch {
      return void 0;
    }
  };
  const checkSessionEligibility = (sessionInfo, eventLocation) => {
    const sessionDirectory = sessionInfo?.location?.directory ?? sessionInfo?.directory;
    const directory = eventLocation?.directory ?? sessionDirectory ?? context.location?.directory;
    const config = resolveV2TuiConfig(context, directory);
    if (!config?.enabled) return false;
    return isEligibleSessionInfo(sessionInfo, config.includeSubagents === true);
  };
  const setHandoffIfEligible = (sessionID, payload, eventLocation) => {
    const handoff = extractTrustedGuardianHandoff(payload, sessionID);
    if (!handoff) return;
    const cachedInfo = getCachedSessionInfo(sessionID);
    if (cachedInfo !== void 0 || typeof context.data.session?.sync !== "function") {
      if (checkSessionEligibility(cachedInfo, eventLocation)) {
        setActiveHandoff(sessionID, handoff);
      }
      return;
    }
    void (async () => {
      try {
        await context.data.session.sync(sessionID);
      } catch {
        return;
      }
      if (disposed) return;
      const syncedInfo = getCachedSessionInfo(sessionID);
      if (checkSessionEligibility(syncedInfo, eventLocation)) {
        setActiveHandoff(sessionID, handoff);
      }
    })();
  };
  let lastRenderedSlotSessionID;
  const cancelActiveInteraction = (reason) => {
    if (pending.size === 0 && inFlightForms.size === 0) return;
    const targets = /* @__PURE__ */ new Set();
    try {
      const route = context.ui.router.current();
      if (route?.type === "session" && route.sessionID) {
        targets.add(route.sessionID);
      }
    } catch {
    }
    if (lastRenderedSlotSessionID) {
      targets.add(lastRenderedSlotSessionID);
    }
    const rootFn = context.data.session?.root;
    const activeRoots = /* @__PURE__ */ new Set();
    if (typeof rootFn === "function") {
      for (const sid of targets) {
        try {
          const rootID = rootFn(sid);
          if (typeof rootID === "string" && rootID) activeRoots.add(rootID);
        } catch {
        }
      }
    }
    for (const item of pending.values()) {
      if (targets.has(item.sessionID)) continue;
      if (targets.size === 0) {
        targets.add(item.sessionID);
        continue;
      }
      if (typeof rootFn === "function" && activeRoots.size > 0) {
        try {
          const rootID = rootFn(item.sessionID);
          if (typeof rootID === "string" && activeRoots.has(rootID)) {
            targets.add(item.sessionID);
          }
        } catch {
        }
      }
    }
    for (const entry of inFlightForms.values()) {
      if (targets.has(entry.sessionID)) continue;
      if (targets.size === 0) {
        targets.add(entry.sessionID);
        continue;
      }
      if (typeof rootFn === "function" && activeRoots.size > 0) {
        try {
          const rootID = rootFn(entry.sessionID);
          if (typeof rootID === "string" && activeRoots.has(rootID)) {
            targets.add(entry.sessionID);
          }
        } catch {
        }
      }
    }
    for (const sessionID of targets) {
      cancelSessionAutoSelection(sessionID, reason);
    }
  };
  const onKey = (keyEvent) => {
    if (keyEvent?.ctrl || keyEvent?.meta || keyEvent?.alt || keyEvent?.option || keyEvent?.super || keyEvent?.hyper) {
      return;
    }
    const keyName = typeof keyEvent?.name === "string" ? keyEvent.name.toLowerCase() : "";
    if (keyName && NON_INTERVENTION_KEYS.has(keyName)) return;
    cancelActiveInteraction("user keyboard interaction");
  };
  const onPaste = () => {
    cancelActiveInteraction("user paste interaction");
  };
  try {
    cleanups.push(context.data.on("form.created", onFormCreated));
    cleanups.push(context.data.on("form.replied", (event) => onFormSettled(event, "replied")));
    cleanups.push(context.data.on("form.cancelled", (event) => onFormSettled(event, "cancelled")));
    cleanups.push(context.data.on("session.synthetic", (event) => {
      const payload = event?.data ?? event?.properties;
      const sessionID = String(payload?.sessionID ?? "");
      if (!sessionID || sessionID === "global") return;
      setHandoffIfEligible(sessionID, payload, event?.location);
    }));
    cleanups.push(context.data.on("session.inbox.enqueued", (event) => {
      const payload = event?.data ?? event?.properties;
      const item = payload?.item;
      const sessionID = String(payload?.sessionID ?? item?.sessionID ?? "");
      if (!sessionID || sessionID === "global") return;
      if (item?.type === "synthetic") {
        setHandoffIfEligible(sessionID, item, event?.location);
      } else if (item?.type === "user" && !isInternalNonHumanMessage(item, sessionID)) {
        releaseUiLease(sessionID, event?.location?.directory);
        invalidateActiveHandoff(sessionID);
        sessionChains.delete(sessionID);
        cancelInFlightForSession(sessionID);
        clearSessionState(sessionID);
      }
    }));
    cleanups.push(context.data.on("session.deleted", (event) => {
      const payload = event?.data ?? event?.properties;
      const sessionID = String(payload?.sessionID ?? payload?.info?.id ?? payload?.session?.id ?? payload?.id ?? "");
      if (sessionID && sessionID !== "global") {
        releaseUiLease(sessionID, event?.location?.directory);
        clearActiveHandoff(sessionID);
        forgetMeshSession(sessionID);
        sessionChains.delete(sessionID);
        cancelInFlightForSession(sessionID);
        cleanupSessionRemediations(sessionID);
        clearSessionState(sessionID);
      }
    }));
    const keyInput = context.renderer.keyInput;
    const subscribeKey = typeof keyInput.prependListener === "function" ? keyInput.prependListener.bind(keyInput) : keyInput.on.bind(keyInput);
    subscribeKey("keypress", onKey);
    cleanups.push(() => keyInput.off("keypress", onKey));
    subscribeKey("paste", onPaste);
    cleanups.push(() => keyInput.off("paste", onPaste));
    cleanups.push(context.ui.slot({
      append: "session.composer.top",
      render: (slotProps) => {
        const getSessionID = () => {
          const sid = slotProps?.sessionID ?? context.ui.router.current()?.sessionID;
          if (typeof sid === "string" && sid) {
            lastRenderedSlotSessionID = sid;
          }
          return sid;
        };
        return _$createComponent(SmartQuestionOverlay, {
          state: () => {
            const sid = getSessionID();
            return sid ? activeBySession()[sid] ?? null : null;
          },
          countdown: () => {
            const sid = getSessionID();
            return sid ? activeBySession()[sid]?.countdown ?? 0 : 0;
          },
          markers: () => {
            const sid = getSessionID();
            return sid ? activeBySession()[sid]?.markers ?? DEFAULT_CONFIG.recommendedMarkers : DEFAULT_CONFIG.recommendedMarkers;
          },
          uiText: () => {
            const sid = getSessionID();
            return sid ? activeBySession()[sid]?.uiText ?? DEFAULT_CONFIG.uiText : DEFAULT_CONFIG.uiText;
          }
        });
      }
    }));
  } catch (error) {
    disposed = true;
    releaseAllUiLeases();
    inFlightForms.clear();
    lifecycleController.abort();
    disposeCleanups();
    for (const formID of pending.keys()) {
      clearPending(formID);
    }
    remediatedForms.clear();
    settledForms.clear();
    userCancelledForms.clear();
    sessionChains.clear();
    setActiveBySession({});
    throw error;
  }
  return () => {
    disposed = true;
    releaseAllUiLeases();
    inFlightForms.clear();
    lifecycleController.abort();
    disposeCleanups();
    for (const formID of pending.keys()) {
      clearPending(formID);
    }
    remediatedForms.clear();
    settledForms.clear();
    userCancelledForms.clear();
    sessionChains.clear();
    setActiveBySession({});
  };
};
var OpencodeSmartQuestionsTui = OpenCodeV2Tui.define({
  id: "opencode-smart-questions.tui",
  setup
});
var tui_runtime_default = OpencodeSmartQuestionsTui;
export {
  OpencodeSmartQuestionsTui,
  SmartQuestionOverlay,
  tui_runtime_default as default,
  detectRecommendations2 as detectRecommendations,
  formatCountdown2 as formatCountdown,
  loadConfig2 as loadConfig,
  resolveAgentName,
  setup,
  stripMarker2 as stripMarker
};
