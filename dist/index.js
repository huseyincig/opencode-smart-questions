import { createSmartQuestionHooks } from './backend.js';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_CONFIG } from './config.js';
export * from './detector.js';
export * from './draft-guard.js';
export * from './backend.js';
/**
 * OpenCode v1 Plugin Factory: export const SmartQuestion: Plugin
 */
export const SmartQuestion = async (input, options) => {
    return createSmartQuestionHooks(input, options);
};
/**
 * OpenCode Dual-Mode Plugin Definition
 */
export const OpencodeSmartQuestions = {
    id: 'opencode-smart-questions',
    /**
     * OpenCode v1 Host Handler
     */
    server: async (input, options) => {
        return createSmartQuestionHooks(input, options);
    },
    /**
     * OpenCode v2 Host Handler
     */
    setup: async (context) => {
        const input = {
            client: context.client ?? context.session ?? {},
            directory: context.location?.directory ?? process.cwd(),
            serverUrl: context.serverUrl,
        };
        const hooks = await createSmartQuestionHooks(input);
        if (context.event?.subscribe && hooks.event) {
            context.event.subscribe(async (event) => {
                await hooks.event?.({ event });
            });
        }
        if (context.catalog?.transform && hooks['tool.definition']) {
            context.catalog.transform((cat) => {
                if (cat?.tool?.update) {
                    cat.tool.update('question', (tool) => {
                        const output = {
                            description: tool.description,
                            parameters: tool.parameters,
                            jsonSchema: tool.jsonSchema,
                        };
                        hooks['tool.definition']?.({ toolID: 'question' }, output);
                        if (output.description)
                            tool.description = output.description;
                    });
                }
            });
        }
    },
};
export default OpencodeSmartQuestions;
