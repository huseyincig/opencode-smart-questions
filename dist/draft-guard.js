import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CONFIG } from './config.js';
import { diagnosticErrorCode } from './diagnostics.js';
export function resolveLockPath(configDir, requestID) {
    if (configDir &&
        typeof configDir === 'object' &&
        ('client' in configDir || 'directory' in configDir)) {
        return {};
    }
    const opencodeDir = (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');
    const safeRequestID = encodeURIComponent(typeof requestID === 'string' ? requestID : 'unknown');
    return path.join(opencodeDir, `.sq-draft-${safeRequestID}`);
}
export function canUseDraftCoordination(configDir, dbg) {
    const opencodeDir = (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');
    const probePath = path.join(opencodeDir, `.sq-draft-probe-${randomUUID()}`);
    try {
        fs.mkdirSync(opencodeDir, { recursive: true });
        fs.writeFileSync(probePath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        fs.unlinkSync(probePath);
        return true;
    }
    catch (error) {
        try {
            fs.unlinkSync(probePath);
        }
        catch {
            // Best-effort probe cleanup.
        }
        dbg?.(`draft coordination unavailable code=${diagnosticErrorCode(error)}`);
        return false;
    }
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
            dbg?.(`deleted lockfile file=${path.basename(lockPath)}`);
        }
    }
    catch (err) {
        const errCode = err?.code;
        if (errCode !== 'ENOENT') {
            dbg?.(`failed to delete lockfile file=${typeof lockPath === 'string' ? path.basename(lockPath) : 'unknown'} code=${diagnosticErrorCode(err)}`);
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
        const staleThresholdMs = Math.max(effectiveTimeout * 4, DEFAULT_CONFIG.timeoutMs * 4);
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
                    dbg?.(`cleanupStaleDrafts: deleted stale draft ${entry} (age=${Math.round(ageMs)}ms > threshold=${staleThresholdMs}ms)`);
                }
            }
            catch (fileErr) {
                dbg?.(`cleanupStaleDrafts: error processing ${entry} code=${diagnosticErrorCode(fileErr)}`);
            }
        }
    }
    catch (err) {
        dbg?.(`cleanupStaleDrafts: unexpected error code=${diagnosticErrorCode(err)}`);
    }
}
