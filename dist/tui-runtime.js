// src/tui-runtime.js
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createTextNode as _$createTextNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insertNode as _$insertNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
import fs3 from "node:fs";
import path3 from "node:path";
import { Show, createMemo, createSignal } from "opentui:runtime-module:solid-js";

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
var DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS = 3;
var MAX_TIMEOUT_MS = 2147483647;
var SMART_QUESTION_CONFIG_KEYS = /* @__PURE__ */ new Set([
  "enabled",
  "timeoutMs",
  "recommendedMarkers",
  "recommendedMarker",
  "manualMarkers",
  "manualMarker",
  "maxUnclassifiedRemediations",
  "unclassifiedQuestionPolicy",
  "requireExactlyOneRecommendation",
  "uiText",
  "debugLog",
  "configDir"
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
  session: "Session:"
};
var DEFAULT_CONFIG = {
  enabled: true,
  timeoutMs: 3e4,
  recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
  recommendedMarker: "[SQ:recommended]",
  manualMarkers: DEFAULT_MANUAL_MARKERS,
  manualMarker: "[SQ:manual]",
  maxUnclassifiedRemediations: DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS,
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
    session: typeof overrides.session === "string" && overrides.session.trim() ? overrides.session : DEFAULT_UI_TEXT.session
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
  if (parsed.enabled !== void 0 && parsed.enabled !== true || parsed.timeoutMs !== void 0 && (typeof parsed.timeoutMs !== "number" || !Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 0 || parsed.timeoutMs > MAX_TIMEOUT_MS) || parsed.requireExactlyOneRecommendation !== void 0 && typeof parsed.requireExactlyOneRecommendation !== "boolean" || parsed.recommendedMarkers !== void 0 && (!Array.isArray(parsed.recommendedMarkers) || parsed.recommendedMarkers.length === 0 || parsed.recommendedMarkers.some((marker) => typeof marker !== "string" || marker.trim().length === 0)) || parsed.recommendedMarker !== void 0 && (typeof parsed.recommendedMarker !== "string" || parsed.recommendedMarker.trim().length === 0) || parsed.debugLog !== void 0 && typeof parsed.debugLog !== "string" || parsed.configDir !== void 0 && (typeof parsed.configDir !== "string" || parsed.configDir.trim().length === 0) || parsed.manualMarkers !== void 0 && (!Array.isArray(parsed.manualMarkers) || parsed.manualMarkers.length === 0 || parsed.manualMarkers.some((marker) => typeof marker !== "string" || marker.trim().length === 0)) || parsed.manualMarker !== void 0 && (typeof parsed.manualMarker !== "string" || parsed.manualMarker.trim().length === 0) || parsed.maxUnclassifiedRemediations !== void 0 && (typeof parsed.maxUnclassifiedRemediations !== "number" || !Number.isFinite(parsed.maxUnclassifiedRemediations) || parsed.maxUnclassifiedRemediations < 0) || parsed.uiText !== void 0 && (parsed.uiText === null || typeof parsed.uiText !== "object" || Array.isArray(parsed.uiText) || Object.values(parsed.uiText).some((value) => typeof value !== "string" || value.trim().length === 0))) {
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
  const maxUnclassifiedRemediations = typeof parsed.maxUnclassifiedRemediations === "number" && Number.isFinite(parsed.maxUnclassifiedRemediations) && parsed.maxUnclassifiedRemediations >= 0 ? Math.floor(parsed.maxUnclassifiedRemediations) : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;
  const timeoutMs = typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs >= 0 && parsed.timeoutMs <= MAX_TIMEOUT_MS ? parsed.timeoutMs : DEFAULT_CONFIG.timeoutMs;
  const normalized = {
    enabled: true,
    timeoutMs,
    recommendedMarkers,
    recommendedMarker,
    manualMarkers,
    manualMarker,
    maxUnclassifiedRemediations,
    requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === "boolean" ? parsed.requireExactlyOneRecommendation : DEFAULT_CONFIG.requireExactlyOneRecommendation,
    uiText: normalizeUIText(parsed.uiText),
    debugLog: typeof parsed.debugLog === "string" ? parsed.debugLog : DEFAULT_CONFIG.debugLog ?? ""
  };
  const resolvedConfigDir = typeof parsed.configDir === "string" && parsed.configDir ? parsed.configDir : configDir;
  if (resolvedConfigDir) normalized.configDir = resolvedConfigDir;
  return normalized;
}
function resolveSmartQuestionConfig(projectDir, pluginOptions) {
  const directory = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
  const configDir = path.resolve(directory, ".opencode");
  if (pluginOptions && Object.prototype.hasOwnProperty.call(pluginOptions, "config")) {
    return normalizeSmartQuestionConfig(pluginOptions.config, configDir);
  }
  if (hasSmartQuestionConfigOptions(pluginOptions)) {
    return normalizeSmartQuestionConfig(pluginOptions, configDir);
  }
  return loadConfig(projectDir);
}
function loadConfig(projectDir) {
  if (projectDir && typeof projectDir === "object" && ("client" in projectDir || "directory" in projectDir)) {
    return {};
  }
  const dir = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
  const candidatePaths = [
    path.resolve(dir, ".opencode/smart-question.json"),
    path.resolve(dir, "smart-question.json"),
    path.resolve(os.homedir(), ".config/opencode/smart-question.json")
  ];
  let configPath = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }
  if (!configPath) {
    return normalizeSmartQuestionConfig({}, path.resolve(dir, ".opencode"));
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    const normalized = normalizeSmartQuestionConfig(parsed, path.dirname(configPath));
    if (!normalized && parsed?.enabled !== false) {
      console.error("[smart-question] Invalid smart-question config; auto-selection disabled");
    }
    return normalized;
  } catch (err) {
    console.error(
      `[smart-question] Failed to load smart-question config (${diagnosticErrorCode(err)}); auto-selection disabled`
    );
    return null;
  }
}

// src/detector.ts
function detectRecommendations(questions, marker = DEFAULT_CONFIG.recommendedMarkers, options = {}) {
  if (questions && typeof questions === "object" && !Array.isArray(questions) && ("client" in questions || "directory" in questions)) {
    return {};
  }
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
function isQuestionExplicitlyManual(q, manualMarkers = DEFAULT_MANUAL_MARKERS) {
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
  return { isManual: false };
}
function classifyQuestions(questions, recommendedMarker = DEFAULT_CONFIG.recommendedMarkers, manualMarker = DEFAULT_MANUAL_MARKERS, handoff, options = {}) {
  void options;
  if (!Array.isArray(questions) || questions.length === 0) {
    return { status: "unclassified", reason: "No questions provided in request" };
  }
  if (handoff && typeof handoff === "object" && "autoSelect" in handoff && handoff.autoSelect === "forbidden") {
    return {
      status: "manual",
      reason: "Guardian handoff explicitly forbids auto-selection (auto_select=forbidden)",
      matchedMarker: "[OPENCODE_HANDOFF:auto_select=forbidden]"
    };
  }
  const recMarkers = normalizeParamMarkers(recommendedMarker);
  const manMarkers = normalizeParamMarkers(manualMarker);
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
    const manualCheck = isQuestionExplicitlyManual(q, manMarkers);
    if (manualCheck.isManual) {
      if (!firstManual) {
        firstManual = { index: qIndex, marker: manualCheck.matchedMarker };
      }
      continue;
    }
    const matched = q.options.map((opt) => {
      if (!opt || typeof opt.label !== "string") return null;
      const normalizedLabel = opt.label.trimEnd().normalize("NFC");
      const m = recMarkers.find((marker) => normalizedLabel.endsWith(marker.normalize("NFC")));
      return m ? { opt, marker: m } : null;
    }).filter((x) => x !== null);
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
      if (!firstUnclassified) {
        firstUnclassified = {
          index: qIndex,
          reason: `Question ${qIndex} has ambiguous recommendation markers (${matched.length})`
        };
      }
      continue;
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

// src/draft-guard.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { randomUUID } from "node:crypto";
function resolveLockPath(configDir, requestID) {
  if (configDir && typeof configDir === "object" && ("client" in configDir || "directory" in configDir)) {
    return {};
  }
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
  if (lockPath && typeof lockPath === "object" && ("client" in lockPath || "directory" in lockPath)) {
    return {};
  }
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

// src/form-adapter.ts
function classifyV2Form(form, markers = DEFAULT_CONFIG.recommendedMarkers, manualMarkers = DEFAULT_MANUAL_MARKERS, handoff, options) {
  if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
    return { status: "unclassified", reason: "Form has no fields", questions: [] };
  }
  const manMarkers = normalizeParamMarkers(manualMarkers);
  const formTexts = [];
  if (typeof form.title === "string") formTexts.push(form.title);
  if (typeof form.description === "string") formTexts.push(form.description);
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
    if (/\[SQ_DECISION:(?:v1\][\s\S]*?mode=)?manual/iu.test(normalized)) {
      formExplicitlyManual = true;
      matchedManualMarker = "[SQ:manual]";
      break;
    }
  }
  const questions = [];
  const selectableFields = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i];
    if (!field) {
      return { status: "unclassified", reason: `Form field ${i + 1} is missing`, questions };
    }
    if (field.hidden === true || field.when !== void 0 && (!Array.isArray(field.when) || field.when.length > 0)) {
      return {
        status: "unclassified",
        reason: `Form field ${i + 1} (${field.key ?? "unknown"}) is hidden or conditional`,
        questions
      };
    }
    const isStringChoice = field.type === "string" && Array.isArray(field.options) && field.options.length > 0;
    const isMultiChoice = field.type === "multiselect" && Array.isArray(field.options) && field.options.length > 0;
    if (!isStringChoice && !isMultiChoice) {
      return {
        status: "unclassified",
        reason: `Form field ${i + 1} (${field.key ?? "unknown"}) is not a supported selectable field`,
        questions
      };
    }
    if (typeof field.key !== "string" || !field.key || seenKeys.has(field.key)) {
      return {
        status: "unclassified",
        reason: `Form field ${i + 1} has a missing or duplicate key`,
        questions
      };
    }
    seenKeys.add(field.key);
    if (isMultiChoice) {
      const constraints = [field.minItems, field.maxItems].filter(
        (value) => value !== void 0
      );
      if (constraints.some((value) => !Number.isInteger(value) || value < 0) || field.minItems !== void 0 && field.maxItems !== void 0 && field.minItems > field.maxItems) {
        return {
          status: "unclassified",
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
        status: "unclassified",
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
  if (formExplicitlyManual) {
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
      answer[field.key] = selectedValues;
    } else {
      const value = selectedValues[0];
      if (typeof value !== "string") {
        return {
          status: "unclassified",
          reason: `Missing recommendation value for field ${field.key}`,
          questions
        };
      }
      answer[field.key] = value;
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

// src/session-scope.ts
function asRecord(value) {
  return value && typeof value === "object" ? value : null;
}
function unwrapSessionInfo(value) {
  const record = asRecord(value);
  if (!record) return null;
  const data = asRecord(record.data);
  if (data) return data;
  return record;
}
function classifySessionScope(value) {
  const session = unwrapSessionInfo(value);
  if (!session || typeof session.id !== "string" || !session.id) {
    return "unknown";
  }
  const parentID = session.parentID;
  if (typeof parentID === "string") {
    return parentID.trim() ? "child" : "root";
  }
  if (parentID === void 0 || parentID === null) {
    return "root";
  }
  return "unknown";
}
function isRootSessionInfo(value) {
  return classifySessionScope(value) === "root";
}

// src/handoff.ts
var OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
var GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
var GUARDIAN_PROVENANCE_KEY = "opencode-guardian";
var DEFAULT_HANDOFF_TTL_MS = 12e4;
var CLOSED_HANDOFF_TTL_MS = 10 * 6e4;
var MAX_CLOSED_HANDOFF_IDS = 512;
var COORDINATION_SYMBOL = Symbol.for("opencode.coordination.v1");
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function isPluginInput(arg) {
  return Boolean(
    arg && typeof arg === "object" && ("client" in arg || "directory" in arg || "project" in arg)
  );
}
function hasGuardianMetadata(value) {
  if (!isRecord(value)) return false;
  const metadata = isRecord(value.metadata) ? value.metadata : void 0;
  return metadata?.[GUARDIAN_PROVENANCE_KEY] === true;
}
function messageRole(value) {
  if (!isRecord(value)) return void 0;
  if (typeof value.role === "string") return value.role;
  if (typeof value.type === "string" && value.type === "user") return "user";
  if (isRecord(value.info) && typeof value.info.role === "string") {
    return value.info.role;
  }
  if (isRecord(value.message)) {
    return messageRole(value.message);
  }
  return void 0;
}
function messageParts(value) {
  if (!isRecord(value)) return void 0;
  if (Array.isArray(value.parts)) return value.parts;
  if (Array.isArray(value.content)) return value.content;
  if (isRecord(value.message)) return messageParts(value.message);
  return void 0;
}
function messageTextCandidates(value) {
  if (!isRecord(value)) return [];
  const out = [];
  if (typeof value.text === "string") out.push(value.text);
  if (typeof value.content === "string") out.push(value.content);
  const parts = messageParts(value);
  if (parts) {
    for (const part of parts) {
      if (isRecord(part) && typeof part.text === "string") {
        out.push(part.text);
      }
    }
  }
  if (isRecord(value.message)) {
    out.push(...messageTextCandidates(value.message));
  }
  return out;
}
function parseOpenCodeHandoff(text, options) {
  if (isPluginInput(text)) return {};
  if (typeof text !== "string" || !text.includes(OPENCODE_HANDOFF_HEADER)) return null;
  const requireMarker = typeof options === "boolean" ? options : Boolean(options?.requireRemediationMarker);
  if (requireMarker && !text.includes(GUARDIAN_REMEDIATION_MARKER)) {
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
  const source = map.get("source");
  const action = map.get("action");
  const kind = map.get("kind");
  const autoSelect = map.get("auto_select");
  const handoffId = map.get("handoff_id");
  if (source !== "guardian" || action !== "question_required" || !handoffId) {
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
    source: "guardian",
    action: "question_required",
    kind,
    autoSelect,
    handoffId
  };
}
function extractHandoffFromParts(parts, options) {
  if (isPluginInput(parts)) return {};
  if (!Array.isArray(parts)) return null;
  const requireMarker = typeof options === "boolean" ? options : options?.requireRemediationMarker ?? true;
  const requireProvenance = typeof options === "boolean" ? true : options?.requireGuardianProvenance ?? true;
  for (const part of parts) {
    if (!isRecord(part) || typeof part.text !== "string") continue;
    if (requireProvenance && !hasGuardianMetadata(part)) continue;
    if (requireMarker && !part.text.includes(GUARDIAN_REMEDIATION_MARKER)) continue;
    const parsed = parseOpenCodeHandoff(part.text, false);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      return parsed;
    }
  }
  return null;
}
function extractTrustedGuardianHandoff(source) {
  if (isPluginInput(source)) return {};
  if (!isRecord(source)) return null;
  const message = isRecord(source.message) ? source.message : void 0;
  const directProvenance = hasGuardianMetadata(source) || hasGuardianMetadata(source.info) || hasGuardianMetadata(message) || (message ? hasGuardianMetadata(message.info) : false);
  const parts = messageParts(source);
  if (parts) {
    const fromParts = extractHandoffFromParts(parts, {
      requireRemediationMarker: true,
      requireGuardianProvenance: !directProvenance
    });
    if (fromParts && typeof fromParts === "object" && "version" in fromParts) {
      return fromParts;
    }
  }
  if (directProvenance) {
    for (const text of messageTextCandidates(source)) {
      const parsed = parseOpenCodeHandoff(text, { requireRemediationMarker: true });
      if (parsed && typeof parsed === "object" && "version" in parsed) {
        return parsed;
      }
    }
  }
  return null;
}
function extractCurrentTurnGuardianHandoff(messages) {
  if (isPluginInput(messages)) return {};
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const handoff = extractTrustedGuardianHandoff(message);
    if (handoff && typeof handoff === "object" && "version" in handoff) {
      return handoff;
    }
    if (messageRole(message) === "user") {
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
      closedHandoffIds: /* @__PURE__ */ new Map()
    };
    g[HANDOFF_STATE_SYMBOL] = state;
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
function pruneClosedHandoffs(state, now = Date.now()) {
  for (const [handoffId, closedAt] of state.closedHandoffIds) {
    if (now - closedAt > CLOSED_HANDOFF_TTL_MS) {
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
function setActiveHandoff(sessionID, handoff, timestamp) {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? "");
  const h = handoff;
  if (!sID || !h?.handoffId) return false;
  const state = getHandoffState();
  pruneClosedHandoffs(state);
  if (state.closedHandoffIds.has(h.handoffId)) {
    return false;
  }
  state.activeHandoffsBySession.set(sID, {
    handoff: h,
    createdAt: typeof timestamp === "number" ? timestamp : Date.now()
  });
  return true;
}
function getActiveHandoff(sessionID, maxAgeMs = DEFAULT_HANDOFF_TTL_MS) {
  if (isPluginInput(sessionID)) return {};
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
  if (isPluginInput(sessionID)) return {};
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
  if (isPluginInput(sessionID)) return {};
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
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? "");
  if (!sID) return;
  getHandoffState().activeHandoffsBySession.delete(sID);
}

// src/backend.ts
var SQ_REMEDIATION_HEADER = "[Smart Questions protocol remediation]";
function buildUnclassifiedRemediationPrompt(primaryMarker, manualMarker = "[SQ:manual]") {
  if (primaryMarker && typeof primaryMarker === "object" && ("client" in primaryMarker || "directory" in primaryMarker)) {
    return {};
  }
  const recMarker = typeof primaryMarker === "string" ? primaryMarker : "[SQ:recommended]";
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
      mode: 384
    });
    return true;
  } catch {
    return false;
  }
}
function resolveV2TuiConfig(context, directory = context.location?.directory) {
  return resolveSmartQuestionConfig(directory, context.options);
}
function resolveAgentName(api, sessionID, eventProps) {
  if (typeof eventProps?.agent === "string" && eventProps.agent.trim().length > 0) {
    return {
      name: eventProps.agent.trim(),
      found: true
    };
  }
  if (typeof eventProps?.agentName === "string" && eventProps.agentName.trim().length > 0) {
    return {
      name: eventProps.agentName.trim(),
      found: true
    };
  }
  try {
    const session = api?.state?.session?.get?.(sessionID);
    if (session && typeof session.agent === "string" && session.agent.trim().length > 0) {
      return {
        name: session.agent.trim(),
        found: true
      };
    }
  } catch {
  }
  const shortId = sessionID && typeof sessionID === "string" ? sessionID.slice(0, 8) : "unknown";
  return {
    name: shortId,
    found: false
  };
}
function stripMarker(label, marker) {
  const strLabel = (typeof label === "string" ? label : String(label ?? "")).trimEnd().normalize("NFC");
  const markers = Array.isArray(marker) ? marker.filter((item) => typeof item === "string" && item.length > 0) : typeof marker === "string" && marker.length > 0 ? [marker] : [];
  let longestMatch = "";
  for (const candidate of markers) {
    const normalized = candidate.normalize("NFC");
    if (strLabel.endsWith(normalized) && normalized.length > longestMatch.length) {
      longestMatch = normalized;
    }
  }
  return longestMatch ? strLabel.slice(0, -longestMatch.length).trim() : strLabel;
}
function formatCountdown(totalSeconds) {
  const numeric = typeof totalSeconds === "number" && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const clamped = Math.max(0, Math.floor(numeric));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function SmartQuestionOverlay(props) {
  const active = () => props.state();
  const markers = () => props.markers ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers ?? [];
  const labels = () => props.uiText ?? DEFAULT_CONFIG.uiText;
  const recommendedChecklist = createMemo(() => {
    const state = active();
    if (!state?.detection?.ok) return "";
    return (state.detection.recommendedOptions ?? []).filter((option) => option && typeof option.label === "string").map((option) => stripMarker(option.label, markers())).filter(Boolean).map((label) => `\u2713 ${label}`).join("   ");
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
    return formatCountdown(seconds);
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
      var _el$ = _$createElement("box"), _el$2 = _$createElement("box"), _el$3 = _$createElement("text"), _el$4 = _$createElement("box"), _el$5 = _$createElement("text"), _el$6 = _$createElement("b");
      _$insertNode(_el$, _el$2);
      _$insertNode(_el$, _el$4);
      _$setProp(_el$, "width", "100%");
      _$setProp(_el$, "border", true);
      _$setProp(_el$, "borderStyle", "rounded");
      _$setProp(_el$, "borderColor", "cyan");
      _$setProp(_el$, "title", " Smart Question ");
      _$setProp(_el$, "paddingLeft", 1);
      _$setProp(_el$, "paddingRight", 1);
      _$setProp(_el$, "flexDirection", "column");
      _$insertNode(_el$2, _el$3);
      _$setProp(_el$2, "width", "100%");
      _$setProp(_el$2, "flexDirection", "row");
      _$setProp(_el$2, "justifyContent", "flex-end");
      _$setProp(_el$3, "fg", "gray");
      _$insert(_el$3, badge);
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
            var _el$12 = _$createElement("text"), _el$13 = _$createElement("b");
            _$insertNode(_el$12, _el$13);
            _$setProp(_el$12, "fg", "red");
            _$insert(_el$13, () => labels().disabled);
            return _el$12;
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
      _$insert(_el$, _$createComponent(Show, {
        get when() {
          return active()?.errorMessage;
        },
        get children() {
          var _el$9 = _$createElement("text");
          _$setProp(_el$9, "fg", "red");
          _$insert(_el$9, () => active()?.errorMessage);
          return _el$9;
        }
      }), null);
      _$insert(_el$, _$createComponent(Show, {
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
      }), null);
      return _el$;
    }
  });
}
var tui = async (api, options) => {
  const projectDir = api.state?.path?.directory ?? process.cwd();
  const config = resolveSmartQuestionConfig(projectDir, options);
  if (!config?.enabled) return;
  const log = createDiagnosticLogger(config, "smart-question-ui");
  if (!canUseDraftCoordination(config.configDir, log)) return;
  const [activeQuestion, setActiveQuestion] = createSignal(null);
  const [countdownSec, setCountdownSec] = createSignal(0);
  let countdownTimer = null;
  let currentLockPath = null;
  let triggerFocusGuard = null;
  const clearTimer = () => {
    if (!countdownTimer) return;
    clearInterval(countdownTimer);
    countdownTimer = null;
  };
  const clearActive = (removeLock = true) => {
    clearTimer();
    triggerFocusGuard = null;
    if (removeLock && currentLockPath) {
      deleteLockfile(currentLockPath, log);
    }
    currentLockPath = null;
    setActiveQuestion(null);
    api.renderer?.requestRender?.();
  };
  const onAsked = (event) => {
    const data = event?.properties ?? event?.data ?? event;
    const requestID = data?.id ?? data?.requestID ?? event?.id;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? "");
    const questions = data?.questions ?? event?.questions ?? [];
    if (typeof requestID !== "string" || !sessionID || !Array.isArray(questions) || questions.length === 0) {
      return;
    }
    let sessionInfo;
    try {
      sessionInfo = api?.state?.session?.get?.(sessionID);
    } catch {
      return;
    }
    if (!isRootSessionInfo(sessionInfo)) return;
    const decision = detectRecommendations2(questions, config.recommendedMarkers, {
      requireExactlyOneRecommendation: config.requireExactlyOneRecommendation
    });
    if (!decision.ok) return;
    let handoff = getActiveHandoff(sessionID);
    if (!handoff) {
      try {
        const msgs = api?.state?.session?.messages?.(sessionID);
        if (Array.isArray(msgs)) {
          const extracted = extractCurrentTurnGuardianHandoff(msgs);
          if (extracted && typeof extracted === "object" && "version" in extracted) {
            if (setActiveHandoff(sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        }
      } catch {
      }
    }
    if (handoff && typeof handoff === "object" && "autoSelect" in handoff && handoff.autoSelect === "forbidden") {
      log(`skip request=${requestID} reason=guardian-handoff-auto-select-forbidden handoffId=${handoff.handoffId}`);
      return;
    }
    clearActive(!activeQuestion()?.focusDisabled);
    const agent = resolveAgentName(api, sessionID, data);
    const lockPath = resolveLockPath(config.configDir, requestID);
    currentLockPath = lockPath;
    setActiveQuestion({
      requestID,
      sessionID,
      questions,
      detection: decision,
      agentName: agent.name,
      agentFound: agent.found,
      focusDisabled: false
    });
    let focusGuardTriggered = false;
    triggerFocusGuard = (reason) => {
      if (focusGuardTriggered) return;
      focusGuardTriggered = true;
      clearTimer();
      ensureDraftLock(lockPath, {
        requestID,
        sessionID,
        ts: Date.now(),
        reason
      });
      setActiveQuestion((current) => current?.requestID === requestID ? {
        ...current,
        focusDisabled: true
      } : current);
      log(`manual interaction request=${requestID} reason=${reason}`);
      api.renderer?.requestRender?.();
    };
    const startedAt = Date.now();
    const updateCountdown = () => {
      const remainingMs = Math.max(0, config.timeoutMs - (Date.now() - startedAt));
      setCountdownSec(Math.ceil(remainingMs / 1e3));
      if (remainingMs <= 0) {
        clearTimer();
        setActiveQuestion(null);
        currentLockPath = null;
      }
      api.renderer?.requestRender?.();
    };
    updateCountdown();
    if (config.timeoutMs > 0) {
      countdownTimer = setInterval(updateCountdown, 250);
    }
  };
  const onEnd = (event) => {
    const data = event?.properties ?? event?.data ?? event;
    const requestID = data?.requestID ?? data?.id ?? event?.id;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? "");
    if (sessionID) {
      consumeActiveHandoff(sessionID);
    }
    const current = activeQuestion();
    if (current && typeof requestID === "string" && requestID === current.requestID) {
      clearActive();
    }
  };
  const onMessageCreated = (event) => {
    const data = event?.properties ?? event?.data ?? event;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? "");
    if (!sessionID) return;
    const handoff = extractTrustedGuardianHandoff(data);
    if (handoff && typeof handoff === "object" && "version" in handoff) {
      setActiveHandoff(sessionID, handoff);
    } else {
      const role = data?.role ?? data?.message?.role;
      if (role === "user") {
        invalidateActiveHandoff(sessionID);
      }
    }
  };
  const onSessionDeleted = (event) => {
    const data = event?.properties ?? event?.data ?? event;
    const sessionID = String(data?.id ?? data?.sessionID ?? event?.sessionID ?? "");
    if (sessionID) {
      clearActiveHandoff(sessionID);
    }
  };
  const stopAsked = api.event?.on?.("question.asked", onAsked);
  const stopReplied = api.event?.on?.("question.replied", onEnd);
  const stopRejected = api.event?.on?.("question.rejected", onEnd);
  const stopMsgUpdated = api.event?.on?.("message.updated", onMessageCreated);
  const stopMsgCreated = api.event?.on?.("message.created", onMessageCreated);
  const stopSessionDel = api.event?.on?.("session.deleted", onSessionDeleted);
  api.slots?.register?.({
    slots: {
      app_bottom() {
        return _$createComponent(SmartQuestionOverlay, {
          state: activeQuestion,
          countdown: countdownSec,
          get markers() {
            return config.recommendedMarkers;
          },
          get uiText() {
            return config.uiText;
          }
        });
      }
    }
  });
  const onKey = () => {
    if (activeQuestion() && triggerFocusGuard) {
      triggerFocusGuard("user keyboard interaction");
    }
  };
  const onPaste = () => {
    if (activeQuestion() && triggerFocusGuard) {
      triggerFocusGuard("user paste interaction");
    }
  };
  let stopLegacyKey;
  let keypressRegistered = false;
  let pasteRegistered = false;
  let cleaned = false;
  const cleanupLocal = () => {
    if (cleaned) return;
    cleaned = true;
    stopLegacyKey?.();
    stopAsked?.();
    stopReplied?.();
    stopRejected?.();
    stopMsgUpdated?.();
    stopMsgCreated?.();
    stopSessionDel?.();
    if (keypressRegistered) {
      api.renderer?.keyInput?.off?.("keypress", onKey);
      keypressRegistered = false;
    }
    if (pasteRegistered) {
      api.renderer?.keyInput?.off?.("paste", onPaste);
      pasteRegistered = false;
    }
    clearActive(activeQuestion()?.focusDisabled !== true);
  };
  api.lifecycle?.onDispose?.(cleanupLocal);
  try {
    if (typeof api.renderer?.keyInput?.on === "function") {
      api.renderer.keyInput.on("keypress", onKey);
      keypressRegistered = true;
      api.renderer.keyInput.on("paste", onPaste);
      pasteRegistered = true;
    }
    stopLegacyKey = api.keymap?.intercept?.("key", onKey);
  } catch (error) {
    cleanupLocal();
    throw error;
  }
};
var setup = async (context) => {
  const formApi = context?.data?.session?.form;
  if (!context || typeof context !== "object" || typeof context.data?.on !== "function" || typeof formApi?.sync !== "function" || typeof formApi?.list !== "function" || typeof formApi?.reply !== "function" || typeof formApi?.invalidate !== "function" || typeof context.renderer?.keyInput?.on !== "function" || typeof context.renderer?.keyInput?.off !== "function" || typeof context.ui?.router?.current !== "function" || typeof context.ui?.slot !== "function") {
    return;
  }
  if (hasSmartQuestionConfigOptions(context.options)) {
    const explicitConfig = resolveV2TuiConfig(context);
    if (!explicitConfig?.enabled) return;
  }
  const [activeBySession, setActiveBySession] = createSignal({});
  const pending = /* @__PURE__ */ new Map();
  const remediatedForms = /* @__PURE__ */ new Set();
  const sessionRemediations = /* @__PURE__ */ new Map();
  const updateSessionState = (sessionID, updater) => {
    setActiveBySession((current) => {
      const next = {
        ...current
      };
      const updated = updater(next[sessionID]);
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
  const cancelSessionAutoSelection = (sessionID, reason) => {
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
    const form = event?.data?.form;
    if (!form?.id || !form.sessionID || form.sessionID === "global") return;
    let sessionInfo;
    try {
      sessionInfo = context.data.session?.get?.(form.sessionID);
    } catch {
      return;
    }
    if (!isRootSessionInfo(sessionInfo)) return;
    for (const [id, existing] of pending.entries()) {
      if (existing.sessionID === form.sessionID) {
        clearPending(id);
      }
    }
    const sessionLocation = sessionInfo?.location;
    const location = event?.location ?? sessionLocation ?? context.location;
    const config = resolveV2TuiConfig(context, location?.directory);
    if (!config?.enabled) return;
    const log = createDiagnosticLogger(config, "smart-question-v2-ui");
    let handoff = getActiveHandoff(form.sessionID);
    if (!handoff) {
      try {
        const msgs = context.data?.session?.messages?.(form.sessionID);
        if (Array.isArray(msgs)) {
          const extracted = extractCurrentTurnGuardianHandoff(msgs);
          if (extracted && typeof extracted === "object" && "version" in extracted) {
            if (setActiveHandoff(form.sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        }
      } catch {
      }
    }
    const classification = classifyV2Form(form, config.recommendedMarkers, config.manualMarkers, handoff, {
      requireExactlyOneRecommendation: config.requireExactlyOneRecommendation
    });
    if (classification.status === "manual") {
      log(`skip form=${form.id} reason=manual-classification matched=${classification.matchedMarker ?? "none"}`);
      return;
    }
    if (classification.status === "unclassified") {
      log(`unclassified form=${form.id} reason=${classification.reason}`);
      if (remediatedForms.has(form.id)) {
        log(`suppress duplicate remediation form=${form.id}`);
        return;
      }
      const maxRemediations = typeof config.maxUnclassifiedRemediations === "number" ? config.maxUnclassifiedRemediations : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;
      const currentCount = sessionRemediations.get(form.sessionID) ?? 0;
      if (currentCount >= maxRemediations) {
        log(`unclassified remediation budget exhausted session=${form.sessionID} count=${currentCount}/${maxRemediations}`);
        return;
      }
      remediatedForms.add(form.id);
      sessionRemediations.set(form.sessionID, currentCount + 1);
      const promptText = buildUnclassifiedRemediationPrompt(config.recommendedMarker, config.manualMarker);
      let remediationSent = false;
      try {
        if (context.client?.session && typeof context.client.session.synthetic === "function") {
          await context.client.session.synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: "Smart Questions protocol remediation",
            metadata: {
              "opencode-smart-questions": true
            },
            delivery: "queue",
            resume: true
          });
          remediationSent = true;
        } else if (context.client?.session && typeof context.client.session.prompt === "function") {
          await context.client.session.prompt({
            sessionID: form.sessionID,
            prompt: promptText
          });
          remediationSent = true;
        } else if (context.data?.session && typeof context.data.session.synthetic === "function") {
          await context.data.session.synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: "Smart Questions protocol remediation",
            metadata: {
              "opencode-smart-questions": true
            },
            delivery: "queue",
            resume: true
          });
          remediationSent = true;
        } else if (context.session && typeof context.session?.synthetic === "function") {
          await context.session.synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: "Smart Questions protocol remediation",
            metadata: {
              "opencode-smart-questions": true
            },
            delivery: "queue",
            resume: true
          });
          remediationSent = true;
        }
      } catch (err) {
        log(`remediation send failed form=${form.id} code=${diagnosticErrorCode(err)}`);
      }
      if (!remediationSent) {
        remediatedForms.delete(form.id);
        if (currentCount === 0) sessionRemediations.delete(form.sessionID);
        else sessionRemediations.set(form.sessionID, currentCount);
        log(`remediation not sent form=${form.id}; retry remains allowed`);
      }
      return;
    }
    const detection = classification.detection;
    const lockPath = resolveLockPath(config.configDir, form.id);
    const expiresAt = Date.now() + config.timeoutMs;
    const initialCountdown = Math.ceil(config.timeoutMs / 1e3);
    const state = {
      requestID: form.id,
      formID: form.id,
      sessionID: form.sessionID,
      questions: classification.questions,
      detection,
      agentName: form.sessionID.slice(0, 8),
      agentFound: false,
      focusDisabled: false,
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
      if (pending.get(form.id) !== item || item.status !== "pending") return;
      item.status = "firing";
      if (item.interval) {
        clearInterval(item.interval);
        item.interval = null;
      }
      try {
        await context.data.session.form.sync(form.sessionID, item.location);
        const forms = context.data.session.form.list(form.sessionID, item.location);
        const stillPending = Array.isArray(forms) && forms.some((candidate) => candidate.id === form.id);
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
        item.status = "replied";
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
        updateSessionState(form.sessionID, (current) => current?.formID === form.id ? {
          ...current,
          countdown
        } : current);
      }, 250);
    }
    pending.set(form.id, item);
    updateSessionState(form.sessionID, () => state);
    log(`schedule form=${form.id} session=${form.sessionID} timeoutMs=${config.timeoutMs}`);
  };
  const onFormSettled = (event) => {
    const formID = event?.data?.id ?? event?.data?.form?.id ?? event?.properties?.id;
    const sessionID = event?.data?.sessionID ?? event?.data?.form?.sessionID ?? event?.properties?.sessionID;
    if (typeof sessionID === "string") consumeActiveHandoff(sessionID);
    if (typeof formID === "string") {
      remediatedForms.delete(formID);
      clearPending(formID);
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
  const onKey = () => {
    const route = context.ui.router.current();
    if (route.type === "session") {
      cancelSessionAutoSelection(route.sessionID, "user keyboard interaction");
    }
  };
  const onPaste = () => {
    const route = context.ui.router.current();
    if (route.type === "session") {
      cancelSessionAutoSelection(route.sessionID, "user paste interaction");
    }
  };
  try {
    cleanups.push(context.data.on("form.created", onFormCreated));
    cleanups.push(context.data.on("form.replied", onFormSettled));
    cleanups.push(context.data.on("form.cancelled", onFormSettled));
    try {
      const msgDisposer = context.data?.on?.("message.created", (event) => {
        const sessionID = String(event?.data?.sessionID ?? event?.sessionID ?? "");
        if (!sessionID || sessionID === "global") return;
        const handoff = extractTrustedGuardianHandoff(event?.data);
        if (handoff && typeof handoff === "object" && "version" in handoff) {
          setActiveHandoff(sessionID, handoff);
        } else {
          const role = event?.data?.role ?? event?.data?.info?.role ?? event?.data?.message?.role;
          if (role === "user") {
            invalidateActiveHandoff(sessionID);
          }
        }
      });
      if (typeof msgDisposer === "function") cleanups.push(msgDisposer);
      const sessionDelDisposer = context.data?.on?.("session.deleted", (event) => {
        const sessionID = String(event?.data?.id ?? event?.data?.sessionID ?? event?.sessionID ?? "");
        if (sessionID && sessionID !== "global") {
          clearActiveHandoff(sessionID);
          sessionRemediations.delete(sessionID);
        }
      });
      if (typeof sessionDelDisposer === "function") cleanups.push(sessionDelDisposer);
    } catch {
    }
    context.renderer.keyInput.on("keypress", onKey);
    cleanups.push(() => context.renderer.keyInput.off("keypress", onKey));
    context.renderer.keyInput.on("paste", onPaste);
    cleanups.push(() => context.renderer.keyInput.off("paste", onPaste));
    cleanups.push(context.ui.slot({
      append: "session.composer.top",
      render: ({
        sessionID
      }) => _$createComponent(SmartQuestionOverlay, {
        state: () => activeBySession()[sessionID] ?? null,
        countdown: () => activeBySession()[sessionID]?.countdown ?? 0,
        get markers() {
          return activeBySession()[sessionID]?.markers ?? DEFAULT_CONFIG.recommendedMarkers;
        },
        get uiText() {
          return activeBySession()[sessionID]?.uiText ?? DEFAULT_CONFIG.uiText;
        }
      })
    }));
  } catch (error) {
    disposeCleanups();
    for (const formID of pending.keys()) {
      clearPending(formID);
    }
    throw error;
  }
  return () => {
    disposeCleanups();
    for (const formID of pending.keys()) {
      clearPending(formID);
    }
  };
};
var pluginModule = {
  id: "smart-question-ui",
  tui,
  setup
};
var tui_runtime_default = pluginModule;
export {
  SmartQuestionOverlay,
  tui_runtime_default as default,
  detectRecommendations2 as detectRecommendations,
  formatCountdown,
  loadConfig2 as loadConfig,
  resolveAgentName,
  setup,
  stripMarker,
  tui
};
