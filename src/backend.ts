import fs from 'node:fs';
import { loadConfig } from './config.js';
import { detectRecommendations } from './detector.js';
import { cleanupStaleDrafts, deleteLockfile, resolveLockPath } from './draft-guard.js';
import type {
  Hooks,
  PendingQuestionState,
  PluginInput,
  SmartQuestionConfig,
} from './types.js';

export async function createSmartQuestionHooks(
  input: PluginInput,
  pluginOptions?: Record<string, unknown>
): Promise<Hooks> {
  const { client, directory } = input;
  const serverUrl = input.serverUrl;

  const config: SmartQuestionConfig | null =
    (pluginOptions?.config as SmartQuestionConfig) || loadConfig(directory);

  if (!config || !config.enabled) {
    return {};
  }

  const effectiveConfigDir = config.configDir || directory || process.cwd();
  const pendingRequests = new Map<string, PendingQuestionState>();
  const debugLogPath =
    typeof config.debugLog === 'string' && config.debugLog ? config.debugLog : null;

  const dbg = (msg: string): void => {
    if (!debugLogPath) return;
    try {
      fs.appendFileSync(debugLogPath, `[smart-question] ${new Date().toISOString()} ${msg}\n`);
    } catch {
      // Diagnostics must never break hook
    }
  };

  const clientKeys = client && typeof client === 'object' ? Object.keys(client).sort().join(',') : 'none';
  dbg(
    `hooks registered dir=${directory} server=${serverUrl ? new URL(String(serverUrl)).origin : 'none'} ` +
      `scheme=${serverUrl ? new URL(String(serverUrl)).protocol : 'none'} ` +
      `timeoutMs=${config.timeoutMs} clientKeys=[${clientKeys}]`
  );

  // Best-effort cleanup of orphaned draft lockfiles from prior sessions/crashes
  cleanupStaleDrafts(effectiveConfigDir, config.timeoutMs, dbg);

  const eventHook = async ({ event }: { event: any }): Promise<void> => {
    if (!event || typeof event.type !== 'string') {
      return;
    }

    const isQuestionEvent = event.type.startsWith('question.');
    const payload = event.data ?? event.properties?.data ?? event.properties ?? null;

    if (isQuestionEvent) {
      dbg(
        `event=${event.type} topKeys=[${Object.keys(event).join(',')}] ` +
          `hasData=${!!event.data} hasProperties=${!!event.properties} ` +
          `payloadKeys=${payload ? '[' + Object.keys(payload).join(',') + ']' : 'none'}`
      );
    }

    if (event.type === 'question.asked') {
      const data = payload;
      const requestID = data?.id ?? data?.requestID;
      if (!requestID || typeof requestID !== 'string') {
        dbg('asked: NO request id found -> bail');
        return;
      }

      // If a previous timer for this request exists, clear it first
      const existing = pendingRequests.get(requestID);
      if (existing) {
        clearTimeout(existing.timer);
        pendingRequests.delete(requestID);
      }

      const decision = detectRecommendations(
        data.questions,
        config.recommendedMarkers,
        { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
      );

      if (decision.ok === false) {
        dbg(`skip request=${requestID} reason=${decision.reason}`);
        return;
      }

      dbg(`schedule request=${requestID} in ${config.timeoutMs}ms answers=${JSON.stringify(decision.answers)}`);

      const timer = setTimeout(async () => {
        const pending = pendingRequests.get(requestID);
        if (!pending || pending.status !== 'pending') {
          return;
        }

        pending.status = 'firing';
        pendingRequests.delete(requestID);

        const lockPath = resolveLockPath(effectiveConfigDir, requestID);
        let userComposing = false;
        try {
          fs.statSync(lockPath);
          userComposing = true;
        } catch (err) {
          const errCode = (err as { code?: string })?.code;
          if (errCode === 'ENOENT') {
            userComposing = false;
          } else {
            dbg(
              `lockfile check error request=${requestID} path=${lockPath} err=${
                err instanceof Error ? err.message : String(err)
              }`
            );
            userComposing = true;
          }
        }

        if (userComposing) {
          dbg(`skip request=${requestID} reason=user composing`);
          deleteLockfile(lockPath, dbg);
          return;
        }

        try {
          dbg(`reply attempt request=${requestID}`);
          const c = client?._client;
          if (client && client.question && typeof client.question.reply === 'function') {
            dbg(`reply path=question.reply request=${requestID}`);
            await client.question.reply({
              requestID,
              answers: decision.answers,
            });
          } else if (c && typeof c.post === 'function') {
            dbg(`reply path=_client request=${requestID}`);
            const res = await c.post({
              url: `/question/${encodeURIComponent(requestID)}/reply`,
              body: { answers: decision.answers },
            });
            if (res && typeof res === 'object') {
              if (res.error) {
                const detail =
                  res.error instanceof Error
                    ? res.error.message
                    : typeof res.error === 'string'
                      ? res.error
                      : JSON.stringify(res.error);
                throw new Error(`client._client error: ${detail}`);
              }
              if (res.ok === false) {
                throw new Error(
                  `client._client request failed with ok=false${res.status ? ` (status ${res.status})` : ''}`
                );
              }
            }
          } else if (serverUrl) {
            dbg(`reply path=fetch_fallback request=${requestID}`);
            const url = new URL(String(serverUrl));
            if (url.protocol === 'ws:') url.protocol = 'http:';
            else if (url.protocol === 'wss:') url.protocol = 'https:';
            const endpoint = `${url.origin}/question/${encodeURIComponent(requestID)}/reply${url.search}`;
            dbg(`reply target=${url.origin}${url.search ? ' (with query)' : ''} (fallback)`);
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ answers: decision.answers }),
            });
            if (!res.ok) {
              const body = await res.text().catch(() => '');
              throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
            }
          } else {
            throw new Error('no client.question.reply, no client._client.post, and no serverUrl');
          }
          dbg(`reply OK request=${requestID}`);
          deleteLockfile(lockPath, dbg);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          dbg(`reply ERROR request=${requestID} err=${message}`);
          console.error(
            `[smart-question] Error replying to question ${requestID}: ${message}`
          );
        }
      }, config.timeoutMs);

      pendingRequests.set(requestID, {
        requestID,
        timer,
        answers: decision.answers,
        status: 'pending',
      });
      return;
    }

    if (event.type === 'question.replied' || event.type === 'question.rejected') {
      const data = event.data ?? event.properties?.data ?? event.properties;
      const requestID = data?.requestID || data?.id;
      if (!requestID || typeof requestID !== 'string') {
        dbg(`${event.type}: NO request id -> cannot cancel`);
        return;
      }
      dbg(`${event.type} request=${requestID} -> cancel timer if pending`);

      const pending = pendingRequests.get(requestID);
      if (pending) {
        clearTimeout(pending.timer);
        pending.status = 'cancelled';
        pendingRequests.delete(requestID);
      }
      const lockPath = resolveLockPath(effectiveConfigDir, requestID);
      deleteLockfile(lockPath, dbg);
      return;
    }
  };

  const disposeHook = async (): Promise<void> => {
    for (const [, pending] of pendingRequests) {
      clearTimeout(pending.timer);
    }
    pendingRequests.clear();
  };

  return {
    event: eventHook,
    dispose: disposeHook,
  };
}
