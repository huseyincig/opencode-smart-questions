import type { SmartQuestionConfig } from './types.js';

export function buildRecommendationGuidance(config: SmartQuestionConfig): {
  primaryMarker: string;
  markerList: string;
  tool: string;
  system: string;
} {
  const markers =
    config.recommendedMarkers && config.recommendedMarkers.length > 0
      ? config.recommendedMarkers
      : ['[SQ:recommended]', '(Recommended)', '(Önerilen)'];
  const primaryMarker = markers[0];
  const markerList = markers.map((marker) => `"${marker}"`).join(', ');

  const tool =
    `\n\n[RECOMMENDED OPTION CONVENTION]: ` +
    `Regardless of the language used for the question and option text, append the exact token "${primaryMarker}" to the label of each option you recommend. ` +
    `Accepted markers: ${markerList}. ` +
    `For multi-select questions, one or more options may be marked. ` +
    `A marked option may be auto-selected after the user's configured countdown. ` +
    `Do not add a marker to choices requiring explicit human approval (such as destructive or irreversible actions) or when you need an unaided manual choice.`;

  const system =
    `\n## Smart Question Auto-Selection Guidance\n` +
    `When presenting selectable choices to the user:\n` +
    `- Write the question and option text in the user's language; append the exact, language-neutral token "${primaryMarker}" to each recommended option.\n` +
    `- Accepted recommendation markers: ${markerList}.\n` +
    `- Multi-select prompts may mark one or more recommended options.\n` +
    `- Marked choices can be auto-selected after the user's configured countdown.\n` +
    `- Never mark choices that require explicit human approval (including destructive or irreversible actions); leave those for manual selection.\n` +
    `- Do not mark an option when you need a completely manual choice.\n`;

  return { primaryMarker, markerList, tool, system };
}
