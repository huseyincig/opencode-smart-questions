import type { Hooks, PluginInput } from './types.js';
export declare const SQ_REMEDIATION_HEADER = "[Smart Questions protocol remediation]";
export declare function buildUnclassifiedRemediationPrompt(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function buildUnclassifiedRemediationPrompt(primaryMarker?: string, manualMarker?: string): string;
export declare function createSmartQuestionHooks(input: PluginInput, pluginOptions?: Record<string, unknown>): Promise<Hooks>;
