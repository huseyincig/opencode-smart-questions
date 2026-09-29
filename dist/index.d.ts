import type { Plugin, PluginInput } from './types.js';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_CONFIG } from './config.js';
export * from './detector.js';
export * from './draft-guard.js';
export * from './backend.js';
/**
 * OpenCode v1 Plugin Factory: export const SmartQuestion: Plugin
 */
export declare const SmartQuestion: Plugin;
/**
 * OpenCode Dual-Mode Plugin Definition
 */
export declare const OpencodeSmartQuestions: {
    id: string;
    /**
     * OpenCode v1 Host Handler
     */
    server: (input: PluginInput, options?: Record<string, unknown>) => Promise<import("./types.js").Hooks>;
    /**
     * OpenCode v2 Host Handler
     */
    setup: (context: any) => Promise<void>;
};
export default OpencodeSmartQuestions;
