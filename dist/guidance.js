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
        `For ALL questions (single-choice, multi-choice, and multi-step sequential questions: step 1, 2, 3): ` +
        `You MUST designate your recommended choice for EVERY question/step by appending "${primaryMarker}" (accepted: ${markerList}) so the system automatically selects it and continues execution. ` +
        `Do not leave any step in a multi-step question unclassified. ` +
        `When human approval is genuinely required for destructive/irreversible actions, include "${primaryManualMarker}". ` +
        `When responding to a Guardian remediation with [OPENCODE_HANDOFF:v1] (action=question_required): ` +
        `If auto_select=allowed, append "${primaryMarker}" to the recommended option. ` +
        `If auto_select=forbidden, explicitly classify with "${primaryManualMarker}".`;
    const system = `\n${SQ_GUIDANCE_SENTINEL}\n## Smart Question Auto-Selection Guidance\n` +
        `- If the user's existing instructions already determine the next action, do not ask a new question or create a form; continue the requested work.\n` +
        `- When a genuine unresolved user choice remains, you MUST use the host's native question/form mechanism for selectable choices; do not present them only as plain assistant text.\n` +
        `- For ALL selectable questions (single-choice, multi-choice, or multi-step 1, 2, 3 questions):\n` +
        `  * ALWAYS designate the recommended option for every question/step by appending "${primaryMarker}" (accepted: ${markerList}) so autonomous progress is maintained.\n` +
        `  * When explicit human approval is required for destructive or irreversible actions, include "${primaryManualMarker}".\n` +
        `- Never emit an unclassified selectable question or omit recommendations in any step.\n\n` +
        `### Guardian Remediation Handoff Protocol\n` +
        `When a message includes [OPENCODE_HANDOFF:v1] with action=question_required:\n` +
        `- You MUST use the native question/form mechanism rather than replying in plain prose.\n` +
        `- If auto_select=allowed: append "${primaryMarker}" to the recommended option for automatic progression.\n` +
        `- If auto_select=forbidden: explicitly include "${primaryManualMarker}" so human approval is awaited.\n`;
    return { primaryMarker, markerList, primaryManualMarker, tool, system };
}
