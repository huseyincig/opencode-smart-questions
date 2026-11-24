export type SessionScope = 'root' | 'child' | 'automation' | 'unknown';
export declare function isAutomationSessionID(sessionID: unknown): boolean;
export declare function classifySessionScope(value: unknown): SessionScope;
export declare function isRootSessionInfo(value: unknown): boolean;
export declare function isEligibleSessionScope(scope: SessionScope, includeSubagents?: boolean): boolean;
export declare function isEligibleSessionInfo(value: unknown, includeSubagents?: boolean): boolean;
export declare function resolveV2SessionScope(sessionApi: unknown, sessionID: string): Promise<SessionScope>;
