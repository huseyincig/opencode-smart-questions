import { classifyQuestions, detectRecommendations } from './detector.js';
import { DEFAULT_CONFIG, DEFAULT_MANUAL_MARKERS, normalizeParamMarkers } from './config.js';
import type { OpenCodeHandoff } from './handoff.js';
import type { DetectionResult, QuestionInfo, QuestionOption } from './types.js';

export interface V2FormOption {
  value: string;
  label: string;
  description?: string;
}

export interface V2FormField {
  key: string;
  type: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<{ key: string; op: 'eq' | 'neq'; value: string | number | boolean }>;
  options?: V2FormOption[];
  minItems?: number;
  maxItems?: number;
  custom?: boolean;
}

export interface V2FormInfo {
  id: string;
  sessionID: string;
  title?: string;
  description?: string;
  fields: V2FormField[];
}

export type V2FormDetectionResult =
  | {
      ok: true;
      answer: Record<string, string | string[]>;
      detection: Extract<DetectionResult, { ok: true }>;
      questions: QuestionInfo[];
    }
  | {
      ok: false;
      reason: string;
    };

export type V2FormClassification =
  | {
      status: 'auto';
      answer: Record<string, string | string[]>;
      detection: Extract<DetectionResult, { ok: true }>;
      questions: QuestionInfo[];
    }
  | {
      status: 'manual';
      reason: string;
      questions: QuestionInfo[];
      matchedMarker?: string | undefined;
    }
  | {
      status: 'unclassified';
      reason: string;
      questions: QuestionInfo[];
    };

/**
 * Converts OpenCode v2 selectable form fields into the legacy question shape
 * used by the shared detector, then maps recommended labels back to stable
 * option values required by session.form.reply().
 *
 * Forms containing free-text, numeric, boolean, external, hidden, or otherwise
 * unsupported fields are deliberately not auto-answered.
 */
export function detectV2FormRecommendations(
  form: V2FormInfo,
  markers?: string | string[],
  options?: { requireExactlyOneRecommendation?: boolean }
): V2FormDetectionResult {
  if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
    return { ok: false, reason: 'Form has no fields' };
  }

  const questions: QuestionInfo[] = [];
  const selectableFields: Array<{
    key: string;
    multiple: boolean;
    options: V2FormOption[];
    minItems?: number;
    maxItems?: number;
  }> = [];

  const seenKeys = new Set<string>();
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i];
    if (!field) {
      return { ok: false, reason: `Form field ${i + 1} is missing` };
    }

    if (
      field.hidden === true ||
      (field.when !== undefined && (!Array.isArray(field.when) || field.when.length > 0))
    ) {
      return {
        ok: false,
        reason: `Form field ${i + 1} (${field.key ?? 'unknown'}) is hidden or conditional`,
      };
    }

    const isStringChoice =
      field.type === 'string' &&
      Array.isArray(field.options) &&
      field.options.length > 0;
    const isMultiChoice =
      field.type === 'multiselect' &&
      Array.isArray(field.options) &&
      field.options.length > 0;

    if (!isStringChoice && !isMultiChoice) {
      return {
        ok: false,
        reason: `Form field ${i + 1} (${field.key ?? 'unknown'}) is not a supported selectable field`,
      };
    }

    if (typeof field.key !== 'string' || !field.key || seenKeys.has(field.key)) {
      return { ok: false, reason: `Form field ${i + 1} has a missing or duplicate key` };
    }
    seenKeys.add(field.key);

    if (isMultiChoice) {
      const constraints = [field.minItems, field.maxItems].filter(
        (value): value is number => value !== undefined
      );
      if (
        constraints.some((value) => !Number.isInteger(value) || value < 0) ||
        (field.minItems !== undefined &&
          field.maxItems !== undefined &&
          field.minItems > field.maxItems)
      ) {
        return {
          ok: false,
          reason: `Form field ${i + 1} has invalid multiselect item constraints`,
        };
      }
    }

    const fieldOptions = field.options as V2FormOption[];
    if (
      fieldOptions.some(
        (option) =>
          !option ||
          typeof option.value !== 'string' ||
          typeof option.label !== 'string'
      )
    ) {
      return {
        ok: false,
        reason: `Form field ${i + 1} contains an invalid option`,
      };
    }

    const mappedOptions: QuestionOption[] = fieldOptions.map((option) => ({
      label: option.label,
      value: option.value,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    }));

    questions.push({
      question: field.description ?? field.title ?? field.key,
      header: field.title ?? field.key,
      key: field.key,
      options: mappedOptions,
      multiple: isMultiChoice,
    });
    selectableFields.push({
      key: field.key,
      multiple: isMultiChoice,
      options: fieldOptions,
      ...(isMultiChoice && field.minItems !== undefined ? { minItems: field.minItems } : {}),
      ...(isMultiChoice && field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
    });
  }

  const detection = detectRecommendations(questions, markers, options);
  if (!detection.ok) return detection;

  const answer: Record<string, string | string[]> = {};
  for (let i = 0; i < selectableFields.length; i++) {
    const field = selectableFields[i];
    if (!field) {
      return { ok: false, reason: `Missing normalized field ${i + 1}` };
    }
    const selectedLabels = detection.answers[i] ?? [];
    const selectedValues = selectedLabels.map((label) => {
      const matchingOptions = field.options.filter((candidate) => candidate.label === label);
      // A repeated label can point at different form values: require an unambiguous mapping.
      return matchingOptions.length === 1 ? matchingOptions[0]?.value : undefined;
    });

    if (
      selectedValues.length !== selectedLabels.length ||
      selectedValues.some((value) => typeof value !== 'string')
    ) {
      return {
        ok: false,
        reason: `Could not map recommended labels to values for field ${field.key}`,
      };
    }

    if (field.multiple) {
      if (field.minItems !== undefined && selectedValues.length < field.minItems) {
        return {
          ok: false,
          reason: `Recommended selections for field ${field.key} do not satisfy minItems`,
        };
      }
      if (field.maxItems !== undefined && selectedValues.length > field.maxItems) {
        return {
          ok: false,
          reason: `Recommended selections for field ${field.key} exceed maxItems`,
        };
      }
      answer[field.key] = selectedValues as string[];
    } else {
      const value = selectedValues[0];
      if (typeof value !== 'string') {
        return {
          ok: false,
          reason: `Missing recommendation value for field ${field.key}`,
        };
      }
      answer[field.key] = value;
    }
  }

  return { ok: true, answer, detection, questions };
}

/**
 * Language-agnostic classification of OpenCode v2 selectable forms into:
 * - AUTO: valid recommendation selections mapped to form values
 * - MANUAL: explicitly classified via [SQ:manual] or Guardian auto_select=forbidden
 * - UNCLASSIFIED: selectable fields exist, but neither recommendation nor manual classification
 */
export function classifyV2Form(
  form: V2FormInfo,
  markers: string | string[] = DEFAULT_CONFIG.recommendedMarkers,
  manualMarkers: string | string[] = DEFAULT_MANUAL_MARKERS,
  handoff?: OpenCodeHandoff | Record<string, unknown> | null,
  options?: { requireExactlyOneRecommendation?: boolean }
): V2FormClassification {
  if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
    return { status: 'unclassified', reason: 'Form has no fields', questions: [] };
  }

  const manMarkers = normalizeParamMarkers(manualMarkers);

  // Check form-level manual markers
  const formTexts: string[] = [];
  if (typeof form.title === 'string') formTexts.push(form.title);
  if (typeof form.description === 'string') formTexts.push(form.description);

  let formExplicitlyManual = false;
  let matchedManualMarker: string | undefined;

  for (const text of formTexts) {
    const normalized = text.normalize('NFC');
    for (const marker of manMarkers) {
      if (normalized.includes(marker.normalize('NFC'))) {
        formExplicitlyManual = true;
        matchedManualMarker = marker;
        break;
      }
    }
    if (/\[SQ_DECISION:(?:v1\][\s\S]*?mode=)?manual/iu.test(normalized)) {
      formExplicitlyManual = true;
      matchedManualMarker = '[SQ:manual]';
      break;
    }
  }

  const questions: QuestionInfo[] = [];
  const selectableFields: Array<{
    key: string;
    multiple: boolean;
    options: V2FormOption[];
    minItems?: number;
    maxItems?: number;
  }> = [];

  const seenKeys = new Set<string>();
  for (let i = 0; i < form.fields.length; i++) {
    const field = form.fields[i];
    if (!field) {
      return { status: 'unclassified', reason: `Form field ${i + 1} is missing`, questions };
    }

    if (
      field.hidden === true ||
      (field.when !== undefined && (!Array.isArray(field.when) || field.when.length > 0))
    ) {
      return {
        status: 'unclassified',
        reason: `Form field ${i + 1} (${field.key ?? 'unknown'}) is hidden or conditional`,
        questions,
      };
    }

    const isStringChoice =
      field.type === 'string' &&
      Array.isArray(field.options) &&
      field.options.length > 0;
    const isMultiChoice =
      field.type === 'multiselect' &&
      Array.isArray(field.options) &&
      field.options.length > 0;

    if (!isStringChoice && !isMultiChoice) {
      return {
        status: 'unclassified',
        reason: `Form field ${i + 1} (${field.key ?? 'unknown'}) is not a supported selectable field`,
        questions,
      };
    }

    if (typeof field.key !== 'string' || !field.key || seenKeys.has(field.key)) {
      return {
        status: 'unclassified',
        reason: `Form field ${i + 1} has a missing or duplicate key`,
        questions,
      };
    }
    seenKeys.add(field.key);

    if (isMultiChoice) {
      const constraints = [field.minItems, field.maxItems].filter(
        (value): value is number => value !== undefined
      );
      if (
        constraints.some((value) => !Number.isInteger(value) || value < 0) ||
        (field.minItems !== undefined &&
          field.maxItems !== undefined &&
          field.minItems > field.maxItems)
      ) {
        return {
          status: 'unclassified',
          reason: `Form field ${i + 1} has invalid multiselect item constraints`,
          questions,
        };
      }
    }

    const fieldOptions = field.options as V2FormOption[];
    if (
      fieldOptions.some(
        (option) =>
          !option ||
          typeof option.value !== 'string' ||
          typeof option.label !== 'string'
      )
    ) {
      return {
        status: 'unclassified',
        reason: `Form field ${i + 1} contains an invalid option`,
        questions,
      };
    }

    const mappedOptions: QuestionOption[] = fieldOptions.map((option) => ({
      label: option.label,
      value: option.value,
      ...(typeof option.description === 'string' ? { description: option.description } : {}),
    }));

    questions.push({
      question: field.description ?? field.title ?? field.key,
      header: field.title ?? field.key,
      key: field.key,
      options: mappedOptions,
      multiple: isMultiChoice,
    });
    selectableFields.push({
      key: field.key,
      multiple: isMultiChoice,
      options: fieldOptions,
      ...(isMultiChoice && field.minItems !== undefined ? { minItems: field.minItems } : {}),
      ...(isMultiChoice && field.maxItems !== undefined ? { maxItems: field.maxItems } : {}),
    });
  }

  if (formExplicitlyManual) {
    return {
      status: 'manual',
      reason: 'Form title or description is explicitly classified as manual',
      questions,
      matchedMarker: matchedManualMarker,
    };
  }

  const classification = classifyQuestions(questions, markers, manualMarkers, handoff, options);
  if (classification.status === 'manual') {
    return {
      status: 'manual',
      reason: classification.reason,
      questions,
      matchedMarker: classification.matchedMarker,
    };
  }
  if (classification.status === 'unclassified') {
    return {
      status: 'unclassified',
      reason: classification.reason,
      questions,
    };
  }

  // Map answers to field values
  const answer: Record<string, string | string[]> = {};
  for (let i = 0; i < selectableFields.length; i++) {
    const field = selectableFields[i];
    if (!field) {
      return { status: 'unclassified', reason: `Missing normalized field ${i + 1}`, questions };
    }
    const selectedLabels = classification.answers[i] ?? [];
    const selectedValues = selectedLabels.map((label) => {
      const matchingOptions = field.options.filter((candidate) => candidate.label === label);
      return matchingOptions.length === 1 ? matchingOptions[0]?.value : undefined;
    });

    if (
      selectedValues.length !== selectedLabels.length ||
      selectedValues.some((value) => typeof value !== 'string')
    ) {
      return {
        status: 'unclassified',
        reason: `Could not map recommended labels to values for field ${field.key}`,
        questions,
      };
    }

    if (field.multiple) {
      if (field.minItems !== undefined && selectedValues.length < field.minItems) {
        return {
          status: 'unclassified',
          reason: `Recommended selections for field ${field.key} do not satisfy minItems`,
          questions,
        };
      }
      if (field.maxItems !== undefined && selectedValues.length > field.maxItems) {
        return {
          status: 'unclassified',
          reason: `Recommended selections for field ${field.key} exceed maxItems`,
          questions,
        };
      }
      answer[field.key] = selectedValues as string[];
    } else {
      const value = selectedValues[0];
      if (typeof value !== 'string') {
        return {
          status: 'unclassified',
          reason: `Missing recommendation value for field ${field.key}`,
          questions,
        };
      }
      answer[field.key] = value;
    }
  }

  return {
    status: 'auto',
    answer,
    detection: {
      ok: true,
      answers: classification.answers,
      recommendedOptions: classification.recommendedOptions,
      matchedMarker: classification.matchedMarker,
    },
    questions,
  };
}
