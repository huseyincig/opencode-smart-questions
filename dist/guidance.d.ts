import type { SmartQuestionConfig } from './types.js';
export declare function buildRecommendationGuidance(config: SmartQuestionConfig): {
    primaryMarker: string;
    markerList: string;
    tool: string;
    system: string;
};
