/** @jsxImportSource @opentui/solid */

import fs from 'node:fs';
import path from 'node:path';
import { Show, createMemo, createSignal } from 'solid-js';
import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
} from '@opencode-ai/plugin/tui';
import type { Plugin as OpenCodeV2Tui } from '@opencode/plugin/tui';

import {
  DEFAULT_CONFIG,
  hasSmartQuestionConfigOptions,
  loadConfig as loadSharedConfig,
  resolveSmartQuestionConfig,
} from './config.js';
import {
  detectRecommendations as detectSharedRecommendations,
  computeQuestionFingerprint,
} from './detector.js';
import {
  canUseDraftCoordination,
  deleteLockfile,
  resolveLockPath,
} from './draft-guard.js';
import {
  classifyV2Form,
  type V2FormInfo,
} from './form-adapter.js';
import { buildUnclassifiedRemediationPrompt } from './backend.js';
import { DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS } from './config.js';
import { diagnosticErrorCode } from './diagnostics.js';
import { isRootSessionInfo } from './session-scope.js';
import {
  getActiveHandoff,
  setActiveHandoff,
  consumeActiveHandoff,
  clearActiveHandoff,
  invalidateActiveHandoff,
  extractTrustedGuardianHandoff,
  extractCurrentTurnGuardianHandoff,
} from './handoff.js';
import type {
  ActiveQuestionState,
  DetectionResult,
  QuestionInfo,
  SmartQuestionConfig,
  SmartQuestionUIText,
} from './types.js';

export function loadConfig(...args: any[]) {
  return loadSharedConfig(...args);
}

export function detectRecommendations(...args: any[]) {
  return detectSharedRecommendations(args[0], args[1], args[2]);
}

interface OverlayState extends ActiveQuestionState {
  countdown?: number;
  formID?: string;
  markers?: string[];
  uiText?: SmartQuestionUIText;
}

interface V2Pending {
  formID: string;
  sessionID: string;
  answer: Record<string, string | string[]>;
  state: OverlayState;
  timeout: NodeJS.Timeout;
  interval: NodeJS.Timeout | null;
  expiresAt: number;
  status: 'pending' | 'firing' | 'cancelled' | 'replied';
  lockPath: string;
  location?: { directory: string; workspaceID?: string };
  log: (message: string) => void;
}

function createDiagnosticLogger(config: SmartQuestionConfig, prefix: string) {
  const logPath =
    typeof config.debugLog === 'string' && config.debugLog ? config.debugLog : '';
  return (message: string): void => {
    if (!logPath) return;
    try {
      fs.appendFileSync(
        logPath,
        `[${prefix}] ${new Date().toISOString()} ${message}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch {
      // Diagnostics must never break the UI.
    }
  };
}

function ensureDraftLock(lockPath: string, _payload: Record<string, unknown>): boolean {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, '', { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function resolveV2TuiConfig(
  context: OpenCodeV2Tui.Context,
  directory: string | undefined = context.location?.directory
): SmartQuestionConfig | null {
  return resolveSmartQuestionConfig(
    directory,
    context.options as Record<string, unknown> | undefined
  );
}


/**
 * Resolve a best-effort agent/session label for the v1 TUI.
 */
export function resolveAgentName(
  api: TuiPluginApi | Record<string, any>,
  sessionID?: string,
  eventProps?: Record<string, unknown>
): { name: string; found: boolean } {
  if (
    typeof eventProps?.agent === 'string' &&
    eventProps.agent.trim().length > 0
  ) {
    return { name: eventProps.agent.trim(), found: true };
  }
  if (
    typeof eventProps?.agentName === 'string' &&
    eventProps.agentName.trim().length > 0
  ) {
    return { name: eventProps.agentName.trim(), found: true };
  }

  try {
    const session = (api as any)?.state?.session?.get?.(sessionID);
    if (
      session &&
      typeof session.agent === 'string' &&
      session.agent.trim().length > 0
    ) {
      return { name: session.agent.trim(), found: true };
    }
  } catch {
    // Best effort.
  }

  const shortId =
    sessionID && typeof sessionID === 'string'
      ? sessionID.slice(0, 8)
      : 'unknown';
  return { name: shortId, found: false };
}

export function stripMarker(label: unknown, marker: unknown): string {
  const strLabel = (typeof label === 'string' ? label : String(label ?? '')).trimEnd().normalize('NFC');
  const markers = Array.isArray(marker)
    ? marker.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : typeof marker === 'string' && marker.length > 0
      ? [marker]
      : [];

  let longestMatch = '';
  for (const candidate of markers) {
    const normalized = candidate.normalize('NFC');
    if (strLabel.endsWith(normalized) && normalized.length > longestMatch.length) {
      longestMatch = normalized;
    }
  }
  return longestMatch
    ? strLabel.slice(0, -longestMatch.length).trim()
    : strLabel;
}

export function formatCountdown(totalSeconds: unknown): string {
  const numeric =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds)
      ? totalSeconds
      : 0;
  const clamped = Math.max(0, Math.floor(numeric));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function SmartQuestionOverlay(props: {
  state: () => OverlayState | null;
  countdown?: () => number;
  marker?: string | string[];
  markers?: string | string[];
  uiText?: SmartQuestionUIText;
}) {
  const active = () => props.state();
  const markers = () =>
    props.markers ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers ?? [];
  const labels = () => props.uiText ?? DEFAULT_CONFIG.uiText;

  const recommendedChecklist = createMemo(() => {
    const state = active();
    if (!state?.detection?.ok) return '';
    return (state.detection.recommendedOptions ?? [])
      .filter((option) => option && typeof option.label === 'string')
      .map((option) => stripMarker(option.label, markers()))
      .filter(Boolean)
      .map((label) => `✓ ${label}`)
      .join('   ');
  });

  const rationale = createMemo(() => {
    const state = active();
    if (!state?.detection?.ok) return '';
    const description = state.detection.recommendedOptions?.[0]?.description;
    return typeof description === 'string' ? description : '';
  });

  const countdownText = createMemo(() => {
    const state = active();
    const seconds =
      typeof props.countdown === 'function'
        ? props.countdown()
        : state?.countdown ?? 0;
    return formatCountdown(seconds);
  });

  const badge = createMemo(() => {
    const state = active();
    if (!state) return '';
    return state.agentFound
      ? `${labels().agent} ${state.agentName}`
      : `${labels().session} ${state.agentName}`;
  });

  return (
    <Show when={active()}>
      <box
        width="100%"
        border={true}
        borderStyle="rounded"
        borderColor="cyan"
        title=" Smart Question "
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        <box width="100%" flexDirection="row" justifyContent="flex-end">
          <text fg="gray">{badge()}</text>
        </box>
        <box width="100%" flexDirection="row" justifyContent="space-between">
          <text fg="green">
            <b>{recommendedChecklist()}</b>
          </text>
          <Show
            when={!active()?.focusDisabled}
            fallback={
              <text fg="red">
                <b>{labels().disabled}</b>
              </text>
            }
          >
            <text fg="yellow">
              <b>{countdownText()}</b>
            </text>
          </Show>
        </box>
        <Show when={active()?.errorMessage}>
          <text fg="red">{active()?.errorMessage}</text>
        </Show>
        <Show when={rationale()}>
          <box flexDirection="row">
            <text fg="gray">{labels().recommendation} </text>
            <text>{rationale()}</text>
          </box>
        </Show>
      </box>
    </Show>
  );
}

/**
 * OpenCode v1 TUI adapter.
 */
export const tui: TuiPlugin = async (api, options) => {
  const projectDir = api.state?.path?.directory ?? process.cwd();
  const config = resolveSmartQuestionConfig(projectDir, options);
  if (!config?.enabled) return;

  const log = createDiagnosticLogger(config, 'smart-question-ui');
  if (!canUseDraftCoordination(config.configDir, log)) return;
  const [activeQuestion, setActiveQuestion] =
    createSignal<OverlayState | null>(null);
  const [countdownSec, setCountdownSec] = createSignal(0);

  let countdownTimer: NodeJS.Timeout | null = null;
  let currentLockPath: string | null = null;
  let triggerFocusGuard: ((reason: string) => void) | null = null;

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

  const onAsked = (event: Record<string, unknown>) => {
    const data = (event?.properties ?? event?.data ?? event) as
      | Record<string, unknown>
      | undefined;
    const requestID = data?.id ?? data?.requestID ?? event?.id;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? '');
    const questions = (data?.questions ?? event?.questions ?? []) as QuestionInfo[];

    if (
      typeof requestID !== 'string' ||
      !sessionID ||
      !Array.isArray(questions) ||
      questions.length === 0
    ) {
      return;
    }

    let sessionInfo: unknown;
    try {
      sessionInfo = (api as any)?.state?.session?.get?.(sessionID);
    } catch {
      return;
    }
    if (!isRootSessionInfo(sessionInfo)) return;

    const decision = detectRecommendations(
      questions,
      config.recommendedMarkers,
      { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
    );
    if (!decision.ok) return;

    let handoff = getActiveHandoff(sessionID);
    if (!handoff) {
      try {
        const msgs = (api as any)?.state?.session?.messages?.(sessionID);
        if (Array.isArray(msgs)) {
          const extracted = extractCurrentTurnGuardianHandoff(msgs);
          if (extracted && typeof extracted === 'object' && 'version' in extracted) {
            if (setActiveHandoff(sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        }
      } catch {
        // Best effort
      }
    }

    if (
      handoff &&
      typeof handoff === 'object' &&
      'autoSelect' in handoff &&
      handoff.autoSelect === 'forbidden'
    ) {
      log(
        `skip request=${requestID} reason=guardian-handoff-auto-select-forbidden handoffId=${handoff.handoffId}`
      );
      return;
    }

    // Preserve a lock for a prior question if the user already took control;
    // its backend timer must still observe the lock and refrain from replying.
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
      focusDisabled: false,
    });

    let focusGuardTriggered = false;
    triggerFocusGuard = (reason: string) => {
      if (focusGuardTriggered) return;
      focusGuardTriggered = true;
      clearTimer();
      ensureDraftLock(lockPath, { requestID, sessionID, ts: Date.now(), reason });
      setActiveQuestion((current) =>
        current?.requestID === requestID
          ? { ...current, focusDisabled: true }
          : current
      );
      log(`manual interaction request=${requestID} reason=${reason}`);
      api.renderer?.requestRender?.();
    };

    const startedAt = Date.now();
    const updateCountdown = () => {
      const remainingMs = Math.max(0, config.timeoutMs - (Date.now() - startedAt));
      setCountdownSec(Math.ceil(remainingMs / 1000));
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

  const onEnd = (event: Record<string, unknown>) => {
    const data = (event?.properties ?? event?.data ?? event) as
      | Record<string, unknown>
      | undefined;
    const requestID = data?.requestID ?? data?.id ?? event?.id;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? '');
    if (sessionID) {
      consumeActiveHandoff(sessionID);
    }
    const current = activeQuestion();
    if (current && typeof requestID === 'string' && requestID === current.requestID) {
      clearActive();
    }
  };

  const onMessageCreated = (event: Record<string, unknown>) => {
    const data = (event?.properties ?? event?.data ?? event) as
      | Record<string, unknown>
      | undefined;
    const sessionID = String(data?.sessionID ?? event?.sessionID ?? '');
    if (!sessionID) return;
    const handoff = extractTrustedGuardianHandoff(data);
    if (handoff && typeof handoff === 'object' && 'version' in handoff) {
      setActiveHandoff(sessionID, handoff);
    } else {
      const role = data?.role ?? (data?.message as any)?.role;
      if (role === 'user') {
        invalidateActiveHandoff(sessionID);
      }
    }
  };

  const onSessionDeleted = (event: Record<string, unknown>) => {
    const data = (event?.properties ?? event?.data ?? event) as
      | Record<string, unknown>
      | undefined;
    const sessionID = String(data?.id ?? data?.sessionID ?? event?.sessionID ?? '');
    if (sessionID) {
      clearActiveHandoff(sessionID);
    }
  };

  const stopAsked = api.event?.on?.('question.asked', onAsked);
  const stopReplied = api.event?.on?.('question.replied', onEnd);
  const stopRejected = api.event?.on?.('question.rejected', onEnd);
  const stopMsgUpdated = api.event?.on?.('message.updated', onMessageCreated);
  const stopMsgCreated = (api.event as any)?.on?.('message.created', onMessageCreated);
  const stopSessionDel = api.event?.on?.('session.deleted', onSessionDeleted);

  api.slots?.register?.({
    slots: {
      app_bottom() {
        return (
          <SmartQuestionOverlay
            state={activeQuestion}
            countdown={countdownSec}
            markers={config.recommendedMarkers}
            uiText={config.uiText}
          />
        );
      },
    },
  });

  const onKey = () => {
    if (activeQuestion() && triggerFocusGuard) {
      triggerFocusGuard('user keyboard interaction');
    }
  };
  const onPaste = () => {
    if (activeQuestion() && triggerFocusGuard) {
      triggerFocusGuard('user paste interaction');
    }
  };

  let stopLegacyKey: (() => void) | undefined;
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
      api.renderer?.keyInput?.off?.('keypress', onKey);
      keypressRegistered = false;
    }
    if (pasteRegistered) {
      api.renderer?.keyInput?.off?.('paste', onPaste);
      pasteRegistered = false;
    }
    // Preserve a manual-control lock across a TUI-only reload so the
    // independently running backend timer cannot auto-reply afterwards.
    clearActive(activeQuestion()?.focusDisabled !== true);
  };

  api.lifecycle?.onDispose?.(cleanupLocal);

  try {
    if (typeof api.renderer?.keyInput?.on === 'function') {
      api.renderer.keyInput.on('keypress', onKey);
      keypressRegistered = true;
      api.renderer.keyInput.on('paste', onPaste);
      pasteRegistered = true;
    }
    stopLegacyKey = (api.keymap as any)?.intercept?.('key', onKey);
  } catch (error) {
    cleanupLocal();
    throw error;
  }
};

/**
 * OpenCode v2 TUI adapter.
 */
export const setup: OpenCodeV2Tui.Definition['setup'] = async (context) => {
  // Some OpenCode transition builds can discover/call the v2 TUI entry without
  // providing the complete v2 TUI capability surface. Treat that as a no-op.
  const formApi = context?.data?.session?.form;
  if (
    !context ||
    typeof context !== 'object' ||
    typeof context.data?.on !== 'function' ||
    typeof formApi?.sync !== 'function' ||
    typeof formApi?.list !== 'function' ||
    typeof formApi?.reply !== 'function' ||
    typeof formApi?.invalidate !== 'function' ||
    typeof context.renderer?.keyInput?.on !== 'function' ||
    typeof context.renderer?.keyInput?.off !== 'function' ||
    typeof context.ui?.router?.current !== 'function' ||
    typeof context.ui?.slot !== 'function'
  ) {
    return;
  }

  if (hasSmartQuestionConfigOptions(context.options as Record<string, unknown> | undefined)) {
    const explicitConfig = resolveV2TuiConfig(context);
    if (!explicitConfig?.enabled) return;
  }

  const [activeBySession, setActiveBySession] = createSignal<
    Record<string, OverlayState>
  >({});
  const pending = new Map<string, V2Pending>();
  const remediatedForms = new Set<string>();
  const sessionChains = new Map<string, { fingerprint: string; consecutiveFailures: number }>();

  const updateSessionState = (
    sessionID: string,
    updater: (current: OverlayState | undefined) => OverlayState | undefined
  ) => {
    setActiveBySession((current) => {
      const next = { ...current };
      const updated = updater(next[sessionID]);
      if (updated) next[sessionID] = updated;
      else delete next[sessionID];
      return next;
    });
  };

  const clearPending = (
    formID: string,
    options: { removeLock?: boolean; removeOverlay?: boolean } = {}
  ) => {
    const item = pending.get(formID);
    if (!item) return;
    clearTimeout(item.timeout);
    if (item.interval) clearInterval(item.interval);
    item.status = 'cancelled';
    pending.delete(formID);
    if (options.removeLock !== false) {
      deleteLockfile(item.lockPath, item.log);
    }
    if (options.removeOverlay !== false) {
      updateSessionState(item.sessionID, (current) =>
        current?.formID === formID ? undefined : current
      );
    }
  };

  const cancelSessionAutoSelection = (sessionID: string, reason: string) => {
    const state = activeBySession()[sessionID];
    if (!state?.formID || state.focusDisabled) return;
    const item = pending.get(state.formID);
    if (!item) return;

    clearTimeout(item.timeout);
    if (item.interval) {
      clearInterval(item.interval);
      item.interval = null;
    }
    item.status = 'cancelled';
    ensureDraftLock(item.lockPath, {
      formID: item.formID,
      sessionID,
      ts: Date.now(),
      reason,
    });
    updateSessionState(sessionID, (current) =>
      current?.formID === item.formID
        ? { ...current, focusDisabled: true }
        : current
    );
    item.log(`manual interaction form=${item.formID} session=${sessionID} reason=${reason}`);
  };

  const onFormCreated = async (event: any) => {
    const form = event?.data?.form as V2FormInfo | undefined;
    if (!form?.id || !form.sessionID || form.sessionID === 'global') return;

    let sessionInfo: unknown;
    try {
      sessionInfo = (context.data.session as any)?.get?.(form.sessionID);
    } catch {
      return;
    }
    if (!isRootSessionInfo(sessionInfo)) return;

    // A newer form supersedes any prior timer in the same session, even if
    // the new form is not eligible for automatic selection.
    for (const [id, existing] of pending.entries()) {
      if (existing.sessionID === form.sessionID) {
        clearPending(id);
      }
    }

    const sessionLocation = (sessionInfo as any)?.location;
    const location = event?.location ?? sessionLocation ?? context.location;
    const config = resolveV2TuiConfig(context, location?.directory);
    if (!config?.enabled) return;
    const log = createDiagnosticLogger(config, 'smart-question-v2-ui');

    let handoff = getActiveHandoff(form.sessionID);
    if (!handoff) {
      try {
        const msgs = (context.data?.session as any)?.messages?.(form.sessionID);
        if (Array.isArray(msgs)) {
          const extracted = extractCurrentTurnGuardianHandoff(msgs);
          if (extracted && typeof extracted === 'object' && 'version' in extracted) {
            if (setActiveHandoff(form.sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        }
      } catch {
        // Best effort
      }
    }

    const classification = classifyV2Form(
      form,
      config.recommendedMarkers,
      config.manualMarkers,
      handoff,
      { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
    );

    if (classification.status === 'manual') {
      sessionChains.delete(form.sessionID);
      log(
        `skip form=${form.id} reason=manual-classification matched=${classification.matchedMarker ?? 'none'}`
      );
      return;
    }

    if (classification.status === 'unclassified') {
      log(`unclassified form=${form.id} reason=${classification.reason}`);
      if (remediatedForms.has(form.id)) {
        log(`suppress duplicate remediation form=${form.id}`);
        return;
      }

      const fingerprint = computeQuestionFingerprint(classification.questions);
      const maxRemediations =
        typeof config.maxUnclassifiedRemediations === 'number'
          ? config.maxUnclassifiedRemediations
          : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;

      const existingChain = sessionChains.get(form.sessionID);
      const isSameChain = existingChain !== undefined && existingChain.fingerprint === fingerprint;
      const currentCount = isSameChain ? existingChain.consecutiveFailures : 0;

      if (currentCount >= maxRemediations) {
        log(
          `unclassified remediation budget exhausted session=${form.sessionID} fingerprint=${fingerprint} count=${currentCount}/${maxRemediations}`
        );
        return;
      }

      remediatedForms.add(form.id);
      sessionChains.set(form.sessionID, {
        fingerprint,
        consecutiveFailures: currentCount + 1,
      });

      const promptText = buildUnclassifiedRemediationPrompt(
        config.recommendedMarker,
        config.manualMarker
      );
      let remediationSent = false;
      try {
        if (context.client?.session && typeof (context.client.session as any).synthetic === 'function') {
          await (context.client.session as any).synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: 'Smart Questions protocol remediation',
            metadata: { 'opencode-smart-questions': true },
            delivery: 'queue',
            resume: true,
          });
          remediationSent = true;
        } else if (context.client?.session && typeof (context.client.session as any).prompt === 'function') {
          await (context.client.session as any).prompt({
            sessionID: form.sessionID,
            prompt: promptText,
          });
          remediationSent = true;
        } else if (context.data?.session && typeof (context.data.session as any).synthetic === 'function') {
          await (context.data.session as any).synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: 'Smart Questions protocol remediation',
            metadata: { 'opencode-smart-questions': true },
            delivery: 'queue',
            resume: true,
          });
          remediationSent = true;
        } else if ((context as any).session && typeof (context as any).session?.synthetic === 'function') {
          await (context as any).session.synthetic({
            sessionID: form.sessionID,
            text: promptText,
            description: 'Smart Questions protocol remediation',
            metadata: { 'opencode-smart-questions': true },
            delivery: 'queue',
            resume: true,
          });
          remediationSent = true;
        }
      } catch (err) {
        log(`remediation send failed form=${form.id} code=${diagnosticErrorCode(err)}`);
      }
      if (!remediationSent) {
        // Preserve in-flight duplicate suppression, but only consume the
        // per-chain remediation budget after an actual transport succeeds.
        remediatedForms.delete(form.id);
        if (currentCount === 0) {
          sessionChains.delete(form.sessionID);
        } else {
          sessionChains.set(form.sessionID, {
            fingerprint,
            consecutiveFailures: currentCount,
          });
        }
        log(`remediation not sent form=${form.id}; retry remains allowed`);
      }
      return;
    }

    // Here classification.status === 'auto'
    sessionChains.delete(form.sessionID);
    const detection: DetectionResult = classification.detection;
    const lockPath = resolveLockPath(config.configDir, form.id);
    const expiresAt = Date.now() + config.timeoutMs;
    const initialCountdown = Math.ceil(config.timeoutMs / 1000);

    const state: OverlayState = {
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
      uiText: config.uiText,
    };

    const item: V2Pending = {
      formID: form.id,
      sessionID: form.sessionID,
      answer: classification.answer,
      state,
      expiresAt,
      status: 'pending',
      lockPath,
      location,
      log,
      timeout: undefined as unknown as NodeJS.Timeout,
      interval: null,
    };

    const fire = async () => {
      if (pending.get(form.id) !== item || item.status !== 'pending') return;
      item.status = 'firing';
      if (item.interval) {
        clearInterval(item.interval);
        item.interval = null;
      }

      try {
        await context.data.session.form.sync(form.sessionID, item.location);
        const forms = context.data.session.form.list(form.sessionID, item.location);
        const stillPending =
          Array.isArray(forms) && forms.some((candidate) => candidate.id === form.id);

        if (
          !stillPending ||
          pending.get(form.id) !== item ||
          item.status !== 'firing' ||
          activeBySession()[form.sessionID]?.formID !== form.id ||
          activeBySession()[form.sessionID]?.focusDisabled
        ) {
          log(`skip reply form=${form.id} reason=no longer pending or manual interaction`);
          clearPending(form.id);
          return;
        }

        // Recheck immediately before initiating the irreversible reply request.
        if (pending.get(form.id) !== item || item.status !== 'firing') {
          clearPending(form.id);
          return;
        }
        await context.data.session.form.reply(
          {
            sessionID: form.sessionID,
            formID: form.id,
            answer: item.answer,
          },
          item.location
        );
        item.status = 'replied';
        consumeActiveHandoff(form.sessionID);
        try {
          context.data.session.form.invalidate(form.sessionID, item.location);
        } catch (error) {
          // Reply was already sent. A cache refresh error must not be reported
          // as a failed reply or cause the user to submit the form twice.
          log(`form cache invalidation failed form=${form.id} code=${diagnosticErrorCode(error)}`);
        }
        deleteLockfile(lockPath, log);
        pending.delete(form.id);
        updateSessionState(form.sessionID, (current) =>
          current?.formID === form.id ? undefined : current
        );
        log(`reply OK form=${form.id}`);
      } catch (error) {
        const code = diagnosticErrorCode(error);
        log(`reply ERROR form=${form.id} code=${code}`);
        console.error(`[smart-question] Auto-selection failed for form ${form.id} (${code})`);
        if (pending.get(form.id) === item) {
          pending.delete(form.id);
          deleteLockfile(lockPath, log);
          updateSessionState(form.sessionID, (current) =>
            current?.formID === form.id
              ? { ...current, focusDisabled: true, errorMessage: config.uiText.autoReplyFailed }
              : current
          );
        }
      }
    };

    item.timeout = setTimeout(() => {
      void fire();
    }, config.timeoutMs);

    if (config.timeoutMs > 0) {
      item.interval = setInterval(() => {
        if (pending.get(form.id) !== item || item.status !== 'pending') return;
        const countdown = Math.ceil(
          Math.max(0, item.expiresAt - Date.now()) / 1000
        );
        updateSessionState(form.sessionID, (current) =>
          current?.formID === form.id ? { ...current, countdown } : current
        );
      }, 250);
    }

    pending.set(form.id, item);
    updateSessionState(form.sessionID, () => state);
    log(
      `schedule form=${form.id} session=${form.sessionID} timeoutMs=${config.timeoutMs}`
    );
  };

  const onFormSettled = (event: any) => {
    const formID = event?.data?.id ?? event?.data?.form?.id ?? event?.properties?.id;
    const sessionID =
      event?.data?.sessionID ??
      event?.data?.form?.sessionID ??
      event?.properties?.sessionID;
    if (typeof sessionID === 'string' && sessionID !== 'global') {
      consumeActiveHandoff(sessionID);
      sessionChains.delete(sessionID);
    }
    if (typeof formID === 'string') {
      remediatedForms.delete(formID);
      clearPending(formID);
    }
  };

  const cleanups: Array<() => unknown> = [];
  const disposeCleanups = () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        // Keep tearing down the remaining resources.
      }
    }
  };

  const onKey = () => {
    const route = context.ui.router.current();
    if (route.type === 'session') {
      cancelSessionAutoSelection(route.sessionID, 'user keyboard interaction');
    }
  };
  const onPaste = () => {
    const route = context.ui.router.current();
    if (route.type === 'session') {
      cancelSessionAutoSelection(route.sessionID, 'user paste interaction');
    }
  };

  try {
    cleanups.push(context.data.on('form.created', onFormCreated));
    cleanups.push(context.data.on('form.replied', onFormSettled));
    cleanups.push(context.data.on('form.cancelled', onFormSettled));

    try {
      const msgDisposer = (context.data as any)?.on?.('message.created', (event: any) => {
        const sessionID = String(event?.data?.sessionID ?? event?.sessionID ?? '');
        if (!sessionID || sessionID === 'global') return;
        const handoff = extractTrustedGuardianHandoff(event?.data);
        if (handoff && typeof handoff === 'object' && 'version' in handoff) {
          setActiveHandoff(sessionID, handoff);
        } else {
          const role = event?.data?.role ?? event?.data?.info?.role ?? event?.data?.message?.role;
          if (role === 'user') {
            invalidateActiveHandoff(sessionID);
            sessionChains.delete(sessionID);
          }
        }
      });
      if (typeof msgDisposer === 'function') cleanups.push(msgDisposer);

      const sessionDelDisposer = (context.data as any)?.on?.('session.deleted', (event: any) => {
        const sessionID = String(event?.data?.id ?? event?.data?.sessionID ?? event?.sessionID ?? '');
        if (sessionID && sessionID !== 'global') {
          clearActiveHandoff(sessionID);
          sessionChains.delete(sessionID);
        }
      });
      if (typeof sessionDelDisposer === 'function') cleanups.push(sessionDelDisposer);
    } catch {
      // Best effort
    }

    context.renderer.keyInput.on('keypress', onKey);
    cleanups.push(() => context.renderer.keyInput.off('keypress', onKey));
    context.renderer.keyInput.on('paste', onPaste);
    cleanups.push(() => context.renderer.keyInput.off('paste', onPaste));

    cleanups.push(context.ui.slot({
      append: 'session.composer.top',
      render: ({ sessionID }) => (
        <SmartQuestionOverlay
          state={() => activeBySession()[sessionID] ?? null}
          countdown={() => activeBySession()[sessionID]?.countdown ?? 0}
          markers={activeBySession()[sessionID]?.markers ?? DEFAULT_CONFIG.recommendedMarkers}
          uiText={activeBySession()[sessionID]?.uiText ?? DEFAULT_CONFIG.uiText}
        />
      ),
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

const pluginModule: TuiPluginModule & {
  id: string;
  setup: typeof setup;
} = {
  id: 'smart-question-ui',
  tui,
  setup,
};

export default pluginModule;
