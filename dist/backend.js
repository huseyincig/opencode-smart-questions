import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS, resolveSmartQuestionConfig, } from './config.js';
import { classifyQuestions, computeQuestionFingerprint } from './detector.js';
import { canUseDraftCoordination, cleanupStaleDrafts, deleteLockfile, resolveLockPath } from './draft-guard.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { createDiagnosticError, diagnosticErrorCode } from './diagnostics.js';
import { resolveV1SessionScope } from './session-scope.js';
import { getActiveHandoff, setActiveHandoff, consumeActiveHandoff, clearActiveHandoff, invalidateActiveHandoff, extractTrustedGuardianHandoff, extractCurrentTurnGuardianHandoff, } from './handoff.js';
export const SQ_REMEDIATION_HEADER = '[Smart Questions protocol remediation]';
export function buildUnclassifiedRemediationPrompt(primaryMarker, manualMarker = '[SQ:manual]') {
    // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
    if (primaryMarker &&
        typeof primaryMarker === 'object' &&
        ('client' in primaryMarker || 'directory' in primaryMarker)) {
        return {};
    }
    const recMarker = typeof primaryMarker === 'string' ? primaryMarker : '[SQ:recommended]';
    return [
        SQ_REMEDIATION_HEADER,
        '',
        'This selectable question is unclassified.',
        '',
        'Do not leave a root-agent selectable question waiting indefinitely.',
        '',
        'Either:',
        '',
        '1. mark the safest/recommended option with the canonical',
        `   ${recMarker}`,
        '   token so Smart Questions can continue automatically,',
        '',
        'or',
        '',
        '2. explicitly classify the question as manual approval using',
        `   the Smart Questions manual-decision protocol (${manualMarker}) when human`,
        '   approval is genuinely required.',
        '',
        'Do not ask the same unclassified question again.',
    ].join('\n');
}
async function sendSyntheticRemediation(client, sessionID, directory, promptText, dbg) {
    try {
        if (client?.session && typeof client.session.synthetic === 'function') {
            await client.session.synthetic({
                sessionID,
                text: promptText,
                description: 'Smart Questions protocol remediation',
                metadata: { 'opencode-smart-questions': true },
                delivery: 'queue',
                resume: true,
            });
            return true;
        }
        if (client?.session && typeof client.session.promptAsync === 'function') {
            await client.session.promptAsync({
                path: { id: sessionID },
                ...(directory ? { query: { directory } } : {}),
                body: {
                    parts: [{
                            type: 'text',
                            text: promptText,
                            synthetic: true,
                            metadata: { 'opencode-smart-questions': true },
                        }],
                },
            });
            return true;
        }
        if (client?.session && typeof client.session.prompt === 'function') {
            await client.session.prompt({
                path: { id: sessionID },
                ...(directory ? { query: { directory } } : {}),
                body: {
                    parts: [{
                            type: 'text',
                            text: promptText,
                            synthetic: true,
                            metadata: { 'opencode-smart-questions': true },
                        }],
                },
            });
            return true;
        }
        if (client?._client && typeof client._client.post === 'function') {
            await client._client.post({
                url: `/session/${encodeURIComponent(sessionID)}/prompt_async`,
                body: {
                    parts: [{
                            type: 'text',
                            text: promptText,
                            synthetic: true,
                            metadata: { 'opencode-smart-questions': true },
                        }],
                },
            });
            return true;
        }
    }
    catch (err) {
        dbg(`remediation prompt failed session=${sessionID} code=${diagnosticErrorCode(err)}`);
    }
    return false;
}
function describeServer(serverUrl) {
    if (!serverUrl)
        return { origin: 'none', protocol: 'none' };
    try {
        const url = new URL(String(serverUrl));
        return { origin: url.origin, protocol: url.protocol };
    }
    catch {
        return { origin: 'invalid', protocol: 'invalid' };
    }
}
export async function createSmartQuestionHooks(input, pluginOptions) {
    const { client, directory } = input;
    const serverUrl = input.serverUrl;
    const config = resolveSmartQuestionConfig(directory, pluginOptions);
    if (!config?.enabled)
        return {};
    const effectiveConfigDir = config.configDir || path.resolve(directory || process.cwd(), '.opencode');
    const pendingRequests = new Map();
    const remediatedRequests = new Set();
    const sessionChains = new Map();
    const sessionScope = new Map();
    const debugLogPath = typeof config.debugLog === 'string' && config.debugLog ? config.debugLog : null;
    const dbg = (msg) => {
        if (!debugLogPath)
            return;
        try {
            fs.appendFileSync(debugLogPath, `[smart-question] ${new Date().toISOString()} ${msg}\n`, { encoding: 'utf8', mode: 0o600 });
        }
        catch {
            // Diagnostics must never break the hook.
        }
    };
    const server = describeServer(serverUrl);
    const clientKeys = client && typeof client === 'object' ? Object.keys(client).sort().join(',') : 'none';
    dbg(`hooks registered directory=${directory ? 'set' : 'none'} server=${server.origin} ` +
        `scheme=${server.protocol} timeoutMs=${config.timeoutMs} clientKeys=[${clientKeys}]`);
    cleanupStaleDrafts(effectiveConfigDir, config.timeoutMs, dbg);
    const isRootSession = async (sessionID) => {
        if (!sessionID)
            return false;
        if (sessionScope.has(sessionID))
            return sessionScope.get(sessionID) === true;
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
    const eventHook = async ({ event }) => {
        if (!event || typeof event.type !== 'string')
            return;
        const payload = event.data ?? event.properties?.data ?? event.properties ?? null;
        if (event.type === 'message.created' || event.type === 'message.updated') {
            const sessionID = String(payload?.sessionID ?? event?.sessionID ?? '');
            if (sessionID && (await isRootSession(sessionID))) {
                const handoff = extractTrustedGuardianHandoff(payload);
                if (handoff && typeof handoff === 'object' && 'version' in handoff) {
                    setActiveHandoff(sessionID, handoff);
                    dbg(`handoff received via event session=${sessionID} handoffId=${handoff.handoffId} kind=${handoff.kind} autoSelect=${handoff.autoSelect}`);
                }
                else {
                    const role = payload?.role ?? payload?.info?.role ?? payload?.message?.role ?? payload?.message?.info?.role;
                    if (event.type === 'message.created' && role === 'user') {
                        invalidateActiveHandoff(sessionID);
                        sessionChains.delete(sessionID);
                        dbg(`invalidated stale handoff and reset unclassified chain on new user turn session=${sessionID}`);
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
                sessionChains.delete(sessionID);
                dbg(`session deleted, cleared handoff, scope and unclassified chain session=${sessionID}`);
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
                    const msgs = res?.data ?? res;
                    if (Array.isArray(msgs)) {
                        const extracted = extractCurrentTurnGuardianHandoff(msgs);
                        if (extracted && typeof extracted === 'object' && 'version' in extracted) {
                            if (setActiveHandoff(sessionID, extracted) === true) {
                                handoff = extracted;
                            }
                        }
                    }
                }
                catch {
                    // Best effort message lookup
                }
            }
            const existing = pendingRequests.get(requestID);
            if (existing) {
                clearTimeout(existing.timer);
                existing.status = 'cancelled';
                pendingRequests.delete(requestID);
            }
            const classification = classifyQuestions(data.questions, config.recommendedMarkers, config.manualMarkers, handoff, { requireExactlyOneRecommendation: config.requireExactlyOneRecommendation });
            if (classification.status === 'manual') {
                sessionChains.delete(sessionID);
                dbg(`skip request=${requestID} reason=manual-classification matched=${classification.matchedMarker ?? 'none'}`);
                return;
            }
            if (classification.status === 'unclassified') {
                if (config.unclassifiedQuestionPolicy === 'ignore') {
                    dbg(`unclassified request=${requestID} ignored per unclassifiedQuestionPolicy`);
                    return;
                }
                dbg(`unclassified request=${requestID} reason=${classification.reason}`);
                if (remediatedRequests.has(requestID)) {
                    dbg(`suppress duplicate remediation request=${requestID}`);
                    return;
                }
                const fingerprint = computeQuestionFingerprint(data.questions);
                const maxRemediations = typeof config.maxUnclassifiedRemediations === 'number'
                    ? config.maxUnclassifiedRemediations
                    : DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS;
                const existingChain = sessionChains.get(sessionID);
                const isSameChain = existingChain !== undefined && existingChain.fingerprint === fingerprint;
                const currentCount = isSameChain ? existingChain.consecutiveFailures : 0;
                if (currentCount >= maxRemediations) {
                    dbg(`unclassified remediation budget exhausted session=${sessionID} fingerprint=${fingerprint} count=${currentCount}/${maxRemediations}`);
                    return;
                }
                remediatedRequests.add(requestID);
                sessionChains.set(sessionID, {
                    fingerprint,
                    consecutiveFailures: currentCount + 1,
                });
                const promptText = buildUnclassifiedRemediationPrompt(config.recommendedMarker, config.manualMarker);
                const sent = await sendSyntheticRemediation(client, sessionID, directory, promptText, dbg);
                if (!sent) {
                    // The request was marked before awaiting transport so concurrent
                    // duplicate events remain suppressed. Roll that state back when
                    // nothing was actually delivered, otherwise the root question can
                    // become permanently unclassified with no retry path.
                    remediatedRequests.delete(requestID);
                    if (currentCount === 0) {
                        sessionChains.delete(sessionID);
                    }
                    else {
                        sessionChains.set(sessionID, {
                            fingerprint,
                            consecutiveFailures: currentCount,
                        });
                    }
                    dbg(`remediation not sent request=${requestID} session=${sessionID}; retry remains allowed`);
                    return;
                }
                dbg(`remediation sent request=${requestID} session=${sessionID} fingerprint=${fingerprint} count=${currentCount + 1}/${maxRemediations}`);
                return;
            }
            // Here classification.status === 'auto'
            sessionChains.delete(sessionID);
            if (!canUseDraftCoordination(effectiveConfigDir, dbg)) {
                dbg(`skip request=${requestID} reason=draft-coordination-unavailable`);
                return;
            }
            const selectionCount = classification.answers.reduce((sum, answer) => sum + answer.length, 0);
            dbg(`schedule request=${requestID} in ${config.timeoutMs}ms questions=${classification.answers.length} selections=${selectionCount}`);
            const pending = {
                requestID,
                timer: undefined,
                answers: classification.answers,
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
                }
                catch (err) {
                    const errCode = err?.code;
                    if (errCode === 'ENOENT') {
                        lockMissing = true;
                    }
                    else {
                        dbg(`lockfile check error request=${requestID} code=${diagnosticErrorCode(err)}`);
                        userComposing = true;
                    }
                }
                if (userComposing) {
                    dbg(`skip request=${requestID} reason=user composing`);
                    pending.status = 'cancelled';
                    if (pendingRequests.get(requestID) === pending)
                        pendingRequests.delete(requestID);
                    deleteLockfile(lockPath, dbg);
                    return;
                }
                if (lockMissing && !canUseDraftCoordination(effectiveConfigDir, dbg)) {
                    dbg(`skip request=${requestID} reason=draft-coordination-unavailable`);
                    pending.status = 'cancelled';
                    if (pendingRequests.get(requestID) === pending)
                        pendingRequests.delete(requestID);
                    return;
                }
                if (pendingRequests.get(requestID) !== pending || pending.status !== 'firing') {
                    return;
                }
                try {
                    dbg(`reply attempt request=${requestID}`);
                    const internalClient = client?._client;
                    if (client?.question && typeof client.question.reply === 'function') {
                        const res = await client.question.reply({ requestID, answers: classification.answers });
                        if (res && typeof res === 'object') {
                            const outcome = res;
                            if (outcome.error) {
                                throw createDiagnosticError('native-reply-error');
                            }
                            if (outcome.ok === false) {
                                throw createDiagnosticError('native-reply-not-ok');
                            }
                        }
                    }
                    else if (internalClient && typeof internalClient.post === 'function') {
                        const res = await internalClient.post({
                            url: `/question/${encodeURIComponent(requestID)}/reply`,
                            body: { answers: pending.answers },
                        });
                        if (res && typeof res === 'object') {
                            if (res.error) {
                                throw createDiagnosticError('internal-reply-error');
                            }
                            if (res.ok === false) {
                                throw createDiagnosticError('internal-reply-not-ok');
                            }
                        }
                    }
                    else if (serverUrl) {
                        const url = new URL(String(serverUrl));
                        if (url.protocol === 'ws:')
                            url.protocol = 'http:';
                        else if (url.protocol === 'wss:')
                            url.protocol = 'https:';
                        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                            throw new Error(`unsupported server URL protocol: ${url.protocol}`);
                        }
                        const endpoint = `${url.origin}/question/${encodeURIComponent(requestID)}/reply${url.search}`;
                        const res = await fetch(endpoint, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ answers: pending.answers }),
                        });
                        if (!res.ok) {
                            throw createDiagnosticError(`HTTP_${res.status}`);
                        }
                    }
                    else {
                        throw createDiagnosticError('no-reply-transport');
                    }
                    pending.status = 'replied';
                    consumeActiveHandoff(sessionID);
                    sessionChains.delete(sessionID);
                    dbg(`reply OK request=${requestID}`);
                    deleteLockfile(lockPath, dbg);
                }
                catch (err) {
                    const code = diagnosticErrorCode(err);
                    dbg(`reply ERROR request=${requestID} code=${code}`);
                    console.error(`[smart-question] Auto-selection failed for question ${requestID} (${code})`);
                }
                finally {
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
                sessionChains.delete(sessionID);
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
            remediatedRequests.delete(requestID);
            deleteLockfile(resolveLockPath(effectiveConfigDir, requestID), dbg);
        }
    };
    const disposeHook = async () => {
        for (const pending of pendingRequests.values()) {
            clearTimeout(pending.timer);
            pending.status = 'cancelled';
        }
        pendingRequests.clear();
    };
    const guidance = buildRecommendationGuidance(config);
    const systemTransformHook = async (hookInput, output) => {
        if (!Array.isArray(output?.system))
            return;
        const sessionID = typeof hookInput?.sessionID === 'string' ? hookInput.sessionID : '';
        if (!(await isRootSession(sessionID)))
            return;
        if (!output.system.some((part) => part.includes(SQ_GUIDANCE_SENTINEL))) {
            output.system.push(guidance.system);
        }
    };
    const chatMessageHook = async (input, output) => {
        const sessionID = typeof input?.sessionID === 'string' ? input.sessionID : '';
        if (!sessionID || !(await isRootSession(sessionID)))
            return;
        const handoff = extractTrustedGuardianHandoff(output);
        if (handoff && typeof handoff === 'object' && 'version' in handoff) {
            setActiveHandoff(sessionID, handoff);
            dbg(`handoff received via chat.message session=${sessionID} handoffId=${handoff.handoffId} kind=${handoff.kind} autoSelect=${handoff.autoSelect}`);
        }
        else {
            const role = output?.message?.role ?? output?.message?.info?.role ?? output?.role;
            if (role === 'user') {
                invalidateActiveHandoff(sessionID);
                sessionChains.delete(sessionID);
                dbg(`invalidated stale handoff and reset unclassified chain on new user turn in chat.message session=${sessionID}`);
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
