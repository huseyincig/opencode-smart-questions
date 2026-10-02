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
  loadConfig as loadSharedConfig,
  normalizeSmartQuestionConfig,
} from './config.js';
import { detectRecommendations as detectSharedRecommendations } from './detector.js';
import {
  deleteLockfile,
  resolveLockPath,
} from './draft-guard.js';
import {
  detectV2FormRecommendations,
  type V2FormInfo,
} from './form-adapter.js';
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
}

function createDiagnosticLogger(config: SmartQuestionConfig, prefix: string) {
  const logPath =
    typeof config.debugLog === 'string' && config.debugLog ? config.debugLog : '';
  return (message: string): void => {
    if (!logPath) return;
    try {
      fs.appendFileSync(
        logPath,
        `[${prefix}] ${new Date().toISOString()} ${message}\n`
      );
    } catch {
      // Diagnostics must never break the UI.
    }
  };
}

function ensureDraftLock(lockPath: string, payload: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, JSON.stringify(payload), 'utf8');
  } catch {
    // Lock creation is best effort; callers also cancel their local timers.
  }
}

function resolveV2TuiConfig(context: OpenCodeV2Tui.Context): SmartQuestionConfig | null {
  const options = context.options as Record<string, unknown> | undefined;
  const configDir = context.location?.directory
    ? path.resolve(context.location.directory, '.opencode')
    : undefined;
  // An explicit but invalid inline configuration must not enable auto-selection.
  if (options && Object.prototype.hasOwnProperty.call(options, 'config')) {
    return normalizeSmartQuestionConfig(options.config, configDir);
  }
  const candidate = options;

  const knownKeys = new Set([
    'enabled',
    'timeoutMs',
    'recommendedMarkers',
    'recommendedMarker',
    'requireExactlyOneRecommendation',
    'uiText',
    'debugLog',
    'configDir',
  ]);
  const hasInlineConfig =
    candidate &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate) &&
    Object.keys(candidate as Record<string, unknown>).some((key) => knownKeys.has(key));

  if (hasInlineConfig) {
    return normalizeSmartQuestionConfig(
      candidate,
      context.location?.directory
        ? path.resolve(context.location.directory, '.opencode')
        : undefined
    );
  }

  return loadConfig(context.location?.directory);
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
export const tui: TuiPlugin = async (api) => {
  const projectDir = api.state?.path?.directory ?? process.cwd();
  const config = loadConfig(projectDir);
  if (!config?.enabled) return;

  const log = createDiagnosticLogger(config, 'smart-question-ui');
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
      !Array.isArray(questions) ||
      questions.length === 0
    ) {
      return;
    }

    const decision = detectRecommendations(
      questions,
      config.recommendedMarkers,
      { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
    );
    if (!decision.ok) return;

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
    const current = activeQuestion();
    if (current && typeof requestID === 'string' && requestID === current.requestID) {
      clearActive();
    }
  };

  const stopAsked = api.event?.on?.('question.asked', onAsked);
  const stopReplied = api.event?.on?.('question.replied', onEnd);
  const stopRejected = api.event?.on?.('question.rejected', onEnd);

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

  api.renderer?.keyInput?.on?.('keypress', onKey);
  api.renderer?.keyInput?.on?.('paste', onPaste);

  const stopLegacyKey = (api.keymap as any)?.intercept?.('key', onKey);

  api.lifecycle?.onDispose?.(() => {
    stopLegacyKey?.();
    stopAsked?.();
    stopReplied?.();
    stopRejected?.();
    api.renderer?.keyInput?.off?.('keypress', onKey);
    api.renderer?.keyInput?.off?.('paste', onPaste);
    clearActive();
  });
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

  const config = resolveV2TuiConfig(context);
  if (!config?.enabled) return;

  const log = createDiagnosticLogger(config, 'smart-question-v2-ui');
  const [activeBySession, setActiveBySession] = createSignal<
    Record<string, OverlayState>
  >({});
  const pending = new Map<string, V2Pending>();
  const location = context.location;

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
      deleteLockfile(item.lockPath, log);
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
    log(`manual interaction form=${item.formID} session=${sessionID} reason=${reason}`);
  };

  const onFormCreated = (event: any) => {
    if (
      event?.location?.directory &&
      location?.directory &&
      event.location.directory !== location.directory
    ) {
      return;
    }

    const form = event?.data?.form as V2FormInfo | undefined;
    if (!form?.id || !form.sessionID || form.sessionID === 'global') return;

    // A newer form supersedes any prior timer in the same session, even if
    // the new form is not eligible for automatic selection.
    for (const [id, existing] of pending.entries()) {
      if (existing.sessionID === form.sessionID) {
        clearPending(id);
      }
    }

    const decision = detectV2FormRecommendations(
      form,
      config.recommendedMarkers,
      { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
    );
    if (!decision.ok) {
      log(`skip form=${form.id} reason=${decision.reason}`);
      return;
    }

    const detection: DetectionResult = decision.detection;
    const lockPath = resolveLockPath(config.configDir, form.id);
    const expiresAt = Date.now() + config.timeoutMs;
    const initialCountdown = Math.ceil(config.timeoutMs / 1000);

    const state: OverlayState = {
      requestID: form.id,
      formID: form.id,
      sessionID: form.sessionID,
      questions: decision.questions,
      detection,
      agentName: form.sessionID.slice(0, 8),
      agentFound: false,
      focusDisabled: false,
      countdown: initialCountdown,
    };

    const item: V2Pending = {
      formID: form.id,
      sessionID: form.sessionID,
      answer: decision.answer,
      state,
      expiresAt,
      status: 'pending',
      lockPath,
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
        await context.data.session.form.sync(form.sessionID, location);
        const forms = context.data.session.form.list(form.sessionID, location);
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
            answer: decision.answer,
          },
          location
        );
        item.status = 'replied';
        try {
          context.data.session.form.invalidate(form.sessionID, location);
        } catch (error) {
          // Reply was already sent. A cache refresh error must not be reported
          // as a failed reply or cause the user to submit the form twice.
          log(`form cache invalidation failed form=${form.id} err=${error instanceof Error ? error.message : String(error)}`);
        }
        deleteLockfile(lockPath, log);
        pending.delete(form.id);
        updateSessionState(form.sessionID, (current) =>
          current?.formID === form.id ? undefined : current
        );
        log(`reply OK form=${form.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log(`reply ERROR form=${form.id} err=${message}`);
        console.error(`[smart-question] Auto-selection failed for form ${form.id}: ${message}`);
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
    if (typeof formID === 'string') clearPending(formID);
  };

  const stopCreated = context.data.on('form.created', onFormCreated);
  const stopReplied = context.data.on('form.replied', onFormSettled);
  const stopCancelled = context.data.on('form.cancelled', onFormSettled);

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

  context.renderer.keyInput.on('keypress', onKey);
  context.renderer.keyInput.on('paste', onPaste);

  const stopSlot = context.ui.slot({
    append: 'session.composer.top',
    render: ({ sessionID }) => (
      <SmartQuestionOverlay
        state={() => activeBySession()[sessionID] ?? null}
        countdown={() => activeBySession()[sessionID]?.countdown ?? 0}
        markers={config.recommendedMarkers}
        uiText={config.uiText}
      />
    ),
  });

  return () => {
    stopCreated();
    stopReplied();
    stopCancelled();
    stopSlot();
    context.renderer.keyInput.off('keypress', onKey);
    context.renderer.keyInput.off('paste', onPaste);
    for (const formID of [...pending.keys()]) {
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
