import { Plugin as OpenCodeV2 } from '@opencode/plugin';
export * from './types.js';
export { loadConfig, resolveSmartQuestionConfig, normalizeSmartQuestionConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_MANUAL_MARKERS, DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export * from './guidance.js';
export { classifyV2Form, detectV2FormRecommendations, type V2FormClassification, type V2FormDetectionResult, } from './form-adapter.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, canUseDraftCoordination, } from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
/**
 * OpenCode v2 server plugin definition.
 */
export declare const OpencodeSmartQuestions: OpenCodeV2.Plugin;
export default OpencodeSmartQuestions;
