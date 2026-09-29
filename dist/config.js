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
export function normalizeConfigMarkers(rawMarkers, legacyMarker) {
    if (Array.isArray(rawMarkers)) {
        const valid = rawMarkers.filter((m) => typeof m === 'string' && m.length > 0);
        const unique = Array.from(new Set(valid));
        if (unique.length > 0) {
            return unique;
        }
    }
    if (typeof legacyMarker === 'string' && legacyMarker.length > 0) {
        return [legacyMarker];
    }
    return [...DEFAULT_RECOMMENDED_MARKERS];
}
export function normalizeParamMarkers(marker) {
    if (Array.isArray(marker)) {
        const valid = marker.filter((m) => typeof m === 'string' && m.length > 0);
        const unique = Array.from(new Set(valid));
        return unique.length > 0 ? unique : [...DEFAULT_RECOMMENDED_MARKERS];
    }
    if (typeof marker === 'string' && marker.length > 0) {
        return [marker];
    }
    return [...DEFAULT_RECOMMENDED_MARKERS];
}
export function loadConfig(projectDir) {
    // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
    if (projectDir &&
        typeof projectDir === 'object' &&
        ('client' in projectDir || 'directory' in projectDir)) {
        return {};
    }
    try {
        const dir = typeof projectDir === 'string' && projectDir ? projectDir : process.cwd();
        const candidatePaths = [
            path.resolve(dir, '.opencode/smart-question.json'),
            path.resolve(dir, 'smart-question.json'),
            path.resolve(os.homedir(), '.config/opencode/smart-question.json'),
        ];
        let configPath = null;
        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                configPath = p;
                break;
            }
        }
        if (!configPath) {
            return null;
        }
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.enabled === false) {
            return null;
        }
        const recommendedMarkers = normalizeConfigMarkers(parsed.recommendedMarkers, parsed.recommendedMarker);
        const recommendedMarker = typeof parsed.recommendedMarker === 'string' && parsed.recommendedMarker.length > 0
            ? parsed.recommendedMarker
            : recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker;
        return {
            enabled: true,
            configDir: path.dirname(configPath),
            timeoutMs: typeof parsed.timeoutMs === 'number' && parsed.timeoutMs >= 0
                ? parsed.timeoutMs
                : DEFAULT_CONFIG.timeoutMs,
            recommendedMarkers,
            recommendedMarker,
            requireExactlyOneRecommendation: typeof parsed.requireExactlyOneRecommendation === 'boolean'
                ? parsed.requireExactlyOneRecommendation
                : DEFAULT_CONFIG.requireExactlyOneRecommendation,
            debugLog: typeof parsed.debugLog === 'string' ? parsed.debugLog : DEFAULT_CONFIG.debugLog,
        };
    }
    catch (err) {
        console.error(`[smart-question] Failed to load config: ${err instanceof Error ? err.message : String(err)}`);
        return null;
    }
}
