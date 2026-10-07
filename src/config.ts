import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnosticErrorCode } from './diagnostics.js';
import type { SmartQuestionConfig, SmartQuestionUIText } from './types.js';

export const DEFAULT_RECOMMENDED_MARKERS: string[] = [
  '[SQ:recommended]',
  '(Recommended)',
  '(Önerilen)',
];

export const DEFAULT_MANUAL_MARKERS: string[] = [
  '[SQ:manual]',
  '[SQ_DECISION:manual]',
];

export const DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS = 3;

const MAX_TIMEOUT_MS = 2_147_483_647;

const SMART_QUESTION_CONFIG_KEYS = new Set([
  'enabled',
  'timeoutMs',
  'recommendedMarkers',
  'recommendedMarker',
  'manualMarkers',
  'manualMarker',
  'maxUnclassifiedRemediations',
  'unclassifiedQuestionPolicy',
  'requireExactlyOneRecommendation',
  'uiText',
  'debugLog',
  'configDir',
]);

export function hasSmartQuestionConfigOptions(
  options?: Record<string, unknown>
): boolean {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
  if (Object.prototype.hasOwnProperty.call(options, 'config')) return true;
  return Object.keys(options).some((key) => SMART_QUESTION_CONFIG_KEYS.has(key));
}

export const DEFAULT_UI_TEXT: SmartQuestionUIText = {
  recommendation: 'Recommendation:',
  disabled: 'AUTO-SELECTION DISABLED',
  autoReplyFailed: 'Auto-selection failed. Please answer manually.',
  agent: 'Agent:',
  session: 'Session:',
};

export const DEFAULT_CONFIG: SmartQuestionConfig = {
  enabled: true,
  timeoutMs: 30000,
  recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
  recommendedMarker: '[SQ:recommended]',
  manualMarkers: DEFAULT_MANUAL_MARKERS,
  manualMarker: '[SQ:manual]',
  maxUnclassifiedRemediations: DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS,
  requireExactlyOneRecommendation: true,
  uiText: DEFAULT_UI_TEXT,
  debugLog: '',
};

function normalizeUIText(value: unknown): SmartQuestionUIText {
  const overrides = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    recommendation: typeof overrides.recommendation === 'string' && overrides.recommendation.trim() ? overrides.recommendation : DEFAULT_UI_TEXT.recommendation,
    disabled: typeof overrides.disabled === 'string' && overrides.disabled.trim() ? overrides.disabled : DEFAULT_UI_TEXT.disabled,
    autoReplyFailed: typeof overrides.autoReplyFailed === 'string' && overrides.autoReplyFailed.trim() ? overrides.autoReplyFailed : DEFAULT_UI_TEXT.autoReplyFailed,
    agent: typeof overrides.agent === 'string' && overrides.agent.trim() ? overrides.agent : DEFAULT_UI_TEXT.agent,
    session: typeof overrides.session === 'string' && overrides.session.trim() ? overrides.session : DEFAULT_UI_TEXT.session,
  };
}

function cleanMarkers(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function normalizeConfigMarkers(rawMarkers?: unknown, legacyMarker?: unknown): string[] {
  const list = cleanMarkers(rawMarkers);
  if (list.length > 0) return list;

  if (typeof legacyMarker === 'string' && legacyMarker.trim().length > 0) {
    return [legacyMarker.trim()];
  }

  return [...DEFAULT_RECOMMENDED_MARKERS];
}

export function normalizeParamMarkers(marker?: string | string[]): string[] {
  if (Array.isArray(marker)) {
    const list = cleanMarkers(marker);
    return list.length > 0 ? list : [...DEFAULT_RECOMMENDED_MARKERS];
  }

  if (typeof marker === 'string' && marker.trim().length > 0) {
    return [marker.trim()];
  }

  return [...DEFAULT_RECOMMENDED_MARKERS];
}

export function normalizeSmartQuestionConfig(
  raw: unknown,
  configDir?: string
): SmartQuestionConfig | null {
  if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
    return null;
  }

  const parsed = (raw ?? {}) as Record<string, unknown>;
  if (parsed.enabled === false) return null;

  // Invalid explicit settings must never silently enable a different auto-reply policy.
  // Omitted settings are fine: they use the documented defaults.
  if (
    (parsed.enabled !== undefined && parsed.enabled !== true) ||
    (parsed.timeoutMs !== undefined &&
      (typeof parsed.timeoutMs !== 'number' ||
        !Number.isFinite(parsed.timeoutMs) ||
        parsed.timeoutMs < 0 ||
        parsed.timeoutMs > MAX_TIMEOUT_MS)) ||
    (parsed.requireExactlyOneRecommendation !== undefined &&
      typeof parsed.requireExactlyOneRecommendation !== 'boolean') ||
    (parsed.recommendedMarkers !== undefined &&
      (!Array.isArray(parsed.recommendedMarkers) ||
        parsed.recommendedMarkers.length === 0 ||
        parsed.recommendedMarkers.some((marker: unknown) =>
          typeof marker !== 'string' || marker.trim().length === 0))) ||
    (parsed.recommendedMarker !== undefined &&
      (typeof parsed.recommendedMarker !== 'string' || parsed.recommendedMarker.trim().length === 0)) ||
    (parsed.debugLog !== undefined && typeof parsed.debugLog !== 'string') ||
    (parsed.configDir !== undefined &&
      (typeof parsed.configDir !== 'string' || parsed.configDir.trim().length === 0)) ||
    (parsed.manualMarkers !== undefined &&
      (!Array.isArray(parsed.manualMarkers) ||
        parsed.manualMarkers.length === 0 ||
        parsed.manualMarkers.some((marker: unknown) =>
          typeof marker !== 'string' || marker.trim().length === 0))) ||
    (parsed.manualMarker !== undefined &&
      (typeof parsed.manualMarker !== 'string' || parsed.manualMarker.trim().length === 0)) ||
    (parsed.maxUnclassifiedRemediations !== undefined &&
      (typeof parsed.maxUnclassifiedRemediations !== 'number' ||
        !Number.isFinite(parsed.maxUnclassifiedRemediations) ||
        parsed.maxUnclassifiedRemediations < 0)) ||
    (parsed.uiText !== undefined &&
      (parsed.uiText === null || typeof parsed.uiText !== 'object' ||
        Array.isArray(parsed.uiText) ||
        Object.values(parsed.uiText).some((value) =>
          typeof value !== 'string' || value.trim().length === 0)))
  ) {
    return null;
  }

  const recommendedMarkers = normalizeConfigMarkers(
    parsed.recommendedMarkers,
    parsed.recommendedMarker
  );
  const recommendedMarker =
    recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker ?? '[SQ:recommended]';

  const rawManualMarkers = cleanMarkers(parsed.manualMarkers);
  const manualMarkers =
    rawManualMarkers.length > 0
      ? rawManualMarkers
      : typeof parsed.manualMarker === 'string' && parsed.manualMarker.trim().length > 0
        ? [parsed.manualMarker.trim()]
        : [...DEFAULT_MANUAL_MARKERS];
  const manualMarker = manualMarkers[0] ?? DEFAULT_CONFIG.manualMarker ?? '[SQ:manual]';

  const maxUnclassifiedRemediations =
    typeof parsed.maxUnclassifiedRemediations === 'number' &&
    Number.isFinite(parsed.maxUnclassifiedRemediations) &&
    parsed.maxUnclassifiedRemediations >= 0
      ? Math.floor(parsed.maxUnclassifiedRemediations)
      : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;

  const timeoutMs =
    typeof parsed.timeoutMs === 'number' &&
    Number.isFinite(parsed.timeoutMs) &&
    parsed.timeoutMs >= 0 &&
    parsed.timeoutMs <= MAX_TIMEOUT_MS
      ? parsed.timeoutMs
      : DEFAULT_CONFIG.timeoutMs;

  const normalized: SmartQuestionConfig = {
    enabled: true,
    timeoutMs,
    recommendedMarkers,
    recommendedMarker,
    manualMarkers,
    manualMarker,
    maxUnclassifiedRemediations,
    requireExactlyOneRecommendation:
      typeof parsed.requireExactlyOneRecommendation === 'boolean'
        ? parsed.requireExactlyOneRecommendation
        : DEFAULT_CONFIG.requireExactlyOneRecommendation,
    uiText: normalizeUIText(parsed.uiText),
    debugLog: typeof parsed.debugLog === 'string' ? parsed.debugLog : DEFAULT_CONFIG.debugLog ?? '',
  };
  const resolvedConfigDir =
    typeof parsed.configDir === 'string' && parsed.configDir ? parsed.configDir : configDir;
  if (resolvedConfigDir) normalized.configDir = resolvedConfigDir;
  return normalized;
}

export function resolveSmartQuestionConfig(
  projectDir?: string,
  pluginOptions?: Record<string, unknown>
): SmartQuestionConfig | null {
  const directory = typeof projectDir === 'string' && projectDir ? projectDir : process.cwd();
  const configDir = path.resolve(directory, '.opencode');

  if (pluginOptions && Object.prototype.hasOwnProperty.call(pluginOptions, 'config')) {
    return normalizeSmartQuestionConfig(pluginOptions.config, configDir);
  }
  if (hasSmartQuestionConfigOptions(pluginOptions)) {
    return normalizeSmartQuestionConfig(pluginOptions, configDir);
  }
  return loadConfig(projectDir);
}

/**
 * Load smart-question configuration from project or global config.
 * Missing configuration uses safe defaults; malformed configuration disables
 * auto-selection instead of guessing.
 */
export function loadConfig(pluginInput: Record<string, unknown>): Record<string, unknown>;
export function loadConfig(projectDir?: string): SmartQuestionConfig | null;
export function loadConfig(
  projectDir?: string | Record<string, unknown>
): SmartQuestionConfig | null | Record<string, unknown> {
  if (
    projectDir &&
    typeof projectDir === 'object' &&
    ('client' in projectDir || 'directory' in projectDir)
  ) {
    return {};
  }

  const dir = typeof projectDir === 'string' && projectDir ? projectDir : process.cwd();
  const candidatePaths = [
    path.resolve(dir, '.opencode/smart-question.json'),
    path.resolve(dir, 'smart-question.json'),
    path.resolve(os.homedir(), '.config/opencode/smart-question.json'),
  ];

  let configPath: string | null = null;
  for (const candidate of candidatePaths) {
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
  }

  if (!configPath) {
    return normalizeSmartQuestionConfig({}, path.resolve(dir, '.opencode'));
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    const normalized = normalizeSmartQuestionConfig(parsed, path.dirname(configPath));

    if (!normalized && parsed?.enabled !== false) {
      console.error('[smart-question] Invalid smart-question config; auto-selection disabled');
    }
    return normalized;
  } catch (err) {
    console.error(
      `[smart-question] Failed to load smart-question config (${diagnosticErrorCode(err)}); auto-selection disabled`
    );
    return null;
  }
}
