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
      : ['(Recommended)', '(Önerilen)'];
  const primaryMarker = markers[0];
  const markerList = markers.map((marker) => `"${marker}"`).join(', ');

  const tool =
    `\n\n[RECOMMENDED OPTION CONVENTION]: ` +
    `When providing choices, append "${primaryMarker}" to the label of each option you recommend. ` +
    `Accepted markers: ${markerList}. ` +
    `For multi-select questions, one or more options may be marked. ` +
    `A marked option may be auto-selected after the user's configured countdown. ` +
    `Do not add a marker when you genuinely require an unaided manual choice.`;

  const system =
    `\n## Smart Question Auto-Selection Guidance\n` +
    `When presenting selectable choices to the user:\n` +
    `- Append "${primaryMarker}" to every option you recommend.\n` +
    `- Accepted recommendation markers: ${markerList}.\n` +
    `- Multi-select prompts may mark one or more recommended options.\n` +
    `- Marked choices can be auto-selected after the user's configured countdown.\n` +
    `- Do not mark an option when you need a completely manual choice.\n`;

  return { primaryMarker, markerList, tool, system };
}
