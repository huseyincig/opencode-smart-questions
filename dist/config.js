import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export const DEFAULT_RECOMMENDED_MARKERS = ['(Recommended)', '(Önerilen)'];
export const DEFAULT_CONFIG = {
    enabled: true,
    timeoutMs: 30000,
    recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
    recommendedMarker: '(Recommended)',
    requireExactlyOneRecommendation: true,
    debugLog: '',
};
function cleanMarkers(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)));
}
export function normalizeConfigMarkers(rawMarkers, legacyMarker) {
    const list = cleanMarkers(rawMarkers);
    if (list.length > 0)
        return list;
    if (typeof legacyMarker === 'string' && legacyMarker.trim().length > 0) {
        return [legacyMarker.trim()];
    }
    return [...DEFAULT_RECOMMENDED_MARKERS];
}
export function normalizeParamMarkers(marker) {
    if (Array.isArray(marker)) {
        const list = cleanMarkers(marker);
        return list.length > 0 ? list : [...DEFAULT_RECOMMENDED_MARKERS];
    }
    if (typeof marker === 'string' && marker.trim().length > 0) {
        return [marker.trim()];
    }
    return [...DEFAULT_RECOMMENDED_MARKERS];
}
export function normalizeSmartQuestionConfig(raw, configDir) {
    if (raw !== undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw))) {
        return null;
    }
    const parsed = (raw ?? {});
    if (parsed.enabled === false)
        return null;
    const recommendedMarkers = normalizeConfigMarkers(parsed.recommendedMarkers, parsed.recommendedMarker);
    const recommendedMarker = typeof parsed.recommendedMarker === 'string' && parsed.recommendedMarker.trim().length > 0
        ? parsed.recommendedMarker.trim()
        : recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker;
    const timeoutMs = typeof parsed.timeoutMs === 'number' &&
        Number.isFinite(parsed.timeoutMs) &&
        parsed.timeoutMs >= 0
        ? parsed.timeoutMs
        : DEFAULT_CONFIG.timeoutMs;
    return {
        enabled: true,
        configDir: typeof parsed.configDir === 'string' && parsed.configDir
            ? parsed.configDir
            : configDir,
        timeoutMs,
        recommendedMarkers,
        recommendedMarker,
        requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === 'boolean'
            ? parsed.requireExactlyOneRecommendation
            : DEFAULT_CONFIG.requireExactlyOneRecommendation,
        debugLog: typeof parsed.debugLog === 'string' ? parsed.debugLog : DEFAULT_CONFIG.debugLog,
    };
}
export function loadConfig(projectDir) {
    if (projectDir &&
        typeof projectDir === 'object' &&
        ('client' in projectDir || 'directory' in projectDir)) {
        return {};
    }
    const dir = typeof projectDir === 'string' && projectDir ? projectDir : process.cwd();
    const candidatePaths = [
        path.resolve(dir, '.opencode/smart-question.json'),
        path.resolve(dir, 'smart-question.json'),
        path.resolve(os.homedir(), '.config/opencode/smart-question.json'),
    ];
    let configPath = null;
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
            console.error(`[smart-question] Invalid config at ${configPath}; auto-selection disabled`);
        }
        return normalized;
    }
    catch (err) {
        console.error(`[smart-question] Failed to load config at ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
