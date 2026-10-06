/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */
export declare const OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
export declare const GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
export declare const DEFAULT_HANDOFF_TTL_MS = 120000;
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
export interface ParseHandoffOptions {
    requireRemediationMarker?: boolean;
}
export interface ExtractHandoffOptions {
    requireRemediationMarker?: boolean;
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
export declare function parseOpenCodeHandoff(text: unknown, options?: ParseHandoffOptions | boolean): OpenCodeHandoff | Record<string, unknown> | null;
/**
 * Format an OpenCode handoff descriptor to the versioned text protocol block.
 */
export declare function formatOpenCodeHandoff(handoff: unknown): string | Record<string, unknown>;
/**
 * Extract an OpenCode handoff from an array of message parts.
 * By default enforces that the message contains the Guardian remediation marker (anti-spoofing).
 */
export declare function extractHandoffFromParts(parts: unknown, options?: ExtractHandoffOptions | boolean): OpenCodeHandoff | Record<string, unknown> | null;
/**
 * Store an active handoff for a session.
 * Fails safe and ignores already-consumed handoff IDs to prevent loops.
 */
export declare function setActiveHandoff(sessionID: unknown, handoff?: unknown, timestamp?: number): boolean | Record<string, unknown>;
/**
 * Retrieve the active handoff for a session, if any.
 * Automatically discards entries older than maxAgeMs (default 120s TTL).
 */
export declare function getActiveHandoff(sessionID: unknown, maxAgeMs?: number): OpenCodeHandoff | Record<string, unknown> | undefined;
/**
 * Check if automatic selection is permitted under the current handoff for this session.
 * Returns false if an active handoff requires explicit human approval (autoSelect === 'forbidden').
 */
export declare function isHandoffAutoSelectAllowed(sessionID: unknown, maxAgeMs?: number): boolean | Record<string, unknown>;
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
