import { createSmartQuestionHooks } from './backend.js';
import { resolveSmartQuestionConfig } from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, } from './draft-guard.js';
export * from './backend.js';
/**
 * OpenCode v1 plugin factory.
 */
export const SmartQuestion = async (input, options) => {
    return createSmartQuestionHooks(input, options);
};
const setupV2 = async (context) => {
    // OpenCode v1/transition builds may discover this v2-shaped plugin object and
    // call setup() with only a partial context. Missing capabilities mean "v2 is
    // unavailable", not a startup error.
    if (!context ||
        typeof context !== 'object' ||
        typeof context.tool?.transform !== 'function' ||
        typeof context.session?.hook !== 'function') {
        return;
    }
    const config = resolveSmartQuestionConfig(context.location?.directory, context.options);
    if (!config?.enabled)
        return;
    const guidance = buildRecommendationGuidance(config);
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
    try {
        const toolRegistration = await context.tool.transform((editor) => {
            editor.update('question', (tool) => {
                if (!tool.description.includes(SQ_GUIDANCE_SENTINEL)) {
                    tool.description += guidance.tool;
                }
            });
        });
        if (!toolRegistration || typeof toolRegistration.dispose !== 'function') {
            throw new Error('V2 tool transform did not return a valid registration');
        }
        registrations.push(toolRegistration);
        const contextRegistration = await context.session.hook('context', (event) => {
            const alreadyInjected = event.system.some((part) => part.type === 'text' &&
                typeof part.text === 'string' &&
                part.text.includes(SQ_GUIDANCE_SENTINEL));
            if (!alreadyInjected) {
                event.system.push({
                    type: 'text',
                    text: guidance.system,
                });
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
