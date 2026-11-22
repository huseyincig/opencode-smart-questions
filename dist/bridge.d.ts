/**
 * OpenCode V2 Universal Plugin Mesh Bridge (v2)
 *
 * Zero-dependency, single-file interoperability module shared across OpenCode V2
 * plugins (`opencode-hi`, `opencode-guardian`, `opencode-smart-questions`,
 * `opencode-lazy-skill-engine`, `opencode-trim`, and future plugins).
 *
 * Design guarantees:
 * 1. Standalone-first: Every function degrades to a safe local default in 0ms
 *    when no sibling plugin is installed.
 * 2. N-Way Any-Combination ($2^N$): Plugins coordinate through 5 capability
 *    domains (`policy.gate`, `interaction.ask`, `orchestration.task`,
 *    `skills.catalog`, `context.prune`) rather than hardcoded plugin pairs.
 * 3. Cryptographic In-Process Provenance: Session-scoped tokens in the shared
 *    process ledger prevent LLM prompt injection from spoofing synthetic prompts,
 *    handoffs, or protected-part metadata.
 * 4. Backward-Compatible: Maintains `Symbol.for("opencode.coordination.v1")`,
 *    `Symbol.for("opencode.handoff.state.v1")`, `[OPENCODE_HANDOFF:v1]`, and
 *    legacy metadata keys (`opencode-guardian`, `opencode-smart-questions`,
 *    `lazySkill`, `hiOutput`).
 */
export declare const MESH_VERSION = 2;
export declare const BRIDGE_REVISION = "2.3.1";
export declare const MESH_SYMBOL: unique symbol;
export declare const LEGACY_COORDINATION_SYMBOL: unique symbol;
export declare const LEGACY_HANDOFF_STATE_SYMBOL: unique symbol;
export declare const MESH_METADATA_KEY = "opencode-mesh";
export declare const OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
export declare const GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
export declare const MESH_REMEDIATION_MARKER = "[opencode-mesh remediation]";
export declare const MESH_STATE_RPC_ID = "opencode-mesh.state";
export declare const DEFAULT_HANDOFF_TTL_MS = 120000;
export declare const CLOSED_HANDOFF_TTL_MS: number;
export declare const MAX_BOUNDED_SESSIONS = 512;
export declare const MAX_TOKENS_PER_SESSION = 128;
export type MeshCapability = "policy.gate" | "interaction.ask" | "orchestration.task" | "skills.catalog" | "context.prune";
export type MeshMessageKind = "remediation" | "visible" | "handoff" | "wake" | "delegation" | "task-contract" | "skill-injection" | "trimmed-output";
export type MeshLeaseKind = "user_interaction" | "active_remediation" | "orchestration_dispatch";
export type HandoffKind = "clarification" | "choice" | "approval";
export type HandoffAutoSelect = "allowed" | "forbidden";
export interface OpenCodeHandoff {
    version: "v1";
    source: string;
    action: "question_required";
    kind: HandoffKind;
    autoSelect: HandoffAutoSelect;
    handoffId: string;
}
export interface MeshPeerDescriptor {
    id: string;
    version: number;
    directory: string;
    capabilities: readonly MeshCapability[];
    metadata?: Record<string, unknown> | undefined;
}
export interface MeshMetadataEnvelope {
    v: 2;
    owner: string;
    kind: MeshMessageKind;
    token: string;
    synthetic?: boolean | undefined;
    protected?: boolean | undefined;
    sanitizedBy?: readonly string[] | undefined;
    boundedBy?: string | undefined;
    taskID?: string | undefined;
    requiredSkills?: readonly string[] | undefined;
}
export interface MeshStampOptions {
    owner: string;
    kind: MeshMessageKind;
    protected?: boolean | undefined;
    sanitizedBy?: readonly string[] | undefined;
    boundedBy?: string | undefined;
    taskID?: string | undefined;
    requiredSkills?: readonly string[] | undefined;
    synthetic?: boolean | undefined;
    legacyGuardian?: boolean | undefined;
}
export interface MeshSessionLease {
    sessionID: string;
    owner: string;
    kind: MeshLeaseKind;
    priority: number;
    acquiredAt: number;
    expiresAt: number;
    reason?: string | undefined;
}
export interface MeshAgentProfile {
    sessionID: string;
    agentName?: string | undefined;
    capability: "write-allowed" | "read-only" | "unknown";
    access?: "primary" | "read-write" | "read-only" | "unknown" | undefined;
    taskID?: string | undefined;
    requiredSkills?: readonly string[] | undefined;
    allowedSkills?: readonly string[] | undefined;
    defaultSkills?: readonly string[] | undefined;
    maxActiveSkills?: number | undefined;
    autoBind?: "off" | "workers" | "all" | undefined;
    managedBy: string;
}
export interface MeshInterventionRecord {
    sessionID: string;
    directory: string;
    owner: string;
    kind: "preflight-blocked" | "post-remediation" | "post-warning" | "stream-interrupt";
    ruleIds: readonly string[];
    deterministic: boolean;
    active: boolean;
    updatedAt: number;
    title?: string | undefined;
    message?: string | undefined;
}
export interface MeshSkillHit {
    id: string;
    name?: string | undefined;
    description?: string | undefined;
    scope: "native" | "vault" | "bundled";
    origin?: "host" | "project" | "global" | "bundled" | undefined;
    score: number;
    coverage?: number | undefined;
}
export interface MeshSkillCatalogProvider {
    owner: string;
    directory: string;
    search: (query: string, options?: {
        topK?: number;
        scope?: "native" | "vault";
        allowedIds?: ReadonlySet<string> | readonly string[];
    }) => Promise<readonly MeshSkillHit[]>;
}
export type MeshRoleProfileResolver = (sessionID: string, directory: string) => Promise<MeshAgentProfile | undefined> | MeshAgentProfile | undefined;
export declare const MESH_STATE_RPC_DEFINITION: {
    id: string;
    methods: {
        sessionState: {
            input: {
                type: string;
                properties: {
                    sessionID: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
            output: {
                type: string;
                properties: {
                    waitingOnUser: {
                        type: string;
                    };
                    remediating: {
                        type: string;
                    };
                    blockingOwner: {
                        type: string;
                    };
                    blockingKind: {
                        type: string;
                    };
                    activeHandoffId: {
                        type: string;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
        };
        setInteractionLease: {
            input: {
                type: string;
                properties: {
                    sessionID: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    owner: {
                        type: string;
                        minLength: number;
                        maxLength: number;
                    };
                    active: {
                        type: string;
                    };
                    ttlMs: {
                        type: string;
                    };
                    reason: {
                        type: string;
                        maxLength: number;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
            output: {
                type: string;
                properties: {
                    ok: {
                        type: string;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
        };
    };
    events: {
        updated: {
            schema: {
                type: string;
                properties: {
                    sessionID: {
                        type: string;
                    };
                    kind: {
                        type: string;
                    };
                };
                required: string[];
                additionalProperties: boolean;
            };
        };
    };
};
export declare function canonicalMeshDirectory(directory?: string): string;
export declare function registerMeshPeer(input: {
    id: string;
    capabilities: readonly MeshCapability[];
    directory?: string | undefined;
    version?: number | undefined;
    metadata?: Record<string, unknown> | undefined;
    onSessionForget?: ((sessionID: string) => void) | undefined;
}): () => void;
export declare function getMeshPeers(options?: {
    directory?: string | undefined;
    capability?: MeshCapability | undefined;
}): MeshPeerDescriptor[];
export declare function hasMeshCapability(capability: MeshCapability, directory?: string): boolean;
export declare function stampMeshMetadata(sessionID: string, options: MeshStampOptions, base?: Record<string, unknown>): Record<string, unknown>;
export declare function extractMetadataRecord(value: unknown): Record<string, unknown> | undefined;
export declare function verifyMeshMetadata(sessionID: string | undefined, valueOrMetadata: unknown, expectedKind?: MeshMessageKind | readonly MeshMessageKind[], expectedOwner?: string): boolean;
export declare function isTrustedMeshMessage(value: unknown, sessionID?: string, expectedKind?: MeshMessageKind | readonly MeshMessageKind[]): boolean;
export declare function isMeshProtectedPart(part: unknown, parentMessage?: unknown): boolean;
export declare function wasMeshSanitized(valueOrMetadata: unknown, owner?: string): boolean;
export declare function wasMeshBounded(valueOrMetadata: unknown): boolean;
export declare function forgetMeshSession(sessionID: string): void;
export declare function acquireSessionLease(input: {
    sessionID: string;
    owner: string;
    kind: MeshLeaseKind;
    ttlMs?: number | undefined;
    reason?: string | undefined;
}): () => void;
export declare function getBlockingSessionLease(sessionID: string, callerKind: MeshLeaseKind, callerOwner?: string): MeshSessionLease | undefined;
export declare function isSessionWaitingOnUser(sessionID: string): boolean;
export declare function isSessionRemediating(sessionID: string): boolean;
export declare function createMeshHandoffId(source: string, sessionID: string, turnKey: string, ruleOrReasonIds: readonly string[], sequence?: number): string;
export declare function formatMeshHandoff(handoff: Omit<OpenCodeHandoff, "version" | "source"> & {
    source?: string | undefined;
}): string;
export declare function parseMeshHandoff(text: unknown, options?: {
    requireRemediationMarker?: boolean;
    allowedSources?: readonly string[];
} | boolean): OpenCodeHandoff | null;
export declare function extractTrustedMeshHandoff(source: unknown, sessionID?: string): OpenCodeHandoff | null;
export declare function extractCurrentTurnMeshHandoff(messages: unknown, sessionID?: string): OpenCodeHandoff | null;
export declare function setActiveMeshHandoff(sessionID: string, handoff: OpenCodeHandoff, timestamp?: number): boolean;
export declare function getActiveMeshHandoff(sessionID: string, maxAgeMs?: number): OpenCodeHandoff | undefined;
export declare function consumeActiveMeshHandoff(sessionID: string): OpenCodeHandoff | undefined;
export declare function invalidateActiveMeshHandoff(sessionID: string): OpenCodeHandoff | undefined;
export declare function clearActiveMeshHandoff(sessionID: string): void;
export declare function registerRoleProfileResolver(input: {
    owner: string;
    directory?: string | undefined;
    resolve: MeshRoleProfileResolver;
}): () => void;
export declare function resolveMeshAgentProfile(sessionID: string, directory?: string): Promise<MeshAgentProfile | undefined>;
export declare function recordMeshIntervention(record: MeshInterventionRecord): void;
export declare function getLatestMeshIntervention(sessionID: string, maxAgeMs?: number): MeshInterventionRecord | undefined;
export declare function clearMeshIntervention(sessionID: string): void;
export declare function registerSkillCatalogProvider(provider: MeshSkillCatalogProvider): () => void;
export declare function queryMeshSkills(query: string, options?: {
    directory?: string | undefined;
    topK?: number | undefined;
    scope?: "native" | "vault" | undefined;
    allowedIds?: ReadonlySet<string> | readonly string[] | undefined;
}): Promise<readonly MeshSkillHit[] | undefined>;
export declare function claimPromptSkillBinding(sessionID: string, turnKey: string, owner: string, skillIDs: readonly string[]): {
    claimed: boolean;
    existingOwner?: string | undefined;
    mergedSkillIDs: string[];
};
export declare function callMeshRpc<TOutput>(input: {
    rpcGetter?: ((contract: unknown) => Record<string, unknown> | undefined) | undefined;
    contract: {
        id: string;
        methods: Record<string, unknown>;
    };
    method: string;
    payload: Record<string, unknown>;
    directory?: string | undefined;
    signal?: AbortSignal | undefined;
    timeoutMs?: number | undefined;
}): Promise<TOutput | undefined>;
export declare function registerMeshStateRpc(input: {
    rpcRegister?: ((definition: typeof MESH_STATE_RPC_DEFINITION, handlers: Record<string, (arg: any) => Promise<any>>) => Promise<{
        dispose?: () => Promise<void> | void;
    } | void> | {
        dispose?: () => Promise<void> | void;
    } | void) | undefined;
    owner: string;
    directory?: string | undefined;
}): Promise<() => Promise<void>>;
export declare function resetMeshStateForTests(): void;
