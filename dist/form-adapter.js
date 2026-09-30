import { detectRecommendations } from './detector.js';
/**
 * Converts OpenCode v2 selectable form fields into the legacy question shape
 * used by the shared detector, then maps recommended labels back to stable
 * option values required by session.form.reply().
 *
 * Forms containing free-text, numeric, boolean, external, hidden, or otherwise
 * unsupported fields are deliberately not auto-answered.
 */
export function detectV2FormRecommendations(form, markers, options) {
    if (!form || !Array.isArray(form.fields) || form.fields.length === 0) {
        return { ok: false, reason: 'Form has no fields' };
    }
    const questions = [];
    const selectableFields = [];
    for (let i = 0; i < form.fields.length; i++) {
        const field = form.fields[i];
        const isStringChoice = field?.type === 'string' &&
            Array.isArray(field.options) &&
            field.options.length > 0;
        const isMultiChoice = field?.type === 'multiselect' &&
            Array.isArray(field.options) &&
            field.options.length > 0;
        if (!isStringChoice && !isMultiChoice) {
            return {
                ok: false,
                reason: `Form field ${i + 1} (${field?.key ?? 'unknown'}) is not a supported selectable field`,
            };
        }
        const fieldOptions = field.options;
        if (fieldOptions.some((option) => !option ||
            typeof option.value !== 'string' ||
            typeof option.label !== 'string')) {
            return {
                ok: false,
                reason: `Form field ${i + 1} contains an invalid option`,
            };
        }
        const mappedOptions = fieldOptions.map((option) => ({
            label: option.label,
            description: option.description,
            value: option.value,
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
        });
    }
    const detection = detectRecommendations(questions, markers, options);
    if (!detection.ok)
        return detection;
    const answer = {};
    for (let i = 0; i < selectableFields.length; i++) {
        const field = selectableFields[i];
        const selectedLabels = detection.answers[i] ?? [];
        const selectedValues = selectedLabels.map((label) => {
            const option = field.options.find((candidate) => candidate.label === label);
            return option?.value;
        });
        if (selectedValues.length !== selectedLabels.length ||
            selectedValues.some((value) => typeof value !== 'string')) {
            return {
                ok: false,
                reason: `Could not map recommended labels to values for field ${field.key}`,
            };
        }
        if (field.multiple) {
            answer[field.key] = selectedValues;
        }
        else {
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
