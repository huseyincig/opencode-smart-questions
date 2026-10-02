import { createSmartQuestionHooks } from './backend.js';
import { loadConfig, normalizeSmartQuestionConfig, } from './config.js';
import { buildRecommendationGuidance } from './guidance.js';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export * from './draft-guard.js';
export * from './backend.js';
function resolveV2Config(context) {
    const options = context.options;
    const configDir = context.location?.directory
        ? `${context.location.directory}/.opencode`
        : undefined;
    // An explicitly supplied malformed config must not activate defaults.
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
    const hasInlineConfig = candidate &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        Object.keys(candidate).some((key) => knownKeys.has(key));
    if (hasInlineConfig) {
        return normalizeSmartQuestionConfig(candidate, context.location?.directory
            ? `${context.location.directory}/.opencode`
            : undefined);
    }
    return loadConfig(context.location?.directory);
}
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
    const config = resolveV2Config(context);
    if (!config?.enabled)
        return;
    const guidance = buildRecommendationGuidance(config);
    context.tool.transform((editor) => {
        editor.update('question', (tool) => {
            if (!tool.description.includes('[RECOMMENDED OPTION CONVENTION]')) {
                tool.description += guidance.tool;
            }
        });
    });
    context.session.hook('context', (event) => {
        const alreadyInjected = event.system.some((part) => part.type === 'text' &&
            typeof part.text === 'string' &&
            part.text.includes('Smart Question Auto-Selection Guidance'));
        if (!alreadyInjected) {
            event.system.push({
                type: 'text',
                text: guidance.system,
            });
        }
    });
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
