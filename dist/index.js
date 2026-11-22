import { Plugin as OpenCodeV2 } from '@opencode/plugin';
import { hasSmartQuestionConfigOptions, resolveSmartQuestionConfig, } from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { isEligibleSessionInfo } from './session-scope.js';
import { clearActiveHandoff, consumeActiveHandoff, extractCurrentTurnGuardianHandoff, extractTrustedGuardianHandoff, invalidateActiveHandoff, isFormRemediated, isInternalNonHumanMessage, registerSmartQuestionsCapability, setActiveHandoff, unmarkFormRemediated, } from './handoff.js';
import { acquireSessionLease, forgetMeshSession, isTrustedMeshMessage, registerMeshStateRpc, resolveMeshAgentProfile, } from './bridge.js';
export * from './types.js';
export { loadConfig, resolveSmartQuestionConfig, normalizeSmartQuestionConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_MANUAL_MARKERS, DEFAULT_MANUAL_ON_PATTERNS, DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS, DEFAULT_CONFIG, } from './config.js';
export { recordSmartQuestionDecision, getRecentSmartQuestionDecisions, clearSmartQuestionDecisions, } from './diagnostics.js';
export * from './detector.js';
export * from './guidance.js';
export { classifyV2Form, detectV2FormRecommendations, } from './form-adapter.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, canUseDraftCoordination, } from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
export { acquireSessionLease, getBlockingSessionLease, isSessionWaitingOnUser, formatMeshHandoff, parseMeshHandoff, stampMeshMetadata, verifyMeshMetadata, isTrustedMeshMessage, forgetMeshSession, extractTrustedMeshHandoff, extractCurrentTurnMeshHandoff, setActiveMeshHandoff, getActiveMeshHandoff, consumeActiveMeshHandoff, clearActiveMeshHandoff, registerMeshPeer, getMeshPeers, hasMeshCapability, registerMeshStateRpc, callMeshRpc, MESH_STATE_RPC_DEFINITION, MESH_STATE_RPC_ID, resetMeshStateForTests, resolveMeshAgentProfile, } from './bridge.js';
const MAX_BOUNDED_ENTRIES = 512;
function setBoundedMap(map, key, value, max = MAX_BOUNDED_ENTRIES, onEvict) {
    if (map.has(key)) {
        map.delete(key);
    }
    map.set(key, value);
    while (map.size > max) {
        const oldestKey = map.keys().next().value;
        if (oldestKey === undefined)
            break;
        const oldestValue = map.get(oldestKey);
        map.delete(oldestKey);
        onEvict?.(oldestKey, oldestValue);
    }
}
function sessionDirectoryFromInfo(sessionInfo, fallbackDirectory) {
    if (sessionInfo && typeof sessionInfo === 'object') {
        const record = sessionInfo;
        if (record.location &&
            typeof record.location === 'object' &&
            typeof record.location.directory === 'string') {
            return record.location.directory;
        }
        if (typeof record.directory === 'string' && record.directory) {
            return record.directory;
        }
    }
    return fallbackDirectory;
}
function eventSessionID(data, eventType) {
    if (!data || typeof data !== 'object')
        return '';
    const record = data;
    if (typeof record.sessionID === 'string')
        return record.sessionID;
    if (record.form &&
        typeof record.form === 'object' &&
        typeof record.form.sessionID === 'string') {
        return record.form.sessionID;
    }
    if (record.item &&
        typeof record.item === 'object' &&
        typeof record.item.sessionID === 'string') {
        return record.item.sessionID;
    }
    if (record.info &&
        typeof record.info === 'object' &&
        typeof record.info.id === 'string') {
        return record.info.id;
    }
    if (record.session &&
        typeof record.session === 'object' &&
        typeof record.session.id === 'string') {
        return record.session.id;
    }
    if (eventType === 'session.deleted' && typeof record.id === 'string') {
        return record.id;
    }
    return '';
}
function eventFormID(data) {
    if (!data || typeof data !== 'object')
        return '';
    const record = data;
    if (typeof record.formID === 'string')
        return record.formID;
    if (typeof record.id === 'string')
        return record.id;
    if (record.form &&
        typeof record.form === 'object' &&
        typeof record.form.id === 'string') {
        return record.form.id;
    }
    return '';
}
function sleepWithAbort(ms, signal) {
    if (signal.aborted)
        return Promise.resolve(false);
    return new Promise((resolve) => {
        const onAbort = () => {
            clearTimeout(timer);
            resolve(false);
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve(!signal.aborted);
        }, ms);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
const setupV2 = async (context) => {
    if (!context ||
        typeof context !== 'object' ||
        typeof context.session?.hook !== 'function' ||
        typeof context.session?.get !== 'function') {
        return;
    }
    const pluginOptions = context.options;
    if (typeof pluginOptions?.resolveConfig !== 'function' &&
        hasSmartQuestionConfigOptions(pluginOptions)) {
        const explicitConfig = resolveSmartQuestionConfig(context.location?.directory, pluginOptions);
        if (!explicitConfig?.enabled)
            return;
    }
    const activeInteractionLeases = new Map();
    const formSessionByFormID = new Map();
    const activeFormBySession = new Map();
    const releaseInteractionLease = (sessionID) => {
        const release = activeInteractionLeases.get(sessionID);
        if (release) {
            activeInteractionLeases.delete(sessionID);
            release();
        }
        activeFormBySession.delete(sessionID);
        for (const [fId, sId] of formSessionByFormID.entries()) {
            if (sId === sessionID) {
                formSessionByFormID.delete(fId);
            }
        }
    };
    const capabilityDisposersByDir = new Map();
    const ensureDirectoryCapability = (directory) => {
        const key = typeof directory === 'string' && directory.trim() ? directory.trim() : '*';
        if (capabilityDisposersByDir.has(key))
            return;
        setBoundedMap(capabilityDisposersByDir, key, registerSmartQuestionsCapability(directory, (sessionID) => {
            releaseInteractionLease(sessionID);
        }), MAX_BOUNDED_ENTRIES, (_k, dispose) => {
            try {
                dispose();
            }
            catch { }
        });
    };
    const disposeCapabilities = () => {
        for (const dispose of Array.from(capabilityDisposersByDir.values()).reverse()) {
            try {
                dispose();
            }
            catch { }
        }
        capabilityDisposersByDir.clear();
    };
    ensureDirectoryCapability(context.location?.directory);
    const registrations = [];
    const disposeRegistrations = async () => {
        for (const release of activeInteractionLeases.values()) {
            try {
                release();
            }
            catch { }
        }
        activeInteractionLeases.clear();
        formSessionByFormID.clear();
        activeFormBySession.clear();
        for (const registration of registrations.splice(0).reverse()) {
            try {
                await registration.dispose();
            }
            catch {
                // Teardown is best effort; continue releasing the remaining resources.
            }
        }
    };
    const resolveEligibleSessionConfig = async (sessionID, eventDirectory) => {
        if (!sessionID)
            return null;
        let sessionInfo;
        try {
            sessionInfo = await context.session.get({ sessionID });
        }
        catch {
            return null;
        }
        const dir = sessionDirectoryFromInfo(sessionInfo, eventDirectory ?? context.location?.directory);
        const config = resolveSmartQuestionConfig(dir, pluginOptions);
        if (!config?.enabled)
            return null;
        if (!isEligibleSessionInfo(sessionInfo, config.includeSubagents === true)) {
            return null;
        }
        ensureDirectoryCapability(dir);
        return config;
    };
    const isSessionEligible = async (sessionID, eventDirectory) => (await resolveEligibleSessionConfig(sessionID, eventDirectory)) !== null;
    try {
        if (typeof context.rpc?.register === 'function') {
            const rpcObj = context.rpc;
            const disposeMeshRpc = await registerMeshStateRpc({
                rpcRegister: rpcObj.register.bind(rpcObj),
                owner: 'opencode-smart-questions',
                directory: context.location?.directory,
            });
            registrations.push({ dispose: disposeMeshRpc });
        }
        const contextRegistration = await context.session.hook('context', async (event) => {
            const sessionID = String(event.sessionID ?? '');
            if (!sessionID)
                return;
            let sessionInfo;
            try {
                sessionInfo = await context.session.get({ sessionID });
            }
            catch {
                return;
            }
            const sessionDirectory = sessionDirectoryFromInfo(sessionInfo, context.location?.directory);
            const config = resolveSmartQuestionConfig(sessionDirectory, pluginOptions);
            if (!config?.enabled)
                return;
            if (!isEligibleSessionInfo(sessionInfo, config.includeSubagents === true))
                return;
            ensureDirectoryCapability(sessionDirectory);
            let skipGuidanceForHiWorker = false;
            if (config.includeSubagents === true) {
                const profile = await resolveMeshAgentProfile(sessionID, sessionDirectory);
                if (profile?.managedBy === 'opencode-hi' &&
                    profile.access &&
                    profile.access !== 'primary') {
                    skipGuidanceForHiWorker = true;
                }
            }
            if (!skipGuidanceForHiWorker && config.guidanceMode !== 'off') {
                const guidance = buildRecommendationGuidance(config);
                if (guidance.system) {
                    if (!Array.isArray(event.system)) {
                        event.system = [];
                    }
                    const alreadyInjected = event.system.some((part) => part.type === 'text' &&
                        typeof part.text === 'string' &&
                        part.text.includes(SQ_GUIDANCE_SENTINEL));
                    if (!alreadyInjected) {
                        event.system.push({
                            type: 'text',
                            text: guidance.system,
                        });
                    }
                }
            }
            let handoff = Array.isArray(event.messages)
                ? extractCurrentTurnGuardianHandoff(event.messages, sessionID)
                : null;
            if (!handoff && Array.isArray(event.system)) {
                for (let i = event.system.length - 1; i >= 0; i--) {
                    const part = event.system[i];
                    if (part?.type === 'text' &&
                        typeof part.text === 'string' &&
                        !part.text.includes(SQ_GUIDANCE_SENTINEL) &&
                        part.text.includes('[OPENCODE_HANDOFF:v1]')) {
                        const parsed = extractTrustedGuardianHandoff(part, sessionID);
                        if (parsed) {
                            handoff = parsed;
                            break;
                        }
                    }
                }
            }
            if (handoff) {
                setActiveHandoff(sessionID, handoff);
            }
        });
        if (!contextRegistration || typeof contextRegistration.dispose !== 'function') {
            throw new Error('V2 context hook did not return a valid registration');
        }
        registrations.push(contextRegistration);
        const promptRegistration = await context.session.hook('prompt', async (event) => {
            const sessionID = String(event.sessionID ?? '');
            if (!sessionID)
                return;
            if (!(await isSessionEligible(sessionID)))
                return;
            const meta = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
                ? event.metadata
                : undefined;
            if (meta?.['opencode-guardian'] === true ||
                meta?.['opencode-smart-questions'] === true ||
                isInternalNonHumanMessage(event, sessionID) ||
                isTrustedMeshMessage(event, sessionID)) {
                return;
            }
            releaseInteractionLease(sessionID);
            invalidateActiveHandoff(sessionID);
        });
        if (!promptRegistration || typeof promptRegistration.dispose !== 'function') {
            throw new Error('V2 prompt hook did not return a valid registration');
        }
        registrations.push(promptRegistration);
        if (typeof context.event?.subscribe === 'function') {
            const eventController = new AbortController();
            registrations.push({
                dispose: async () => {
                    eventController.abort();
                },
            });
            void (async () => {
                let attempt = 0;
                while (!eventController.signal.aborted) {
                    try {
                        const stream = context.event.subscribe({ signal: eventController.signal });
                        for await (const evt of stream) {
                            if (eventController.signal.aborted)
                                break;
                            attempt = 0;
                            if (!evt || typeof evt !== 'object')
                                continue;
                            const eventType = evt.type;
                            const eventLocationDir = evt.location?.directory;
                            const eventDir = typeof eventLocationDir === 'string' ? eventLocationDir : undefined;
                            const data = evt.data ??
                                evt.properties;
                            const formID = eventFormID(data);
                            const sessionID = eventSessionID(data, eventType) ||
                                (formID ? (formSessionByFormID.get(formID) ?? '') : '');
                            if (!sessionID)
                                continue;
                            if (eventType === 'session.synthetic') {
                                const handoff = extractTrustedGuardianHandoff(data, sessionID);
                                if (handoff && (await isSessionEligible(sessionID, eventDir))) {
                                    setActiveHandoff(sessionID, handoff);
                                }
                            }
                            else if (eventType === 'session.inbox.enqueued') {
                                const item = data && typeof data === 'object'
                                    ? data.item
                                    : undefined;
                                const itemType = item && typeof item === 'object'
                                    ? item.type
                                    : undefined;
                                if (itemType === 'synthetic') {
                                    const handoff = extractTrustedGuardianHandoff(item, sessionID);
                                    if (handoff && (await isSessionEligible(sessionID, eventDir))) {
                                        setActiveHandoff(sessionID, handoff);
                                    }
                                }
                                else if (itemType === 'user' && !isInternalNonHumanMessage(item, sessionID)) {
                                    releaseInteractionLease(sessionID);
                                    invalidateActiveHandoff(sessionID);
                                }
                            }
                            else if (eventType === 'form.created') {
                                const sessionConfig = await resolveEligibleSessionConfig(sessionID, eventDir);
                                if (sessionConfig) {
                                    const existingRelease = activeInteractionLeases.get(sessionID);
                                    if (existingRelease) {
                                        activeInteractionLeases.delete(sessionID);
                                        existingRelease();
                                    }
                                    if (formID) {
                                        setBoundedMap(formSessionByFormID, formID, sessionID);
                                        setBoundedMap(activeFormBySession, sessionID, formID);
                                    }
                                    else {
                                        activeFormBySession.delete(sessionID);
                                    }
                                    setBoundedMap(activeInteractionLeases, sessionID, acquireSessionLease({
                                        sessionID,
                                        owner: 'opencode-smart-questions',
                                        kind: 'user_interaction',
                                        ttlMs: Math.max((sessionConfig.timeoutMs ?? 0) + 15_000, 120_000),
                                        reason: 'form-created',
                                    }), MAX_BOUNDED_ENTRIES, (_k, release) => {
                                        try {
                                            release();
                                        }
                                        catch { }
                                    });
                                }
                            }
                            else if (eventType === 'form.replied' || eventType === 'form.cancelled') {
                                const activeFormID = activeFormBySession.get(sessionID);
                                if (formID && activeFormID && activeFormID !== formID) {
                                    formSessionByFormID.delete(formID);
                                    unmarkFormRemediated(formID);
                                }
                                else if (eventType === 'form.cancelled' &&
                                    isFormRemediated(formID || activeFormID, sessionID)) {
                                    if (formID) {
                                        formSessionByFormID.delete(formID);
                                        unmarkFormRemediated(formID);
                                    }
                                    else if (activeFormID) {
                                        unmarkFormRemediated(activeFormID);
                                    }
                                    const existingRelease = activeInteractionLeases.get(sessionID);
                                    if (existingRelease) {
                                        activeInteractionLeases.delete(sessionID);
                                        existingRelease();
                                    }
                                    setBoundedMap(activeInteractionLeases, sessionID, acquireSessionLease({
                                        sessionID,
                                        owner: 'opencode-smart-questions',
                                        kind: 'user_interaction',
                                        ttlMs: 45_000,
                                        reason: `remediation:${formID || activeFormID || sessionID}`,
                                    }), MAX_BOUNDED_ENTRIES, (_k, release) => {
                                        try {
                                            release();
                                        }
                                        catch { }
                                    });
                                }
                                else {
                                    if (formID) {
                                        formSessionByFormID.delete(formID);
                                        unmarkFormRemediated(formID);
                                    }
                                    releaseInteractionLease(sessionID);
                                    consumeActiveHandoff(sessionID);
                                }
                            }
                            else if (eventType === 'session.deleted') {
                                releaseInteractionLease(sessionID);
                                clearActiveHandoff(sessionID);
                                forgetMeshSession(sessionID);
                            }
                        }
                    }
                    catch {
                        if (eventController.signal.aborted)
                            break;
                    }
                    if (eventController.signal.aborted)
                        break;
                    const backoffMs = Math.min(30_000, 250 * 2 ** Math.min(attempt, 10));
                    attempt += 1;
                    const shouldContinue = await sleepWithAbort(backoffMs, eventController.signal);
                    if (!shouldContinue)
                        break;
                }
            })();
        }
    }
    catch (error) {
        await disposeRegistrations();
        disposeCapabilities();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[smart-question] V2 backend registration failed: ${message}`);
    }
    return async () => {
        try {
            await disposeRegistrations();
        }
        finally {
            disposeCapabilities();
        }
    };
};
/**
 * OpenCode v2 server plugin definition.
 */
export const OpencodeSmartQuestions = OpenCodeV2.define({
    id: 'opencode-smart-questions',
    setup: setupV2,
});
export default OpencodeSmartQuestions;
