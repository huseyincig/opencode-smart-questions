// src/tui-runtime.js
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
var DEFAULT_RECOMMENDED_MARKERS = [
  "[SQ:recommended]",
  "(Recommended)",
  "(\xD6nerilen)"
];
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
  if (parsed.enabled !== void 0 && parsed.enabled !== true || parsed.timeoutMs !== void 0 && (typeof parsed.timeoutMs !== "number" || !Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs < 0) || parsed.requireExactlyOneRecommendation !== void 0 && typeof parsed.requireExactlyOneRecommendation !== "boolean" || parsed.recommendedMarkers !== void 0 && (!Array.isArray(parsed.recommendedMarkers) || parsed.recommendedMarkers.length === 0 || parsed.recommendedMarkers.some((marker) => typeof marker !== "string" || marker.trim().length === 0)) || parsed.recommendedMarker !== void 0 && (typeof parsed.recommendedMarker !== "string" || parsed.recommendedMarker.trim().length === 0) || parsed.debugLog !== void 0 && typeof parsed.debugLog !== "string" || parsed.configDir !== void 0 && (typeof parsed.configDir !== "string" || parsed.configDir.trim().length === 0) || parsed.uiText !== void 0 && (parsed.uiText === null || typeof parsed.uiText !== "object" || Array.isArray(parsed.uiText) || Object.values(parsed.uiText).some((value) => typeof value !== "string" || value.trim().length === 0))) {
    return null;
  }
  const recommendedMarkers = normalizeConfigMarkers(
    parsed.recommendedMarkers,
    parsed.recommendedMarker
  );
  const recommendedMarker = typeof parsed.recommendedMarker === "string" && parsed.recommendedMarker.trim().length > 0 ? parsed.recommendedMarker.trim() : recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker;
  const timeoutMs = typeof parsed.timeoutMs === "number" && Number.isFinite(parsed.timeoutMs) && parsed.timeoutMs >= 0 ? parsed.timeoutMs : DEFAULT_CONFIG.timeoutMs;
  return {
    enabled: true,
    configDir: typeof parsed.configDir === "string" && parsed.configDir ? parsed.configDir : configDir,
    timeoutMs,
    recommendedMarkers,
    recommendedMarker,
    requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === "boolean" ? parsed.requireExactlyOneRecommendation : DEFAULT_CONFIG.requireExactlyOneRecommendation,
    uiText: normalizeUIText(parsed.uiText),
    debugLog: typeof parsed.debugLog === "string" ? parsed.debugLog : DEFAULT_CONFIG.debugLog
  };
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
      console.error(
        `[smart-question] Invalid config at ${configPath}; auto-selection disabled`
      );
    }
    return normalized;
  } catch (err) {
    console.error(
      `[smart-question] Failed to load config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`
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
    if (!matchedMarker) {
      matchedMarker = matched[0].marker;
    }
    if (q.multiple) {
      answers.push(matched.map((m) => m.opt.label));
      recommendedOptions.push(...matched.map((m) => m.opt));
    } else {
      answers.push([matched[0].opt.label]);
      recommendedOptions.push(matched[0].opt);
    }
  }
  return { ok: true, answers, recommendedOptions, matchedMarker };
}

// src/draft-guard.ts
import fs2 from "node:fs";
import path2 from "node:path";
function resolveLockPath(configDir, requestID) {
  if (configDir && typeof configDir === "object" && ("client" in configDir || "directory" in configDir)) {
    return {};
  }
  const opencodeDir = typeof configDir === "string" && configDir || path2.resolve(process.cwd(), ".opencode");
  const safeRequestID = encodeURIComponent(typeof requestID === "string" ? requestID : "unknown");
  return path2.join(opencodeDir, `.sq-draft-${safeRequestID}`);
}
function deleteLockfile(lockPath, dbg) {
  if (lockPath && typeof lockPath === "object" && ("client" in lockPath || "directory" in lockPath)) {
    return {};
  }
  try {
    if (typeof lockPath === "string" && fs2.existsSync(lockPath)) {
      fs2.unlinkSync(lockPath);
      dbg?.(`deleted lockfile path=${lockPath}`);
    }
  } catch (err) {
    const errCode = err?.code;
    if (errCode !== "ENOENT") {
      dbg?.(`failed to delete lockfile path=${lockPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

// src/form-adapter.ts
function detectV2FormRecommendations(form, markers, options) {
  if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
    return { ok: false, reason: "Form has no fields" };
  }
  const questions = [];
  const selectableFields = [];
  const seenKeys = /* @__PURE__ */ new Set();
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i];
    const isStringChoice = field?.type === "string" && Array.isArray(field.options) && field.options.length > 0;
    const isMultiChoice = field?.type === "multiselect" && Array.isArray(field.options) && field.options.length > 0;
    if (!isStringChoice && !isMultiChoice) {
      return {
        ok: false,
        reason: `Form field ${i + 1} (${field?.key ?? "unknown"}) is not a supported selectable field`
      };
    }
    if (typeof field.key !== "string" || !field.key || seenKeys.has(field.key)) {
      return { ok: false, reason: `Form field ${i + 1} has a missing or duplicate key` };
    }
    seenKeys.add(field.key);
    const fieldOptions = field.options;
    if (fieldOptions.some(
      (option) => !option || typeof option.value !== "string" || typeof option.label !== "string"
    )) {
      return {
        ok: false,
        reason: `Form field ${i + 1} contains an invalid option`
      };
    }
    const mappedOptions = fieldOptions.map((option) => ({
      label: option.label,
      description: option.description,
      value: option.value
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
      options: fieldOptions
    });
  }
  const detection = detectRecommendations(questions, markers, options);
  if (!detection.ok) return detection;
  const answer = {};
  for (let i = 0; i < selectableFields.length; i++) {
    const field = selectableFields[i];
    const selectedLabels = detection.answers[i] ?? [];
    const selectedValues = selectedLabels.map((label) => {
      const matchingOptions = field.options.filter((candidate) => candidate.label === label);
      return matchingOptions.length === 1 ? matchingOptions[0].value : void 0;
    });
    if (selectedValues.length !== selectedLabels.length || selectedValues.some((value) => typeof value !== "string")) {
      return {
        ok: false,
        reason: `Could not map recommended labels to values for field ${field.key}`
      };
    }
    if (field.multiple) {
      answer[field.key] = selectedValues;
    } else {
      const value = selectedValues[0];
      if (typeof value !== "string") {
        return {
          ok: false,
          reason: `Missing recommendation value for field ${field.key}`
        };
      }
      answer[field.key] = value;
    }
  }
  return { ok: true, answer, detection, questions };
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
`);
    } catch {
    }
  };
}
function ensureDraftLock(lockPath, payload) {
  try {
    fs3.mkdirSync(path3.dirname(lockPath), {
      recursive: true
    });
    fs3.writeFileSync(lockPath, JSON.stringify(payload), "utf8");
  } catch {
  }
}
function resolveV2TuiConfig(context) {
  const options = context.options;
  const configDir = context.location?.directory ? path3.resolve(context.location.directory, ".opencode") : void 0;
  if (options && Object.prototype.hasOwnProperty.call(options, "config")) {
    return normalizeSmartQuestionConfig(options.config, configDir);
  }
  const candidate = options;
  const knownKeys = /* @__PURE__ */ new Set(["enabled", "timeoutMs", "recommendedMarkers", "recommendedMarker", "requireExactlyOneRecommendation", "uiText", "debugLog", "configDir"]);
  const hasInlineConfig = candidate && typeof candidate === "object" && !Array.isArray(candidate) && Object.keys(candidate).some((key) => knownKeys.has(key));
  if (hasInlineConfig) {
    return normalizeSmartQuestionConfig(candidate, context.location?.directory ? path3.resolve(context.location.directory, ".opencode") : void 0);
  }
  return loadConfig2(context.location?.directory);
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
var tui = async (api) => {
  const projectDir = api.state?.path?.directory ?? process.cwd();
  const config = loadConfig2(projectDir);
  if (!config?.enabled) return;
  const log = createDiagnosticLogger(config, "smart-question-ui");
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
    if (typeof requestID !== "string" || !Array.isArray(questions) || questions.length === 0) {
      return;
    }
    const decision = detectRecommendations2(questions, config.recommendedMarkers, {
      requireExactlyOneRecommendation: config.requireExactlyOneRecommendation
    });
    if (!decision.ok) return;
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
    const current = activeQuestion();
    if (current && typeof requestID === "string" && requestID === current.requestID) {
      clearActive();
    }
  };
  const stopAsked = api.event?.on?.("question.asked", onAsked);
  const stopReplied = api.event?.on?.("question.replied", onEnd);
  const stopRejected = api.event?.on?.("question.rejected", onEnd);
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
  api.renderer?.keyInput?.on?.("keypress", onKey);
  api.renderer?.keyInput?.on?.("paste", onPaste);
  const stopLegacyKey = api.keymap?.intercept?.("key", onKey);
  api.lifecycle?.onDispose?.(() => {
    stopLegacyKey?.();
    stopAsked?.();
    stopReplied?.();
    stopRejected?.();
    api.renderer?.keyInput?.off?.("keypress", onKey);
    api.renderer?.keyInput?.off?.("paste", onPaste);
    clearActive();
  });
};
var setup = async (context) => {
  const formApi = context?.data?.session?.form;
  if (!context || typeof context !== "object" || typeof context.data?.on !== "function" || typeof formApi?.sync !== "function" || typeof formApi?.list !== "function" || typeof formApi?.reply !== "function" || typeof formApi?.invalidate !== "function" || typeof context.renderer?.keyInput?.on !== "function" || typeof context.renderer?.keyInput?.off !== "function" || typeof context.ui?.router?.current !== "function" || typeof context.ui?.slot !== "function") {
    return;
  }
  const config = resolveV2TuiConfig(context);
  if (!config?.enabled) return;
  const log = createDiagnosticLogger(config, "smart-question-v2-ui");
  const [activeBySession, setActiveBySession] = createSignal({});
  const pending = /* @__PURE__ */ new Map();
  const location = context.location;
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
      deleteLockfile(item.lockPath, log);
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
    log(`manual interaction form=${item.formID} session=${sessionID} reason=${reason}`);
  };
  const onFormCreated = (event) => {
    if (event?.location?.directory && location?.directory && event.location.directory !== location.directory) {
      return;
    }
    const form = event?.data?.form;
    if (!form?.id || !form.sessionID || form.sessionID === "global") return;
    for (const [id, existing] of pending.entries()) {
      if (existing.sessionID === form.sessionID) {
        clearPending(id);
      }
    }
    const decision = detectV2FormRecommendations(form, config.recommendedMarkers, {
      requireExactlyOneRecommendation: config.requireExactlyOneRecommendation
    });
    if (!decision.ok) {
      log(`skip form=${form.id} reason=${decision.reason}`);
      return;
    }
    const detection = decision.detection;
    const lockPath = resolveLockPath(config.configDir, form.id);
    const expiresAt = Date.now() + config.timeoutMs;
    const initialCountdown = Math.ceil(config.timeoutMs / 1e3);
    const state = {
      requestID: form.id,
      formID: form.id,
      sessionID: form.sessionID,
      questions: decision.questions,
      detection,
      agentName: form.sessionID.slice(0, 8),
      agentFound: false,
      focusDisabled: false,
      countdown: initialCountdown
    };
    const item = {
      formID: form.id,
      sessionID: form.sessionID,
      answer: decision.answer,
      state,
      expiresAt,
      status: "pending",
      lockPath,
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
        await context.data.session.form.sync(form.sessionID, location);
        const forms = context.data.session.form.list(form.sessionID, location);
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
          answer: decision.answer
        }, location);
        item.status = "replied";
        try {
          context.data.session.form.invalidate(form.sessionID, location);
        } catch (error) {
          log(`form cache invalidation failed form=${form.id} err=${error instanceof Error ? error.message : String(error)}`);
        }
        deleteLockfile(lockPath, log);
        pending.delete(form.id);
        updateSessionState(form.sessionID, (current) => current?.formID === form.id ? void 0 : current);
        log(`reply OK form=${form.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`reply ERROR form=${form.id} err=${message}`);
        console.error(`[smart-question] Auto-selection failed for form ${form.id}: ${message}`);
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
    if (typeof formID === "string") clearPending(formID);
  };
  const stopCreated = context.data.on("form.created", onFormCreated);
  const stopReplied = context.data.on("form.replied", onFormSettled);
  const stopCancelled = context.data.on("form.cancelled", onFormSettled);
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
  context.renderer.keyInput.on("keypress", onKey);
  context.renderer.keyInput.on("paste", onPaste);
  const stopSlot = context.ui.slot({
    append: "session.composer.top",
    render: ({
      sessionID
    }) => _$createComponent(SmartQuestionOverlay, {
      state: () => activeBySession()[sessionID] ?? null,
      countdown: () => activeBySession()[sessionID]?.countdown ?? 0,
      get markers() {
        return config.recommendedMarkers;
      },
      get uiText() {
        return config.uiText;
      }
    })
  });
  return () => {
    stopCreated();
    stopReplied();
    stopCancelled();
    stopSlot();
    context.renderer.keyInput.off("keypress", onKey);
    context.renderer.keyInput.off("paste", onPaste);
    for (const formID of [...pending.keys()]) {
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
