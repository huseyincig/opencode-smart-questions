/** @jsxImportSource @opentui/solid */
import { Plugin as OpenCodeV2Tui } from '@opencode/plugin/tui';
import type { ActiveQuestionState, DetectionResult, QuestionOverlayStatus, SmartQuestionConfig, SmartQuestionUIText } from './types.js';
export declare function loadConfig(...args: any[]): SmartQuestionConfig | null;
export declare function detectRecommendations(...args: any[]): DetectionResult;
export interface OverlayState extends ActiveQuestionState {
    status?: QuestionOverlayStatus | undefined;
    statusMessage?: string | undefined;
    countdown?: number | undefined;
    formID?: string | undefined;
    lockPath?: string | undefined;
    markers?: string[] | undefined;
    uiText?: SmartQuestionUIText | undefined;
}
/**
 * Resolve a best-effort agent/session label for the v2 TUI.
 */
export declare function resolveAgentName(sessionInfo: unknown, sessionID?: string): {
    name: string;
    found: boolean;
};
export declare function stripMarker(label: unknown, marker: unknown): string;
export declare function formatCountdown(totalSeconds: unknown): string;
export declare function SmartQuestionOverlay(props: {
    state: () => OverlayState | null;
    countdown?: () => number;
    marker?: string | string[];
    markers?: string | string[] | (() => string | string[]);
    uiText?: SmartQuestionUIText | (() => SmartQuestionUIText);
}): any;
/**
 * OpenCode v2 TUI adapter.
 */
export declare const setup: OpenCodeV2Tui.Definition['setup'];
export declare const OpencodeSmartQuestionsTui: OpenCodeV2Tui.Definition;
export default OpencodeSmartQuestionsTui;
