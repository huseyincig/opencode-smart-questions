/** @jsxImportSource @opentui/solid */

import fs from 'node:fs';
import path from 'node:path';
import { Show, createMemo, createSignal } from 'solid-js';
import { Plugin as OpenCodeV2Tui } from '@opencode/plugin/tui';

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
  cleanupStaleDrafts,
  deleteLockfile,
  resolveLockPath,
} from './draft-guard.js';
import {
  classifyV2Form,
  type V2FormInfo,
} from './form-adapter.js';
import { buildUnclassifiedRemediationPrompt } from './backend.js';
import { DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS } from './config.js';
import {
  diagnosticErrorCode,
  recordSmartQuestionDecision,
} from './diagnostics.js';
import { isEligibleSessionInfo } from './session-scope.js';
import {
  getActiveHandoff,
  setActiveHandoff,
  consumeActiveHandoff,
  clearActiveHandoff,
  invalidateActiveHandoff,
  isInternalNonHumanMessage,
  extractTrustedGuardianHandoff,
  extractCurrentTurnGuardianHandoff,
  markFormRemediated,
  unmarkFormRemediated,
} from './handoff.js';
import {
  acquireSessionLease,
  callMeshRpc,
  forgetMeshSession,
  MESH_STATE_RPC_DEFINITION,
  stampMeshMetadata,
} from './bridge.js';
import type {
  ActiveQuestionState,
  DetectionResult,
  QuestionOverlayStatus,
  SmartQuestionConfig,
  SmartQuestionUIText,
} from './types.js';

export function loadConfig(...args: any[]) {
  return loadSharedConfig(...args);
}

export function detectRecommendations(...args: any[]) {
  return detectSharedRecommendations(args[0], args[1], args[2]);
}

export interface OverlayState extends ActiveQuestionState {
  status?: QuestionOverlayStatus | undefined;
  statusMessage?: string | undefined;
  countdown?: number | undefined;
  formID?: string | undefined;
  lockPath?: string | undefined;
  markers?: string[] | undefined;
  uiText?: SmartQuestionUIText | undefined;
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
    // Exclusive create ('wx') refuses to follow or overwrite pre-existing symlinks or files.
    fs.writeFileSync(lockPath, '', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
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
 * Resolve a best-effort agent/session label for the v2 TUI.
 */
export function resolveAgentName(
  sessionInfo: unknown,
  sessionID?: string
): { name: string; found: boolean } {
  if (sessionInfo && typeof sessionInfo === 'object') {
    const record = sessionInfo as Record<string, unknown>;
    const agent = record.agent;
    if (typeof agent === 'string' && agent.trim().length > 0) {
      return { name: agent.trim(), found: true };
    }
  }

  const shortId =
    sessionID && typeof sessionID === 'string'
      ? sessionID.slice(0, 8)
      : 'unknown';
  return { name: shortId, found: false };
}

import {
  formatCountdown as vmFormatCountdown,
  stripMarker as vmStripMarker,
} from './view-model.js';

export function stripMarker(label: unknown, marker: unknown): string {
  return vmStripMarker(label, marker);
}

export function formatCountdown(totalSeconds: unknown): string {
  return vmFormatCountdown(totalSeconds);
}


export function SmartQuestionOverlay(props: {
  state: () => OverlayState | null;
  countdown?: () => number;
  marker?: string | string[];
  markers?: string | string[] | (() => string | string[]);
  uiText?: SmartQuestionUIText | (() => SmartQuestionUIText);
}) {
  const active = () => props.state();
  const markers = () => {
    const fromState = active()?.markers;
    if (fromState !== undefined) return fromState;
    const fromProp =
      typeof props.markers === 'function' ? props.markers() : props.markers;
    return fromProp ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers ?? [];
  };
  const labels = () => {
    const fromState = active()?.uiText;
    if (fromState !== undefined) return fromState;
    const fromProp =
      typeof props.uiText === 'function' ? props.uiText() : props.uiText;
    return fromProp ?? DEFAULT_CONFIG.uiText;
  };

  const status = createMemo(() => active()?.status ?? 'auto');

  const title = createMemo(() => {
    switch (status()) {
      case 'manual':
        return ' Smart Question — Manual Decision ';
      case 'unclassified':
        return ' Smart Question — Intercepted ';
      case 'error':
        return ' Smart Question — Warning ';
      case 'auto':
      default:
        return ' Smart Question ';
    }
  });

  const borderColor = createMemo(() => {
    switch (status()) {
      case 'manual':
        return 'yellow';
      case 'unclassified':
        return 'cyan';
      case 'error':
        return 'red';
      case 'auto':
      default:
        return 'cyan';
    }
  });

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
        borderColor={borderColor()}
        title={title()}
        paddingLeft={1}
        paddingRight={1}
        flexDirection="column"
      >
        <box width="100%" flexDirection="row" justifyContent="flex-end">
          <text fg="gray">{badge()}</text>
        </box>
        <Show
          when={status() === 'auto'}
          fallback={
            <Show
              when={status() === 'manual'}
              fallback={
                <Show
                  when={status() === 'unclassified'}
                  fallback={
                    <box width="100%" flexDirection="column">
                      <box width="100%" flexDirection="row" justifyContent="space-between">
                        <text fg="red">
                          <b>{active()?.errorMessage ?? labels().remediationFailed ?? 'Remediation stopped. Please answer manually.'}</b>
                        </text>
                        <text fg="red">
                          <b>{labels().disabled}</b>
                        </text>
                      </box>
                    </box>
                  }
                >
                  <box width="100%" flexDirection="column">
                    <box width="100%" flexDirection="row" justifyContent="space-between">
                      <text fg="cyan">
                        <b>{labels().unclassifiedTitle ?? 'Unclassified Question Intercepted'}</b>
                      </text>
                      <text fg="magenta">
                        <b>WAITING FOR AGENT</b>
                      </text>
                    </box>
                    <box width="100%" flexDirection="row">
                      <text fg="gray">{active()?.statusMessage ?? labels().unclassifiedSubtitle ?? 'Agent was asked to classify the question.'}</text>
                    </box>
                  </box>
                </Show>
              }
            >
              <box width="100%" flexDirection="column">
                <box width="100%" flexDirection="row" justifyContent="space-between">
                  <text fg="yellow">
                    <b>{labels().manualTitle ?? 'Manual Decision Required'}</b>
                  </text>
                  <text fg="red">
                    <b>{labels().disabled}</b>
                  </text>
                </box>
                <box width="100%" flexDirection="row">
                  <text fg="gray">{active()?.statusMessage ?? labels().manualSubtitle ?? 'Auto-selection disabled — human approval required.'}</text>
                </box>
              </box>
            </Show>
          }
        >
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
        </Show>
      </box>
    </Show>
  );
}

const MAX_REMEDIATED_FORMS = 512;
const MAX_SESSION_CHAINS = 512;

function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  if (map.has(key)) {
    map.delete(key);
  }
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

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

  const pluginOptions = context.options as Record<string, unknown> | undefined;
  if (
    typeof pluginOptions?.resolveConfig !== 'function' &&
    hasSmartQuestionConfigOptions(pluginOptions)
  ) {
    const explicitConfig = resolveV2TuiConfig(context);
    if (!explicitConfig?.enabled) return;
  }

  let disposed = false;
  const lifecycleController = new AbortController();

  const [activeBySession, setActiveBySession] = createSignal<
    Record<string, OverlayState>
  >({});
  const pending = new Map<string, V2Pending>();
  const inFlightForms = new Map<string, { sessionID: string; token: symbol }>();
  const remediatedForms = new Map<string, string>();
  const settledForms = new Map<string, true>();
  const sessionChains = new Map<string, { fingerprint: string; consecutiveFailures: number }>();
  const uiInteractionLeases = new Map<
    string,
    { release: () => void; dir?: string | undefined; formID?: string | undefined }
  >();
  const MAX_UI_INTERACTION_LEASES = 512;
  const syncRemoteLease = (
    sessionID: string,
    active: boolean,
    dir?: string,
    ttlMs?: number,
    reason?: string
  ) => {
    const rpcFn = (context.client as { rpc?: (contract: unknown) => any } | undefined)?.rpc;
    if (typeof rpcFn !== 'function') return;
    void callMeshRpc({
      rpcGetter: rpcFn.bind(context.client),
      contract: MESH_STATE_RPC_DEFINITION,
      method: 'setInteractionLease',
      payload: {
        sessionID,
        owner: 'opencode-smart-questions',
        active,
        ...(ttlMs !== undefined ? { ttlMs } : {}),
        ...(reason ? { reason } : {}),
      },
      directory: dir ?? context.location?.directory,
    });
  };
  const setUiInteractionLease = (
    sessionID: string,
    entry: { release: () => void; dir?: string | undefined; formID?: string | undefined }
  ) => {
    if (uiInteractionLeases.has(sessionID)) {
      uiInteractionLeases.delete(sessionID);
    }
    uiInteractionLeases.set(sessionID, entry);
    while (uiInteractionLeases.size > MAX_UI_INTERACTION_LEASES) {
      const oldestSessionID = uiInteractionLeases.keys().next().value;
      if (oldestSessionID === undefined) break;
      const oldest = uiInteractionLeases.get(oldestSessionID);
      uiInteractionLeases.delete(oldestSessionID);
      if (oldest) {
        try {
          oldest.release();
        } catch {}
        syncRemoteLease(oldestSessionID, false, oldest.dir);
      }
    }
  };
  const releaseUiLease = (sessionID: string, dir?: string) => {
    const entry = uiInteractionLeases.get(sessionID);
    if (entry) {
      uiInteractionLeases.delete(sessionID);
      try {
        entry.release();
      } catch {}
      syncRemoteLease(sessionID, false, entry.dir ?? dir);
    }
  };
  const releaseAllUiLeases = () => {
    for (const sessionID of Array.from(uiInteractionLeases.keys())) {
      releaseUiLease(sessionID);
    }
  };

  const MAX_SETTLED_FORMS = 512;

  const cancelInFlightForSession = (sessionID: string) => {
    for (const [fID, entry] of inFlightForms.entries()) {
      if (entry.sessionID === sessionID) {
        inFlightForms.delete(fID);
      }
    }
  };

  const cleanupSessionRemediations = (sessionID: string) => {
    for (const [fID, sID] of remediatedForms.entries()) {
      if (sID === sessionID) {
        remediatedForms.delete(fID);
        unmarkFormRemediated(fID);
      }
    }
  };

  const updateSessionState = (
    sessionID: string,
    updater: (current: OverlayState | undefined) => OverlayState | undefined
  ) => {
    setActiveBySession((current) => {
      const prev = current[sessionID];
      const updated = updater(prev);
      if (updated === prev) return current;
      const next = { ...current };
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

  const clearSessionState = (sessionID: string) => {
    for (const [id, item] of pending.entries()) {
      if (item.sessionID === sessionID) {
        clearPending(id);
      }
    }
    const existingState = activeBySession()[sessionID];
    if (existingState?.lockPath) {
      deleteLockfile(existingState.lockPath);
    }
    updateSessionState(sessionID, () => undefined);
  };

  const cancelSessionAutoSelection = (sessionID: string, reason: string) => {
    cancelInFlightForSession(sessionID);
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
    if (disposed) return;
    const form = (event?.data?.form ?? event?.properties?.form) as V2FormInfo | undefined;
    if (!form?.id || !form.sessionID || form.sessionID === 'global') return;

    // Re-delivery of the same form must preserve its reply owner and any
    // user-interaction cancellation instead of starting a new countdown.
    if (pending.has(form.id) || inFlightForms.has(form.id) || settledForms.has(form.id)) return;

    const flightToken = Symbol(form.id);
    inFlightForms.set(form.id, { sessionID: form.sessionID, token: flightToken });
    const isFlightCurrent = () =>
      !disposed && inFlightForms.get(form.id)?.token === flightToken;

    try {
      let sessionInfo: unknown;
      try {
        sessionInfo = (context.data.session as any)?.get?.(form.sessionID);
        if (!sessionInfo && typeof (context.data.session as any)?.sync === 'function') {
          await (context.data.session as any).sync(form.sessionID);
          if (!isFlightCurrent()) return;
          sessionInfo = (context.data.session as any)?.get?.(form.sessionID);
        }
      } catch {
        return;
      }
      if (!isFlightCurrent()) return;

      if (!sessionInfo && typeof (context.data.session as any)?.root === 'function') {
        try {
          const rootID = (context.data.session as any).root(form.sessionID);
          if (typeof rootID === 'string' && rootID) {
            sessionInfo = {
              id: form.sessionID,
              parentID: rootID === form.sessionID ? undefined : rootID,
            };
          }
        } catch {
          // Fall back
        }
      }

      const sessionLocation =
        (sessionInfo as any)?.location?.directory ??
        (sessionInfo as any)?.directory;
      const locationDir = event?.location?.directory ?? sessionLocation ?? context.location?.directory;
      const location = event?.location ?? (sessionLocation ? { directory: sessionLocation } : context.location);
      const config = resolveV2TuiConfig(context, locationDir);
      if (!isEligibleSessionInfo(sessionInfo, config?.includeSubagents === true)) return;
      if (pending.has(form.id)) return;

      // A newer form supersedes any prior timer in the same session, even if
      // the new form is not eligible for automatic selection.
      for (const [id, existing] of pending.entries()) {
        if (existing.sessionID === form.sessionID) {
          clearPending(id);
        }
      }

      if (!config?.enabled) return;
      releaseUiLease(form.sessionID, locationDir);
      const leaseTtl = Math.max((config.timeoutMs ?? 0) + 15_000, 120_000);
      setUiInteractionLease(form.sessionID, {
        release: acquireSessionLease({
          sessionID: form.sessionID,
          owner: 'opencode-smart-questions',
          kind: 'user_interaction',
          ttlMs: leaseTtl,
          reason: `form:${form.id}`,
        }),
        dir: locationDir,
        formID: form.id,
      });
      syncRemoteLease(form.sessionID, true, locationDir, leaseTtl, `form:${form.id}`);
      const log = createDiagnosticLogger(config, 'smart-question-v2-ui');
      const effectiveConfigDir =
        config.configDir ||
        path.resolve(
          location?.directory || context.location?.directory || process.cwd(),
          '.opencode'
        );
      cleanupStaleDrafts(effectiveConfigDir, config.timeoutMs, log);

      const fallbackActive =
        config.unclassifiedQuestionPolicy === 'fallback-first' ||
        config.fallbackToFirstOption === true;
      const classifyOptions = {
        requireExactlyOneRecommendation: config.requireExactlyOneRecommendation,
        allowFallback: fallbackActive,
        allowFallbackOnManual: config.fallbackOnManual === true,
        manualOnPatterns: config.manualOnPatterns,
        unsupportedFieldPolicy: config.unsupportedFieldPolicy,
      };

      // Pre-classify before expensive session message sync: forms that are already
      // strictly manual or ignored unsupported fields do not need a DB message sync.
      let handoff = getActiveHandoff(form.sessionID);
      const preliminary = !handoff
        ? classifyV2Form(
            form,
            config.recommendedMarkers,
            config.manualMarkers,
            null,
            classifyOptions
          )
        : null;
      const skipMessageSync =
        preliminary !== null &&
        (preliminary.status === 'manual' ||
          (preliminary.status === 'unclassified' &&
            Boolean(preliminary.unsupported) &&
            config.unsupportedFieldPolicy !== 'remediate'));

      if (!handoff && !skipMessageSync) {
        try {
          const msgApi = (context.data?.session as any)?.message;
          let msgs = msgApi?.list?.(form.sessionID);
          let synced = false;
          if (
            (!Array.isArray(msgs) || msgs.length === 0) &&
            typeof msgApi?.sync === 'function'
          ) {
            await msgApi.sync(form.sessionID);
            synced = true;
            if (!isFlightCurrent()) return;
            msgs = msgApi?.list?.(form.sessionID);
          }
          let extracted = Array.isArray(msgs)
            ? extractCurrentTurnGuardianHandoff(msgs, form.sessionID)
            : null;
          if (!extracted && !synced && typeof msgApi?.sync === 'function') {
            await msgApi.sync(form.sessionID);
            if (!isFlightCurrent()) return;
            msgs = msgApi?.list?.(form.sessionID);
            extracted = Array.isArray(msgs)
              ? extractCurrentTurnGuardianHandoff(msgs, form.sessionID)
              : null;
          }
          if (extracted) {
            if (setActiveHandoff(form.sessionID, extracted) === true) {
              handoff = extracted;
            }
          }
        } catch {
          // Best effort
        }
      }
      if (!isFlightCurrent()) return;

      const agent = resolveAgentName(sessionInfo, form.sessionID);

      let classification =
        !handoff && preliminary
          ? preliminary
          : classifyV2Form(
              form,
              config.recommendedMarkers,
              config.manualMarkers,
              handoff,
              classifyOptions
            );

      if (classification.status === 'manual') {
        recordSmartQuestionDecision({
          formID: form.id,
          sessionID: form.sessionID,
          status: 'manual',
          reason: classification.reason,
          matchedMarker: classification.matchedMarker,
          timestamp: Date.now(),
        });
        sessionChains.delete(form.sessionID);
        const lockPath = resolveLockPath(effectiveConfigDir, form.id);
        ensureDraftLock(lockPath, { formID: form.id, sessionID: form.sessionID, ts: Date.now(), reason: 'manual' });
        const state: OverlayState = {
          requestID: form.id,
          formID: form.id,
          sessionID: form.sessionID,
          questions: classification.questions,
          detection: { ok: false, reason: classification.reason },
          agentName: agent.name,
          agentFound: agent.found,
          focusDisabled: true,
          status: 'manual',
          statusMessage: config.uiText.manualSubtitle,
          lockPath,
          markers: config.recommendedMarkers,
          uiText: config.uiText,
        };
        updateSessionState(form.sessionID, () => state);
        log(
          `manual form=${form.id} reason=manual-classification matched=${classification.matchedMarker ?? 'none'}`
        );
        return;
      }

      if (classification.status === 'unclassified') {
        if (classification.unsupported && config.unsupportedFieldPolicy !== 'remediate') {
          recordSmartQuestionDecision({
            formID: form.id,
            sessionID: form.sessionID,
            status: 'unsupported',
            reason: classification.reason,
            timestamp: Date.now(),
          });
          log(`unsupported form=${form.id} reason=${classification.reason}`);
          return;
        }
        recordSmartQuestionDecision({
          formID: form.id,
          sessionID: form.sessionID,
          status: 'unclassified',
          reason: classification.reason,
          timestamp: Date.now(),
        });
        if (config.unclassifiedQuestionPolicy === 'ignore') {
          log(`unclassified form=${form.id} ignored per unclassifiedQuestionPolicy`);
          return;
        }
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

        const lockPath = resolveLockPath(effectiveConfigDir, form.id);

        if (currentCount >= maxRemediations) {
          log(
            `unclassified remediation budget exhausted session=${form.sessionID} fingerprint=${fingerprint} count=${currentCount}/${maxRemediations}`
          );

          if (config.unclassifiedQuestionPolicy === 'remediate-then-fallback') {
            const fallbackClassification = classifyV2Form(
              form,
              config.recommendedMarkers,
              config.manualMarkers,
              handoff,
              {
                requireExactlyOneRecommendation: config.requireExactlyOneRecommendation,
                allowFallback: true,
                allowFallbackOnManual: config.fallbackOnManual === true,
                manualOnPatterns: config.manualOnPatterns,
                unsupportedFieldPolicy: config.unsupportedFieldPolicy,
              }
            );
            if (fallbackClassification.status === 'auto') {
              classification = fallbackClassification;
              sessionChains.delete(form.sessionID);
              log(`remediation budget exhausted, activating fallback form=${form.id}`);
            }
          }

          if (classification.status !== 'auto') {
            ensureDraftLock(lockPath, { formID: form.id, sessionID: form.sessionID, ts: Date.now(), reason: 'budget-exhausted' });
            const state: OverlayState = {
              requestID: form.id,
              formID: form.id,
              sessionID: form.sessionID,
              questions: classification.questions,
              detection: { ok: false, reason: 'Remediation budget exhausted' },
              agentName: agent.name,
              agentFound: agent.found,
              focusDisabled: true,
              status: 'error',
              errorMessage: config.uiText.budgetExhausted,
              lockPath,
              markers: config.recommendedMarkers,
              uiText: config.uiText,
            };
            updateSessionState(form.sessionID, () => state);
            return;
          }
        }

        if (classification.status === 'unclassified') {
          setBounded(remediatedForms, form.id, form.sessionID, MAX_REMEDIATED_FORMS);
          markFormRemediated(form.id, form.sessionID);
          setBounded(
            sessionChains,
            form.sessionID,
            {
              fingerprint,
              consecutiveFailures: currentCount + 1,
            },
            MAX_SESSION_CHAINS
          );

          ensureDraftLock(lockPath, { formID: form.id, sessionID: form.sessionID, ts: Date.now(), reason: 'unclassified' });
          const state: OverlayState = {
            requestID: form.id,
            formID: form.id,
            sessionID: form.sessionID,
            questions: classification.questions,
            detection: { ok: false, reason: classification.reason },
            agentName: agent.name,
            agentFound: agent.found,
            focusDisabled: true,
            status: 'unclassified',
            statusMessage: config.uiText.unclassifiedSubtitle,
            lockPath,
            markers: config.recommendedMarkers,
            uiText: config.uiText,
          };
          updateSessionState(form.sessionID, () => state);

          const promptText = buildUnclassifiedRemediationPrompt(
            config.recommendedMarker,
            config.manualMarker
          );
          let remediationSent = false;
          try {
            if (isFlightCurrent()) {
              const response: unknown = await context.client.session.synthetic(
                {
                  sessionID: form.sessionID,
                  text: promptText,
                  description: 'Smart Questions protocol remediation',
                  metadata: stampMeshMetadata(form.sessionID, {
                    owner: 'opencode-smart-questions',
                    kind: 'remediation',
                    protected: true,
                  }) as Record<string, any>,
                  delivery: 'queue',
                  resume: true,
                },
                { signal: lifecycleController.signal }
              );
              const rejected = response && typeof response === 'object' && !Array.isArray(response) &&
                (Boolean((response as { error?: unknown }).error) ||
                  (response as { ok?: unknown }).ok === false ||
                  (response as { name?: unknown }).name === 'UnknownError');
              remediationSent = !disposed && !rejected;
            }
          } catch (err) {
            log(`remediation send failed form=${form.id} code=${diagnosticErrorCode(err)}`);
          }
          if (!remediationSent) {
            remediatedForms.delete(form.id);
            unmarkFormRemediated(form.id);
            if (
              settledForms.has(form.id) &&
              uiInteractionLeases.get(form.sessionID)?.formID === form.id
            ) {
              releaseUiLease(form.sessionID, locationDir);
            }
            if (currentCount === 0) {
              sessionChains.delete(form.sessionID);
            } else {
              setBounded(
                sessionChains,
                form.sessionID,
                {
                  fingerprint,
                  consecutiveFailures: currentCount,
                },
                MAX_SESSION_CHAINS
              );
            }
            if (!disposed && !settledForms.has(form.id)) {
              updateSessionState(form.sessionID, (current) =>
                current?.formID === form.id
                  ? { ...current, status: 'error', errorMessage: config.uiText.remediationFailed }
                  : current
              );
            }
            log(`remediation not sent form=${form.id}; retry remains allowed`);
          }
          return;
        }
      }

      if (classification.status !== 'auto' || !isFlightCurrent()) return;
      if (!canUseDraftCoordination(effectiveConfigDir, log)) {
        log(`skip auto-selection form=${form.id} reason=draft coordination unavailable`);
        return;
      }

      sessionChains.delete(form.sessionID);
      const detection: DetectionResult = classification.detection;
      recordSmartQuestionDecision({
        formID: form.id,
        sessionID: form.sessionID,
        status: 'auto',
        matchedMarker: detection.matchedMarker,
        timeoutMs: config.timeoutMs,
        timestamp: Date.now(),
      });
      const lockPath = resolveLockPath(effectiveConfigDir, form.id);
      const expiresAt = Date.now() + config.timeoutMs;
      const initialCountdown = Math.ceil(config.timeoutMs / 1000);

      const state: OverlayState = {
        requestID: form.id,
        formID: form.id,
        sessionID: form.sessionID,
        questions: classification.questions,
        detection,
        agentName: agent.name,
        agentFound: agent.found,
        focusDisabled: false,
        status: 'auto',
        lockPath,
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
        if (disposed || pending.get(form.id) !== item || item.status !== 'pending') return;
        item.status = 'firing';
        if (item.interval) {
          clearInterval(item.interval);
          item.interval = null;
        }

        try {
          try {
            fs.statSync(lockPath);
            log(`skip reply form=${form.id} reason=draft lockfile present`);
            clearPending(form.id, { removeLock: false });
            return;
          } catch (lockErr) {
            const lockCode = (lockErr as { code?: string })?.code;
            if (lockCode !== 'ENOENT' || !canUseDraftCoordination(effectiveConfigDir, log)) {
              log(`skip reply form=${form.id} reason=draft coordination check failed`);
              clearPending(form.id, { removeLock: false });
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
          const stillPending =
            Array.isArray(forms) && forms.some((candidate) => candidate.id === form.id);

          if (!stillPending) {
            releaseUiLease(form.sessionID, locationDir);
          }
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
          if (disposed || pending.get(form.id) !== item) return;
          item.status = 'replied';
          recordSmartQuestionDecision({
            formID: form.id,
            sessionID: form.sessionID,
            status: 'replied',
            matchedMarker: detection.matchedMarker,
            timeoutMs: config.timeoutMs,
            timestamp: Date.now(),
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
          updateSessionState(form.sessionID, (current) => {
            if (!current || current.formID !== form.id || current.countdown === countdown) {
              return current;
            }
            return { ...current, countdown };
          });
        }, 250);
      }

      pending.set(form.id, item);
      updateSessionState(form.sessionID, () => state);
      log(
        `schedule form=${form.id} session=${form.sessionID} timeoutMs=${config.timeoutMs}`
      );
    } finally {
      if (inFlightForms.get(form.id)?.token === flightToken) {
        inFlightForms.delete(form.id);
      }
    }
  };

  const onFormSettled = (
    event: any,
    kind: 'replied' | 'cancelled' = 'replied'
  ) => {
    const formID =
      event?.data?.formID ??
      event?.data?.id ??
      event?.data?.form?.id ??
      event?.properties?.formID ??
      event?.properties?.id ??
      event?.properties?.form?.id;
    const rawSessionID =
      event?.data?.sessionID ??
      event?.data?.form?.sessionID ??
      event?.properties?.sessionID ??
      event?.properties?.form?.sessionID;
    const targetSession =
      typeof rawSessionID === 'string' && rawSessionID !== 'global'
        ? rawSessionID
        : typeof formID === 'string'
          ? (pending.get(formID)?.sessionID ??
            remediatedForms.get(formID) ??
            inFlightForms.get(formID)?.sessionID ??
            Object.keys(activeBySession()).find((sId) => activeBySession()[sId]?.formID === formID) ??
            Array.from(uiInteractionLeases.entries()).find(([, v]) => v.formID === formID)?.[0])
          : undefined;

    const currentFormID = targetSession
      ? (uiInteractionLeases.get(targetSession)?.formID ??
        activeBySession()[targetSession]?.formID)
      : undefined;

    if (
      targetSession &&
      typeof formID === 'string' &&
      currentFormID &&
      currentFormID !== formID
    ) {
      setBounded(settledForms, formID, true, MAX_SETTLED_FORMS);
      inFlightForms.delete(formID);
      remediatedForms.delete(formID);
      unmarkFormRemediated(formID);
      clearPending(formID);
      const existingState = activeBySession()[targetSession];
      if (existingState?.formID === formID && existingState.lockPath) {
        try {
          deleteLockfile(existingState.lockPath);
        } catch {}
      }
      updateSessionState(targetSession, (current) =>
        current?.formID === formID ? undefined : current
      );
      return;
    }

    const wasRemediated =
      typeof formID === 'string' && remediatedForms.has(formID);

    if (typeof formID === 'string') {
      setBounded(settledForms, formID, true, MAX_SETTLED_FORMS);
      inFlightForms.delete(formID);
      remediatedForms.delete(formID);
      if (kind !== 'cancelled') {
        unmarkFormRemediated(formID);
      }
      clearPending(formID);
    }

    if (targetSession) {
      const existingState = activeBySession()[targetSession];
      if (
        existingState?.lockPath &&
        (!formID || existingState.formID === formID)
      ) {
        try {
          deleteLockfile(existingState.lockPath);
        } catch {}
      }
      if (typeof formID === 'string') {
        updateSessionState(targetSession, (current) =>
          current?.formID === formID ? undefined : current
        );
      } else {
        updateSessionState(targetSession, () => undefined);
      }

      if (kind === 'cancelled' && wasRemediated) {
        const prevDir =
          uiInteractionLeases.get(targetSession)?.dir ??
          event?.location?.directory ??
          context.location?.directory;
        releaseUiLease(targetSession, prevDir);
        const remediationTtlMs = 45_000;
        setUiInteractionLease(targetSession, {
          release: acquireSessionLease({
            sessionID: targetSession,
            owner: 'opencode-smart-questions',
            kind: 'user_interaction',
            ttlMs: remediationTtlMs,
            reason: `remediation:${formID}`,
          }),
          dir: prevDir,
          formID: typeof formID === 'string' ? formID : undefined,
        });
        syncRemoteLease(
          targetSession,
          true,
          prevDir,
          remediationTtlMs,
          `remediation:${formID}`
        );
      } else {
        releaseUiLease(targetSession, event?.location?.directory);
        consumeActiveHandoff(targetSession);
        sessionChains.delete(targetSession);
      }
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

  const NON_INTERVENTION_KEYS = new Set([
    'pageup',
    'pagedown',
    'home',
    'end',
    'scrollup',
    'scrolldown',
    'f1',
    'f2',
    'f3',
    'f4',
    'f5',
    'f6',
    'f7',
    'f8',
    'f9',
    'f10',
    'f11',
    'f12',
    'shift',
    'ctrl',
    'control',
    'alt',
    'option',
    'meta',
    'super',
    'hyper',
    'leftshift',
    'rightshift',
    'leftctrl',
    'rightctrl',
    'leftalt',
    'rightalt',
    'leftmeta',
    'rightmeta',
    'leftsuper',
    'rightsuper',
    'lefthyper',
    'righthyper',
    'iso_level3_shift',
    'iso_level5_shift',
    'capslock',
    'numlock',
    'scrolllock',
  ]);

  const getCachedSessionInfo = (sessionID: string): unknown => {
    try {
      let sessionInfo = (context.data.session as any)?.get?.(sessionID);
      if (!sessionInfo && typeof (context.data.session as any)?.root === 'function') {
        const rootID = (context.data.session as any).root(sessionID);
        if (typeof rootID === 'string' && rootID) {
          sessionInfo = {
            id: sessionID,
            parentID: rootID === sessionID ? undefined : rootID,
          };
        }
      }
      return sessionInfo;
    } catch {
      return undefined;
    }
  };

  const checkSessionEligibility = (
    sessionInfo: unknown,
    eventLocation?: { directory?: string }
  ): boolean => {
    const sessionDirectory =
      (sessionInfo as any)?.location?.directory ??
      (sessionInfo as any)?.directory;
    const directory =
      eventLocation?.directory ?? sessionDirectory ?? context.location?.directory;
    const config = resolveV2TuiConfig(context, directory);
    if (!config?.enabled) return false;
    return isEligibleSessionInfo(sessionInfo, config.includeSubagents === true);
  };

  const setHandoffIfEligible = (
    sessionID: string,
    payload: unknown,
    eventLocation?: { directory?: string }
  ) => {
    const handoff = extractTrustedGuardianHandoff(payload, sessionID);
    if (!handoff) return;
    const cachedInfo = getCachedSessionInfo(sessionID);
    if (cachedInfo !== undefined || typeof (context.data.session as any)?.sync !== 'function') {
      if (checkSessionEligibility(cachedInfo, eventLocation)) {
        setActiveHandoff(sessionID, handoff);
      }
      return;
    }
    void (async () => {
      try {
        await (context.data.session as any).sync(sessionID);
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

  let lastRenderedSlotSessionID: string | undefined;

  const cancelActiveInteraction = (reason: string) => {
    if (pending.size === 0 && inFlightForms.size === 0) return;
    const targets = new Set<string>();
    const route = context.ui.router.current();
    if (route.type === 'session' && route.sessionID) {
      targets.add(route.sessionID);
    }
    if (lastRenderedSlotSessionID) {
      targets.add(lastRenderedSlotSessionID);
    }

    const rootFn = (context.data.session as { root?: (id: string) => string } | undefined)?.root;
    const activeRoots = new Set<string>();
    if (typeof rootFn === 'function') {
      for (const sid of targets) {
        try {
          const rootID = rootFn(sid);
          if (typeof rootID === 'string' && rootID) activeRoots.add(rootID);
        } catch {}
      }
    }

    for (const item of pending.values()) {
      if (targets.has(item.sessionID)) continue;
      if (targets.size === 0) {
        targets.add(item.sessionID);
        continue;
      }
      if (typeof rootFn === 'function' && activeRoots.size > 0) {
        try {
          const rootID = rootFn(item.sessionID);
          if (typeof rootID === 'string' && activeRoots.has(rootID)) {
            targets.add(item.sessionID);
          }
        } catch {}
      }
    }
    for (const entry of inFlightForms.values()) {
      if (targets.has(entry.sessionID)) continue;
      if (targets.size === 0) {
        targets.add(entry.sessionID);
        continue;
      }
      if (typeof rootFn === 'function' && activeRoots.size > 0) {
        try {
          const rootID = rootFn(entry.sessionID);
          if (typeof rootID === 'string' && activeRoots.has(rootID)) {
            targets.add(entry.sessionID);
          }
        } catch {}
      }
    }

    for (const sessionID of targets) {
      cancelSessionAutoSelection(sessionID, reason);
    }
  };

  const onKey = (keyEvent?: {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    alt?: boolean;
    option?: boolean;
    super?: boolean;
    hyper?: boolean;
  }) => {
    if (
      keyEvent?.ctrl ||
      keyEvent?.meta ||
      keyEvent?.alt ||
      keyEvent?.option ||
      keyEvent?.super ||
      keyEvent?.hyper
    ) {
      return;
    }
    const keyName = typeof keyEvent?.name === 'string' ? keyEvent.name.toLowerCase() : '';
    if (keyName && NON_INTERVENTION_KEYS.has(keyName)) return;
    cancelActiveInteraction('user keyboard interaction');
  };
  const onPaste = () => {
    cancelActiveInteraction('user paste interaction');
  };

  try {
    cleanups.push(context.data.on('form.created', onFormCreated));
    cleanups.push(context.data.on('form.replied', (event) => onFormSettled(event, 'replied')));
    cleanups.push(context.data.on('form.cancelled', (event) => onFormSettled(event, 'cancelled')));

    cleanups.push(
      context.data.on('session.synthetic', (event: any) => {
        const payload = event?.data ?? event?.properties;
        const sessionID = String(payload?.sessionID ?? '');
        if (!sessionID || sessionID === 'global') return;
        setHandoffIfEligible(sessionID, payload, event?.location);
      })
    );

    cleanups.push(
      context.data.on('session.inbox.enqueued', (event: any) => {
        const payload = event?.data ?? event?.properties;
        const item = payload?.item;
        const sessionID = String(payload?.sessionID ?? item?.sessionID ?? '');
        if (!sessionID || sessionID === 'global') return;
        if (item?.type === 'synthetic') {
          setHandoffIfEligible(sessionID, item, event?.location);
        } else if (item?.type === 'user' && !isInternalNonHumanMessage(item, sessionID)) {
          releaseUiLease(sessionID, event?.location?.directory);
          invalidateActiveHandoff(sessionID);
          sessionChains.delete(sessionID);
          cancelInFlightForSession(sessionID);
          clearSessionState(sessionID);
        }
      })
    );

    cleanups.push(
      context.data.on('session.deleted', (event: any) => {
        const payload = event?.data ?? event?.properties;
        const sessionID = String(
          payload?.sessionID ??
            payload?.info?.id ??
            payload?.session?.id ??
            payload?.id ??
            ''
        );
        if (sessionID && sessionID !== 'global') {
          releaseUiLease(sessionID, event?.location?.directory);
          clearActiveHandoff(sessionID);
          forgetMeshSession(sessionID);
          sessionChains.delete(sessionID);
          cancelInFlightForSession(sessionID);
          cleanupSessionRemediations(sessionID);
          clearSessionState(sessionID);
        }
      })
    );

    // Register ahead of OpenCode's Keymap listener (which uses prependListener and calls
    // stopPropagation() on handled form keys) so any user keypress cancels auto-selection.
    const keyInput = context.renderer.keyInput as typeof context.renderer.keyInput & {
      prependListener?: typeof context.renderer.keyInput.on;
    };
    const subscribeKey =
      typeof keyInput.prependListener === 'function'
        ? keyInput.prependListener.bind(keyInput)
        : keyInput.on.bind(keyInput);
    subscribeKey('keypress', onKey);
    cleanups.push(() => keyInput.off('keypress', onKey));
    subscribeKey('paste', onPaste);
    cleanups.push(() => keyInput.off('paste', onPaste));

    cleanups.push(context.ui.slot({
      append: 'session.composer.top',
      render: (slotProps?: { sessionID?: string }) => {
        const getSessionID = () => {
          const sid =
            slotProps?.sessionID ?? (context.ui.router.current() as any)?.sessionID;
          if (typeof sid === 'string' && sid) {
            lastRenderedSlotSessionID = sid;
          }
          return sid;
        };
        return (
          <SmartQuestionOverlay
            state={() => {
              const sid = getSessionID();
              return sid ? activeBySession()[sid] ?? null : null;
            }}
            countdown={() => {
              const sid = getSessionID();
              return sid ? activeBySession()[sid]?.countdown ?? 0 : 0;
            }}
            markers={() => {
              const sid = getSessionID();
              return sid
                ? activeBySession()[sid]?.markers ?? DEFAULT_CONFIG.recommendedMarkers
                : DEFAULT_CONFIG.recommendedMarkers;
            }}
            uiText={() => {
              const sid = getSessionID();
              return sid
                ? activeBySession()[sid]?.uiText ?? DEFAULT_CONFIG.uiText
                : DEFAULT_CONFIG.uiText;
            }}
          />
        );
      },
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
    sessionChains.clear();
    setActiveBySession({});
  };
};

export const OpencodeSmartQuestionsTui = OpenCodeV2Tui.define({
  id: 'opencode-smart-questions.tui',
  setup,
});

export default OpencodeSmartQuestionsTui;
