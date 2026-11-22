export declare function diagnosticErrorCode(error: unknown): string;
export declare function createDiagnosticError(code: string): Error & {
    code: string;
};
export interface SmartQuestionDecisionRecord {
    formID: string;
    sessionID: string;
    status: 'auto' | 'manual' | 'unclassified' | 'unsupported' | 'replied' | 'cancelled' | 'error';
    reason?: string | undefined;
    matchedMarker?: string | undefined;
    timeoutMs?: number | undefined;
    timestamp: number;
}
export declare function recordSmartQuestionDecision(record: SmartQuestionDecisionRecord): void;
export declare function getRecentSmartQuestionDecisions(options?: {
    sessionID?: string | undefined;
    limit?: number | undefined;
}): SmartQuestionDecisionRecord[];
export declare function clearSmartQuestionDecisions(sessionID?: string): void;
