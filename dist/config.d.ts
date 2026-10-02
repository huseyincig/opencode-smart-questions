import type { SmartQuestionConfig, SmartQuestionUIText } from './types.js';
export declare const DEFAULT_RECOMMENDED_MARKERS: string[];
export declare const DEFAULT_UI_TEXT: SmartQuestionUIText;
export declare const DEFAULT_CONFIG: SmartQuestionConfig;
export declare function normalizeConfigMarkers(rawMarkers?: unknown, legacyMarker?: unknown): string[];
export declare function normalizeParamMarkers(marker?: string | string[]): string[];
export declare function normalizeSmartQuestionConfig(raw: unknown, configDir?: string): SmartQuestionConfig | null;
/**
 * Load smart-question configuration from project or global config.
 * Missing configuration uses safe defaults; malformed configuration disables
 * auto-selection instead of guessing.
 */
export declare function loadConfig(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function loadConfig(projectDir?: string): SmartQuestionConfig | null;
