// src/tui-runtime.js
import { createTextNode as _$createTextNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createComponent as _$createComponent } from "opentui:runtime-module:%40opentui%2Fsolid";
import { effect as _$effect } from "opentui:runtime-module:%40opentui%2Fsolid";
import { memo as _$memo } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insertNode as _$insertNode } from "opentui:runtime-module:%40opentui%2Fsolid";
import { insert as _$insert } from "opentui:runtime-module:%40opentui%2Fsolid";
import { setProp as _$setProp } from "opentui:runtime-module:%40opentui%2Fsolid";
import { createElement as _$createElement } from "opentui:runtime-module:%40opentui%2Fsolid";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createEffect, createMemo, createSignal, Show } from "opentui:runtime-module:solid-js";
var DEFAULT_RECOMMENDED_MARKERS = ["(Recommended)", "(\xD6nerilen)"];
var DEFAULT_CONFIG = {
  enabled: true,
  timeoutMs: 3e4,
  recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
  recommendedMarker: "(Recommended)",
  requireExactlyOneRecommendation: true
};
function normalizeConfigMarkers(rawMarkers, legacyMarker) {
  if (Array.isArray(rawMarkers)) {
    const valid = rawMarkers.filter((m) => typeof m === "string" && m.length > 0);
    const unique = Array.from(new Set(valid));
    if (unique.length > 0) {
      return unique;
    }
  }
  if (typeof legacyMarker === "string" && legacyMarker.length > 0) {
    return [legacyMarker];
  }
  return [...DEFAULT_RECOMMENDED_MARKERS];
}
function normalizeParamMarkers(marker) {
  if (Array.isArray(marker)) {
    const valid = marker.filter((m) => typeof m === "string" && m.length > 0);
    const unique = Array.from(new Set(valid));
    return unique.length > 0 ? unique : [...DEFAULT_RECOMMENDED_MARKERS];
  }
  if (typeof marker === "string" && marker.length > 0) {
    return [marker];
  }
  return [...DEFAULT_RECOMMENDED_MARKERS];
}
function loadConfig(projectDir) {
  try {
    const dir = typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
    const candidatePaths = [path.resolve(dir, ".opencode/smart-question.json"), path.resolve(dir, "smart-question.json"), path.resolve(os.homedir(), ".config/opencode/smart-question.json")];
    let configPath = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        configPath = p;
        break;
      }
    }
    if (!configPath) {
      return null;
    }
    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.enabled === false) {
      return null;
    }
    const configDir = path.dirname(configPath);
    const recommendedMarkers = normalizeConfigMarkers(parsed.recommendedMarkers, parsed.recommendedMarker);
    const recommendedMarker = typeof parsed.recommendedMarker === "string" && parsed.recommendedMarker.length > 0 ? parsed.recommendedMarker : recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker;
    return {
      enabled: true,
      configDir,
      timeoutMs: typeof parsed.timeoutMs === "number" && parsed.timeoutMs >= 0 ? parsed.timeoutMs : DEFAULT_CONFIG.timeoutMs,
      recommendedMarkers,
      recommendedMarker,
      requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === "boolean" ? parsed.requireExactlyOneRecommendation : DEFAULT_CONFIG.requireExactlyOneRecommendation
    };
  } catch (err) {
    console.error(`[smart-question-ui] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
function detectRecommendations(questions, marker = DEFAULT_CONFIG.recommendedMarkers, options = {}) {
  const requireOne = options.requireExactlyOneRecommendation !== false;
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      ok: false,
      reason: "No questions provided in request"
    };
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
      return {
        ok: false,
        reason: `Question ${qIndex} is null or undefined`
      };
    }
    if (!Array.isArray(q.options) || q.options.length === 0) {
      return {
        ok: false,
        reason: `Question ${qIndex} has no options`
      };
    }
    const matched = q.options.map((opt) => {
      if (!opt || typeof opt.label !== "string") return null;
      const m = markers.find((m2) => typeof m2 === "string" && m2.length > 0 && opt.label.endsWith(m2));
      return m ? {
        opt,
        marker: m
      } : null;
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
    if (!q.multiple && requireOne && matched.length !== 1) {
      return {
        ok: false,
        reason: `Question ${qIndex} has ${matched.length} recommendations (requireExactlyOneRecommendation is true)`
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
  return {
    ok: true,
    answers,
    recommendedOptions,
    matchedMarker
  };
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
    const session = api.state?.session?.get?.(sessionID);
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
  const strLabel = typeof label === "string" ? label : String(label ?? "");
  let candidateMarkers = [];
  if (Array.isArray(marker)) {
    candidateMarkers = marker.filter((m) => typeof m === "string" && m.length > 0);
  } else if (typeof marker === "string" && marker.length > 0) {
    candidateMarkers = [marker];
  }
  let longestMatch = null;
  for (const m of candidateMarkers) {
    if (strLabel.endsWith(m)) {
      if (!longestMatch || m.length > longestMatch.length) {
        longestMatch = m;
      }
    }
  }
  if (longestMatch) {
    return strLabel.slice(0, -longestMatch.length).trim();
  }
  return strLabel;
}
function formatCountdown(totalSeconds) {
  const num = typeof totalSeconds === "number" && Number.isFinite(totalSeconds) ? totalSeconds : 0;
  const clamped = Math.max(0, Math.floor(num));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function SmartQuestionOverlay(props) {
  const theme = createMemo(() => props.api?.theme?.current);
  const t = () => theme();
  const active = () => props.state();
  const act = new Proxy({}, {
    get(_target, prop) {
      const current = active();
      if (!current) {
        return prop === "detection" ? {} : void 0;
      }
      return current[prop] ?? (prop === "detection" ? {} : void 0);
    }
  });
  const isAutoSelect = createMemo(() => Boolean(active()?.detection && active()?.detection.ok === true && !active()?.focusDisabled));
  const hasRecommendation = createMemo(() => Boolean(active()?.detection && active()?.detection.ok === true));
  const recommendedChecklist = createMemo(() => {
    const act2 = active();
    if (!act2?.detection?.ok || !Array.isArray(act2.detection.recommendedOptions)) {
      return "";
    }
    const markers = props.markers ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers;
    return act2.detection.recommendedOptions.filter((opt) => Boolean(opt && typeof opt.label === "string")).map((opt) => stripMarker(opt.label, markers)).filter(Boolean).map((label) => `\u2713 ${label}`).join("   ");
  });
  const rationale = createMemo(() => {
    const act2 = active();
    if (!act2?.detection?.ok || !Array.isArray(act2.detection.recommendedOptions)) {
      return "";
    }
    const firstRec = act2.detection.recommendedOptions[0];
    const desc = firstRec?.description;
    return typeof desc === "string" ? desc : String(desc ?? "");
  });
  const countdownText = createMemo(() => {
    const sec = typeof props.countdown === "function" ? props.countdown() : 0;
    return formatCountdown(sec);
  });
  const agentBadgeText = createMemo(() => {
    const act2 = active();
    if (!act2) return "";
    const name = String(act2.agentName ?? "");
    return act2.agentFound ? `Agent: ${name}` : `Session: ${name}`;
  });
  createEffect(() => {
    const act2 = active();
    if (act2) {
      try {
        fs.appendFileSync("/tmp/smart-question-ui.log", `[smart-question-ui] ${(/* @__PURE__ */ new Date()).toISOString()} Overlay active: req=${act2.requestID}, countdown=${countdownText()}, recs=${recommendedChecklist()}
`);
      } catch {
      }
    }
  });
  return (() => {
    var _el$ = _$createElement("box");
    _$setProp(_el$, "width", "100%");
    _$setProp(_el$, "flexDirection", "column");
    _$insert(_el$, _$createComponent(Show, {
      get when() {
        return Boolean(active());
      },
      get children() {
        var _el$2 = _$createElement("box"), _el$3 = _$createElement("box"), _el$4 = _$createElement("text"), _el$5 = _$createElement("box");
        _$insertNode(_el$2, _el$3);
        _$insertNode(_el$2, _el$5);
        _$setProp(_el$2, "width", "100%");
        _$setProp(_el$2, "border", true);
        _$setProp(_el$2, "borderStyle", "rounded");
        _$setProp(_el$2, "title", " Smart Question ");
        _$setProp(_el$2, "paddingLeft", 1);
        _$setProp(_el$2, "paddingRight", 1);
        _$setProp(_el$2, "flexDirection", "column");
        _$insertNode(_el$3, _el$4);
        _$setProp(_el$3, "width", "100%");
        _$setProp(_el$3, "flexDirection", "row");
        _$setProp(_el$3, "justifyContent", "flex-end");
        _$insert(_el$4, agentBadgeText);
        _$setProp(_el$5, "width", "100%");
        _$setProp(_el$5, "flexDirection", "row");
        _$setProp(_el$5, "justifyContent", "space-between");
        _$insert(_el$5, (() => {
          var _c$ = _$memo(() => !!(hasRecommendation() && recommendedChecklist()));
          return () => _c$() ? (() => {
            var _el$6 = _$createElement("box"), _el$7 = _$createElement("text"), _el$8 = _$createElement("b"), _el$9 = _$createElement("text"), _el$1 = _$createElement("text"), _el$10 = _$createElement("b");
            _$insertNode(_el$6, _el$7);
            _$insertNode(_el$6, _el$9);
            _$insertNode(_el$6, _el$1);
            _$setProp(_el$6, "flexDirection", "row");
            _$insertNode(_el$7, _el$8);
            _$insert(_el$8, recommendedChecklist);
            _$insertNode(_el$9, _$createTextNode(` `));
            _$insertNode(_el$1, _el$10);
            _$insert(_el$10, (() => {
              var _c$4 = _$memo(() => !!act.detection.matchedMarker);
              return () => _c$4() ? act.detection.matchedMarker.replace(/[()]/g, "").toUpperCase() : "RECOMMENDED";
            })());
            _$effect((_p$) => {
              var _v$3 = t()?.success ?? "green", _v$4 = t()?.success ?? "green", _v$5 = t()?.success ?? "green";
              _v$3 !== _p$.e && (_p$.e = _$setProp(_el$7, "fg", _v$3, _p$.e));
              _v$4 !== _p$.t && (_p$.t = _$setProp(_el$9, "fg", _v$4, _p$.t));
              _v$5 !== _p$.a && (_p$.a = _$setProp(_el$1, "fg", _v$5, _p$.a));
              return _p$;
            }, {
              e: void 0,
              t: void 0,
              a: void 0
            });
            return _el$6;
          })() : _$createElement("box");
        })(), null);
        _$insert(_el$5, (() => {
          var _c$2 = _$memo(() => !!isAutoSelect());
          return () => _c$2() ? (() => {
            var _el$12 = _$createElement("text"), _el$13 = _$createElement("b");
            _$insertNode(_el$12, _el$13);
            _$insert(_el$13, countdownText);
            _$effect((_$p) => _$setProp(_el$12, "fg", t()?.warning ?? "yellow", _$p));
            return _el$12;
          })() : (() => {
            var _el$14 = _$createElement("text"), _el$15 = _$createElement("b");
            _$insertNode(_el$14, _el$15);
            _$insertNode(_el$15, _$createTextNode(`AUTO-SELECTION DISABLED`));
            _$effect((_$p) => _$setProp(_el$14, "fg", t()?.error ?? "red", _$p));
            return _el$14;
          })();
        })(), null);
        _$insert(_el$2, (() => {
          var _c$3 = _$memo(() => !!rationale());
          return () => _c$3() ? (() => {
            var _el$17 = _$createElement("box"), _el$18 = _$createElement("text"), _el$20 = _$createElement("text");
            _$insertNode(_el$17, _el$18);
            _$insertNode(_el$17, _el$20);
            _$setProp(_el$17, "flexDirection", "row");
            _$insertNode(_el$18, _$createTextNode(`\xD6neri: `));
            _$insert(_el$20, rationale);
            _$effect((_p$) => {
              var _v$6 = t()?.textMuted ?? "gray", _v$7 = t()?.text ?? "white";
              _v$6 !== _p$.e && (_p$.e = _$setProp(_el$18, "fg", _v$6, _p$.e));
              _v$7 !== _p$.t && (_p$.t = _$setProp(_el$20, "fg", _v$7, _p$.t));
              return _p$;
            }, {
              e: void 0,
              t: void 0
            });
            return _el$17;
          })() : null;
        })(), null);
        _$effect((_p$) => {
          var _v$ = t()?.accent ?? "cyan", _v$2 = t()?.textMuted ?? "gray";
          _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "borderColor", _v$, _p$.e));
          _v$2 !== _p$.t && (_p$.t = _$setProp(_el$4, "fg", _v$2, _p$.t));
          return _p$;
        }, {
          e: void 0,
          t: void 0
        });
        return _el$2;
      }
    }));
    return _el$;
  })();
}
var tui = async (api) => {
  const projectDir = api.state?.path?.directory ?? process.cwd();
  const config = loadConfig(projectDir);
  if (!config?.enabled) {
    return;
  }
  const [activeQuestion, setActiveQuestion] = createSignal(null);
  const [countdownSec, setCountdownSec] = createSignal(0);
  let countdownTimer = null;
  let currentLockPath = null;
  let currentTriggerFocusGuard = null;
  const logDiagnostic = (msg) => {
    try {
      fs.appendFileSync("/tmp/smart-question-ui.log", `[smart-question-ui] ${(/* @__PURE__ */ new Date()).toISOString()} ${msg}
`);
    } catch {
    }
  };
  let isPrechecking = false;
  const clearTimer = () => {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  };
  const clearActive = (reason) => {
    logDiagnostic(`clearActive called${reason ? ` (reason: ${reason})` : ""}`);
    clearTimer();
    currentTriggerFocusGuard = null;
    if (currentLockPath) {
      try {
        if (fs.existsSync(currentLockPath)) {
          fs.unlinkSync(currentLockPath);
        }
      } catch {
      }
      currentLockPath = null;
    }
    setActiveQuestion(null);
    try {
      api.renderer?.requestRender?.();
    } catch {
    }
  };
  const opencodeDir = config.configDir ?? path.resolve(process.cwd(), ".opencode");
  const handleQuestionAsked = (event) => {
    const data = event?.properties ?? event?.data ?? event;
    const requestID = data?.id ?? data?.requestID ?? event?.id;
    const sessionID = data?.sessionID ?? event?.sessionID ?? "";
    const questions = data?.questions ?? event?.questions ?? [];
    logDiagnostic(`asked event received: requestID=${requestID ?? "none"}, sessionID=${sessionID}, questionsCount=${Array.isArray(questions) ? questions.length : 0}`);
    if (!requestID || !Array.isArray(questions) || questions.length === 0) {
      return;
    }
    clearTimer();
    const decision = detectRecommendations(questions, config.recommendedMarkers, {
      requireExactlyOneRecommendation: config.requireExactlyOneRecommendation
    });
    const {
      name: agentName,
      found: agentFound
    } = resolveAgentName(api, sessionID, data);
    setActiveQuestion({
      requestID,
      sessionID,
      questions,
      detection: decision,
      agentName,
      agentFound
    });
    const lockPath = path.resolve(opencodeDir, `.sq-draft-${requestID}`);
    currentLockPath = lockPath;
    let focusGuardTriggered = false;
    const triggerFocusGuard = (reason) => {
      if (focusGuardTriggered) return;
      focusGuardTriggered = true;
      clearTimer();
      logDiagnostic(`focus-activation: requestID=${requestID}, reason=${reason}, writing lockPath=${lockPath}`);
      try {
        fs.writeFileSync(lockPath, JSON.stringify({
          requestID,
          ts: Date.now()
        }), "utf8");
      } catch (err) {
        logDiagnostic(`focus-activation write lockfile failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      setActiveQuestion((prev) => {
        if (!prev || prev.requestID !== requestID) return prev;
        return {
          ...prev,
          focusDisabled: true
        };
      });
      try {
        api.renderer?.requestRender?.();
      } catch {
      }
    };
    currentTriggerFocusGuard = triggerFocusGuard;
    if (decision.ok) {
      const markers = normalizeParamMarkers(config.recommendedMarkers);
      const sleep = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms));
      const precheckTabs = async () => {
        isPrechecking = true;
        try {
          await sleep(150);
          if (questions.length === 1 && questions[0]?.multiple !== true) {
            return;
          }
          for (let qIdx = 0; qIdx < questions.length; qIdx++) {
            const q = questions[qIdx];
            if (!q || !Array.isArray(q.options)) continue;
            const recIndices = [];
            q.options.forEach((opt, idx) => {
              if (opt && typeof opt.label === "string" && markers.some((m) => opt.label.endsWith(m)) && idx < 9) {
                recIndices.push(idx);
              }
            });
            if (q.multiple === true) {
              for (const idx of recIndices) {
                try {
                  logDiagnostic(`Tab ${qIdx + 1}: Pre-checking multi-select option ${idx + 1}: ${q.options[idx]?.label}`);
                  process.stdin.emit("data", Buffer.from(String(idx + 1)));
                } catch (err) {
                  logDiagnostic(`Failed to pre-check option ${idx + 1}: ${err}`);
                }
                await sleep(60);
              }
              if (qIdx < questions.length - 1) {
                try {
                  logDiagnostic(`Advancing from tab ${qIdx + 1} to next tab via Tab key`);
                  process.stdin.emit("data", Buffer.from("	"));
                } catch (err) {
                  logDiagnostic(`Failed to advance tab: ${err}`);
                }
                await sleep(100);
              }
            } else {
              if (recIndices.length > 0) {
                const idx = recIndices[0];
                try {
                  logDiagnostic(`Tab ${qIdx + 1}: Selecting single-select option ${idx + 1}: ${q.options[idx]?.label}`);
                  process.stdin.emit("data", Buffer.from(String(idx + 1)));
                } catch (err) {
                  logDiagnostic(`Failed to select option ${idx + 1}: ${err}`);
                }
                await sleep(100);
              }
            }
          }
        } finally {
          await sleep(100);
          isPrechecking = false;
        }
      };
      precheckTabs().catch((err) => {
        logDiagnostic(`precheckTabs error: ${err}`);
      });
      const initialSeconds = Math.max(0, Math.floor(config.timeoutMs / 1e3));
      setCountdownSec(initialSeconds);
      countdownTimer = setInterval(() => {
        setCountdownSec((prev) => {
          const next = prev - 1;
          if (next <= 0) {
            logDiagnostic(`countdown zero -> clearActive: requestID=${requestID}`);
            clearActive("countdown zero");
            return 0;
          }
          return next;
        });
        try {
          api.renderer?.requestRender?.();
        } catch {
        }
      }, 1e3);
    }
    try {
      api.renderer?.requestRender?.();
    } catch {
    }
  };
  const handleQuestionEnd = (eventName, event) => {
    const data = event?.properties ?? event?.data ?? event;
    const payloadKeys = event ? Object.keys(event).join(",") : "none";
    const dataKeys = data ? Object.keys(data).join(",") : "none";
    const requestID = data?.requestID ?? data?.id ?? event?.id;
    const current = activeQuestion();
    const idsMatched = Boolean(current && requestID && requestID === current.requestID);
    logDiagnostic(`handleQuestionEnd: event=${eventName}, eventKeys=[${payloadKeys}], dataKeys=[${dataKeys}], eventRequestID=${requestID ?? "none"}, currentRequestID=${current?.requestID ?? "none"}, idsMatched=${idsMatched}`);
    if (!current || !requestID || requestID === current.requestID) {
      clearActive(`handleQuestionEnd:${eventName}`);
    }
  };
  const unsubAsked = api.event?.on?.("question.asked", handleQuestionAsked);
  const unsubReplied = api.event?.on?.("question.replied", (e) => handleQuestionEnd("question.replied", e));
  const unsubRejected = api.event?.on?.("question.rejected", (e) => handleQuestionEnd("question.rejected", e));
  api.slots.register({
    slots: {
      app_bottom() {
        logDiagnostic("app_bottom slot instantiated");
        return _$createComponent(SmartQuestionOverlay, {
          api,
          state: activeQuestion,
          countdown: countdownSec,
          get markers() {
            return config.recommendedMarkers;
          },
          get marker() {
            return config.recommendedMarkers;
          }
        });
      }
    }
  });
  const unsubKey = api.keymap?.intercept?.("key", () => {
    if (isPrechecking) return;
    if (activeQuestion() && currentTriggerFocusGuard) {
      logDiagnostic("User key interaction intercepted -> triggering focus guard");
      currentTriggerFocusGuard("User key interaction in question dialog");
    }
  });
  api.lifecycle?.onDispose?.(() => {
    unsubKey?.();
    unsubAsked?.();
    unsubReplied?.();
    unsubRejected?.();
    clearActive();
  });
};
var pluginModule = {
  id: "smart-question-ui",
  tui
};
var tui_runtime_default = pluginModule;
export {
  SmartQuestionOverlay,
  tui_runtime_default as default,
  detectRecommendations,
  formatCountdown,
  loadConfig,
  resolveAgentName,
  stripMarker,
  tui
};
