export const SQ_GUIDANCE_SENTINEL = '[SQ_GUIDANCE:v1]';
export function buildRecommendationGuidance(config) {
    const markers = config.recommendedMarkers && config.recommendedMarkers.length > 0
        ? config.recommendedMarkers
        : ['[SQ:recommended]', '(Recommended)', '(Önerilen)'];
    const primaryMarker = markers[0] ?? '[SQ:recommended]';
    const markerList = markers.map((marker) => `"${marker}"`).join(', ');
    const tool = `\n\n${SQ_GUIDANCE_SENTINEL} [RECOMMENDED OPTION CONVENTION]: ` +
        `If the user's existing instructions already determine the next action, do not ask a new question or create a form; continue the requested work. ` +
        `When a genuine unresolved user choice remains and this native question tool is available, you MUST use it for selectable-choice questions instead of presenting those choices only as plain assistant text. ` +
        `Regardless of the language used for the question and option text, append the exact token "${primaryMarker}" to the label of each option you recommend. ` +
        `Accepted markers: ${markerList}. ` +
        `For multi-select questions, one or more options may be marked. ` +
        `A marked option may be auto-selected after the user's configured countdown. ` +
        `Do not add a marker to choices requiring explicit human approval (such as destructive or irreversible actions) or when you need an unaided manual choice.`;
    const system = `\n${SQ_GUIDANCE_SENTINEL}\n## Smart Question Auto-Selection Guidance\n` +
        `When presenting selectable choices to the user:\n` +
        `- If the user's existing instructions already determine the next action, do not ask a new question or create a form; continue the requested work.\n` +
        `- Only when a genuine unresolved user choice remains, you MUST use the host's native question/form mechanism for selectable choices whenever it is available; do not present those choices only as plain assistant text.\n` +
        `- Write the question and option text in the user's language; append the exact, language-neutral token "${primaryMarker}" to each recommended option.\n` +
        `- Accepted recommendation markers: ${markerList}.\n` +
        `- Multi-select prompts may mark one or more recommended options.\n` +
        `- Marked choices can be auto-selected after the user's configured countdown.\n` +
        `- Never mark choices that require explicit human approval (including destructive or irreversible actions); leave those for manual selection.\n` +
        `- Do not mark an option when you need a completely manual choice.\n`;
    return { primaryMarker, markerList, tool, system };
}
