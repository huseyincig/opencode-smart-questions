/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */
export declare const OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
export declare const GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
export declare const GUARDIAN_PROVENANCE_KEY = "opencode-guardian";
export declare const GUARDIAN_PROVENANCE_TOKEN_KEY = "opencode-guardian-provenance";
export declare const GUARDIAN_KIND_KEY = "opencode-guardian-kind";
export declare const DEFAULT_HANDOFF_TTL_MS = 120000;
export declare const CLOSED_HANDOFF_TTL_MS: number;
export declare const MAX_CLOSED_HANDOFF_IDS = 512;
export declare const MAX_ACTIVE_HANDOFFS = 512;
export type HandoffKind = 'clarification' | 'choice' | 'approval';
export type HandoffAutoSelect = 'allowed' | 'forbidden';
export interface OpenCodeHandoff {
    version: 'v1';
    source: string;
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
    requireGuardianProvenance?: boolean;
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
export declare function isInternalNonHumanMessage(value: unknown): boolean;
export declare function registerSmartQuestionsCapability(directory?: string): () => void;
/**
 * Check if Guardian is registered in the in-process capability registry.
 */
export declare function getGuardianCapability(): OpenCodeCoordinationRegistry['guardian'] | undefined;
/**
 * Parse a syntactically valid OpenCode handoff block.
 * This is a pure protocol parser; callers handling untrusted messages must use
 * extractTrustedGuardianHandoff() or extractHandoffFromParts() with provenance enabled.
 */
export declare function parseOpenCodeHandoff(text: unknown, options?: ParseHandoffOptions | boolean): OpenCodeHandoff | null;
/**
 * Format an OpenCode handoff descriptor to the versioned text protocol block.
 */
export declare function formatOpenCodeHandoff(handoff: Omit<OpenCodeHandoff, 'version' | 'source'> | OpenCodeHandoff): string;
/**
 * Extract a handoff from V1-style message parts.
 * Marker and host provenance are both required by default.
 */
export declare function extractHandoffFromParts(parts: unknown, options?: ExtractHandoffOptions | boolean): OpenCodeHandoff | null;
/**
 * Extract a Guardian or mesh handoff only when the host object carries trusted provenance.
 * Supports V1 part metadata and V2 synthetic/message metadata without importing sibling plugins.
 */
export declare function extractTrustedGuardianHandoff(source: unknown): OpenCodeHandoff | null;
/**
 * Return the latest trusted Guardian handoff in the current human turn.
 * Scanning stops at the first newer ordinary user message, so an older
 * remediation cannot be resurrected for a later user request.
 */
export declare function extractCurrentTurnGuardianHandoff(messages: unknown): OpenCodeHandoff | null;
/**
 * Store an active handoff for a session.
 * Fails safe and ignores recently closed handoff IDs to prevent replay loops.
 */
export declare function setActiveHandoff(sessionID: string, handoff: OpenCodeHandoff, timestamp?: number): boolean;
/**
 * Retrieve the active handoff for a session, if any.
 * Expired IDs are closed so message-history fallback cannot revive them.
 */
export declare function getActiveHandoff(sessionID: string, maxAgeMs?: number): OpenCodeHandoff | undefined;
/**
 * Check if automatic selection is permitted under the current handoff for this session.
 */
export declare function isHandoffAutoSelectAllowed(sessionID: string, maxAgeMs?: number): boolean;
/**
 * Mark an active handoff as consumed and prevent immediate replay.
 */
export declare function consumeActiveHandoff(sessionID: string): OpenCodeHandoff | undefined;
/**
 * Invalidate an active handoff because its human turn ended.
 * Unlike a plain clear, invalidation also prevents history-based resurrection.
 */
export declare function invalidateActiveHandoff(sessionID: string): OpenCodeHandoff | undefined;
/**
 * Clear the active handoff for a session without closing its ID.
 * Use invalidateActiveHandoff() when a new human turn makes replay invalid.
 */
export declare function clearActiveHandoff(sessionID: string): void;
/**
 * Reset all handoff tracking state (primarily for test isolation).
 */
export declare function resetHandoffTracking(): void;
