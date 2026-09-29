import type { SmartQuestionConfig } from './types.js';
export declare const DEFAULT_RECOMMENDED_MARKERS: string[];
export declare const DEFAULT_CONFIG: SmartQuestionConfig;
export declare function normalizeConfigMarkers(rawMarkers?: unknown, legacyMarker?: unknown): string[];
export declare function normalizeParamMarkers(marker?: string | string[]): string[];
/**
 * Load and validate smart-question configuration from project directory or global config.
 * Returns null if file is missing, unparseable, or enabled is false.
 */
export declare function loadConfig(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function loadConfig(projectDir?: string): SmartQuestionConfig | null;
