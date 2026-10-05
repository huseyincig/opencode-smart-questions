export declare function diagnosticErrorCode(error: unknown): string;
export declare function createDiagnosticError(code: string): Error & {
    code: string;
};
