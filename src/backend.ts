import fs from 'node:fs';
import path from 'node:path';
import { resolveSmartQuestionConfig } from './config.js';
import { detectRecommendations } from './detector.js';
import { canUseDraftCoordination, cleanupStaleDrafts, deleteLockfile, resolveLockPath } from './draft-guard.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { createDiagnosticError, diagnosticErrorCode } from './diagnostics.js';
import type {
  Hooks,
  PendingQuestionState,
  PluginInput,
} from './types.js';

function describeServer(serverUrl: unknown): { origin: string; protocol: string } {
  if (!serverUrl) return { origin: 'none', protocol: 'none' };
  try {
    const url = new URL(String(serverUrl));
    return { origin: url.origin, protocol: url.protocol };
  } catch {
    return { origin: 'invalid', protocol: 'invalid' };
  }
}

function enhanceQuestionSchema(schema: any, marker: string): void {
  try {
    const optionsProp =
      schema?.properties?.questions?.items?.properties?.options?.items?.properties;
    const label = optionsProp?.label;
    if (label && typeof label.description === 'string') {
      const suffix = ` (Append "${marker}" to indicate a recommended option)`;
      if (!label.description.includes(suffix)) {
        label.description += suffix;
      }
    }
  } catch {
    // Best-effort schema enhancement.
  }
}

export async function createSmartQuestionHooks(
  input: PluginInput,
  pluginOptions?: Record<string, unknown>
): Promise<Hooks> {
  const { client, directory } = input;
  const serverUrl = input.serverUrl;
  const config = resolveSmartQuestionConfig(directory, pluginOptions);

  if (!config?.enabled) return {};

  const effectiveConfigDir =
    config.configDir || path.resolve(directory || process.cwd(), '.opencode');
  const pendingRequests = new Map<string, PendingQuestionState>();
  const debugLogPath =
    typeof config.debugLog === 'string' && config.debugLog ? config.debugLog : null;

  const dbg = (msg: string): void => {
    if (!debugLogPath) return;
    try {
      fs.appendFileSync(
        debugLogPath,
        `[smart-question] ${new Date().toISOString()} ${msg}\n`,
        { encoding: 'utf8', mode: 0o600 }
      );
    } catch {
      // Diagnostics must never break the hook.
    }
  };

  const server = describeServer(serverUrl);
  const clientKeys =
    client && typeof client === 'object' ? Object.keys(client).sort().join(',') : 'none';
  dbg(
    `hooks registered directory=${directory ? 'set' : 'none'} server=${server.origin} ` +
      `scheme=${server.protocol} timeoutMs=${config.timeoutMs} clientKeys=[${clientKeys}]`
  );

  cleanupStaleDrafts(effectiveConfigDir, config.timeoutMs, dbg);

  const eventHook = async ({ event }: { event: any }): Promise<void> => {
    if (!event || typeof event.type !== 'string') return;

    const payload = event.data ?? event.properties?.data ?? event.properties ?? null;

    if (event.type === 'question.asked') {
      const data = payload;
      const requestID = data?.id ?? data?.requestID;
      if (!requestID || typeof requestID !== 'string') {
        dbg('question.asked: no request id');
        return;
      }

      const existing = pendingRequests.get(requestID);
      if (existing) {
        clearTimeout(existing.timer);
        existing.status = 'cancelled';
        pendingRequests.delete(requestID);
      }

      const decision = detectRecommendations(
        data.questions,
        config.recommendedMarkers,
        { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation }
      );
      if (!decision.ok) {
        dbg(`skip request=${requestID} reason=${decision.reason}`);
        return;
      }

      if (!canUseDraftCoordination(effectiveConfigDir, dbg)) {
        dbg(`skip request=${requestID} reason=draft-coordination-unavailable`);
        return;
      }

      const selectionCount = decision.answers.reduce((sum, answer) => sum + answer.length, 0);
      dbg(
        `schedule request=${requestID} in ${config.timeoutMs}ms questions=${decision.answers.length} selections=${selectionCount}`
      );

      const pending: PendingQuestionState = {
        requestID,
        timer: undefined as unknown as NodeJS.Timeout,
        answers: decision.answers,
        status: 'pending',
      };

      pending.timer = setTimeout(async () => {
        if (pendingRequests.get(requestID) !== pending || pending.status !== 'pending') {
          return;
        }
        pending.status = 'firing';

        const lockPath = resolveLockPath(effectiveConfigDir, requestID);
        let userComposing = false;
        let lockMissing = false;
        try {
          fs.statSync(lockPath);
          userComposing = true;
        } catch (err) {
          const errCode = (err as { code?: string })?.code;
          if (errCode === 'ENOENT') {
            lockMissing = true;
          } else {
            dbg(`lockfile check error request=${requestID} code=${diagnosticErrorCode(err)}`);
            userComposing = true;
          }
        }

        if (userComposing) {
          dbg(`skip request=${requestID} reason=user composing`);
          pending.status = 'cancelled';
          if (pendingRequests.get(requestID) === pending) pendingRequests.delete(requestID);
          deleteLockfile(lockPath, dbg);
          return;
        }

        if (lockMissing && !canUseDraftCoordination(effectiveConfigDir, dbg)) {
          dbg(`skip request=${requestID} reason=draft-coordination-unavailable`);
          pending.status = 'cancelled';
          if (pendingRequests.get(requestID) === pending) pendingRequests.delete(requestID);
          return;
        }

        if (pendingRequests.get(requestID) !== pending || pending.status !== 'firing') {
          return;
        }

        try {
          dbg(`reply attempt request=${requestID}`);
          const internalClient = client?._client;

          if (client?.question && typeof client.question.reply === 'function') {
            const res = await client.question.reply({ requestID, answers: decision.answers });
            if (res && typeof res === 'object') {
              const outcome = res as { error?: unknown; ok?: boolean };
              if (outcome.error) {
                throw createDiagnosticError('native-reply-error');
              }
              if (outcome.ok === false) {
                throw createDiagnosticError('native-reply-not-ok');
              }
            }
          } else if (internalClient && typeof internalClient.post === 'function') {
            const res = await internalClient.post({
              url: `/question/${encodeURIComponent(requestID)}/reply`,
              body: { answers: decision.answers },
            });
            if (res && typeof res === 'object') {
              if (res.error) {
                throw createDiagnosticError('internal-reply-error');
              }
              if (res.ok === false) {
                throw createDiagnosticError('internal-reply-not-ok');
              }
            }
          } else if (serverUrl) {
            const url = new URL(String(serverUrl));
            if (url.protocol === 'ws:') url.protocol = 'http:';
            else if (url.protocol === 'wss:') url.protocol = 'https:';
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
              throw new Error(`unsupported server URL protocol: ${url.protocol}`);
            }

            const endpoint =
              `${url.origin}/question/${encodeURIComponent(requestID)}/reply${url.search}`;
            const res = await fetch(endpoint, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ answers: decision.answers }),
            });
            if (!res.ok) {
              throw createDiagnosticError(`HTTP_${res.status}`);
            }
          } else {
            throw createDiagnosticError('no-reply-transport');
          }

          pending.status = 'replied';
          dbg(`reply OK request=${requestID}`);
          deleteLockfile(lockPath, dbg);
        } catch (err) {
          const code = diagnosticErrorCode(err);
          dbg(`reply ERROR request=${requestID} code=${code}`);
          console.error(`[smart-question] Auto-selection failed for question ${requestID} (${code})`);
        } finally {
          if (pendingRequests.get(requestID) === pending) {
            pendingRequests.delete(requestID);
          }
        }
      }, config.timeoutMs);

      pendingRequests.set(requestID, pending);
      return;
    }

    if (event.type === 'question.replied' || event.type === 'question.rejected') {
      const data = payload;
      const requestID = data?.requestID ?? data?.id;
      if (!requestID || typeof requestID !== 'string') {
        dbg(`${event.type}: no request id`);
        return;
      }

      const pending = pendingRequests.get(requestID);
      if (pending) {
        clearTimeout(pending.timer);
        pending.status = 'cancelled';
        pendingRequests.delete(requestID);
      }
      deleteLockfile(resolveLockPath(effectiveConfigDir, requestID), dbg);
    }
  };

  const disposeHook = async (): Promise<void> => {
    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.status = 'cancelled';
    }
    pendingRequests.clear();
  };

  const guidance = buildRecommendationGuidance(config);

  const toolDefinitionHook = async (
    hookInput: { toolID?: string; [key: string]: any },
    output: { description?: string; parameters?: any; jsonSchema?: any; [key: string]: any }
  ): Promise<void> => {
    if (hookInput?.toolID !== 'question') return;

    if (typeof output.description === 'string') {
      if (!output.description.includes(SQ_GUIDANCE_SENTINEL)) {
        output.description += guidance.tool;
      }
    } else {
      output.description = guidance.tool.trim();
    }

    enhanceQuestionSchema(output.jsonSchema, guidance.primaryMarker);
    enhanceQuestionSchema(output.parameters, guidance.primaryMarker);
  };

  const systemTransformHook = async (
    _hookInput: { sessionID?: string; model?: any; [key: string]: any },
    output: { system?: string[]; [key: string]: any }
  ): Promise<void> => {
    if (!Array.isArray(output?.system)) return;
    if (!output.system.some((part) => part.includes(SQ_GUIDANCE_SENTINEL))) {
      output.system.push(guidance.system);
    }
  };

  return {
    event: eventHook,
    dispose: disposeHook,
    'tool.definition': toolDefinitionHook,
    'experimental.chat.system.transform': systemTransformHook,
  };
}
