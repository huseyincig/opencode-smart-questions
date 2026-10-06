/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */
export const OPENCODE_HANDOFF_HEADER = '[OPENCODE_HANDOFF:v1]';
export const GUARDIAN_REMEDIATION_MARKER = '[opencode-guardian remediation]';
export const DEFAULT_HANDOFF_TTL_MS = 120_000;
export const COORDINATION_SYMBOL = Symbol.for('opencode.coordination.v1');
function isPluginInput(arg) {
    return Boolean(arg &&
        typeof arg === 'object' &&
        ('client' in arg || 'directory' in arg || 'project' in arg));
}
/**
 * Register Smart Questions capability in the global OpenCode coordination registry.
 */
export function registerSmartQuestionsCapability(arg) {
    if (isPluginInput(arg))
        return {};
    const globalObj = globalThis;
    const root = (globalObj[COORDINATION_SYMBOL] ??= {});
    root.smartQuestions = {
        version: 1,
        mainAgentOnly: true,
        supportsAutoSelect: true,
    };
}
/**
 * Check if Guardian is registered in the in-process capability registry.
 */
export function getGuardianCapability(arg) {
    if (isPluginInput(arg))
        return {};
    const globalObj = globalThis;
    return globalObj[COORDINATION_SYMBOL]?.guardian;
}
/**
 * Parse an OpenCode handoff block from remediation or message text.
 */
export function parseOpenCodeHandoff(text, options) {
    if (isPluginInput(text))
        return {};
    if (typeof text !== 'string' || !text.includes(OPENCODE_HANDOFF_HEADER))
        return null;
    const requireMarker = typeof options === 'boolean'
        ? options
        : Boolean(options?.requireRemediationMarker);
    if (requireMarker && !text.includes(GUARDIAN_REMEDIATION_MARKER)) {
        return null;
    }
    const match = /\[OPENCODE_HANDOFF:v1\]\s*([\s\S]*?)(?:\n\n|\r\n\r\n|$)/.exec(text);
    if (!match || !match[1])
        return null;
    const lines = match[1].split(/\r?\n/);
    const map = new Map();
    for (const line of lines) {
        const eq = line.indexOf('=');
        if (eq > 0) {
            map.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
        }
    }
    const source = map.get('source');
    const action = map.get('action');
    const kind = map.get('kind');
    const autoSelect = map.get('auto_select');
    const handoffId = map.get('handoff_id');
    if (source !== 'guardian' || action !== 'question_required' || !handoffId) {
        return null;
    }
    if (kind !== 'clarification' && kind !== 'choice' && kind !== 'approval') {
        return null;
    }
    if (autoSelect !== 'allowed' && autoSelect !== 'forbidden') {
        return null;
    }
    return {
        version: 'v1',
        source: 'guardian',
        action: 'question_required',
        kind,
        autoSelect,
        handoffId,
    };
}
/**
 * Format an OpenCode handoff descriptor to the versioned text protocol block.
 */
export function formatOpenCodeHandoff(handoff) {
    if (isPluginInput(handoff))
        return {};
    const h = handoff;
    return [
        OPENCODE_HANDOFF_HEADER,
        'source=guardian',
        `action=${h.action}`,
        `kind=${h.kind}`,
        `auto_select=${h.autoSelect}`,
        `handoff_id=${h.handoffId}`,
    ].join('\n');
}
/**
 * Extract an OpenCode handoff from an array of message parts.
 * By default enforces that the message contains the Guardian remediation marker (anti-spoofing).
 */
export function extractHandoffFromParts(parts, options) {
    if (isPluginInput(parts))
        return {};
    if (!Array.isArray(parts))
        return null;
    const requireMarker = typeof options === 'boolean'
        ? options
        : (options?.requireRemediationMarker ?? true);
    if (requireMarker) {
        const hasRemediationMarker = parts.some((part) => Boolean(part &&
            typeof part === 'object' &&
            typeof part.text === 'string' &&
            part.text.includes(GUARDIAN_REMEDIATION_MARKER)));
        if (!hasRemediationMarker)
            return null;
    }
    for (const part of parts) {
        if (part && typeof part === 'object') {
            const text = part.text;
            if (typeof text === 'string') {
                const parsed = parseOpenCodeHandoff(text, false);
                if (parsed && typeof parsed === 'object' && 'version' in parsed) {
                    return parsed;
                }
            }
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// In-Memory Handoff Tracking & Loop Prevention (Process-wide Symbol State)
// ---------------------------------------------------------------------------
const HANDOFF_STATE_SYMBOL = Symbol.for('opencode.handoff.state.v1');
function getHandoffState() {
    const g = globalThis;
    return (g[HANDOFF_STATE_SYMBOL] ??= {
        activeHandoffsBySession: new Map(),
        consumedHandoffIds: new Set(),
    });
}
/**
 * Store an active handoff for a session.
 * Fails safe and ignores already-consumed handoff IDs to prevent loops.
 */
export function setActiveHandoff(sessionID, handoff, timestamp) {
    if (isPluginInput(sessionID))
        return {};
    const sID = String(sessionID ?? '');
    const h = handoff;
    if (!sID || !h?.handoffId)
        return false;
    const state = getHandoffState();
    if (state.consumedHandoffIds.has(h.handoffId)) {
        return false;
    }
    state.activeHandoffsBySession.set(sID, {
        handoff: h,
        createdAt: typeof timestamp === 'number' ? timestamp : Date.now(),
    });
    return true;
}
/**
 * Retrieve the active handoff for a session, if any.
 * Automatically discards entries older than maxAgeMs (default 120s TTL).
 */
export function getActiveHandoff(sessionID, maxAgeMs = DEFAULT_HANDOFF_TTL_MS) {
    if (isPluginInput(sessionID))
        return {};
    const sID = String(sessionID ?? '');
    if (!sID)
        return undefined;
    const state = getHandoffState();
    const entry = state.activeHandoffsBySession.get(sID);
    if (!entry)
        return undefined;
    const age = Date.now() - entry.createdAt;
    if (age > maxAgeMs) {
        state.activeHandoffsBySession.delete(sID);
        return undefined;
    }
    return entry.handoff;
}
/**
 * Check if automatic selection is permitted under the current handoff for this session.
 * Returns false if an active handoff requires explicit human approval (autoSelect === 'forbidden').
 */
export function isHandoffAutoSelectAllowed(sessionID, maxAgeMs = DEFAULT_HANDOFF_TTL_MS) {
    if (isPluginInput(sessionID))
        return {};
    const sID = String(sessionID ?? '');
    if (!sID)
        return true;
    const active = getActiveHandoff(sID, maxAgeMs);
    if (!active || typeof active !== 'object' || !('autoSelect' in active))
        return true;
    return active.autoSelect === 'allowed';
}
/**
 * Mark an active handoff as consumed and remove it from active tracking.
 */
export function consumeActiveHandoff(sessionID) {
    if (isPluginInput(sessionID))
        return {};
    const sID = String(sessionID ?? '');
    if (!sID)
        return undefined;
    const state = getHandoffState();
    const entry = state.activeHandoffsBySession.get(sID);
    if (entry) {
        state.consumedHandoffIds.add(entry.handoff.handoffId);
        state.activeHandoffsBySession.delete(sID);
        return entry.handoff;
    }
    return undefined;
}
/**
 * Clear the active handoff for a session without adding it to consumed history.
 */
export function clearActiveHandoff(sessionID) {
    if (isPluginInput(sessionID))
        return {};
    const sID = String(sessionID ?? '');
    if (!sID)
        return;
    getHandoffState().activeHandoffsBySession.delete(sID);
}
/**
 * Reset all handoff tracking state (primarily for test isolation).
 */
export function resetHandoffTracking(arg) {
    if (isPluginInput(arg))
        return {};
    const state = getHandoffState();
    state.activeHandoffsBySession.clear();
    state.consumedHandoffIds.clear();
}
