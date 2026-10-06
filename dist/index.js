import { createSmartQuestionHooks } from './backend.js';
import { resolveSmartQuestionConfig } from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { resolveV2SessionScope } from './session-scope.js';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, } from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
import { registerSmartQuestionsCapability, setActiveHandoff, parseOpenCodeHandoff, extractHandoffFromParts, } from './handoff.js';
/**
 * OpenCode v1 plugin factory.
 */
export const SmartQuestion = async (input, options) => {
    registerSmartQuestionsCapability();
    return createSmartQuestionHooks(input, options);
};
const setupV2 = async (context) => {
    // OpenCode v1/transition builds may discover this v2-shaped plugin object and
    // call setup() with only a partial context. Missing capabilities mean "v2 is
    // unavailable", not a startup error.
    if (!context ||
        typeof context !== 'object' ||
        typeof context.session?.hook !== 'function' ||
        typeof context.session?.get !== 'function') {
        return;
    }
    const config = resolveSmartQuestionConfig(context.location?.directory, context.options);
    if (!config?.enabled)
        return;
    registerSmartQuestionsCapability();
    const guidance = buildRecommendationGuidance(config);
    const sessionScope = new Map();
    const registrations = [];
    const disposeRegistrations = async () => {
        // Complete cleanup strictly in reverse registration order. Each disposer
        // is isolated so one cleanup failure does not prevent older resources
        // from being released. Splicing keeps repeated disposal idempotent.
        for (const registration of registrations.splice(0).reverse()) {
            try {
                await registration.dispose();
            }
            catch {
                // Teardown is best effort; continue releasing the remaining resources.
            }
        }
    };
    const isRootSession = async (sessionID) => {
        if (!sessionID)
            return false;
        if (sessionScope.has(sessionID))
            return sessionScope.get(sessionID) === true;
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
            if (!(await isRootSession(String(event.sessionID ?? ''))))
                return;
            const alreadyInjected = event.system.some((part) => part.type === 'text' &&
                typeof part.text === 'string' &&
                part.text.includes(SQ_GUIDANCE_SENTINEL));
            if (!alreadyInjected) {
                event.system.push({
                    type: 'text',
                    text: guidance.system,
                });
            }
            if (Array.isArray(event.messages)) {
                for (let i = event.messages.length - 1; i >= 0 && i >= event.messages.length - 5; i--) {
                    const msg = event.messages[i];
                    const parts = msg?.parts;
                    const text = msg?.content ??
                        msg?.text;
                    const handoff = extractHandoffFromParts(parts) ??
                        (typeof text === 'string' ? parseOpenCodeHandoff(text) : null);
                    if (handoff) {
                        setActiveHandoff(String(event.sessionID ?? ''), handoff);
                        break;
                    }
                }
            }
        });
        if (!contextRegistration || typeof contextRegistration.dispose !== 'function') {
            throw new Error('V2 context hook did not return a valid registration');
        }
        registrations.push(contextRegistration);
    }
    catch (error) {
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
export const OpencodeSmartQuestions = {
    id: 'opencode-smart-questions',
    server: SmartQuestion,
    setup: setupV2,
};
export default OpencodeSmartQuestions;
