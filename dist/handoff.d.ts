/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */
export declare const OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
export type HandoffKind = 'clarification' | 'choice' | 'approval';
export type HandoffAutoSelect = 'allowed' | 'forbidden';
export interface OpenCodeHandoff {
    version: 'v1';
    source: 'guardian';
    action: 'question_required';
    kind: HandoffKind;
    autoSelect: HandoffAutoSelect;
    handoffId: string;
}
export declare const COORDINATION_SYMBOL: unique symbol;
export interface OpenCodeCoordinationRegistry {
    guardian?: {
        version: number;
        supportsHandoff: boolean;
    };
    smartQuestions?: {
        version: number;
        mainAgentOnly?: boolean;
        supportsAutoSelect?: boolean;
    };
}
/**
 * Register Smart Questions capability in the global OpenCode coordination registry.
 */
export declare function registerSmartQuestionsCapability(arg?: unknown): void | Record<string, unknown>;
/**
 * Check if Guardian is registered in the in-process capability registry.
 */
export declare function getGuardianCapability(arg?: unknown): OpenCodeCoordinationRegistry['guardian'] | Record<string, unknown> | undefined;
/**
 * Parse an OpenCode handoff block from remediation or message text.
 */
export declare function parseOpenCodeHandoff(text: unknown): OpenCodeHandoff | Record<string, unknown> | null;
/**
 * Format an OpenCode handoff descriptor to the versioned text protocol block.
 */
export declare function formatOpenCodeHandoff(handoff: unknown): string | Record<string, unknown>;
/**
 * Extract an OpenCode handoff from an array of message parts.
 */
export declare function extractHandoffFromParts(parts: unknown): OpenCodeHandoff | Record<string, unknown> | null;
/**
 * Store an active handoff for a session.
 * Fails safe and ignores already-consumed handoff IDs to prevent loops.
 */
export declare function setActiveHandoff(sessionID: unknown, handoff?: unknown): boolean | Record<string, unknown>;
/**
 * Retrieve the active handoff for a session, if any.
 */
export declare function getActiveHandoff(sessionID: unknown): OpenCodeHandoff | Record<string, unknown> | undefined;
/**
 * Check if automatic selection is permitted under the current handoff for this session.
 * Returns false if an active handoff requires explicit human approval (autoSelect === 'forbidden').
 */
export declare function isHandoffAutoSelectAllowed(sessionID: unknown): boolean | Record<string, unknown>;
/**
 * Mark an active handoff as consumed and remove it from active tracking.
 */
export declare function consumeActiveHandoff(sessionID: unknown): OpenCodeHandoff | Record<string, unknown> | undefined;
/**
 * Clear the active handoff for a session without adding it to consumed history.
 */
export declare function clearActiveHandoff(sessionID: unknown): void | Record<string, unknown>;
/**
 * Reset all handoff tracking state (primarily for test isolation).
 */
export declare function resetHandoffTracking(arg?: unknown): void | Record<string, unknown>;
