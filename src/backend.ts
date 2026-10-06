import fs from 'node:fs';
import path from 'node:path';
import { resolveSmartQuestionConfig } from './config.js';
import { detectRecommendations } from './detector.js';
import { canUseDraftCoordination, cleanupStaleDrafts, deleteLockfile, resolveLockPath } from './draft-guard.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { createDiagnosticError, diagnosticErrorCode } from './diagnostics.js';
import { resolveV1SessionScope } from './session-scope.js';
import {
  getActiveHandoff,
  setActiveHandoff,
  consumeActiveHandoff,
  clearActiveHandoff,
  extractHandoffFromParts,
  parseOpenCodeHandoff,
} from './handoff.js';
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
  const sessionScope = new Map<string, boolean>();
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

  const isRootSession = async (sessionID: string): Promise<boolean> => {
    if (!sessionID) return false;
    if (sessionScope.has(sessionID)) return sessionScope.get(sessionID) === true;

    const scope = await resolveV1SessionScope(client, sessionID, directory);
    if (scope === 'root') {
      sessionScope.set(sessionID, true);
      return true;
    }
    if (scope === 'child') {
      sessionScope.set(sessionID, false);
      return false;
    }

    dbg(`skip session=${sessionID} reason=session-scope-unknown`);
    return false;
  };

  const eventHook = async ({ event }: { event: any }): Promise<void> => {
    if (!event || typeof event.type !== 'string') return;

    const payload = event.data ?? event.properties?.data ?? event.properties ?? null;

    if (event.type === 'message.created' || event.type === 'message.updated') {
      const sessionID = String(payload?.sessionID ?? event?.sessionID ?? '');
      if (sessionID && (await isRootSession(sessionID))) {
        const parts = payload?.parts ?? payload?.message?.parts;
        const handoff =
          extractHandoffFromParts(parts) ??
          (typeof payload?.content === 'string' ? parseOpenCodeHandoff(payload.content, { requireRemediationMarker: true }) : null) ??
          (typeof payload?.text === 'string' ? parseOpenCodeHandoff(payload.text, { requireRemediationMarker: true }) : null);
        if (handoff && typeof handoff === 'object' && 'version' in handoff) {
          setActiveHandoff(sessionID, handoff);
          dbg(`handoff received via event session=${sessionID} handoffId=${handoff.handoffId} kind=${handoff.kind} autoSelect=${handoff.autoSelect}`);
        } else {
          const role = payload?.role ?? payload?.info?.role ?? payload?.message?.role ?? payload?.message?.info?.role;
          if (event.type === 'message.created' && role === 'user') {
            clearActiveHandoff(sessionID);
            dbg(`cleared stale handoff on new user turn session=${sessionID}`);
          }
        }
      }
      return;
    }

    if (event.type === 'session.deleted') {
      const sessionID = String(payload?.id ?? payload?.sessionID ?? event?.sessionID ?? '');
      if (sessionID) {
        clearActiveHandoff(sessionID);
        sessionScope.delete(sessionID);
        dbg(`session deleted, cleared handoff and scope session=${sessionID}`);
      }
      return;
    }

    if (event.type === 'question.asked') {
      const data = payload;
      const requestID = data?.id ?? data?.requestID;
      const sessionID = String(data?.sessionID ?? event?.sessionID ?? '');
      if (!requestID || typeof requestID !== 'string') {
        dbg('question.asked: no request id');
        return;
      }
      if (!(await isRootSession(sessionID))) {
        dbg(`skip request=${requestID} reason=non-root-session`);
        return;
      }

      let handoff = getActiveHandoff(sessionID);
      if (!handoff && client?.session && typeof client.session.messages === 'function') {
        try {
          const res = await client.session.messages({ path: { id: sessionID } });
          const msgs = (res as any)?.data ?? res;
          if (Array.isArray(msgs)) {
            for (let i = msgs.length - 1; i >= 0 && i >= msgs.length - 5; i--) {
              const m = msgs[i];
              const extracted =
                extractHandoffFromParts(m?.parts) ??
                (typeof m?.content === 'string' ? parseOpenCodeHandoff(m.content, { requireRemediationMarker: true }) : null);
              if (extracted && typeof extracted === 'object' && 'version' in extracted) {
                setActiveHandoff(sessionID, extracted);
                handoff = extracted as any;
                break;
              }
            }
          }
        } catch {
          // Best effort message lookup
        }
      }

      if (handoff && handoff.autoSelect === 'forbidden') {
        dbg(`skip request=${requestID} reason=guardian-handoff-auto-select-forbidden handoffId=${handoff.handoffId}`);
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
          consumeActiveHandoff(sessionID);
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
      const sessionID = String(data?.sessionID ?? event?.sessionID ?? '');
      if (sessionID) {
        consumeActiveHandoff(sessionID);
      }
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

  const systemTransformHook = async (
    hookInput: { sessionID?: string; model?: any; [key: string]: any },
    output: { system?: string[]; [key: string]: any }
  ): Promise<void> => {
    if (!Array.isArray(output?.system)) return;
    const sessionID = typeof hookInput?.sessionID === 'string' ? hookInput.sessionID : '';
    if (!(await isRootSession(sessionID))) return;
    if (!output.system.some((part) => part.includes(SQ_GUIDANCE_SENTINEL))) {
      output.system.push(guidance.system);
    }
  };

  const chatMessageHook = async (
    input: { sessionID?: string; [key: string]: any },
    output: { message?: any; parts?: any[]; [key: string]: any }
  ): Promise<void> => {
    const sessionID = typeof input?.sessionID === 'string' ? input.sessionID : '';
    if (!sessionID || !(await isRootSession(sessionID))) return;
    const handoff =
      extractHandoffFromParts(output?.parts) ??
      (typeof output?.message?.content === 'string'
        ? parseOpenCodeHandoff(output.message.content, { requireRemediationMarker: true })
        : null);
    if (handoff && typeof handoff === 'object' && 'version' in handoff) {
      setActiveHandoff(sessionID, handoff);
      dbg(`handoff received via chat.message session=${sessionID} handoffId=${handoff.handoffId} kind=${handoff.kind} autoSelect=${handoff.autoSelect}`);
    } else {
      const role = output?.message?.role ?? output?.message?.info?.role;
      if (role === 'user') {
        clearActiveHandoff(sessionID);
        dbg(`cleared stale handoff on new user turn in chat.message session=${sessionID}`);
      }
    }
  };

  return {
    event: eventHook,
    dispose: disposeHook,
    'experimental.chat.system.transform': systemTransformHook,
    'chat.message': chatMessageHook,
  };
}
