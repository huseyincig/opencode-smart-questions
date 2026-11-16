export type SessionScope = 'root' | 'child' | 'unknown';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

function unwrapSessionInfo(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;

  const data = asRecord(record.data);
  if (data) return data;

  const info = asRecord(record.info);
  if (info) return info;

  return record;
}

export function classifySessionScope(value: unknown): SessionScope {
  const session = unwrapSessionInfo(value);
  const id = session?.id ?? (session as Record<string, unknown> | null)?.sessionID;
  if (!session || typeof id !== 'string' || !id) {
    return 'unknown';
  }

  const parentID = session.parentID ?? (session as Record<string, unknown>).parentId;
  if (typeof parentID === 'string') {
    return parentID.trim() ? 'child' : 'root';
  }
  if (parentID === undefined || parentID === null) {
    return 'root';
  }
  return 'unknown';
}

export function isRootSessionInfo(value: unknown): boolean {
  return classifySessionScope(value) === 'root';
}

export function isEligibleSessionScope(
  scope: SessionScope,
  includeSubagents = false
): boolean {
  if (scope === 'root') return true;
  if (includeSubagents && scope === 'child') return true;
  return false;
}

export function isEligibleSessionInfo(
  value: unknown,
  includeSubagents = false
): boolean {
  return isEligibleSessionScope(classifySessionScope(value), includeSubagents);
}

export async function resolveV2SessionScope(
  sessionApi: unknown,
  sessionID: string
): Promise<SessionScope> {
  if (!sessionID) return 'unknown';

  const api = asRecord(sessionApi);
  const get = api?.get;
  if (typeof get !== 'function') return 'unknown';

  try {
    const response = await get.call(api, { sessionID });
    return classifySessionScope(response);
  } catch {
    return 'unknown';
  }
}
