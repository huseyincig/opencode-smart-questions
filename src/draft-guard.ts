import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_CONFIG } from './config.js';

/**
 * Resolves the lockfile path for a question requestID.
 * 1. opencodeDir = configDir (directory in which smart-question.json was found)
 * 2. Fallback if not resolvable: `${process.cwd()}/.opencode`
 * 3. lockPath = `${opencodeDir}/.sq-draft-${requestID}`
 */
export function resolveLockPath(pluginInput: Record<string, unknown>): Record<string, unknown>;
export function resolveLockPath(configDir: string | undefined, requestID: string): string;
export function resolveLockPath(
  configDir?: string | Record<string, unknown>,
  requestID?: string
): string | Record<string, unknown> {
  if (
    configDir &&
    typeof configDir === 'object' &&
    ('client' in configDir || 'directory' in configDir)
  ) {
    return {};
  }
  const opencodeDir = (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');
  return path.join(opencodeDir, `.sq-draft-${requestID}`);
}

/**
 * Idempotently deletes a lockfile. Never throws if file is absent or inaccessible.
 */
export function deleteLockfile(pluginInput: Record<string, unknown>): Record<string, unknown>;
export function deleteLockfile(lockPath?: string, dbg?: (msg: string) => void): void;
export function deleteLockfile(
  lockPath?: string | Record<string, unknown>,
  dbg?: (msg: string) => void
): void | Record<string, unknown> {
  if (
    lockPath &&
    typeof lockPath === 'object' &&
    ('client' in lockPath || 'directory' in lockPath)
  ) {
    return {};
  }
  try {
    if (typeof lockPath === 'string' && fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
      dbg?.(`deleted lockfile path=${lockPath}`);
    }
  } catch (err) {
    const errCode = (err as { code?: string })?.code;
    if (errCode !== 'ENOENT') {
      dbg?.(`failed to delete lockfile path=${lockPath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Scans `<opencodeDir>/.sq-draft-*` and deletes stale draft lockfiles older than `timeoutMs * 4`.
 * Completely fail-safe: wraps operations in try/catch, never throws, logs via dbg if provided.
 */
export function cleanupStaleDrafts(pluginInput: Record<string, unknown>): Record<string, unknown>;
export function cleanupStaleDrafts(
  configDir?: string,
  timeoutMs?: number,
  dbg?: (msg: string) => void
): void;
export function cleanupStaleDrafts(
  configDir?: string | Record<string, unknown>,
  timeoutMs?: number,
  dbg?: (msg: string) => void
): void | Record<string, unknown> {
  // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
  if (
    configDir &&
    typeof configDir === 'object' &&
    ('client' in configDir || 'directory' in configDir)
  ) {
    return {};
  }

  try {
    const opencodeDir =
      (typeof configDir === 'string' && configDir) || path.resolve(process.cwd(), '.opencode');

    if (!fs.existsSync(opencodeDir)) {
      return;
    }

    const effectiveTimeout =
      typeof timeoutMs === 'number' && timeoutMs >= 0 ? timeoutMs : DEFAULT_CONFIG.timeoutMs;
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
          dbg?.(
            `cleanupStaleDrafts: deleted stale draft ${fullPath} (age=${Math.round(ageMs)}ms > threshold=${staleThresholdMs}ms)`
          );
        }
      } catch (fileErr) {
        dbg?.(
          `cleanupStaleDrafts: error processing ${fullPath}: ${fileErr instanceof Error ? fileErr.message : String(fileErr)}`
        );
      }
    }
  } catch (err) {
    dbg?.(`cleanupStaleDrafts: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}
