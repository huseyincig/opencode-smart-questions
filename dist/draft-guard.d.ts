/**
 * Resolves the lockfile path for a question requestID.
 * 1. opencodeDir = configDir (directory in which smart-question.json was found)
 * 2. Fallback if not resolvable: `${process.cwd()}/.opencode`
 * 3. lockPath = `${opencodeDir}/.sq-draft-${requestID}`
 */
export declare function resolveLockPath(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function resolveLockPath(configDir: string | undefined, requestID: string): string;
export declare function canUseDraftCoordination(configDir?: string, dbg?: (msg: string) => void): boolean;
/**
 * Idempotently deletes a lockfile. Never throws if file is absent or inaccessible.
 */
export declare function deleteLockfile(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function deleteLockfile(lockPath?: string, dbg?: (msg: string) => void): void;
/**
 * Scans `<opencodeDir>/.sq-draft-*` and deletes stale draft lockfiles older than `timeoutMs * 4`.
 * Completely fail-safe: wraps operations in try/catch, never throws, logs via dbg if provided.
 */
export declare function cleanupStaleDrafts(pluginInput: Record<string, unknown>): Record<string, unknown>;
export declare function cleanupStaleDrafts(configDir?: string, timeoutMs?: number, dbg?: (msg: string) => void): void;
