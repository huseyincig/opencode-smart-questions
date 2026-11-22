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
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { types } from "node:util";
export const MESH_VERSION = 2;
export const BRIDGE_REVISION = "2.3.1";
export const MESH_SYMBOL = Symbol.for("opencode.mesh.v2");
export const LEGACY_COORDINATION_SYMBOL = Symbol.for("opencode.coordination.v1");
export const LEGACY_HANDOFF_STATE_SYMBOL = Symbol.for("opencode.handoff.state.v1");
export const MESH_METADATA_KEY = "opencode-mesh";
export const OPENCODE_HANDOFF_HEADER = "[OPENCODE_HANDOFF:v1]";
export const GUARDIAN_REMEDIATION_MARKER = "[opencode-guardian remediation]";
export const MESH_REMEDIATION_MARKER = "[opencode-mesh remediation]";
export const MESH_STATE_RPC_ID = "opencode-mesh.state";
export const DEFAULT_HANDOFF_TTL_MS = 120_000;
export const CLOSED_HANDOFF_TTL_MS = 10 * 60_000;
export const MAX_BOUNDED_SESSIONS = 512;
export const MAX_TOKENS_PER_SESSION = 128;
// Plain JSON-Schema V2 RPC definition (compatible with `Rpc.define`, server `ctx.rpc`, and TUI `client.rpc`).
// Deliberately not frozen because host schema validators may annotate schema objects.
export const MESH_STATE_RPC_DEFINITION = {
    id: MESH_STATE_RPC_ID,
    methods: {
        sessionState: {
            input: {
                type: "object",
                properties: {
                    sessionID: { type: "string", minLength: 1, maxLength: 256 },
                },
                required: ["sessionID"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    waitingOnUser: { type: "boolean" },
                    remediating: { type: "boolean" },
                    blockingOwner: { type: "string" },
                    blockingKind: { type: "string" },
                    activeHandoffId: { type: "string" },
                },
                required: ["waitingOnUser", "remediating"],
                additionalProperties: false,
            },
        },
        setInteractionLease: {
            input: {
                type: "object",
                properties: {
                    sessionID: { type: "string", minLength: 1, maxLength: 256 },
                    owner: { type: "string", minLength: 1, maxLength: 128 },
                    active: { type: "boolean" },
                    ttlMs: { type: "number" },
                    reason: { type: "string", maxLength: 256 },
                },
                required: ["sessionID", "owner", "active"],
                additionalProperties: false,
            },
            output: {
                type: "object",
                properties: {
                    ok: { type: "boolean" },
                },
                required: ["ok"],
                additionalProperties: false,
            },
        },
    },
    events: {
        updated: {
            schema: {
                type: "object",
                properties: {
                    sessionID: { type: "string" },
                    kind: { type: "string" },
                },
                required: ["sessionID", "kind"],
                additionalProperties: false,
            },
        },
    },
};
const LEASE_PRIORITY = {
    user_interaction: 30,
    active_remediation: 20,
    orchestration_dispatch: 10,
};
const DEFAULT_LEASE_TTL_MS = {
    user_interaction: 120_000,
    active_remediation: 45_000,
    orchestration_dispatch: 15_000,
};
function isRecord(value) {
    return Boolean(value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !types.isProxy(value));
}
function ownData(obj, key) {
    if (!isRecord(obj))
        return undefined;
    const desc = Object.getOwnPropertyDescriptor(obj, key);
    return desc && "value" in desc ? desc.value : undefined;
}
export function canonicalMeshDirectory(directory) {
    if (typeof directory !== "string" || !directory.trim() || directory.includes("\0")) {
        return "*";
    }
    const trimmed = directory.trim();
    if (!isAbsolute(trimmed))
        return "*";
    try {
        return realpathSync(trimmed);
    }
    catch {
        try {
            return resolvePath(trimmed);
        }
        catch {
            return "*";
        }
    }
}
function setBoundedMap(map, key, value, max = MAX_BOUNDED_SESSIONS) {
    if (map.has(key))
        map.delete(key);
    map.set(key, value);
    while (map.size > max) {
        const oldest = map.keys().next().value;
        if (oldest === undefined)
            break;
        map.delete(oldest);
    }
}
function getMeshState() {
    const g = globalThis;
    let state = g[MESH_SYMBOL];
    if (!state || typeof state !== "object") {
        state = {
            version: MESH_VERSION,
            peersByKey: new Map(),
            provenanceBySession: new Map(),
            leasesBySession: new Map(),
            interventionsBySession: new Map(),
            roleResolversByKey: new Map(),
            skillProvidersByKey: new Map(),
            promptSkillClaims: new Map(),
            rpcHostsByDir: new Map(),
            remoteInteractionLeases: new Map(),
        };
        g[MESH_SYMBOL] = state;
    }
    if (typeof state.version !== "number" || state.version < MESH_VERSION) {
        state.version = MESH_VERSION;
    }
    if (!(state.peersByKey instanceof Map))
        state.peersByKey = new Map();
    if (!(state.provenanceBySession instanceof Map))
        state.provenanceBySession = new Map();
    if (!(state.leasesBySession instanceof Map))
        state.leasesBySession = new Map();
    if (!(state.interventionsBySession instanceof Map))
        state.interventionsBySession = new Map();
    if (!(state.roleResolversByKey instanceof Map))
        state.roleResolversByKey = new Map();
    if (!(state.skillProvidersByKey instanceof Map))
        state.skillProvidersByKey = new Map();
    if (!(state.promptSkillClaims instanceof Map))
        state.promptSkillClaims = new Map();
    if (!(state.rpcHostsByDir instanceof Map))
        state.rpcHostsByDir = new Map();
    if (!(state.remoteInteractionLeases instanceof Map))
        state.remoteInteractionLeases = new Map();
    return state;
}
function getLegacyHandoffState() {
    const g = globalThis;
    let state = g[LEGACY_HANDOFF_STATE_SYMBOL];
    if (!state || typeof state !== "object") {
        state = {
            activeHandoffsBySession: new Map(),
            closedHandoffIds: new Map(),
        };
        g[LEGACY_HANDOFF_STATE_SYMBOL] = state;
    }
    if (!(state.activeHandoffsBySession instanceof Map)) {
        state.activeHandoffsBySession = new Map();
    }
    if (!(state.closedHandoffIds instanceof Map)) {
        state.closedHandoffIds = new Map();
    }
    if (state.consumedHandoffIds instanceof Set && state.consumedHandoffIds.size > 0) {
        const now = Date.now();
        for (const id of state.consumedHandoffIds) {
            state.closedHandoffIds.set(id, now);
        }
        state.consumedHandoffIds.clear();
    }
    return state;
}
function syncLegacyCoordinationRegistry(state) {
    const g = globalThis;
    let hasGuardian = false;
    let hasSmartQuestions = false;
    for (const { descriptor, count } of state.peersByKey.values()) {
        if (count <= 0)
            continue;
        if (descriptor.id === "opencode-guardian" || descriptor.capabilities.includes("policy.gate")) {
            hasGuardian = true;
        }
        if (descriptor.id === "opencode-smart-questions" || descriptor.capabilities.includes("interaction.ask")) {
            hasSmartQuestions = true;
        }
    }
    if (!hasGuardian && !hasSmartQuestions) {
        if (g[LEGACY_COORDINATION_SYMBOL]) {
            delete g[LEGACY_COORDINATION_SYMBOL].guardian;
            delete g[LEGACY_COORDINATION_SYMBOL].smartQuestions;
            if (Object.keys(g[LEGACY_COORDINATION_SYMBOL]).length === 0) {
                delete g[LEGACY_COORDINATION_SYMBOL];
            }
        }
        return;
    }
    const root = (g[LEGACY_COORDINATION_SYMBOL] ??= {});
    if (hasGuardian) {
        root.guardian = { version: 1, supportsHandoff: true };
    }
    else {
        delete root.guardian;
    }
    if (hasSmartQuestions) {
        root.smartQuestions = { version: 1, mainAgentOnly: true, supportsAutoSelect: true };
    }
    else {
        delete root.smartQuestions;
    }
}
// ---------------------------------------------------------------------------
// 1. Peer & Capability Discovery
// ---------------------------------------------------------------------------
export function registerMeshPeer(input) {
    const state = getMeshState();
    const dir = canonicalMeshDirectory(input.directory);
    const key = `${dir}::${input.id}`;
    const existing = state.peersByKey.get(key);
    const onSessionForgets = existing?.onSessionForgets ?? new Set();
    const forgetCb = typeof input.onSessionForget === "function" ? input.onSessionForget : undefined;
    if (forgetCb)
        onSessionForgets.add(forgetCb);
    const descriptor = {
        id: input.id,
        version: input.version ?? MESH_VERSION,
        directory: dir,
        capabilities: [...new Set(input.capabilities)],
        ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
    };
    state.peersByKey.set(key, {
        descriptor,
        count: (existing?.count ?? 0) + 1,
        onSessionForgets,
    });
    syncLegacyCoordinationRegistry(state);
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        const current = state.peersByKey.get(key);
        if (!current)
            return;
        if (forgetCb)
            current.onSessionForgets?.delete(forgetCb);
        if (current.count > 1) {
            current.count -= 1;
        }
        else {
            state.peersByKey.delete(key);
        }
        syncLegacyCoordinationRegistry(state);
    };
}
export function getMeshPeers(options) {
    const state = getMeshState();
    const targetDir = options?.directory ? canonicalMeshDirectory(options.directory) : undefined;
    const out = [];
    for (const { descriptor, count } of state.peersByKey.values()) {
        if (count <= 0)
            continue;
        if (targetDir &&
            targetDir !== "*" &&
            descriptor.directory !== "*" &&
            descriptor.directory !== targetDir) {
            continue;
        }
        if (options?.capability && !descriptor.capabilities.includes(options.capability)) {
            continue;
        }
        out.push(descriptor);
    }
    return out;
}
export function hasMeshCapability(capability, directory) {
    if (getMeshPeers({ directory, capability }).length > 0)
        return true;
    const g = globalThis;
    if (capability === "policy.gate" && g[LEGACY_COORDINATION_SYMBOL]?.guardian)
        return true;
    if (capability === "interaction.ask" && g[LEGACY_COORDINATION_SYMBOL]?.smartQuestions)
        return true;
    return false;
}
// ---------------------------------------------------------------------------
// 2. Cryptographic In-Process Session Provenance & Metadata Envelope
// ---------------------------------------------------------------------------
const SYNTHETIC_MESH_KINDS = [
    "remediation",
    "visible",
    "handoff",
    "wake",
    "delegation",
];
export function stampMeshMetadata(sessionID, options, base = {}) {
    const state = getMeshState();
    const token = randomUUID();
    const sID = String(sessionID || "global");
    const isSynthetic = options.synthetic ??
        (options.kind === "remediation" ||
            options.kind === "visible" ||
            options.kind === "handoff" ||
            options.kind === "wake" ||
            options.kind === "delegation");
    let sessionTokens = state.provenanceBySession.get(sID);
    if (!sessionTokens) {
        sessionTokens = new Map();
        setBoundedMap(state.provenanceBySession, sID, sessionTokens, MAX_BOUNDED_SESSIONS);
    }
    else {
        setBoundedMap(state.provenanceBySession, sID, sessionTokens, MAX_BOUNDED_SESSIONS);
    }
    setBoundedMap(sessionTokens, token, { owner: options.owner, kind: options.kind, synthetic: isSynthetic, createdAt: Date.now() }, MAX_TOKENS_PER_SESSION);
    const isProtected = options.protected ??
        (options.kind === "remediation" ||
            options.kind === "handoff" ||
            options.kind === "task-contract" ||
            options.kind === "skill-injection");
    const envelope = {
        v: 2,
        owner: options.owner,
        kind: options.kind,
        token,
        ...(options.synthetic === false ? { synthetic: false } : isSynthetic ? { synthetic: true } : {}),
        ...(isProtected ? { protected: true } : {}),
        ...(options.sanitizedBy?.length ? { sanitizedBy: [...options.sanitizedBy] } : {}),
        ...(options.boundedBy ? { boundedBy: options.boundedBy } : {}),
        ...(options.taskID ? { taskID: options.taskID } : {}),
        ...(options.requiredSkills?.length ? { requiredSkills: [...options.requiredSkills] } : {}),
    };
    const out = {
        ...base,
        [MESH_METADATA_KEY]: envelope,
    };
    if (isSynthetic) {
        out.synthetic = true;
    }
    // Backward compatibility with existing Guardian & Smart Questions metadata checks
    if (options.owner === "opencode-guardian" || options.legacyGuardian) {
        out["opencode-guardian"] = true;
        out["opencode-guardian-provenance"] = token;
        out["opencode-guardian-kind"] = options.kind === "visible" ? "visible" : "remediation";
    }
    if (options.owner === "opencode-smart-questions") {
        out["opencode-smart-questions"] = true;
    }
    if (options.owner === "opencode-hi") {
        out["opencode-hi"] = true;
    }
    if (options.requiredSkills?.length || options.taskID) {
        const existingLazy = isRecord(base.lazySkill) ? base.lazySkill : {};
        out.lazySkill = {
            ...existingLazy,
            ...(options.taskID ? { taskId: options.taskID } : {}),
            ...(options.requiredSkills?.length ? { requiredSkills: [...options.requiredSkills] } : {}),
        };
    }
    return out;
}
export function extractMetadataRecord(value) {
    if (!isRecord(value))
        return undefined;
    const meta = ownData(value, "metadata");
    if (isRecord(meta) && Object.keys(meta).length > 0)
        return meta;
    const prompt = ownData(value, "prompt");
    const promptMeta = ownData(prompt, "metadata");
    if (isRecord(promptMeta) && Object.keys(promptMeta).length > 0) {
        return promptMeta;
    }
    const info = ownData(value, "info");
    const infoMeta = ownData(info, "metadata");
    if (isRecord(infoMeta) && Object.keys(infoMeta).length > 0) {
        return infoMeta;
    }
    const payload = ownData(value, "payload");
    const payloadMeta = ownData(payload, "metadata");
    if (isRecord(payloadMeta) && Object.keys(payloadMeta).length > 0) {
        return payloadMeta;
    }
    const state = ownData(value, "state");
    const stateMeta = ownData(state, "metadata");
    if (isRecord(stateMeta) && Object.keys(stateMeta).length > 0) {
        return stateMeta;
    }
    if (isRecord(meta))
        return meta;
    if (isRecord(promptMeta))
        return promptMeta;
    if (isRecord(infoMeta))
        return infoMeta;
    if (isRecord(payloadMeta))
        return payloadMeta;
    if (isRecord(stateMeta))
        return stateMeta;
    if (isRecord(ownData(value, MESH_METADATA_KEY)) ||
        ownData(value, "opencode-guardian") === true ||
        ownData(value, "opencode-smart-questions") === true ||
        ownData(value, "opencode-hi") === true ||
        typeof ownData(value, "hi-internal") === "string" ||
        typeof ownData(value, "hi-message") === "string") {
        return value;
    }
    return undefined;
}
export function verifyMeshMetadata(sessionID, valueOrMetadata, expectedKind, expectedOwner) {
    if (!sessionID)
        return false;
    const meta = extractMetadataRecord(valueOrMetadata);
    if (!meta)
        return false;
    const state = getMeshState();
    const sessionTokens = state.provenanceBySession.get(sessionID);
    const globalTokens = sessionID !== "global" ? state.provenanceBySession.get("global") : undefined;
    if (!sessionTokens && !globalTokens)
        return false;
    const meshEnv = isRecord(meta[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : undefined;
    const primaryToken = typeof meshEnv?.token === "string" ? meshEnv.token : undefined;
    const legacyToken = typeof meta["opencode-guardian-provenance"] === "string"
        ? meta["opencode-guardian-provenance"]
        : undefined;
    if (!primaryToken && !legacyToken)
        return false;
    const record = (primaryToken ? (sessionTokens?.get(primaryToken) ?? globalTokens?.get(primaryToken)) : undefined) ??
        (legacyToken ? (sessionTokens?.get(legacyToken) ?? globalTokens?.get(legacyToken)) : undefined);
    if (!record)
        return false;
    if (meshEnv) {
        if (typeof meshEnv.owner === "string" && meshEnv.owner !== record.owner)
            return false;
        if (typeof meshEnv.kind === "string" && meshEnv.kind !== record.kind)
            return false;
    }
    if (expectedOwner && record.owner !== expectedOwner)
        return false;
    if (expectedKind) {
        const allowed = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
        if (!allowed.includes(record.kind))
            return false;
    }
    return true;
}
export function isTrustedMeshMessage(value, sessionID, expectedKind) {
    if (!isRecord(value))
        return false;
    const effectiveExpectedKind = expectedKind ?? SYNTHETIC_MESH_KINDS;
    const meta = extractMetadataRecord(value);
    const meshEnv = isRecord(meta?.[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : undefined;
    if (sessionID && verifyMeshMetadata(sessionID, value, effectiveExpectedKind)) {
        if (expectedKind === undefined && meshEnv?.synthetic === false) {
            return false;
        }
        return true;
    }
    const isHostSynthetic = value.type === "synthetic" ||
        value.synthetic === true ||
        value.ignored === true ||
        meta?.synthetic === true ||
        meta?.internal === true ||
        meta?.autoContinue === true ||
        typeof meta?.["hi-internal"] === "string" ||
        typeof meta?.["hi-message"] === "string";
    if (meshEnv &&
        typeof meshEnv.token === "string" &&
        meshEnv.token.length > 0 &&
        isHostSynthetic &&
        (expectedKind !== undefined || meshEnv.synthetic !== false)) {
        const allowed = Array.isArray(effectiveExpectedKind)
            ? effectiveExpectedKind
            : [effectiveExpectedKind];
        if (typeof meshEnv.kind !== "string" || !allowed.includes(meshEnv.kind)) {
            return false;
        }
        return true;
    }
    if (isHostSynthetic &&
        (meta?.["opencode-guardian"] === true ||
            meta?.["opencode-smart-questions"] === true ||
            meta?.["opencode-hi"] === true ||
            isRecord(meta?.hi))) {
        return true;
    }
    const parts = Array.isArray(value.parts)
        ? value.parts
        : Array.isArray(value.content)
            ? value.content
            : undefined;
    if (parts?.some((part) => isTrustedMeshMessage(part, sessionID, expectedKind))) {
        return true;
    }
    if (isRecord(value.prompt) && isTrustedMeshMessage(value.prompt, sessionID, expectedKind)) {
        return true;
    }
    if (isRecord(value.message)) {
        return isTrustedMeshMessage(value.message, sessionID, expectedKind);
    }
    return false;
}
export function isMeshProtectedPart(part, parentMessage) {
    for (const candidate of [part, parentMessage]) {
        if (!isRecord(candidate))
            continue;
        const meta = extractMetadataRecord(candidate);
        if (!meta)
            continue;
        const meshEnv = isRecord(meta[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : undefined;
        if (meshEnv?.protected === true)
            return true;
        if (meshEnv?.kind === "remediation" ||
            meshEnv?.kind === "handoff" ||
            meshEnv?.kind === "task-contract" ||
            meshEnv?.kind === "skill-injection") {
            return true;
        }
        if (meta["opencode-guardian"] === true ||
            meta["opencode-smart-questions"] === true ||
            (isRecord(meta.hiOutput) && meta.hiOutput.protected === true)) {
            return true;
        }
    }
    return false;
}
export function wasMeshSanitized(valueOrMetadata, owner) {
    const meta = extractMetadataRecord(valueOrMetadata);
    const meshEnv = isRecord(meta?.[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : undefined;
    if (!Array.isArray(meshEnv?.sanitizedBy) || meshEnv.sanitizedBy.length === 0)
        return false;
    return owner ? meshEnv.sanitizedBy.includes(owner) : true;
}
export function wasMeshBounded(valueOrMetadata) {
    const meta = extractMetadataRecord(valueOrMetadata);
    const meshEnv = isRecord(meta?.[MESH_METADATA_KEY]) ? meta[MESH_METADATA_KEY] : undefined;
    if (typeof meshEnv?.boundedBy === "string" && meshEnv.boundedBy.length > 0)
        return true;
    if (isRecord(meta?.hiOutput) && meta.hiOutput.bounded === true)
        return true;
    return false;
}
export function forgetMeshSession(sessionID) {
    if (!sessionID)
        return;
    const state = getMeshState();
    state.provenanceBySession.delete(sessionID);
    state.leasesBySession.delete(sessionID);
    state.interventionsBySession.delete(sessionID);
    for (const key of state.promptSkillClaims.keys()) {
        if (key.startsWith(`${sessionID}::`)) {
            state.promptSkillClaims.delete(key);
        }
    }
    for (const [key, release] of state.remoteInteractionLeases) {
        if (key.includes(`::${sessionID}::`)) {
            state.remoteInteractionLeases.delete(key);
            try {
                release();
            }
            catch { }
        }
    }
    clearActiveMeshHandoff(sessionID);
    for (const peer of state.peersByKey.values()) {
        if (peer.count <= 0 || !(peer.onSessionForgets instanceof Set))
            continue;
        for (const cb of peer.onSessionForgets) {
            try {
                cb(sessionID);
            }
            catch { }
        }
    }
}
// ---------------------------------------------------------------------------
// 3. Coordinated Session Leases (Idle, Form Wait & Remediation Arbitration)
// ---------------------------------------------------------------------------
function pruneExpiredLeases(state, sessionID, now = Date.now()) {
    const leases = state.leasesBySession.get(sessionID);
    if (!leases)
        return undefined;
    for (const [key, lease] of leases) {
        if (lease.expiresAt <= now) {
            leases.delete(key);
        }
    }
    if (leases.size === 0) {
        state.leasesBySession.delete(sessionID);
        return undefined;
    }
    return leases;
}
export function acquireSessionLease(input) {
    const sID = String(input.sessionID ?? "");
    if (!sID)
        return () => { };
    const state = getMeshState();
    const now = Date.now();
    const ttl = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0
        ? input.ttlMs
        : DEFAULT_LEASE_TTL_MS[input.kind];
    let leases = pruneExpiredLeases(state, sID, now);
    if (!leases) {
        leases = new Map();
        setBoundedMap(state.leasesBySession, sID, leases, MAX_BOUNDED_SESSIONS);
    }
    const key = `${input.owner}::${input.kind}`;
    const lease = {
        sessionID: sID,
        owner: input.owner,
        kind: input.kind,
        priority: LEASE_PRIORITY[input.kind],
        acquiredAt: now,
        expiresAt: now + ttl,
        ...(input.reason ? { reason: input.reason } : {}),
    };
    leases.set(key, lease);
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        const current = state.leasesBySession.get(sID);
        if (!current)
            return;
        if (current.get(key) === lease) {
            current.delete(key);
        }
        if (current.size === 0) {
            state.leasesBySession.delete(sID);
        }
    };
}
export function getBlockingSessionLease(sessionID, callerKind, callerOwner) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return undefined;
    const state = getMeshState();
    const leases = pruneExpiredLeases(state, sID);
    const callerPriority = LEASE_PRIORITY[callerKind];
    let highest;
    if (leases) {
        for (const lease of leases.values()) {
            if (callerOwner && lease.owner === callerOwner && lease.kind === callerKind)
                continue;
            if (lease.priority > callerPriority) {
                if (!highest || lease.priority > highest.priority) {
                    highest = lease;
                }
            }
        }
    }
    if (highest)
        return highest;
    // If a question handoff is currently active in the session, treat it as user_interaction (priority 30)
    if (callerPriority < LEASE_PRIORITY.user_interaction) {
        const activeHandoff = getActiveMeshHandoff(sID);
        const isOwnHandoff = callerOwner !== undefined &&
            (activeHandoff?.source === callerOwner ||
                (callerOwner === "opencode-guardian" && activeHandoff?.source === "guardian") ||
                (callerOwner === "guardian" && activeHandoff?.source === "opencode-guardian") ||
                (callerOwner === "opencode-hi" && activeHandoff?.source === "hi") ||
                (callerOwner === "hi" && activeHandoff?.source === "opencode-hi"));
        if (activeHandoff && !isOwnHandoff) {
            return {
                sessionID: sID,
                owner: activeHandoff.source,
                kind: "user_interaction",
                priority: LEASE_PRIORITY.user_interaction,
                acquiredAt: Date.now(),
                expiresAt: Date.now() + DEFAULT_HANDOFF_TTL_MS,
                reason: `handoff:${activeHandoff.handoffId}`,
            };
        }
    }
    return undefined;
}
export function isSessionWaitingOnUser(sessionID) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return false;
    const state = getMeshState();
    const leases = pruneExpiredLeases(state, sID);
    if (leases) {
        for (const lease of leases.values()) {
            if (lease.kind === "user_interaction")
                return true;
        }
    }
    return getActiveMeshHandoff(sID) !== undefined;
}
export function isSessionRemediating(sessionID) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return false;
    const state = getMeshState();
    const leases = pruneExpiredLeases(state, sID);
    if (!leases)
        return false;
    for (const lease of leases.values()) {
        if (lease.kind === "active_remediation")
            return true;
    }
    return false;
}
// ---------------------------------------------------------------------------
// 4. N-Way Handoff Protocol (Backward-Compatible with [OPENCODE_HANDOFF:v1])
// ---------------------------------------------------------------------------
const VALID_HANDOFF_SOURCE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
export function createMeshHandoffId(source, sessionID, turnKey, ruleOrReasonIds, sequence = 1) {
    const prefix = source.replace(/^opencode-/, "").slice(0, 4) || "mh";
    const hash = createHash("sha256")
        .update(`${source}:${sessionID}:${turnKey}:${sequence}:${ruleOrReasonIds.join(",")}`)
        .digest("hex")
        .slice(0, 10);
    return `${prefix}q_${hash}`;
}
export function formatMeshHandoff(handoff) {
    const source = typeof handoff.source === "string" && VALID_HANDOFF_SOURCE.test(handoff.source)
        ? handoff.source.toLowerCase()
        : "guardian";
    return [
        OPENCODE_HANDOFF_HEADER,
        `source=${source}`,
        `action=${handoff.action}`,
        `kind=${handoff.kind}`,
        `auto_select=${handoff.autoSelect}`,
        `handoff_id=${handoff.handoffId}`,
    ].join("\n");
}
export function parseMeshHandoff(text, options) {
    if (typeof text !== "string" || !text.includes(OPENCODE_HANDOFF_HEADER))
        return null;
    const requireMarker = typeof options === "boolean"
        ? options
        : Boolean(options?.requireRemediationMarker);
    if (requireMarker &&
        !text.includes(GUARDIAN_REMEDIATION_MARKER) &&
        !text.includes(MESH_REMEDIATION_MARKER)) {
        return null;
    }
    const match = /\[OPENCODE_HANDOFF:v1\]\s*([\s\S]*?)(?:\n\n|\r\n\r\n|$)/.exec(text);
    if (!match || !match[1])
        return null;
    const map = new Map();
    for (const line of match[1].split(/\r?\n/)) {
        const eq = line.indexOf("=");
        if (eq > 0) {
            map.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
        }
    }
    const source = map.get("source")?.toLowerCase();
    const action = map.get("action");
    const kind = map.get("kind");
    const autoSelect = map.get("auto_select");
    const handoffId = map.get("handoff_id");
    if (!source || !VALID_HANDOFF_SOURCE.test(source) || action !== "question_required" || !handoffId) {
        return null;
    }
    if (typeof options === "object" &&
        options?.allowedSources &&
        !options.allowedSources.map((s) => s.toLowerCase()).includes(source)) {
        return null;
    }
    if (kind !== "clarification" && kind !== "choice" && kind !== "approval") {
        return null;
    }
    if (autoSelect !== "allowed" && autoSelect !== "forbidden") {
        return null;
    }
    return {
        version: "v1",
        source,
        action: "question_required",
        kind,
        autoSelect,
        handoffId,
    };
}
export function extractTrustedMeshHandoff(source, sessionID) {
    if (!isRecord(source))
        return null;
    if (!isTrustedMeshMessage(source, sessionID, ["remediation", "handoff"])) {
        return null;
    }
    const candidates = [];
    if (typeof source.text === "string")
        candidates.push(source.text);
    if (typeof source.content === "string")
        candidates.push(source.content);
    if (isRecord(source.payload) && typeof source.payload.text === "string") {
        candidates.push(source.payload.text);
    }
    const parts = Array.isArray(source.parts)
        ? source.parts
        : Array.isArray(source.content)
            ? source.content
            : undefined;
    if (parts) {
        for (const part of parts) {
            if (isRecord(part) && typeof part.text === "string") {
                candidates.push(part.text);
            }
        }
    }
    if (isRecord(source.message)) {
        const nested = extractTrustedMeshHandoff(source.message, sessionID);
        if (nested)
            return nested;
    }
    for (const text of candidates) {
        const parsed = parseMeshHandoff(text, false);
        if (parsed)
            return parsed;
    }
    return null;
}
export function extractCurrentTurnMeshHandoff(messages, sessionID) {
    if (!Array.isArray(messages))
        return null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        const handoff = extractTrustedMeshHandoff(msg, sessionID);
        if (handoff)
            return handoff;
        if (isRecord(msg)) {
            const role = typeof msg.role === "string"
                ? msg.role
                : msg.type === "user"
                    ? "user"
                    : isRecord(msg.info) && typeof msg.info.role === "string"
                        ? msg.info.role
                        : undefined;
            if (role === "user" && !isTrustedMeshMessage(msg, sessionID)) {
                return null;
            }
        }
    }
    return null;
}
function pruneClosedHandoffs(state, now = Date.now()) {
    for (const [id, closedAt] of state.closedHandoffIds) {
        if (now - closedAt > CLOSED_HANDOFF_TTL_MS) {
            state.closedHandoffIds.delete(id);
        }
    }
    while (state.closedHandoffIds.size > MAX_BOUNDED_SESSIONS) {
        const oldest = state.closedHandoffIds.keys().next().value;
        if (!oldest)
            break;
        state.closedHandoffIds.delete(oldest);
    }
}
export function setActiveMeshHandoff(sessionID, handoff, timestamp = Date.now()) {
    const sID = String(sessionID ?? "");
    if (!sID || !handoff?.handoffId)
        return false;
    const state = getLegacyHandoffState();
    pruneClosedHandoffs(state, timestamp);
    if (state.closedHandoffIds.has(handoff.handoffId))
        return false;
    setBoundedMap(state.activeHandoffsBySession, sID, { handoff, createdAt: timestamp }, MAX_BOUNDED_SESSIONS);
    return true;
}
export function getActiveMeshHandoff(sessionID, maxAgeMs = DEFAULT_HANDOFF_TTL_MS) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return undefined;
    const state = getLegacyHandoffState();
    const now = Date.now();
    pruneClosedHandoffs(state, now);
    const entry = state.activeHandoffsBySession.get(sID);
    if (!entry)
        return undefined;
    if (now - entry.createdAt > maxAgeMs) {
        state.activeHandoffsBySession.delete(sID);
        setBoundedMap(state.closedHandoffIds, entry.handoff.handoffId, now, MAX_BOUNDED_SESSIONS);
        return undefined;
    }
    return entry.handoff;
}
export function consumeActiveMeshHandoff(sessionID) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return undefined;
    const state = getLegacyHandoffState();
    const entry = state.activeHandoffsBySession.get(sID);
    if (!entry)
        return undefined;
    state.activeHandoffsBySession.delete(sID);
    setBoundedMap(state.closedHandoffIds, entry.handoff.handoffId, Date.now(), MAX_BOUNDED_SESSIONS);
    return entry.handoff;
}
export function invalidateActiveMeshHandoff(sessionID) {
    return consumeActiveMeshHandoff(sessionID);
}
export function clearActiveMeshHandoff(sessionID) {
    const sID = String(sessionID ?? "");
    if (!sID)
        return;
    getLegacyHandoffState().activeHandoffsBySession.delete(sID);
}
// ---------------------------------------------------------------------------
// 5. Orchestration Role Profile & Policy Intervention Bus
// ---------------------------------------------------------------------------
export function registerRoleProfileResolver(input) {
    const state = getMeshState();
    const dir = canonicalMeshDirectory(input.directory);
    const key = `${dir}::${input.owner}`;
    state.roleResolversByKey.set(key, {
        owner: input.owner,
        directory: dir,
        resolve: input.resolve,
    });
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        state.roleResolversByKey.delete(key);
    };
}
export async function resolveMeshAgentProfile(sessionID, directory) {
    if (!sessionID)
        return undefined;
    const state = getMeshState();
    const targetDir = canonicalMeshDirectory(directory);
    for (const entry of state.roleResolversByKey.values()) {
        if (targetDir !== "*" &&
            entry.directory !== "*" &&
            entry.directory !== targetDir) {
            continue;
        }
        try {
            const profile = await entry.resolve(sessionID, targetDir);
            if (profile && profile.capability !== "unknown") {
                return profile;
            }
        }
        catch {
            // Resolver errors must never break the caller
        }
    }
    return undefined;
}
export function recordMeshIntervention(record) {
    if (!record.sessionID)
        return;
    const state = getMeshState();
    setBoundedMap(state.interventionsBySession, record.sessionID, { ...record, updatedAt: record.updatedAt || Date.now() }, MAX_BOUNDED_SESSIONS);
}
export function getLatestMeshIntervention(sessionID, maxAgeMs = 60_000) {
    if (!sessionID)
        return undefined;
    const state = getMeshState();
    const entry = state.interventionsBySession.get(sessionID);
    if (!entry)
        return undefined;
    if (Date.now() - entry.updatedAt > maxAgeMs) {
        state.interventionsBySession.delete(sessionID);
        return undefined;
    }
    return entry;
}
export function clearMeshIntervention(sessionID) {
    if (!sessionID)
        return;
    getMeshState().interventionsBySession.delete(sessionID);
}
// ---------------------------------------------------------------------------
// 6. Shared Skill Catalog & Prompt Binding Coordination
// ---------------------------------------------------------------------------
export function registerSkillCatalogProvider(provider) {
    const state = getMeshState();
    const dir = canonicalMeshDirectory(provider.directory);
    const key = `${dir}::${provider.owner}`;
    state.skillProvidersByKey.set(key, { ...provider, directory: dir });
    let disposed = false;
    return () => {
        if (disposed)
            return;
        disposed = true;
        state.skillProvidersByKey.delete(key);
    };
}
export async function queryMeshSkills(query, options) {
    const state = getMeshState();
    const targetDir = canonicalMeshDirectory(options?.directory);
    for (const provider of state.skillProvidersByKey.values()) {
        if (targetDir !== "*" &&
            provider.directory !== "*" &&
            provider.directory !== targetDir) {
            continue;
        }
        try {
            return await provider.search(query, {
                ...(options?.topK !== undefined ? { topK: options.topK } : {}),
                ...(options?.scope !== undefined ? { scope: options.scope } : {}),
                ...(options?.allowedIds !== undefined ? { allowedIds: options.allowedIds } : {}),
            });
        }
        catch {
            // Fall back to next provider or local skill search
        }
    }
    return undefined;
}
export function claimPromptSkillBinding(sessionID, turnKey, owner, skillIDs) {
    const state = getMeshState();
    const key = `${sessionID}::${turnKey || "latest"}`;
    const now = Date.now();
    const existing = state.promptSkillClaims.get(key);
    if (existing && now - existing.claimedAt < 10_000 && existing.owner !== owner) {
        const merged = [...new Set([...existing.skillIDs, ...skillIDs])];
        existing.skillIDs = merged;
        return { claimed: false, existingOwner: existing.owner, mergedSkillIDs: merged };
    }
    const merged = [...new Set(skillIDs)];
    setBoundedMap(state.promptSkillClaims, key, { owner, skillIDs: merged, claimedAt: now }, MAX_BOUNDED_SESSIONS);
    return { claimed: true, mergedSkillIDs: merged };
}
// ---------------------------------------------------------------------------
// 7. V2.2.7+ Startup-Safe Cross-Process RPC Helper
// ---------------------------------------------------------------------------
export async function callMeshRpc(input) {
    if (typeof input.rpcGetter !== "function")
        return undefined;
    const timeoutMs = input.timeoutMs ?? 1200;
    let timer;
    try {
        const client = input.rpcGetter(input.contract);
        const fn = client?.[input.method];
        if (typeof fn !== "function")
            return undefined;
        const callOptions = {};
        if (input.directory)
            callOptions.location = { directory: input.directory };
        if (input.signal)
            callOptions.signal = input.signal;
        const result = await Promise.race([
            Promise.resolve().then(() => fn(input.payload, callOptions)),
            new Promise((resolve) => {
                timer = setTimeout(() => resolve(undefined), timeoutMs);
            }),
        ]);
        return result;
    }
    catch {
        // Peer plugin not installed or still loading (v2.2.7+); degrade cleanly to standalone mode.
        return undefined;
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
}
export async function registerMeshStateRpc(input) {
    if (typeof input.rpcRegister !== "function")
        return async () => { };
    const state = getMeshState();
    const dir = canonicalMeshDirectory(input.directory);
    const standbysByDir = (state.rpcStandbysByDir ??= new Map());
    const activeHostDir = state.rpcHostsByDir.has(dir)
        ? dir
        : dir === "*" && state.rpcHostsByDir.size === 1
            ? state.rpcHostsByDir.keys().next().value
            : dir !== "*" && state.rpcHostsByDir.has("*")
                ? "*"
                : undefined;
    if (activeHostDir !== undefined) {
        const candidate = {
            owner: input.owner,
            rpcRegister: input.rpcRegister,
            disposed: false,
        };
        const queue = standbysByDir.get(activeHostDir) ?? [];
        queue.push(candidate);
        standbysByDir.set(activeHostDir, queue);
        return async () => {
            if (candidate.disposed)
                return;
            candidate.disposed = true;
            const list = standbysByDir.get(activeHostDir);
            if (list) {
                const idx = list.indexOf(candidate);
                if (idx >= 0)
                    list.splice(idx, 1);
                if (list.length === 0)
                    standbysByDir.delete(activeHostDir);
            }
            if (candidate.activeDispose) {
                const fn = candidate.activeDispose;
                candidate.activeDispose = undefined;
                await fn();
            }
        };
    }
    let reg;
    const hostEntry = {
        owner: input.owner,
        releaseAll: () => {
            for (const [k, rel] of state.remoteInteractionLeases) {
                if (k.startsWith(`${dir}::`)) {
                    state.remoteInteractionLeases.delete(k);
                    try {
                        rel();
                    }
                    catch { }
                }
            }
        },
    };
    state.rpcHostsByDir.set(dir, hostEntry);
    try {
        reg = await input.rpcRegister(MESH_STATE_RPC_DEFINITION, {
            sessionState: async (arg) => {
                const sid = typeof arg?.sessionID === "string" ? arg.sessionID : "";
                const waitingOnUser = sid ? isSessionWaitingOnUser(sid) : false;
                const remediating = sid ? isSessionRemediating(sid) : false;
                const blocker = sid ? getBlockingSessionLease(sid, "orchestration_dispatch") : undefined;
                const handoff = sid ? getActiveMeshHandoff(sid) : undefined;
                return {
                    waitingOnUser,
                    remediating,
                    ...(blocker ? { blockingOwner: blocker.owner, blockingKind: blocker.kind } : {}),
                    ...(handoff ? { activeHandoffId: handoff.handoffId } : {}),
                };
            },
            setInteractionLease: async (arg) => {
                const sid = typeof arg?.sessionID === "string" ? arg.sessionID : "";
                const owner = typeof arg?.owner === "string" && arg.owner ? arg.owner : "remote";
                if (!sid)
                    return { ok: false };
                const leaseKey = `${dir}::${sid}::${owner}`;
                const existing = state.remoteInteractionLeases.get(leaseKey);
                if (existing) {
                    state.remoteInteractionLeases.delete(leaseKey);
                    try {
                        existing();
                    }
                    catch { }
                }
                if (arg?.active) {
                    const release = acquireSessionLease({
                        sessionID: sid,
                        owner,
                        kind: "user_interaction",
                        ttlMs: arg.ttlMs,
                        reason: arg.reason,
                    });
                    setBoundedMap(state.remoteInteractionLeases, leaseKey, release, MAX_BOUNDED_SESSIONS);
                }
                return { ok: true };
            },
        });
    }
    catch {
        state.rpcHostsByDir.delete(dir);
        return async () => { };
    }
    let disposed = false;
    return async () => {
        if (disposed)
            return;
        disposed = true;
        if (state.rpcHostsByDir.get(dir) === hostEntry) {
            state.rpcHostsByDir.delete(dir);
        }
        try {
            await reg?.dispose?.();
        }
        catch { }
        const queue = standbysByDir.get(dir);
        while (queue && queue.length > 0 && !state.rpcHostsByDir.has(dir)) {
            const next = queue.shift();
            if (!next || next.disposed)
                continue;
            if (queue.length === 0)
                standbysByDir.delete(dir);
            next.activeDispose = await registerMeshStateRpc({
                rpcRegister: next.rpcRegister,
                owner: next.owner,
                directory: input.directory,
            });
            if (next.disposed && next.activeDispose) {
                const fn = next.activeDispose;
                next.activeDispose = undefined;
                await fn();
            }
            else if (state.rpcHostsByDir.has(dir)) {
                break;
            }
        }
        if (!state.rpcHostsByDir.has(dir)) {
            hostEntry.releaseAll();
        }
    };
}
export function resetMeshStateForTests() {
    const g = globalThis;
    delete g[MESH_SYMBOL];
    delete g[LEGACY_COORDINATION_SYMBOL];
    delete g[LEGACY_HANDOFF_STATE_SYMBOL];
}
