/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */

import {
  isTrustedMeshMessage,
  MESH_REMEDIATION_MARKER,
  registerMeshPeer,
  verifyMeshMetadata,
} from './bridge.js';

export const OPENCODE_HANDOFF_HEADER = '[OPENCODE_HANDOFF:v1]';
export const GUARDIAN_REMEDIATION_MARKER = '[opencode-guardian remediation]';
export const GUARDIAN_PROVENANCE_KEY = 'opencode-guardian';
export const GUARDIAN_PROVENANCE_TOKEN_KEY = 'opencode-guardian-provenance';
export const GUARDIAN_KIND_KEY = 'opencode-guardian-kind';
export const DEFAULT_HANDOFF_TTL_MS = 120_000;
export const CLOSED_HANDOFF_TTL_MS = 10 * 60_000;
export const MAX_CLOSED_HANDOFF_IDS = 512;
export const MAX_ACTIVE_HANDOFFS = 512;

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
  parentMeshProvenance?: boolean;
  sessionID?: string | undefined;
}

export const COORDINATION_SYMBOL = Symbol.for('opencode.coordination.v1');

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function guardianMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const direct = isRecord(value.metadata) ? value.metadata : undefined;
  const payloadMeta =
    isRecord(value.payload) && isRecord(value.payload.metadata)
      ? value.payload.metadata
      : undefined;
  const infoMeta =
    isRecord(value.info) && isRecord(value.info.metadata)
      ? value.info.metadata
      : undefined;
  const promptMeta =
    isRecord(value.prompt) && isRecord(value.prompt.metadata)
      ? value.prompt.metadata
      : undefined;
  const stateMeta =
    isRecord(value.state) && isRecord(value.state.metadata)
      ? value.state.metadata
      : undefined;

  if (direct || payloadMeta || infoMeta || promptMeta || stateMeta) {
    return {
      ...stateMeta,
      ...promptMeta,
      ...infoMeta,
      ...payloadMeta,
      ...direct,
    };
  }
  if (
    isRecord(value['opencode-mesh']) ||
    value[GUARDIAN_PROVENANCE_KEY] === true ||
    value['opencode-smart-questions'] === true ||
    value['opencode-hi'] === true ||
    typeof value['hi-internal'] === 'string' ||
    typeof value['hi-message'] === 'string'
  ) {
    return value;
  }
  return undefined;
}

function hasGuardianMetadata(
  value: unknown,
  expectedKind?: 'remediation' | 'visible'
): boolean {
  const metadata = guardianMetadata(value);
  if (metadata?.[GUARDIAN_PROVENANCE_KEY] !== true) return false;

  const token = metadata[GUARDIAN_PROVENANCE_TOKEN_KEY];
  const kind = metadata[GUARDIAN_KIND_KEY];

  // Current Guardian writes a session-scoped provenance token and explicit
  // message kind. When either modern field is present, require the complete
  // pair instead of accepting a partially spoofed metadata object.
  if (token !== undefined || kind !== undefined) {
    if (typeof token !== 'string' || token.length === 0) return false;
    if (kind !== 'remediation' && kind !== 'visible') return false;
    if (expectedKind && kind !== expectedKind) return false;
    return true;
  }

  // Backward compatibility for older Guardian versions that only emitted the
  // boolean provenance flag. Callers still require the remediation marker and
  // a Guardian-owned synthetic/ignored message boundary.
  return expectedKind !== 'visible';
}

function isGuardianOwnedNonHumanMessage(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const kind = guardianMetadata(value)?.[GUARDIAN_KIND_KEY];
  if (
    hasGuardianMetadata(value) &&
    (value.type === 'synthetic' ||
      value.synthetic === true ||
      value.ignored === true ||
      kind === 'remediation' ||
      kind === 'visible' ||
      guardianMetadata(value)?.[GUARDIAN_PROVENANCE_KEY] === true)
  ) {
    return true;
  }

  const parts = messageParts(value);
  if (parts?.some((part) => {
    if (!isRecord(part) || !hasGuardianMetadata(part)) return false;
    const partKind = guardianMetadata(part)?.[GUARDIAN_KIND_KEY];
    return (
      part.synthetic === true ||
      part.ignored === true ||
      partKind === 'remediation' ||
      partKind === 'visible' ||
      guardianMetadata(part)?.[GUARDIAN_PROVENANCE_KEY] === true
    );
  })) {
    return true;
  }

  return isRecord(value.message)
    ? isGuardianOwnedNonHumanMessage(value.message)
    : false;
}

function isInternalNonHumanPart(part: unknown, sessionID?: string): boolean {
  if (!isRecord(part)) return false;
  if (isTrustedMeshMessage(part, sessionID)) return true;
  const meta = guardianMetadata(part);
  if (
    part.type === 'synthetic' ||
    part.synthetic === true ||
    part.ignored === true ||
    meta?.['opencode-smart-questions'] === true ||
    meta?.[GUARDIAN_PROVENANCE_KEY] === true ||
    meta?.['opencode-hi'] === true ||
    isRecord(meta?.hi) ||
    typeof meta?.['hi-internal'] === 'string' ||
    typeof meta?.['hi-message'] === 'string'
  ) {
    return true;
  }
  return isRecord(part.prompt)
    ? isInternalNonHumanPart(part.prompt, sessionID)
    : false;
}

export function isInternalNonHumanMessage(
  value: unknown,
  sessionID?: string
): boolean {
  if (!isRecord(value)) return false;
  if (isTrustedMeshMessage(value, sessionID)) return true;
  if (isGuardianOwnedNonHumanMessage(value)) return true;

  const meta = guardianMetadata(value);
  if (
    value.type === 'synthetic' ||
    value.synthetic === true ||
    value.ignored === true ||
    meta?.['opencode-smart-questions'] === true ||
    meta?.[GUARDIAN_PROVENANCE_KEY] === true ||
    meta?.['opencode-hi'] === true ||
    isRecord(meta?.hi) ||
    typeof meta?.['hi-internal'] === 'string' ||
    typeof meta?.['hi-message'] === 'string'
  ) {
    return true;
  }

  const parts = messageParts(value);
  if (parts?.some((part) => isInternalNonHumanPart(part, sessionID))) {
    return true;
  }

  if (isRecord(value.prompt) && isInternalNonHumanMessage(value.prompt, sessionID)) {
    return true;
  }
  if (isRecord(value.info) && isInternalNonHumanMessage(value.info, sessionID)) {
    return true;
  }

  return isRecord(value.message)
    ? isInternalNonHumanMessage(value.message, sessionID)
    : false;
}

function messageRole(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.role === 'string') return value.role;
  if (typeof value.type === 'string' && value.type === 'user') return 'user';

  if (isRecord(value.info) && typeof value.info.role === 'string') {
    return value.info.role;
  }
  if (isRecord(value.message)) {
    return messageRole(value.message);
  }
  return undefined;
}

function messageParts(value: unknown): unknown[] | undefined {
  if (!isRecord(value)) return undefined;
  if (Array.isArray(value.parts)) return value.parts;
  if (Array.isArray(value.content)) return value.content;
  if (isRecord(value.prompt)) {
    const promptParts = messageParts(value.prompt);
    if (promptParts) return promptParts;
  }
  if (isRecord(value.message)) return messageParts(value.message);
  return undefined;
}

function messageTextCandidates(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const out: string[] = [];
  if (typeof value.text === 'string') out.push(value.text);
  if (typeof value.content === 'string') out.push(value.content);
  if (isRecord(value.payload) && typeof value.payload.text === 'string') {
    out.push(value.payload.text);
  }

  const parts = messageParts(value);
  if (parts) {
    for (const part of parts) {
      if (isRecord(part) && typeof part.text === 'string') {
        out.push(part.text);
      }
    }
  }

  if (isRecord(value.prompt)) {
    out.push(...messageTextCandidates(value.prompt));
  }
  if (isRecord(value.message)) {
    out.push(...messageTextCandidates(value.message));
  }
  return out;
}

/**
 * Register Smart Questions capability in the global OpenCode coordination registry.
 */
const SQ_COUNT_SYMBOL = Symbol.for('opencode.coordination.sq.count.v1');

export function registerSmartQuestionsCapability(
  directory?: string,
  onSessionForget?: (sessionID: string) => void
): () => void {
  const g = globalThis as unknown as { [SQ_COUNT_SYMBOL]?: number };
  g[SQ_COUNT_SYMBOL] = (g[SQ_COUNT_SYMBOL] ?? 0) + 1;
  const unregisterMesh = registerMeshPeer({
    id: 'opencode-smart-questions',
    directory,
    capabilities: ['interaction.ask'],
    onSessionForget: (sessionID: string) => {
      clearActiveHandoff(sessionID);
      onSessionForget?.(sessionID);
    },
  });
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const nextCount = Math.max(0, (g[SQ_COUNT_SYMBOL] ?? 1) - 1);
    if (nextCount === 0) {
      delete g[SQ_COUNT_SYMBOL];
    } else {
      g[SQ_COUNT_SYMBOL] = nextCount;
    }
    unregisterMesh();
  };
}

/**
 * Check if Guardian is registered in the in-process capability registry.
 */
export function getGuardianCapability():
  | OpenCodeCoordinationRegistry['guardian']
  | undefined {
  const globalObj = globalThis as unknown as {
    [COORDINATION_SYMBOL]?: OpenCodeCoordinationRegistry;
  };
  return globalObj[COORDINATION_SYMBOL]?.guardian;
}

/**
 * Parse a syntactically valid OpenCode handoff block.
 * This is a pure protocol parser; callers handling untrusted messages must use
 * extractTrustedGuardianHandoff() or extractHandoffFromParts() with provenance enabled.
 */
export function parseOpenCodeHandoff(
  text: unknown,
  options?: ParseHandoffOptions | boolean
): OpenCodeHandoff | null {
  if (typeof text !== 'string' || !text.includes(OPENCODE_HANDOFF_HEADER)) return null;

  const requireMarker =
    typeof options === 'boolean'
      ? options
      : Boolean(options?.requireRemediationMarker);

  if (
    requireMarker &&
    !text.includes(GUARDIAN_REMEDIATION_MARKER) &&
    !text.includes(MESH_REMEDIATION_MARKER)
  ) {
    return null;
  }

  const match = /\[OPENCODE_HANDOFF:v1\]\s*([\s\S]*?)(?:\n\n|\r\n\r\n|$)/.exec(text);
  if (!match || !match[1]) return null;

  const lines = match[1].split(/\r?\n/);
  const map = new Map<string, string>();
  for (const line of lines) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      map.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
    }
  }

  const source = map.get('source')?.toLowerCase();
  const action = map.get('action');
  const kind = map.get('kind') as HandoffKind | undefined;
  const autoSelect = map.get('auto_select') as HandoffAutoSelect | undefined;
  const handoffId = map.get('handoff_id');

  if (
    !source ||
    !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(source) ||
    action !== 'question_required' ||
    !handoffId
  ) {
    return null;
  }
  if (kind !== 'clarification' && kind !== 'choice' && kind !== 'approval') {
    return null;
  }
  if (autoSelect !== 'allowed' && autoSelect !== 'forbidden') {
    return null;
  }

  return {
    version: 'v1',
    source,
    action: 'question_required',
    kind,
    autoSelect,
    handoffId,
  };
}

/**
 * Format an OpenCode handoff descriptor to the versioned text protocol block.
 */
export function formatOpenCodeHandoff(
  handoff: Omit<OpenCodeHandoff, 'version' | 'source'> | OpenCodeHandoff
): string {
  const h = handoff as Omit<OpenCodeHandoff, 'version' | 'source'>;
  return [
    OPENCODE_HANDOFF_HEADER,
    'source=guardian',
    `action=${h.action}`,
    `kind=${h.kind}`,
    `auto_select=${h.autoSelect}`,
    `handoff_id=${h.handoffId}`,
  ].join('\n');
}

function isSyntheticCarrier(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const meta = guardianMetadata(value);
  const meshEnv = isRecord(meta?.['opencode-mesh']) ? meta['opencode-mesh'] : undefined;
  const info = isRecord(value.info) ? value.info : undefined;
  const prompt = isRecord(value.prompt) ? value.prompt : undefined;
  return (
    value.type === 'synthetic' ||
    value.synthetic === true ||
    value.ignored === true ||
    info?.type === 'synthetic' ||
    info?.synthetic === true ||
    info?.ignored === true ||
    prompt?.type === 'synthetic' ||
    prompt?.synthetic === true ||
    prompt?.ignored === true ||
    meta?.synthetic === true ||
    meta?.internal === true ||
    meta?.autoContinue === true ||
    meshEnv?.synthetic === true ||
    typeof meta?.['hi-internal'] === 'string' ||
    typeof meta?.['hi-message'] === 'string'
  );
}

function hasMeshHandoffProvenance(
  value: unknown,
  parentSynthetic = false,
  sessionID?: string
): boolean {
  if (!isRecord(value)) return false;
  const meta = guardianMetadata(value);
  if (!meta) return false;
  // Guardian messages must always satisfy hasGuardianMetadata(value, 'remediation').
  if (meta[GUARDIAN_PROVENANCE_KEY] === true) return false;

  const meshEnv = isRecord(meta['opencode-mesh']) ? meta['opencode-mesh'] : undefined;
  if (meshEnv?.owner === 'opencode-guardian') return false;
  if (meshEnv?.synthetic === false) return false;

  if (sessionID && verifyMeshMetadata(sessionID, meta, ['remediation', 'handoff'])) {
    return true;
  }

  if (!parentSynthetic && !isSyntheticCarrier(value)) return false;

  if (meshEnv && typeof meshEnv.token === 'string' && meshEnv.token.length > 0) {
    return meshEnv.kind === 'remediation' || meshEnv.kind === 'handoff';
  }

  return (
    meta['opencode-hi'] === true ||
    isRecord(meta.hi) ||
    typeof meta['hi-internal'] === 'string' ||
    typeof meta['hi-message'] === 'string'
  );
}

/**
 * Extract a handoff from V1-style message parts.
 * Marker and host provenance are both required by default.
 */
export function extractHandoffFromParts(
  parts: unknown,
  options?: ExtractHandoffOptions | boolean
): OpenCodeHandoff | null {
  if (!Array.isArray(parts)) return null;

  const requireMarker =
    typeof options === 'boolean'
      ? options
      : (options?.requireRemediationMarker ?? true);
  const requireProvenance =
    typeof options === 'boolean'
      ? true
      : (options?.requireGuardianProvenance ?? true);
  const parentMeshProvenance =
    typeof options === 'object' ? Boolean(options?.parentMeshProvenance) : false;
  const sessionID =
    typeof options === 'object' ? options?.sessionID : undefined;

  for (const part of parts) {
    if (!isRecord(part) || typeof part.text !== 'string') continue;
    const isMeshPart =
      parentMeshProvenance || hasMeshHandoffProvenance(part, false, sessionID);
    if (requireProvenance && !hasGuardianMetadata(part, 'remediation') && !isMeshPart) continue;
    if (
      requireProvenance &&
      !isMeshPart &&
      part.synthetic !== true &&
      part.ignored !== true &&
      guardianMetadata(part)?.[GUARDIAN_KIND_KEY] !== 'remediation'
    ) {
      continue;
    }

    const parsed = parseOpenCodeHandoff(part.text, false);
    if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
      continue;
    }
    const hasMarker =
      part.text.includes(GUARDIAN_REMEDIATION_MARKER) ||
      part.text.includes(MESH_REMEDIATION_MARKER);
    if (
      requireMarker &&
      !hasMarker &&
      !(isMeshPart && parsed.source !== 'guardian')
    ) {
      continue;
    }
    return parsed as OpenCodeHandoff;
  }
  return null;
}

/**
 * Extract a Guardian or mesh handoff only when the host object carries trusted provenance.
 * Supports V1 part metadata and V2 synthetic/message metadata without importing sibling plugins.
 */
export function extractTrustedGuardianHandoff(
  source: unknown,
  sessionID?: string
): OpenCodeHandoff | null {
  if (!isRecord(source)) return null;

  const message = isRecord(source.message) ? source.message : undefined;
  const prompt = isRecord(source.prompt) ? source.prompt : undefined;
  const syntheticCarrier =
    isSyntheticCarrier(source) ||
    isSyntheticCarrier(message) ||
    isSyntheticCarrier(prompt);
  const directProvenance =
    hasGuardianMetadata(source, 'remediation') ||
    hasGuardianMetadata(source.info, 'remediation') ||
    hasGuardianMetadata(prompt, 'remediation') ||
    hasGuardianMetadata(message, 'remediation') ||
    (message ? hasGuardianMetadata(message.info, 'remediation') : false);
  const meshProvenance =
    hasMeshHandoffProvenance(source, syntheticCarrier, sessionID) ||
    hasMeshHandoffProvenance(source.info, syntheticCarrier, sessionID) ||
    hasMeshHandoffProvenance(prompt, syntheticCarrier, sessionID) ||
    hasMeshHandoffProvenance(message, syntheticCarrier, sessionID) ||
    (message ? hasMeshHandoffProvenance(message.info, syntheticCarrier, sessionID) : false);

  const parts = messageParts(source);
  if (parts) {
    const fromParts = extractHandoffFromParts(parts, {
      requireRemediationMarker: true,
      requireGuardianProvenance: !(directProvenance || meshProvenance),
      parentMeshProvenance: meshProvenance && !directProvenance,
      sessionID,
    });
    if (fromParts && typeof fromParts === 'object' && 'version' in fromParts) {
      return fromParts as OpenCodeHandoff;
    }
  }

  if ((directProvenance && isGuardianOwnedNonHumanMessage(source)) || meshProvenance) {
    for (const text of messageTextCandidates(source)) {
      const parsed = parseOpenCodeHandoff(text, false);
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed)) {
        continue;
      }
      const hasMarker =
        text.includes(GUARDIAN_REMEDIATION_MARKER) ||
        text.includes(MESH_REMEDIATION_MARKER);
      if (!hasMarker && !(meshProvenance && parsed.source !== 'guardian')) {
        continue;
      }
      return parsed as OpenCodeHandoff;
    }
  }
  return null;
}

/**
 * Return the latest trusted Guardian handoff in the current human turn.
 * Scanning stops at the first newer ordinary user message, so an older
 * remediation cannot be resurrected for a later user request.
 */
export function extractCurrentTurnGuardianHandoff(
  messages: unknown,
  sessionID?: string
): OpenCodeHandoff | null {
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const handoff = extractTrustedGuardianHandoff(message, sessionID);
    if (handoff) {
      return handoff;
    }
    if (
      messageRole(message) === 'user' &&
      !isInternalNonHumanMessage(message, sessionID)
    ) {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// In-Memory Handoff Tracking & Loop Prevention (Process-wide Symbol State)
// ---------------------------------------------------------------------------

const HANDOFF_STATE_SYMBOL = Symbol.for('opencode.handoff.state.v1');

interface TrackedHandoff {
  handoff: OpenCodeHandoff;
  createdAt: number;
}

interface HandoffGlobalState {
  activeHandoffsBySession: Map<string, TrackedHandoff>;
  closedHandoffIds: Map<string, number>;
  remediatedFormsById?: Map<string, string>;
  consumedHandoffIds?: Set<string>;
}

function getHandoffState(): HandoffGlobalState {
  const g = globalThis as unknown as {
    [HANDOFF_STATE_SYMBOL]?: HandoffGlobalState;
  };
  let state = g[HANDOFF_STATE_SYMBOL];
  if (!state) {
    state = {
      activeHandoffsBySession: new Map(),
      closedHandoffIds: new Map(),
      remediatedFormsById: new Map(),
    };
    g[HANDOFF_STATE_SYMBOL] = state;
  }

  if (!(state.activeHandoffsBySession instanceof Map)) {
    state.activeHandoffsBySession = new Map();
  }
  if (!(state.closedHandoffIds instanceof Map)) {
    state.closedHandoffIds = new Map();
  }
  if (!(state.remediatedFormsById instanceof Map)) {
    state.remediatedFormsById = new Map();
  }

  // Hot-reload compatibility with v1 state that used an unbounded Set.
  if (state.consumedHandoffIds instanceof Set && state.consumedHandoffIds.size > 0) {
    const now = Date.now();
    for (const id of state.consumedHandoffIds) {
      state.closedHandoffIds.set(id, now);
    }
    state.consumedHandoffIds.clear();
  }

  return state;
}

function pruneClosedHandoffs(state: HandoffGlobalState, now = Date.now()): void {
  for (const [handoffId, closedAt] of state.closedHandoffIds) {
    if (now - closedAt > CLOSED_HANDOFF_TTL_MS) {
      state.closedHandoffIds.delete(handoffId);
    }
  }

  while (state.closedHandoffIds.size > MAX_CLOSED_HANDOFF_IDS) {
    const oldest = state.closedHandoffIds.keys().next().value as string | undefined;
    if (!oldest) break;
    state.closedHandoffIds.delete(oldest);
  }
}

function closeHandoffId(
  state: HandoffGlobalState,
  handoffId: string,
  now = Date.now()
): void {
  pruneClosedHandoffs(state, now);
  state.closedHandoffIds.delete(handoffId);
  state.closedHandoffIds.set(handoffId, now);
  pruneClosedHandoffs(state, now);
}

function boundActiveHandoffs(
  state: HandoffGlobalState,
  now = Date.now()
): void {
  while (state.activeHandoffsBySession.size > MAX_ACTIVE_HANDOFFS) {
    const oldestSessionID = state.activeHandoffsBySession.keys().next().value as
      | string
      | undefined;
    if (!oldestSessionID) break;
    const oldest = state.activeHandoffsBySession.get(oldestSessionID);
    state.activeHandoffsBySession.delete(oldestSessionID);
    if (oldest?.handoff.handoffId) {
      closeHandoffId(state, oldest.handoff.handoffId, now);
    }
  }
}

/**
 * Store an active handoff for a session.
 * Fails safe and ignores recently closed handoff IDs to prevent replay loops.
 */
export function setActiveHandoff(
  sessionID: string,
  handoff: OpenCodeHandoff,
  timestamp?: number
): boolean {
  const sID = String(sessionID ?? '');
  const h = handoff;
  if (!sID || !h?.handoffId) return false;

  const state = getHandoffState();
  pruneClosedHandoffs(state);
  if (state.closedHandoffIds.has(h.handoffId)) {
    return false;
  }

  // Refresh insertion order when a session receives a newer handoff so the
  // bounded map evicts truly oldest session state first.
  state.activeHandoffsBySession.delete(sID);
  state.activeHandoffsBySession.set(sID, {
    handoff: h,
    createdAt: typeof timestamp === 'number' ? timestamp : Date.now(),
  });
  boundActiveHandoffs(state);
  return true;
}

/**
 * Retrieve the active handoff for a session, if any.
 * Expired IDs are closed so message-history fallback cannot revive them.
 */
export function getActiveHandoff(
  sessionID: string,
  maxAgeMs = DEFAULT_HANDOFF_TTL_MS
): OpenCodeHandoff | undefined {
  const sID = String(sessionID ?? '');
  if (!sID) return undefined;

  const state = getHandoffState();
  pruneClosedHandoffs(state);
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return undefined;

  const age = Date.now() - entry.createdAt;
  if (age > maxAgeMs) {
    state.activeHandoffsBySession.delete(sID);
    closeHandoffId(state, entry.handoff.handoffId);
    return undefined;
  }
  return entry.handoff;
}

/**
 * Check if automatic selection is permitted under the current handoff for this session.
 */
export function isHandoffAutoSelectAllowed(
  sessionID: string,
  maxAgeMs = DEFAULT_HANDOFF_TTL_MS
): boolean {
  const sID = String(sessionID ?? '');
  if (!sID) return true;
  const active = getActiveHandoff(sID, maxAgeMs);
  if (!active) return true;
  return active.autoSelect === 'allowed';
}

/**
 * Mark an active handoff as consumed and prevent immediate replay.
 */
export function consumeActiveHandoff(
  sessionID: string
): OpenCodeHandoff | undefined {
  const sID = String(sessionID ?? '');
  if (!sID) return undefined;

  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return undefined;

  closeHandoffId(state, entry.handoff.handoffId);
  state.activeHandoffsBySession.delete(sID);
  return entry.handoff;
}

/**
 * Invalidate an active handoff because its human turn ended.
 * Unlike a plain clear, invalidation also prevents history-based resurrection.
 */
export function invalidateActiveHandoff(
  sessionID: string
): OpenCodeHandoff | undefined {
  const sID = String(sessionID ?? '');
  if (!sID) return undefined;

  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return undefined;

  closeHandoffId(state, entry.handoff.handoffId);
  state.activeHandoffsBySession.delete(sID);
  return entry.handoff;
}

/**
 * Clear the active handoff for a session without closing its ID.
 * Use invalidateActiveHandoff() when a new human turn makes replay invalid.
 */
export function clearActiveHandoff(sessionID: string): void {
  const sID = String(sessionID ?? '');
  if (!sID) return;
  getHandoffState().activeHandoffsBySession.delete(sID);
}

export function markFormRemediated(formID: string, sessionID: string): void {
  if (!formID || !sessionID) return;
  const map = getHandoffState().remediatedFormsById!;
  if (map.has(formID)) map.delete(formID);
  map.set(formID, sessionID);
  while (map.size > MAX_ACTIVE_HANDOFFS) {
    const oldest = map.keys().next().value;
    if (!oldest) break;
    map.delete(oldest);
  }
}

export function unmarkFormRemediated(formID: string): void {
  if (!formID) return;
  getHandoffState().remediatedFormsById?.delete(formID);
}

export function isFormRemediated(formID?: string, sessionID?: string): boolean {
  const map = getHandoffState().remediatedFormsById;
  if (!map) return false;
  if (formID && map.has(formID)) {
    return sessionID ? map.get(formID) === sessionID : true;
  }
  if (sessionID) {
    for (const sid of map.values()) {
      if (sid === sessionID) return true;
    }
  }
  return false;
}

/**
 * Reset all handoff tracking state (primarily for test isolation).
 */
export function resetHandoffTracking(): void {
  const state = getHandoffState();
  state.activeHandoffsBySession.clear();
  state.closedHandoffIds.clear();
  state.remediatedFormsById?.clear();
  state.consumedHandoffIds?.clear();
}
