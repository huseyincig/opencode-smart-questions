import type { SmartQuestionConfig } from './types.js';
export declare const SQ_GUIDANCE_SENTINEL = "[SQ_GUIDANCE:v1]";
export declare function buildRecommendationGuidance(config: SmartQuestionConfig): {
    primaryMarker: string;
    markerList: string;
    tool: string;
    system: string;
};
