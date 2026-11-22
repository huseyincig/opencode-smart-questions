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

function isSafeInternalCode(code: string): boolean {
  return INTERNAL_CODES.has(code) || /^HTTP_[1-5]\d\d$/.test(code);
}

export function diagnosticErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (
      typeof code === 'string' &&
      (OS_CODES.has(code) ||
        ((error as { name?: unknown }).name === 'SmartQuestionError' &&
          isSafeInternalCode(code)))
    ) {
      return code;
    }

    if (error instanceof SyntaxError) return 'syntax-error';
    if (error instanceof TypeError) return 'type-error';
    if (error instanceof RangeError) return 'range-error';
    if (error instanceof Error) return 'error';
    return 'object-error';
  }

  if (typeof error === 'string') return 'string-error';
  if (error === null) return 'null-error';
  if (error === undefined) return 'undefined-error';
  return `${typeof error}-error`;
}

export function createDiagnosticError(code: string): Error & { code: string } {
  const safeCode = isSafeInternalCode(code) ? code : 'reply-failed';
  const error = new Error('Smart Question operation failed') as Error & { code: string };
  error.name = 'SmartQuestionError';
  error.code = safeCode;
  return error;
}

export interface SmartQuestionDecisionRecord {
  formID: string;
  sessionID: string;
  status: 'auto' | 'manual' | 'unclassified' | 'unsupported' | 'replied' | 'cancelled' | 'error';
  reason?: string | undefined;
  matchedMarker?: string | undefined;
  timeoutMs?: number | undefined;
  timestamp: number;
}

const DECISION_STATE_SYMBOL = Symbol.for('opencode.smart-questions.decisions.v1');
const MAX_DECISION_HISTORY = 128;

function getDecisionStore(): SmartQuestionDecisionRecord[] {
  const g = globalThis as unknown as {
    [DECISION_STATE_SYMBOL]?: SmartQuestionDecisionRecord[];
  };
  if (!Array.isArray(g[DECISION_STATE_SYMBOL])) {
    g[DECISION_STATE_SYMBOL] = [];
  }
  return g[DECISION_STATE_SYMBOL]!;
}

export function recordSmartQuestionDecision(record: SmartQuestionDecisionRecord): void {
  if (!record || typeof record.formID !== 'string' || typeof record.sessionID !== 'string') return;
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

export function getRecentSmartQuestionDecisions(options?: {
  sessionID?: string | undefined;
  limit?: number | undefined;
}): SmartQuestionDecisionRecord[] {
  const store = getDecisionStore();
  const filtered =
    options?.sessionID && typeof options.sessionID === 'string'
      ? store.filter((item) => item.sessionID === options.sessionID)
      : [...store];
  const limit =
    typeof options?.limit === 'number' && options.limit > 0
      ? Math.floor(options.limit)
      : filtered.length;
  return filtered.slice(-limit);
}

export function clearSmartQuestionDecisions(sessionID?: string): void {
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
