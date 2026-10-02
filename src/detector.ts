import { DEFAULT_CONFIG, normalizeParamMarkers } from './config.js';
import type { DetectionResult, QuestionInfo, QuestionOption } from './types.js';

/**
 * Pure decision logic for detecting recommendations across questions.
 * Enforces fail-safe conditions:
 * - Empty questions list -> fail
 * - Zero recommended options in ANY question -> fail
 * - More than 1 recommended options in ANY single-select question -> fail
 * - Exact suffix matching on marker
 */
export function detectRecommendations(pluginInput: Record<string, unknown>): Record<string, unknown>;
export function detectRecommendations(
  questions: QuestionInfo[],
  marker?: string | string[],
  options?: { requireExactlyOneRecommendation?: boolean }
): DetectionResult;
export function detectRecommendations(
  questions: QuestionInfo[] | Record<string, unknown>,
  marker: string | string[] = DEFAULT_CONFIG.recommendedMarkers,
  options: { requireExactlyOneRecommendation?: boolean } = {}
): DetectionResult | Record<string, unknown> {
  // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
  if (
    questions &&
    typeof questions === 'object' &&
    !Array.isArray(questions) &&
    ('client' in questions || 'directory' in questions)
  ) {
    return {};
  }
  const requireOne = options.requireExactlyOneRecommendation !== false;

  if (!Array.isArray(questions) || questions.length === 0) {
    return { ok: false, reason: 'No questions provided in request' };
  }

  const markers = normalizeParamMarkers(marker);
  const markerDesc =
    markers.length === 1
      ? `"${markers[0]}"`
      : `(accepted: ${markers.map((m) => `"${m}"`).join(', ')})`;

  const answers: string[][] = [];
  const recommendedOptions: QuestionOption[] = [];
  let matchedMarker: string | undefined;

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const qIndex = i + 1;

    if (!q) {
      return { ok: false, reason: `Question ${qIndex} is null or undefined` };
    }

    if (!Array.isArray(q.options) || q.options.length === 0) {
      return { ok: false, reason: `Question ${qIndex} has no options` };
    }

    // Exact suffix matching: label must end with configured marker
    const matched = q.options
      .map((opt) => {
        if (!opt || typeof opt.label !== 'string') return null;
        const normalizedLabel = opt.label.trimEnd().normalize('NFC');
        const m = markers.find(
          (marker) => normalizedLabel.endsWith(marker.normalize('NFC'))
        );
        return m ? { opt, marker: m } : null;
      })
      .filter((x) => x !== null) as { opt: QuestionOption; marker: string }[];

    if (matched.length === 0) {
      return {
        ok: false,
        reason: `Question ${qIndex} has no options ending with marker ${markerDesc}`,
      };
    }

    if (!q.multiple && matched.length > 1) {
      return {
        ok: false,
        reason: `Question ${qIndex} has ${matched.length} options ending with marker ${markerDesc} (expected exactly 1)`,
      };
    }

    if (!q.multiple && requireOne && matched.length !== 1) {
      return {
        ok: false,
        reason: `Question ${qIndex} has ${matched.length} recommendations (requireExactlyOneRecommendation is true)`,
      };
    }

    if (!matchedMarker) {
      matchedMarker = matched[0].marker;
    }

    if (q.multiple) {
      answers.push(matched.map((m) => m.opt.label));
      recommendedOptions.push(...matched.map((m) => m.opt));
    } else {
      // Verbatim label copied from event payload
      answers.push([matched[0].opt.label]);
      recommendedOptions.push(matched[0].opt);
    }
  }

  return { ok: true, answers, recommendedOptions, matchedMarker };
}
