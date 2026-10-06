export type SessionScope = 'root' | 'child' | 'unknown';
export declare function classifySessionScope(value: unknown): SessionScope;
export declare function isRootSessionInfo(value: unknown): boolean;
export declare function resolveV1SessionScope(client: unknown, sessionID: string, directory?: string): Promise<SessionScope>;
export declare function resolveV2SessionScope(sessionApi: unknown, sessionID: string): Promise<SessionScope>;
