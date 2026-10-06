/**
 * OpenCode Coordination Handoff Protocol (v1)
 * Enables decoupled, autonomous collaboration between OpenCode Guardian and Smart Questions.
 */

export const OPENCODE_HANDOFF_HEADER = '[OPENCODE_HANDOFF:v1]';
export const GUARDIAN_REMEDIATION_MARKER = '[opencode-guardian remediation]';
export const DEFAULT_HANDOFF_TTL_MS = 120_000;

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

function isPluginInput(arg: unknown): boolean {
  return Boolean(
    arg &&
      typeof arg === 'object' &&
      ('client' in arg || 'directory' in arg || 'project' in arg)
  );
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
 * Parse an OpenCode handoff block from remediation or message text.
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
 * Extract an OpenCode handoff from an array of message parts.
 * By default enforces that the message contains the Guardian remediation marker (anti-spoofing).
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

  if (requireMarker) {
    const hasRemediationMarker = parts.some(
      (part) =>
        Boolean(
          part &&
            typeof part === 'object' &&
            typeof (part as { text?: unknown }).text === 'string' &&
            (part as { text: string }).text.includes(GUARDIAN_REMEDIATION_MARKER)
        )
    );
    if (!hasRemediationMarker) return null;
  }

  for (const part of parts) {
    if (part && typeof part === 'object') {
      const text = (part as { text?: unknown }).text;
      if (typeof text === 'string') {
        const parsed = parseOpenCodeHandoff(text, false);
        if (parsed && typeof parsed === 'object' && 'version' in parsed) {
          return parsed as OpenCodeHandoff;
        }
      }
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
  consumedHandoffIds: Set<string>;
}

function getHandoffState(): HandoffGlobalState {
  const g = globalThis as unknown as {
    [HANDOFF_STATE_SYMBOL]?: HandoffGlobalState;
  };
  return (g[HANDOFF_STATE_SYMBOL] ??= {
    activeHandoffsBySession: new Map(),
    consumedHandoffIds: new Set(),
  });
}

/**
 * Store an active handoff for a session.
 * Fails safe and ignores already-consumed handoff IDs to prevent loops.
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
  if (state.consumedHandoffIds.has(h.handoffId)) {
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
 * Automatically discards entries older than maxAgeMs (default 120s TTL).
 */
export function getActiveHandoff(
  sessionID: unknown,
  maxAgeMs = DEFAULT_HANDOFF_TTL_MS
): OpenCodeHandoff | Record<string, unknown> | undefined {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? '');
  if (!sID) return undefined;
  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (!entry) return undefined;

  const age = Date.now() - entry.createdAt;
  if (age > maxAgeMs) {
    state.activeHandoffsBySession.delete(sID);
    return undefined;
  }
  return entry.handoff;
}

/**
 * Check if automatic selection is permitted under the current handoff for this session.
 * Returns false if an active handoff requires explicit human approval (autoSelect === 'forbidden').
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
 * Mark an active handoff as consumed and remove it from active tracking.
 */
export function consumeActiveHandoff(
  sessionID: unknown
): OpenCodeHandoff | Record<string, unknown> | undefined {
  if (isPluginInput(sessionID)) return {};
  const sID = String(sessionID ?? '');
  if (!sID) return undefined;
  const state = getHandoffState();
  const entry = state.activeHandoffsBySession.get(sID);
  if (entry) {
    state.consumedHandoffIds.add(entry.handoff.handoffId);
    state.activeHandoffsBySession.delete(sID);
    return entry.handoff;
  }
  return undefined;
}

/**
 * Clear the active handoff for a session without adding it to consumed history.
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
  state.consumedHandoffIds.clear();
}
