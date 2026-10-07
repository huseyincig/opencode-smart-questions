import type { OpenCodeHandoff } from './handoff.js';
import type { DetectionResult, QuestionClassification, QuestionInfo } from './types.js';
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
/**
 * Checks if a question is explicitly classified as requiring manual human decision.
 */
export declare function isQuestionExplicitlyManual(q: QuestionInfo, manualMarkers?: string[]): {
    isManual: boolean;
    matchedMarker?: string;
};
/**
 * Language-agnostic classification of selectable root questions into:
 * - AUTO: all questions carry valid recommendation markers
 * - MANUAL: explicitly classified via [SQ:manual], or Guardian handoff auto_select=forbidden
 * - UNCLASSIFIED: selectable options exist, but neither recommendation nor manual classification is present
 */
export declare function classifyQuestions(questions: QuestionInfo[] | Record<string, unknown>, recommendedMarker?: string | string[], manualMarker?: string | string[], handoff?: OpenCodeHandoff | Record<string, unknown> | null, options?: {
    requireExactlyOneRecommendation?: boolean;
}): QuestionClassification;
