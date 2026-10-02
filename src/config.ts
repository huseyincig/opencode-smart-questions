import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SmartQuestionConfig, SmartQuestionUIText } from './types.js';

export const DEFAULT_RECOMMENDED_MARKERS: string[] = [
  '[SQ:recommended]',
  '(Recommended)',
  '(Önerilen)',
];

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

  const recommendedMarkers = normalizeConfigMarkers(
    parsed.recommendedMarkers,
    parsed.recommendedMarker
  );
  const recommendedMarker =
    typeof parsed.recommendedMarker === 'string' && parsed.recommendedMarker.trim().length > 0
      ? parsed.recommendedMarker.trim()
      : recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker;

  const timeoutMs =
    typeof parsed.timeoutMs === 'number' &&
    Number.isFinite(parsed.timeoutMs) &&
    parsed.timeoutMs >= 0
      ? parsed.timeoutMs
      : DEFAULT_CONFIG.timeoutMs;

  return {
    enabled: true,
    configDir:
      typeof parsed.configDir === 'string' && parsed.configDir
        ? parsed.configDir
        : configDir,
    timeoutMs,
    recommendedMarkers,
    recommendedMarker,
    requireExactlyOneRecommendation:
      typeof parsed.requireExactlyOneRecommendation === 'boolean'
        ? parsed.requireExactlyOneRecommendation
        : DEFAULT_CONFIG.requireExactlyOneRecommendation,
    uiText: normalizeUIText(parsed.uiText),
    debugLog: typeof parsed.debugLog === 'string' ? parsed.debugLog : DEFAULT_CONFIG.debugLog,
  };
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
      console.error(
        `[smart-question] Invalid config at ${configPath}; auto-selection disabled`
      );
    }
    return normalized;
  } catch (err) {
    console.error(
      `[smart-question] Failed to load config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}
