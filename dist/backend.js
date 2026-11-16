export const SQ_REMEDIATION_HEADER = '[Smart Questions protocol remediation]';
export function buildUnclassifiedRemediationPrompt(primaryMarker = '[SQ:recommended]', manualMarker = '[SQ:manual]') {
    const recMarker = typeof primaryMarker === 'string' && primaryMarker ? primaryMarker : '[SQ:recommended]';
    return [
        SQ_REMEDIATION_HEADER,
        '',
        'This selectable question is unclassified.',
        '',
        'Do not leave a root-agent selectable question waiting indefinitely.',
        '',
        'Either:',
        '',
        '1. mark the safest/recommended option with the canonical',
        `   ${recMarker}`,
        '   token so Smart Questions can continue automatically,',
        '',
        'or',
        '',
        '2. explicitly classify the question as manual approval using',
        `   the Smart Questions manual-decision protocol (${manualMarker}) when human`,
        '   approval is genuinely required.',
        '',
        'Do not ask the same unclassified question again.',
    ].join('\n');
}
