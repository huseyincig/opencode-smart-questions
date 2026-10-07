import type { Plugin as OpenCodeV1Plugin } from '@opencode-ai/plugin';
import type { Plugin as OpenCodeV2 } from '@opencode/plugin';
import { createSmartQuestionHooks } from './backend.js';
import { resolveSmartQuestionConfig } from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import type { PluginInput } from './types.js';
import { resolveV2SessionScope } from './session-scope.js';

export * from './types.js';
export {
  loadConfig,
  DEFAULT_RECOMMENDED_MARKERS,
  DEFAULT_MANUAL_MARKERS,
  DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS,
  DEFAULT_CONFIG,
} from './config.js';
export * from './detector.js';
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
} from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
import {
  registerSmartQuestionsCapability,
  setActiveHandoff,
  extractCurrentTurnGuardianHandoff,
} from './handoff.js';

/**
 * OpenCode v1 plugin factory.
 */
export const SmartQuestion: OpenCodeV1Plugin = async (input, options) => {
  registerSmartQuestionsCapability();
  return createSmartQuestionHooks(
    input as unknown as PluginInput,
    options as Record<string, unknown> | undefined
  );
};

const setupV2: OpenCodeV2.Plugin['setup'] = async (context) => {
  // OpenCode v1/transition builds may discover this v2-shaped plugin object and
  // call setup() with only a partial context. Missing capabilities mean "v2 is
  // unavailable", not a startup error.
  if (
    !context ||
    typeof context !== 'object' ||
    typeof context.session?.hook !== 'function' ||
    typeof context.session?.get !== 'function'
  ) {
    return;
  }

  const config = resolveSmartQuestionConfig(
    context.location?.directory,
    context.options as Record<string, unknown> | undefined
  );
  if (!config?.enabled) return;

  registerSmartQuestionsCapability();

  const guidance = buildRecommendationGuidance(config);
  const sessionScope = new Map<string, boolean>();
  const registrations: Array<{ dispose(): Promise<void> }> = [];
  const disposeRegistrations = async (): Promise<void> => {
    // Complete cleanup strictly in reverse registration order. Each disposer
    // is isolated so one cleanup failure does not prevent older resources
    // from being released. Splicing keeps repeated disposal idempotent.
    for (const registration of registrations.splice(0).reverse()) {
      try {
        await registration.dispose();
      } catch {
        // Teardown is best effort; continue releasing the remaining resources.
      }
    }
  };

  const isRootSession = async (sessionID: string): Promise<boolean> => {
    if (!sessionID) return false;
    if (sessionScope.has(sessionID)) return sessionScope.get(sessionID) === true;

    const scope = await resolveV2SessionScope(context.session, sessionID);
    if (scope === 'root') {
      sessionScope.set(sessionID, true);
      return true;
    }
    if (scope === 'child') {
      sessionScope.set(sessionID, false);
      return false;
    }
    return false;
  };

  try {
    const contextRegistration = await context.session.hook('context', async (event) => {
      if (!(await isRootSession(String(event.sessionID ?? '')))) return;
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
        if (handoff && typeof handoff === 'object' && 'version' in handoff) {
          setActiveHandoff(String(event.sessionID ?? ''), handoff);
        }
      }
    });
    if (!contextRegistration || typeof contextRegistration.dispose !== 'function') {
      throw new Error('V2 context hook did not return a valid registration');
    }
    registrations.push(contextRegistration);
  } catch (error) {
    await disposeRegistrations();
    throw new Error('[smart-question] V2 backend registration failed', { cause: error });
  }

  return disposeRegistrations;
};

/**
 * OpenCode v2 backend plugin definition. The v2 backend injects recommendation
 * guidance; the v2 TUI adapter owns form countdown/reply because the server
 * plugin Context intentionally does not expose session.form.reply().
 */
export const OpencodeSmartQuestions: OpenCodeV2.Plugin & {
  server: OpenCodeV1Plugin;
} = {
  id: 'opencode-smart-questions',
  server: SmartQuestion,
  setup: setupV2,
};

export default OpencodeSmartQuestions;
