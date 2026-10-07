export const SQ_GUIDANCE_SENTINEL = '[SQ_GUIDANCE:v1]';
export function buildRecommendationGuidance(config) {
    const markers = config.recommendedMarkers && config.recommendedMarkers.length > 0
        ? config.recommendedMarkers
        : ['[SQ:recommended]', '(Recommended)', '(Önerilen)'];
    const primaryMarker = markers[0] ?? '[SQ:recommended]';
    const markerList = markers.map((marker) => `"${marker}"`).join(', ');
    const manualMarkers = config.manualMarkers && config.manualMarkers.length > 0
        ? config.manualMarkers
        : ['[SQ:manual]'];
    const primaryManualMarker = manualMarkers[0] ?? '[SQ:manual]';
    const tool = `\n\n${SQ_GUIDANCE_SENTINEL} [SMART QUESTIONS CLASSIFICATION CONVENTION]: ` +
        `If the user's existing instructions already determine the next action, do not ask a new question or create a form; continue the requested work. ` +
        `When a genuine unresolved user choice remains and this native question tool is available, you MUST use it for selectable-choice questions instead of presenting those choices only as plain assistant text. ` +
        `Every selectable root-agent question MUST be explicitly classified into AUTO or MANUAL: ` +
        `1. AUTO: Append the exact token "${primaryMarker}" to the label of each option you recommend. Accepted recommendation markers: ${markerList}. A marked option may be auto-selected after the user's countdown. ` +
        `2. MANUAL: Include "${primaryManualMarker}" in the question or option text when explicit human approval is genuinely required (such as destructive or irreversible actions, credentials, or release permissions). ` +
        `Do not merely omit recommendation markers for a manual question; you must explicitly classify it with "${primaryManualMarker}". ` +
        `Never leave a selectable question unclassified. ` +
        `When responding to a Guardian remediation with [OPENCODE_HANDOFF:v1] (action=question_required): ` +
        `If auto_select=allowed, append "${primaryMarker}" to the recommended option. ` +
        `If auto_select=forbidden, explicitly classify with "${primaryManualMarker}" to require human approval.`;
    const system = `\n${SQ_GUIDANCE_SENTINEL}\n## Smart Question Auto-Selection Guidance\n` +
        `When presenting selectable choices to the user:\n` +
        `- If the user's existing instructions already determine the next action, do not ask a new question or create a form; continue the requested work.\n` +
        `- When a genuine unresolved user choice remains, you MUST use the host's native question/form mechanism for selectable choices; do not present them only as plain assistant text.\n` +
        `- Every selectable root question MUST be classified:\n` +
        `  * AUTO: append the language-neutral token "${primaryMarker}" to each recommended option. Accepted markers: ${markerList}.\n` +
        `  * MANUAL: include the token "${primaryManualMarker}" when human approval is required (including destructive/irreversible operations, credentials, or releases).\n` +
        `- Do NOT merely omit the recommendation marker for a manual question; explicitly classify it with "${primaryManualMarker}".\n` +
        `- Never emit an unclassified selectable question without either recommendation or manual classification.\n\n` +
        `### Guardian Remediation Handoff Protocol\n` +
        `When a message includes [OPENCODE_HANDOFF:v1] with action=question_required:\n` +
        `- You MUST use the native question/form mechanism rather than replying in plain prose.\n` +
        `- If auto_select=allowed: append "${primaryMarker}" to the recommended option for automatic progression.\n` +
        `- If auto_select=forbidden: explicitly include "${primaryManualMarker}" so human approval is awaited.\n`;
    return { primaryMarker, markerList, primaryManualMarker, tool, system };
}
