/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */

export const OPENCODE_HANDOFF_HEADER = '[OPENCODE_HANDOFF:v1]';
export const GUARDIAN_REMEDIATION_MARKER = '[opencode-guardian remediation]';
export const GUARDIAN_PROVENANCE_KEY = 'opencode-guardian';
export const DEFAULT_HANDOFF_TTL_MS = 120_000;
export const CLOSED_HANDOFF_TTL_MS = 10 * 60_000;
export const MAX_CLOSED_HANDOFF_IDS = 512;

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
  requireGuardianProvenance?: boolean;
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

function isPluginInput(arg: unknown): boolean {
  return Boolean(
    arg &&
      typeof arg === 'object' &&
      ('client' in arg || 'directory' in arg || 'project' in arg)
  );
}

function hasGuardianMetadata(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const metadata = isRecord(value.metadata) ? value.metadata : undefined;
  return metadata?.[GUARDIAN_PROVENANCE_KEY] === true;
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
  if (isRecord(value.message)) return messageParts(value.message);
  return undefined;
}

function messageTextCandidates(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const out: string[] = [];
  if (typeof value.text === 'string') out.push(value.text);
  if (typeof value.content === 'string') out.push(value.content);

  const parts = messageParts(value);
  if (parts) {
    for (const part of parts) {
      if (isRecord(part) && typeof part.text === 'string') {
        out.push(part.text);
      }
    }
  }

  if (isRecord(value.message)) {
    out.push(...messageTextCandidates(value.message));
  }
  return out;
}

/**
 * Register Smart Questions capability in the global OpenCode coordination registry.
 */
export function registerSmartQuestionsCapability(arg?: unknown): void | Record<string, unknown> {
  if (isPluginInput(arg)) return {};
  const globalObj = globalThis as unknown as {
    [COORDINATION_SYMBOL]?: OpenCodeCoordinationRegistry;
  };
  const root = (globalObj[COORDINATION_SYMBOL] ??= {});
  root.smartQuestions = {
    version: 1,
    mainAgentOnly: true,
    supportsAutoSelect: true,
  };
}

/**
 * Check if Guardian is registered in the in-process capability registry.
 */
export function getGuardianCapability(arg?: unknown):
  | OpenCodeCoordinationRegistry['guardian']
  | Record<string, unknown>
  | undefined {
  if (isPluginInput(arg)) return {};
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
): OpenCodeHandoff | Record<string, unknown> | null {
  if (isPluginInput(text)) return {};
  if (typeof text !== 'string' || !text.includes(OPENCODE_HANDOFF_HEADER)) return null;

  const requireMarker =
    typeof options === 'boolean'
      ? options
      : Boolean(options?.requireRemediationMarker);

  if (requireMarker && !text.includes(GUARDIAN_REMEDIATION_MARKER)) {
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

  const source = map.get('source');
  const action = map.get('action');
  const kind = map.get('kind') as HandoffKind | undefined;
  const autoSelect = map.get('auto_select') as HandoffAutoSelect | undefined;
  const handoffId = map.get('handoff_id');

  if (source !== 'guardian' || action !== 'question_required' || !handoffId) {
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
    source: 'guardian',
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
  handoff: unknown
): string | Record<string, unknown> {
  if (isPluginInput(handoff)) return {};
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

/**
 * Extract a handoff from V1-style message parts.
 * Marker and host provenance are both required by default.
 */
export function extractHandoffFromParts(
  parts: unknown,
  options?: ExtractHandoffOptions | boolean
): OpenCodeHandoff | Record<string, unknown> | null {
  if (isPluginInput(parts)) return {};
  if (!Array.isArray(parts)) return null;

  const requireMarker =
    typeof options === 'boolean'
      ? options
      : (options?.requireRemediationMarker ?? true);
  const requireProvenance =
    typeof options === 'boolean'
      ? true
      : (options?.requireGuardianProvenance ?? true);

  for (const part of parts) {
    if (!isRecord(part) || typeof part.text !== 'string') continue;
    if (requireProvenance && !hasGuardianMetadata(part)) continue;
    if (requireMarker && !part.text.includes(GUARDIAN_REMEDIATION_MARKER)) continue;

    const parsed = parseOpenCodeHandoff(part.text, false);
    if (parsed && typeof parsed === 'object' && 'version' in parsed) {
      return parsed as OpenCodeHandoff;
    }
  }
  return null;
}

/**
 * Extract a Guardian handoff only when the host object carries Guardian provenance.
 * Supports V1 part metadata and V2 synthetic/message metadata without importing Guardian.
 */
export function extractTrustedGuardianHandoff(
  source: unknown
): OpenCodeHandoff | Record<string, unknown> | null {
  if (isPluginInput(source)) return {};
  if (!isRecord(source)) return null;

  const message = isRecord(source.message) ? source.message : undefined;
  const directProvenance =
    hasGuardianMetadata(source) ||
    hasGuardianMetadata(source.info) ||
    hasGuardianMetadata(message) ||
    (message ? hasGuardianMetadata(message.info) : false);

  const parts = messageParts(source);
  if (parts) {
    const fromParts = extractHandoffFromParts(parts, {
      requireRemediationMarker: true,
      requireGuardianProvenance: !directProvenance,
    });
    if (fromParts && typeof fromParts === 'object' && 'version' in fromParts) {
      return fromParts as OpenCodeHandoff;
    }
  }

  if (directProvenance) {
    for (const text of messageTextCandidates(source)) {
      const parsed = parseOpenCodeHandoff(text, { requireRemediationMarker: true });
      if (parsed && typeof parsed === 'object' && 'version' in parsed) {
        return parsed as OpenCodeHandoff;
      }
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
  messages: unknown
): OpenCodeHandoff | Record<string, unknown> | null {
  if (isPluginInput(messages)) return {};
  if (!Array.isArray(messages)) return null;

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const handoff = extractTrustedGuardianHandoff(message);
    if (handoff && typeof handoff === 'object' && 'version' in handoff) {
      return handoff as OpenCodeHandoff;
    }
    if (messageRole(message) === 'user') {
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
    };
    g[HANDOFF_STATE_SYMBOL] = state;
  }

  if (!(state.activeHandoffsBySession instanceof Map)) {
    state.activeHandoffsBySession = new Map();
  }
  if (!(state.closedHandoffIds instanceof Map)) {
    state.closedHandoffIds = new Map();
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

/**
 * Store an active handoff for a session.
 * Fails safe and ignores recently closed handoff IDs to prevent replay loops.
 */
export function setActiveHandoff(
  sessionID: unknown,
  handoff?: unknown,
  timestamp?: number
): boolean | Record<string, unknown> {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? '');
  const h = handoff as OpenCodeHandoff | undefined;
  if (!sID || !h?.handoffId) return false;

  const state = getHandoffState();
  pruneClosedHandoffs(state);
  if (state.closedHandoffIds.has(h.handoffId)) {
    return false;
  }

  state.activeHandoffsBySession.set(sID, {
    handoff: h,
    createdAt: typeof timestamp === 'number' ? timestamp : Date.now(),
  });
  return true;
}

/**
 * Retrieve the active handoff for a session, if any.
 * Expired IDs are closed so message-history fallback cannot revive them.
 */
export function getActiveHandoff(
  sessionID: unknown,
  maxAgeMs = DEFAULT_HANDOFF_TTL_MS
): OpenCodeHandoff | Record<string, unknown> | undefined {
  if (isPluginInput(sessionID)) return {};
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
  sessionID: unknown,
  maxAgeMs = DEFAULT_HANDOFF_TTL_MS
): boolean | Record<string, unknown> {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? '');
  if (!sID) return true;
  const active = getActiveHandoff(sID, maxAgeMs);
  if (!active || typeof active !== 'object' || !('autoSelect' in active)) return true;
  return active.autoSelect === 'allowed';
}

/**
 * Mark an active handoff as consumed and prevent immediate replay.
 */
export function consumeActiveHandoff(
  sessionID: unknown
): OpenCodeHandoff | Record<string, unknown> | undefined {
  if (isPluginInput(sessionID)) return {};
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
  sessionID: unknown
): OpenCodeHandoff | Record<string, unknown> | undefined {
  if (isPluginInput(sessionID)) return {};
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
export function clearActiveHandoff(sessionID: unknown): void | Record<string, unknown> {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? '');
  if (!sID) return;
  getHandoffState().activeHandoffsBySession.delete(sID);
}

/**
 * Reset all handoff tracking state (primarily for test isolation).
 */
export function resetHandoffTracking(arg?: unknown): void | Record<string, unknown> {
  if (isPluginInput(arg)) return {};
  const state = getHandoffState();
  state.activeHandoffsBySession.clear();
  state.closedHandoffIds.clear();
  state.consumedHandoffIds?.clear();
}
