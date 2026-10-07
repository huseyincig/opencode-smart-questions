import type { Plugin as OpenCodeV1Plugin } from '@opencode-ai/plugin';
import type { Plugin as OpenCodeV2 } from '@opencode/plugin';
export * from './types.js';
export { loadConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_MANUAL_MARKERS, DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export { classifyV2Form, detectV2FormRecommendations, type V2FormClassification, type V2FormDetectionResult, } from './form-adapter.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, } from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
/**
 * OpenCode v1 plugin factory.
 */
export declare const SmartQuestion: OpenCodeV1Plugin;
/**
 * OpenCode v2 backend plugin definition. The v2 backend injects recommendation
 * guidance; the v2 TUI adapter owns form countdown/reply because the server
 * plugin Context intentionally does not expose session.form.reply().
 */
export declare const OpencodeSmartQuestions: OpenCodeV2.Plugin & {
    server: OpenCodeV1Plugin;
};
export default OpencodeSmartQuestions;
