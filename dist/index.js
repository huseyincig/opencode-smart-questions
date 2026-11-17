import { Plugin as OpenCodeV2 } from '@opencode/plugin';
import { hasSmartQuestionConfigOptions, resolveSmartQuestionConfig, } from './config.js';
import { buildRecommendationGuidance, SQ_GUIDANCE_SENTINEL } from './guidance.js';
import { isEligibleSessionInfo } from './session-scope.js';
import { clearActiveHandoff, consumeActiveHandoff, extractCurrentTurnGuardianHandoff, extractTrustedGuardianHandoff, invalidateActiveHandoff, isInternalNonHumanMessage, registerSmartQuestionsCapability, setActiveHandoff, } from './handoff.js';
export * from './types.js';
export { loadConfig, resolveSmartQuestionConfig, normalizeSmartQuestionConfig, DEFAULT_RECOMMENDED_MARKERS, DEFAULT_MANUAL_MARKERS, DEFAULT_MAX_UNCLASSIFIED_REMEDIATIONS, DEFAULT_CONFIG, } from './config.js';
export * from './detector.js';
export * from './guidance.js';
export { classifyV2Form, detectV2FormRecommendations, } from './form-adapter.js';
export { resolveLockPath, deleteLockfile, cleanupStaleDrafts, canUseDraftCoordination, } from './draft-guard.js';
export * from './backend.js';
export * from './handoff.js';
function sessionDirectoryFromInfo(sessionInfo, fallbackDirectory) {
    if (sessionInfo &&
        typeof sessionInfo === 'object' &&
        'location' in sessionInfo &&
        sessionInfo.location &&
        typeof sessionInfo.location === 'object' &&
        'directory' in sessionInfo.location &&
        typeof sessionInfo.location.directory === 'string') {
        return sessionInfo.location.directory;
    }
    return fallbackDirectory;
}
function eventSessionID(data) {
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
    const unregisterCapability = registerSmartQuestionsCapability();
    const registrations = [];
    const disposeRegistrations = async () => {
        for (const registration of registrations.splice(0).reverse()) {
            try {
                await registration.dispose();
            }
            catch {
                // Teardown is best effort; continue releasing the remaining resources.
            }
        }
    };
    const isSessionEligible = async (sessionID) => {
        if (!sessionID)
            return false;
        let sessionInfo;
        try {
            sessionInfo = await context.session.get({ sessionID });
        }
        catch {
            return false;
        }
        const dir = sessionDirectoryFromInfo(sessionInfo, context.location?.directory);
        const config = resolveSmartQuestionConfig(dir, pluginOptions);
        if (!config?.enabled)
            return false;
        return isEligibleSessionInfo(sessionInfo, config.includeSubagents === true);
    };
    try {
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
            const guidance = buildRecommendationGuidance(config);
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
            if (Array.isArray(event.messages)) {
                const handoff = extractCurrentTurnGuardianHandoff(event.messages);
                if (handoff) {
                    setActiveHandoff(sessionID, handoff);
                }
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
            const meta = event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)
                ? event.metadata
                : undefined;
            if (meta?.['opencode-guardian'] === true || meta?.['opencode-smart-questions'] === true) {
                return;
            }
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
                            const data = evt.data;
                            const sessionID = eventSessionID(data);
                            if (!sessionID)
                                continue;
                            if (eventType === 'session.synthetic') {
                                const handoff = extractTrustedGuardianHandoff(data);
                                if (handoff && (await isSessionEligible(sessionID))) {
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
                                    const handoff = extractTrustedGuardianHandoff(item);
                                    if (handoff && (await isSessionEligible(sessionID))) {
                                        setActiveHandoff(sessionID, handoff);
                                    }
                                }
                                else if (itemType === 'user' && !isInternalNonHumanMessage(item)) {
                                    invalidateActiveHandoff(sessionID);
                                }
                            }
                            else if (eventType === 'form.replied' || eventType === 'form.cancelled') {
                                consumeActiveHandoff(sessionID);
                            }
                            else if (eventType === 'session.deleted') {
                                clearActiveHandoff(sessionID);
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
        unregisterCapability();
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`[smart-question] V2 backend registration failed: ${message}`);
    }
    return async () => {
        try {
            await disposeRegistrations();
        }
        finally {
            unregisterCapability();
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
