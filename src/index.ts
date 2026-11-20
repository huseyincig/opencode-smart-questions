import { Plugin as OpenCodeV2 } from '@opencode/plugin';
import {
  hasSmartQuestionConfigOptions,
  resolveSmartQuestionConfig,
} from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { isEligibleSessionInfo } from './session-scope.js';
import {
  clearActiveHandoff,
  consumeActiveHandoff,
  extractCurrentTurnGuardianHandoff,
  extractTrustedGuardianHandoff,
  invalidateActiveHandoff,
  isInternalNonHumanMessage,
  registerSmartQuestionsCapability,
  setActiveHandoff,
} from './handoff.js';
import {
  acquireSessionLease,
  forgetMeshSession,
  isTrustedMeshMessage,
  registerMeshStateRpc,
} from './bridge.js';

export * from './types.js';
export {
  loadConfig,
  resolveSmartQuestionConfig,
  normalizeSmartQuestionConfig,
  DEFAULT_RECOMMENDED_MARKERS,
  DEFAULT_MANUAL_MARKERS,
  DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS,
  DEFAULT_CONFIG,
} from './config.js';
export * from './detector.js';
export * from './guidance.js';
export {
  classifyV2Form,
  detectV2FormRecommendations,
  type V2FormClassification,
  type V2FormDetectionResult,
} from './form-adapter.js';
export {
  resolveLockPath,
  deleteLockfile,
  cleanupStaleDrafts,
  canUseDraftCoordination,
} from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
export {
  acquireSessionLease,
  getBlockingSessionLease,
  isSessionWaitingOnUser,
  formatMeshHandoff,
  parseMeshHandoff,
  stampMeshMetadata,
  verifyMeshMetadata,
  isTrustedMeshMessage,
  forgetMeshSession,
} from './bridge.js';

function sessionDirectoryFromInfo(
  sessionInfo: unknown,
  fallbackDirectory?: string
): string | undefined {
  if (sessionInfo && typeof sessionInfo === 'object') {
    const record = sessionInfo as Record<string, unknown>;
    if (
      record.location &&
      typeof record.location === 'object' &&
      typeof (record.location as Record<string, unknown>).directory === 'string'
    ) {
      return (record.location as Record<string, unknown>).directory as string;
    }
    if (typeof record.directory === 'string' && record.directory) {
      return record.directory;
    }
  }
  return fallbackDirectory;
}

function eventSessionID(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  if (typeof record.sessionID === 'string') return record.sessionID;
  if (
    record.form &&
    typeof record.form === 'object' &&
    typeof (record.form as Record<string, unknown>).sessionID === 'string'
  ) {
    return (record.form as Record<string, unknown>).sessionID as string;
  }
  if (
    record.item &&
    typeof record.item === 'object' &&
    typeof (record.item as Record<string, unknown>).sessionID === 'string'
  ) {
    return (record.item as Record<string, unknown>).sessionID as string;
  }
  return '';
}

function eventFormID(data: unknown): string {
  if (!data || typeof data !== 'object') return '';
  const record = data as Record<string, unknown>;
  if (typeof record.formID === 'string') return record.formID;
  if (typeof record.id === 'string') return record.id;
  if (
    record.form &&
    typeof record.form === 'object' &&
    typeof (record.form as Record<string, unknown>).id === 'string'
  ) {
    return (record.form as Record<string, unknown>).id as string;
  }
  return '';
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve(!signal.aborted);
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

const setupV2: OpenCodeV2.Plugin['setup'] = async (context) => {
  if (
    !context ||
    typeof context !== 'object' ||
    typeof context.session?.hook !== 'function' ||
    typeof context.session?.get !== 'function'
  ) {
    return;
  }

  const pluginOptions = context.options as Record<string, unknown> | undefined;
  if (
    typeof pluginOptions?.resolveConfig !== 'function' &&
    hasSmartQuestionConfigOptions(pluginOptions)
  ) {
    const explicitConfig = resolveSmartQuestionConfig(
      context.location?.directory,
      pluginOptions
    );
    if (!explicitConfig?.enabled) return;
  }

  const unregisterCapability = registerSmartQuestionsCapability(context.location?.directory);
  const activeInteractionLeases = new Map<string, () => void>();
  const formSessionByFormID = new Map<string, string>();
  const releaseInteractionLease = (sessionID: string) => {
    const release = activeInteractionLeases.get(sessionID);
    if (release) {
      activeInteractionLeases.delete(sessionID);
      release();
    }
    for (const [fId, sId] of formSessionByFormID.entries()) {
      if (sId === sessionID) {
        formSessionByFormID.delete(fId);
      }
    }
  };
  const registrations: Array<{ dispose(): Promise<void> | void }> = [];
  const disposeRegistrations = async (): Promise<void> => {
    for (const release of activeInteractionLeases.values()) {
      try {
        release();
      } catch {}
    }
    activeInteractionLeases.clear();
    formSessionByFormID.clear();
    for (const registration of registrations.splice(0).reverse()) {
      try {
        await registration.dispose();
      } catch {
        // Teardown is best effort; continue releasing the remaining resources.
      }
    }
  };

  const resolveEligibleSessionConfig = async (
    sessionID: string,
    eventDirectory?: string
  ) => {
    if (!sessionID) return null;
    let sessionInfo: unknown;
    try {
      sessionInfo = await context.session.get({ sessionID });
    } catch {
      return null;
    }
    const dir = sessionDirectoryFromInfo(
      sessionInfo,
      eventDirectory ?? context.location?.directory
    );
    const config = resolveSmartQuestionConfig(dir, pluginOptions);
    if (!config?.enabled) return null;
    if (!isEligibleSessionInfo(sessionInfo, config.includeSubagents === true)) {
      return null;
    }
    return config;
  };

  const isSessionEligible = async (
    sessionID: string,
    eventDirectory?: string
  ): Promise<boolean> => (await resolveEligibleSessionConfig(sessionID, eventDirectory)) !== null;

  try {
    if (typeof (context as { rpc?: { register?: unknown } }).rpc?.register === 'function') {
      const rpcObj = (context as unknown as { rpc: { register: any } }).rpc;
      const disposeMeshRpc = await registerMeshStateRpc({
        rpcRegister: rpcObj.register.bind(rpcObj),
        owner: 'opencode-smart-questions',
        directory: context.location?.directory,
      });
      registrations.push({ dispose: disposeMeshRpc });
    }
    const contextRegistration = await context.session.hook('context', async (event) => {
      const sessionID = String(event.sessionID ?? '');
      if (!sessionID) return;

      let sessionInfo: unknown;
      try {
        sessionInfo = await context.session.get({ sessionID });
      } catch {
        return;
      }

      const sessionDirectory = sessionDirectoryFromInfo(
        sessionInfo,
        context.location?.directory
      );
      const config = resolveSmartQuestionConfig(sessionDirectory, pluginOptions);
      if (!config?.enabled) return;
      if (!isEligibleSessionInfo(sessionInfo, config.includeSubagents === true)) return;

      const guidance = buildRecommendationGuidance(config);

      if (!Array.isArray(event.system)) {
        event.system = [];
      }

      const alreadyInjected = event.system.some(
        (part) =>
          part.type === 'text' &&
          typeof part.text === 'string' &&
          part.text.includes(SQ_GUIDANCE_SENTINEL)
      );
      if (!alreadyInjected) {
        event.system.push({
          type: 'text',
          text: guidance.system,
        });
      }

      if (Array.isArray(event.messages)) {
        const handoff = extractCurrentTurnGuardianHandoff(event.messages);
        if (handoff) {
          setActiveHandoff(sessionID, handoff);
        }
      }
      if (Array.isArray(event.system)) {
        for (let i = event.system.length - 1; i >= 0; i--) {
          const part = event.system[i];
          if (
            part?.type === 'text' &&
            typeof part.text === 'string' &&
            !part.text.includes(SQ_GUIDANCE_SENTINEL) &&
            part.text.includes('[OPENCODE_HANDOFF:v1]')
          ) {
            const parsed = extractTrustedGuardianHandoff(part);
            if (parsed) {
              setActiveHandoff(sessionID, parsed);
              break;
            }
          }
        }
      }
    });

    if (!contextRegistration || typeof contextRegistration.dispose !== 'function') {
      throw new Error('V2 context hook did not return a valid registration');
    }
    registrations.push(contextRegistration);

    const promptRegistration = await context.session.hook('prompt', async (event) => {
      const sessionID = String(event.sessionID ?? '');
      if (!sessionID) return;
      if (!(await isSessionEligible(sessionID))) return;
      const meta =
        event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
          ? (event.metadata as Record<string, unknown>)
          : undefined;
      if (
        meta?.['opencode-guardian'] === true ||
        meta?.['opencode-smart-questions'] === true ||
        isTrustedMeshMessage(event, sessionID)
      ) {
        return;
      }
      releaseInteractionLease(sessionID);
      invalidateActiveHandoff(sessionID);
    });

    if (!promptRegistration || typeof promptRegistration.dispose !== 'function') {
      throw new Error('V2 prompt hook did not return a valid registration');
    }
    registrations.push(promptRegistration);

    if (typeof context.event?.subscribe === 'function') {
      const eventController = new AbortController();
      registrations.push({
        dispose: async () => {
          eventController.abort();
        },
      });

      void (async () => {
        let attempt = 0;
        while (!eventController.signal.aborted) {
          try {
            const stream = context.event.subscribe({ signal: eventController.signal });
            for await (const evt of stream) {
              if (eventController.signal.aborted) break;
              attempt = 0;
              if (!evt || typeof evt !== 'object') continue;
              const eventType = (evt as { type?: unknown }).type;
              const eventLocationDir =
                (evt as { location?: { directory?: unknown } }).location?.directory;
              const eventDir = typeof eventLocationDir === 'string' ? eventLocationDir : undefined;
              const data =
                (evt as { data?: unknown; properties?: unknown }).data ??
                (evt as { properties?: unknown }).properties;
              const formID = eventFormID(data);
              const sessionID =
                eventSessionID(data) || (formID ? (formSessionByFormID.get(formID) ?? '') : '');
              if (!sessionID) continue;

              if (eventType === 'session.synthetic') {
                const handoff = extractTrustedGuardianHandoff(data);
                if (handoff && (await isSessionEligible(sessionID, eventDir))) {
                  setActiveHandoff(sessionID, handoff);
                }
              } else if (eventType === 'session.inbox.enqueued') {
                const item =
                  data && typeof data === 'object'
                    ? (data as { item?: unknown }).item
                    : undefined;
                const itemType =
                  item && typeof item === 'object'
                    ? (item as { type?: unknown }).type
                    : undefined;
                if (itemType === 'synthetic') {
                  const handoff = extractTrustedGuardianHandoff(item);
                  if (handoff && (await isSessionEligible(sessionID, eventDir))) {
                    setActiveHandoff(sessionID, handoff);
                  }
                } else if (itemType === 'user' && !isInternalNonHumanMessage(item)) {
                  releaseInteractionLease(sessionID);
                  invalidateActiveHandoff(sessionID);
                }
              } else if (eventType === 'form.created') {
                const sessionConfig = await resolveEligibleSessionConfig(sessionID, eventDir);
                if (sessionConfig) {
                  releaseInteractionLease(sessionID);
                  if (formID) {
                    formSessionByFormID.set(formID, sessionID);
                  }
                  activeInteractionLeases.set(
                    sessionID,
                    acquireSessionLease({
                      sessionID,
                      owner: 'opencode-smart-questions',
                      kind: 'user_interaction',
                      ttlMs: Math.max((sessionConfig.timeoutMs ?? 0) + 15_000, 120_000),
                      reason: 'form-created',
                    })
                  );
                }
              } else if (eventType === 'form.replied' || eventType === 'form.cancelled') {
                releaseInteractionLease(sessionID);
                consumeActiveHandoff(sessionID);
              } else if (eventType === 'session.deleted') {
                releaseInteractionLease(sessionID);
                clearActiveHandoff(sessionID);
                forgetMeshSession(sessionID);
              }
            }
          } catch {
            if (eventController.signal.aborted) break;
          }

          if (eventController.signal.aborted) break;
          const backoffMs = Math.min(30_000, 250 * 2 ** Math.min(attempt, 10));
          attempt += 1;
          const shouldContinue = await sleepWithAbort(backoffMs, eventController.signal);
          if (!shouldContinue) break;
        }
      })();
    }
  } catch (error) {
    await disposeRegistrations();
    unregisterCapability();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[smart-question] V2 backend registration failed: ${message}`);
  }

  return async () => {
    try {
      await disposeRegistrations();
    } finally {
      unregisterCapability();
    }
  };
};

/**
 * OpenCode v2 server plugin definition.
 */
export const OpencodeSmartQuestions = OpenCodeV2.define({
  id: 'opencode-smart-questions',
  setup: setupV2,
});

export default OpencodeSmartQuestions;
