export function isAutomationSessionID(sessionID) {
    return typeof sessionID === 'string' && /^ses_aut_/i.test(sessionID.trim());
}
function asRecord(value) {
    return value && typeof value === 'object'
        ? value
        : null;
}
function unwrapSessionInfo(value) {
    const record = asRecord(value);
    if (!record)
        return null;
    const data = asRecord(record.data);
    if (data)
        return data;
    const info = asRecord(record.info);
    if (info)
        return info;
    return record;
}
export function classifySessionScope(value) {
    const session = unwrapSessionInfo(value);
    const id = session?.id ?? session?.sessionID;
    if (!session || typeof id !== 'string' || !id) {
        return 'unknown';
    }
    if (isAutomationSessionID(id)) {
        return 'automation';
    }
    const parentID = session.parentID ?? session.parentId;
    if (typeof parentID === 'string') {
        return parentID.trim() ? 'child' : 'root';
    }
    if (parentID === undefined || parentID === null) {
        return 'root';
    }
    return 'unknown';
}
export function isRootSessionInfo(value) {
    return classifySessionScope(value) === 'root';
}
export function isEligibleSessionScope(scope, includeSubagents = false) {
    if (scope === 'root')
        return true;
    if (includeSubagents && scope === 'child')
        return true;
    return false;
}
export function isEligibleSessionInfo(value, includeSubagents = false) {
    return isEligibleSessionScope(classifySessionScope(value), includeSubagents);
}
export async function resolveV2SessionScope(sessionApi, sessionID) {
    if (!sessionID)
        return 'unknown';
    const api = asRecord(sessionApi);
    const get = api?.get;
    if (typeof get !== 'function')
        return 'unknown';
    try {
        const response = await get.call(api, { sessionID });
        return classifySessionScope(response);
    }
    catch {
        return 'unknown';
    }
}
