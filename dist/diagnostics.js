const INTERNAL_CODES = new Set([
    'native-reply-error',
    'native-reply-not-ok',
    'internal-reply-error',
    'internal-reply-not-ok',
    'no-reply-transport',
    'reply-failed',
]);
const OS_CODES = new Set([
    'EACCES',
    'EPERM',
    'ENOENT',
    'EEXIST',
    'ENOTDIR',
    'EISDIR',
    'EROFS',
    'ENOSPC',
    'EMFILE',
    'ENFILE',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
    'EPIPE',
    'ABORT_ERR',
]);
function isSafeInternalCode(code) {
    return INTERNAL_CODES.has(code) || /^HTTP_[1-5]\d\d$/.test(code);
}
export function diagnosticErrorCode(error) {
    if (error && typeof error === 'object') {
        const code = error.code;
        if (typeof code === 'string' &&
            (OS_CODES.has(code) ||
                (error.name === 'SmartQuestionError' &&
                    isSafeInternalCode(code)))) {
            return code;
        }
        if (error instanceof SyntaxError)
            return 'syntax-error';
        if (error instanceof TypeError)
            return 'type-error';
        if (error instanceof RangeError)
            return 'range-error';
        if (error instanceof Error)
            return 'error';
        return 'object-error';
    }
    if (typeof error === 'string')
        return 'string-error';
    if (error === null)
        return 'null-error';
    if (error === undefined)
        return 'undefined-error';
    return `${typeof error}-error`;
}
export function createDiagnosticError(code) {
    const safeCode = isSafeInternalCode(code) ? code : 'reply-failed';
    const error = new Error('Smart Question operation failed');
    error.name = 'SmartQuestionError';
    error.code = safeCode;
    return error;
}
const DECISION_STATE_SYMBOL = Symbol.for('opencode.smart-questions.decisions.v1');
const MAX_DECISION_HISTORY = 128;
function getDecisionStore() {
    const g = globalThis;
    if (!Array.isArray(g[DECISION_STATE_SYMBOL])) {
        g[DECISION_STATE_SYMBOL] = [];
    }
    return g[DECISION_STATE_SYMBOL];
}
export function recordSmartQuestionDecision(record) {
    if (!record || typeof record.formID !== 'string' || typeof record.sessionID !== 'string')
        return;
    const store = getDecisionStore();
    store.push({
        formID: record.formID,
        sessionID: record.sessionID,
        status: record.status,
        ...(record.reason ? { reason: record.reason } : {}),
        ...(record.matchedMarker ? { matchedMarker: record.matchedMarker } : {}),
        ...(typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : {}),
        timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
    });
    while (store.length > MAX_DECISION_HISTORY) {
        store.shift();
    }
}
export function getRecentSmartQuestionDecisions(options) {
    const store = getDecisionStore();
    const filtered = options?.sessionID && typeof options.sessionID === 'string'
        ? store.filter((item) => item.sessionID === options.sessionID)
        : [...store];
    const limit = typeof options?.limit === 'number' && options.limit > 0
        ? Math.floor(options.limit)
        : filtered.length;
    return filtered.slice(-limit);
}
export function clearSmartQuestionDecisions(sessionID) {
    const store = getDecisionStore();
    if (!sessionID) {
        store.length = 0;
        return;
    }
    for (let i = store.length - 1; i >= 0; i--) {
        if (store[i]?.sessionID === sessionID) {
            store.splice(i, 1);
        }
    }
}
