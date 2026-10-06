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
    return record;
}
export function classifySessionScope(value) {
    const session = unwrapSessionInfo(value);
    if (!session || typeof session.id !== 'string' || !session.id) {
        return 'unknown';
    }
    const parentID = session.parentID;
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
export async function resolveV1SessionScope(client, sessionID, directory) {
    if (!sessionID)
        return 'unknown';
    const clientRecord = asRecord(client);
    const sessionApi = asRecord(clientRecord?.session);
    const get = sessionApi?.get;
    if (typeof get !== 'function')
        return 'unknown';
    try {
        const response = await get.call(sessionApi, {
            path: { id: sessionID },
            ...(directory ? { query: { directory } } : {}),
        });
        return classifySessionScope(response);
    }
    catch {
        return 'unknown';
    }
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
