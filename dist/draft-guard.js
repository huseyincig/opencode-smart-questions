import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './config.js';
export function resolveLockPath(configDir, requestID) {
    if (configDir &&
        typeof configDir === 'object' &&
        ('client' in configDir || 'directory' in configDir)) {
        return {};
    }
    const opencodeDir = (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');
    return path.join(opencodeDir, `.sq-draft-${requestID}`);
}
export function deleteLockfile(lockPath, dbg) {
    if (lockPath &&
        typeof lockPath === 'object' &&
        ('client' in lockPath || 'directory' in lockPath)) {
        return {};
    }
    try {
        if (typeof lockPath === 'string' && fs.existsSync(lockPath)) {
            fs.unlinkSync(lockPath);
            dbg?.(`deleted lockfile path=${lockPath}`);
        }
    }
    catch (err) {
        const errCode = err?.code;
        if (errCode !== 'ENOENT') {
            dbg?.(`failed to delete lockfile path=${lockPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
export function cleanupStaleDrafts(configDir, timeoutMs, dbg) {
    // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
    if (configDir &&
        typeof configDir === 'object' &&
        ('client' in configDir || 'directory' in configDir)) {
        return {};
    }
    try {
        const opencodeDir = (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');
        if (!fs.existsSync(opencodeDir)) {
            return;
        }
        const effectiveTimeout = typeof timeoutMs === 'number' && timeoutMs >= 0 ? timeoutMs : DEFAULT_CONFIG.timeoutMs;
        const staleThresholdMs = effectiveTimeout * 4;
        const now = Date.now();
        const entries = fs.readdirSync(opencodeDir);
        for (const entry of entries) {
            if (!entry.startsWith('.sq-draft-')) {
                continue;
            }
            const fullPath = path.join(opencodeDir, entry);
            try {
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) {
                    continue;
                }
                const ageMs = now - stat.mtimeMs;
                if (ageMs > staleThresholdMs) {
                    fs.unlinkSync(fullPath);
                    dbg?.(`cleanupStaleDrafts: deleted stale draft ${fullPath} (age=${Math.round(ageMs)}ms > threshold=${staleThresholdMs}ms)`);
                }
            }
            catch (fileErr) {
                dbg?.(`cleanupStaleDrafts: error processing ${fullPath}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`);
            }
        }
    }
    catch (err) {
        dbg?.(`cleanupStaleDrafts: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
}
