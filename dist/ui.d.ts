/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui';
import type { Plugin as OpenCodeV2Tui } from '@opencode/plugin/tui';
import type { ActiveQuestionState, DetectionResult, SmartQuestionConfig, SmartQuestionUIText } from './types.js';
export declare function loadConfig(...args: any[]): SmartQuestionConfig | null;
export declare function detectRecommendations(...args: any[]): DetectionResult;
interface OverlayState extends ActiveQuestionState {
    countdown?: number;
    formID?: string;
}
/**
 * Resolve a best-effort agent/session label for the v1 TUI.
 */
export declare function resolveAgentName(api: TuiPluginApi | Record<string, any>, sessionID?: string, eventProps?: Record<string, unknown>): {
    name: string;
    found: boolean;
};
export declare function stripMarker(label: unknown, marker: unknown): string;
export declare function formatCountdown(totalSeconds: unknown): string;
export declare function SmartQuestionOverlay(props: {
    state: () => OverlayState | null;
    countdown?: () => number;
    marker?: string | string[];
    markers?: string | string[];
    uiText?: SmartQuestionUIText;
}): any;
/**
 * OpenCode v1 TUI adapter.
 */
export declare const tui: TuiPlugin;
/**
 * OpenCode v2 TUI adapter.
 */
export declare const setup: OpenCodeV2Tui.Definition['setup'];
declare const pluginModule: TuiPluginModule & {
    id: string;
    setup: typeof setup;
};
export default pluginModule;
