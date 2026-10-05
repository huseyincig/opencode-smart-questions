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
