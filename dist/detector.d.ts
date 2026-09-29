import type { DetectionResult, QuestionInfo } from './types.js';
/**
 * Pure decision logic for detecting recommendations across questions.
 * Enforces fail-safe conditions:
 * - Empty questions list -> fail
 * - Zero recommended options in ANY question -> fail
 * - More than 1 recommended options in ANY single-select question -> fail
 * - Exact suffix matching on marker
 */
export declare function detectRecommendations(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function detectRecommendations(questions: QuestionInfo[], marker?: string | string[], options?: {
    requireExactlyOneRecommendation?: boolean;
}): DetectionResult;
