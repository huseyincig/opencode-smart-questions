import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";
/**
 * Question option shape from @opencode/schema (QuestionV1.Option).
 */
export interface QuestionOption {
    label: string;
    description?: string;
}
/**
 * Question info shape from @opencode/schema (QuestionV1.Info).
 */
export interface QuestionInfo {
    question: string;
    header: string;
    options: QuestionOption[];
    multiple?: boolean;
    custom?: boolean;
}
/**
 * Configuration schema for smart-question plugin.
 */
export interface SmartQuestionConfig {
    enabled: boolean;
    timeoutMs: number;
    recommendedMarkers: string[];
    recommendedMarker?: string;
    requireExactlyOneRecommendation: boolean;
    configDir?: string;
}
export interface DetectionSuccess {
    ok: true;
    answers: string[][];
    recommendedOptions: QuestionOption[];
    matchedMarker?: string;
}
export interface DetectionFailure {
    ok: false;
    reason: string;
}
export type DetectionResult = DetectionSuccess | DetectionFailure;
export interface ActiveQuestionState {
    requestID: string;
    sessionID: string;
    questions: QuestionInfo[];
    detection: DetectionResult;
    agentName: string;
    agentFound: boolean;
    focusDisabled?: boolean;
}
/**
 * Load and validate smart-question configuration from project directory.
 * Returns null if file is missing, unparseable, or enabled is false.
 */
export declare function loadConfig(projectDir?: string | Record<string, unknown>): SmartQuestionConfig | null;
/**
 * Pure decision logic for detecting recommendations across questions.
 * Enforces fail-safe conditions matching the backend plugin:
 * - Empty questions list -> fail
 * - Zero recommended options in ANY question -> fail
 * - More than 1 recommended options in ANY single-select question -> fail
 * - Exact suffix matching on marker
 */
export declare function detectRecommendations(questions: QuestionInfo[], marker?: string | string[], options?: {
    requireExactlyOneRecommendation?: boolean;
}): DetectionResult;
/**
 * Resolve agent name from event metadata or session state, falling back to session short-id.
 */
export declare function resolveAgentName(api: TuiPluginApi, sessionID: string, eventProps?: Record<string, unknown>): {
    name: string;
    found: boolean;
};
/**
 * Strip marker from option label if it ends with marker.
 */
export declare function stripMarker(label: unknown, marker: unknown): string;
/**
 * Format total seconds into mm:ss format.
 */
export declare function formatCountdown(totalSeconds: unknown): string;
/**
 * Smart Question UI overlay component.
 */
export declare function SmartQuestionOverlay(props: {
    api: TuiPluginApi;
    state: () => ActiveQuestionState | null;
    countdown: () => number;
    marker?: string | string[];
    markers?: string | string[];
}): any;
/**
 * Smart Question UI TUI plugin function.
 */
export declare const tui: TuiPlugin;
declare const pluginModule: TuiPluginModule & {
    id: string;
};
export default pluginModule;
