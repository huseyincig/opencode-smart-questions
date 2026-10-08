import { createHash } from 'node:crypto';
import { DEFAULT_CONFIG, DEFAULT_MANUAL_MARKERS, normalizeParamMarkers } from './config.js';
export function detectRecommendations(questions, marker = DEFAULT_CONFIG.recommendedMarkers, options = {}) {
    // If invoked directly by OpenCode's plugin engine as a plugin factory, return an empty hooks object
    if (questions &&
        typeof questions === 'object' &&
        !Array.isArray(questions) &&
        ('client' in questions || 'directory' in questions)) {
        return {};
    }
    // Retain the legacy options argument without relaxing single-choice ambiguity checks.
    void options;
    if (!Array.isArray(questions) || questions.length === 0) {
        return { ok: false, reason: 'No questions provided in request' };
    }
    const markers = normalizeParamMarkers(marker);
    const markerDesc = markers.length === 1
        ? `"${markers[0]}"`
        : `(accepted: ${markers.map((m) => `"${m}"`).join(', ')})`;
    const answers = [];
    const recommendedOptions = [];
    let matchedMarker;
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
            if (!opt || typeof opt.label !== 'string')
                return null;
            const normalizedLabel = opt.label.trimEnd().normalize('NFC');
            const m = markers.find((marker) => normalizedLabel.endsWith(marker.normalize('NFC')));
            return m ? { opt, marker: m } : null;
        })
            .filter((x) => x !== null);
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
        const firstMatch = matched[0];
        if (!firstMatch) {
            return { ok: false, reason: `Question ${qIndex} has no usable recommended option` };
        }
        if (!matchedMarker) {
            matchedMarker = firstMatch.marker;
        }
        if (q.multiple) {
            answers.push(matched.map((m) => m.opt.label));
            recommendedOptions.push(...matched.map((m) => m.opt));
        }
        else {
            // Verbatim label copied from event payload
            answers.push([firstMatch.opt.label]);
            recommendedOptions.push(firstMatch.opt);
        }
    }
    return { ok: true, answers, recommendedOptions, matchedMarker };
}
/**
 * Checks if a question is explicitly classified as requiring manual human decision.
 */
export function isQuestionExplicitlyManual(q, manualMarkers = DEFAULT_MANUAL_MARKERS) {
    if (!q)
        return { isManual: false };
    const textsToCheck = [];
    if (typeof q.question === 'string')
        textsToCheck.push(q.question);
    if (typeof q.header === 'string')
        textsToCheck.push(q.header);
    if (typeof q.title === 'string') {
        textsToCheck.push(q.title);
    }
    if (typeof q.description === 'string') {
        textsToCheck.push(q.description);
    }
    if (Array.isArray(q.options)) {
        for (const opt of q.options) {
            if (!opt)
                continue;
            if (typeof opt.label === 'string')
                textsToCheck.push(opt.label);
            if (typeof opt.description === 'string')
                textsToCheck.push(opt.description);
            if (typeof opt.value === 'string')
                textsToCheck.push(opt.value);
        }
    }
    for (const text of textsToCheck) {
        const normalized = text.normalize('NFC');
        for (const marker of manualMarkers) {
            const normMarker = marker.normalize('NFC');
            if (normalized.includes(normMarker)) {
                return { isManual: true, matchedMarker: marker };
            }
        }
        if (/\[SQ_DECISION:(?:v1\][\s\S]*?mode=)?manual/iu.test(normalized)) {
            return { isManual: true, matchedMarker: '[SQ:manual]' };
        }
    }
    return { isManual: false };
}
/**
 * Resiliently detects whether an option represents a recommendation.
 * Matches:
 * 1. Exact suffix (standard contract): e.g. "Option [SQ:recommended]"
 * 2. Prefix: e.g. "[SQ:recommended] Option", "(Recommended) Option"
 * 3. Case-insensitive suffix or prefix: e.g. "(recommended)"
 * 4. In description: e.g. description: "(Recommended)"
 * 5. Standard markers anywhere in label
 */
function matchOptionRecommendation(opt, recMarkers) {
    if (!opt || typeof opt.label !== 'string')
        return undefined;
    const label = opt.label.trim();
    const normalizedLabel = label.normalize('NFC');
    const desc = typeof opt.description === 'string' ? opt.description.trim().normalize('NFC') : '';
    // 1. Exact suffix matching on label (highest priority)
    for (const marker of recMarkers) {
        const normM = marker.normalize('NFC');
        if (normalizedLabel.endsWith(normM)) {
            return { opt, marker };
        }
    }
    // 2. Exact prefix matching on label
    for (const marker of recMarkers) {
        const normM = marker.normalize('NFC');
        if (normalizedLabel.startsWith(normM)) {
            return { opt, marker };
        }
    }
    // 3. Case-insensitive suffix or prefix on label
    const lowerLabel = normalizedLabel.toLowerCase();
    for (const marker of recMarkers) {
        const lowerM = marker.normalize('NFC').toLowerCase();
        if (lowerLabel.endsWith(lowerM) || lowerLabel.startsWith(lowerM)) {
            return { opt, marker };
        }
    }
    // 4. In description
    for (const marker of recMarkers) {
        const normM = marker.normalize('NFC');
        if (desc.startsWith(normM) || desc.toLowerCase().includes(marker.toLowerCase())) {
            return { opt, marker };
        }
    }
    // 5. Common standard markers anywhere in label
    const commonMarkers = ['(recommended)', '[recommended]', '(önerilen)', '[önerilen]', '[sq:recommended]'];
    for (const cm of commonMarkers) {
        if (lowerLabel.includes(cm) || desc.toLowerCase().includes(cm)) {
            return { opt, marker: recMarkers[0] ?? '[SQ:recommended]' };
        }
    }
    return undefined;
}
/**
 * Language-agnostic classification of selectable root questions into:
 * - AUTO: all questions carry valid recommendation markers (or resolved via fallback)
 * - MANUAL: explicitly classified via [SQ:manual], or Guardian handoff auto_select=forbidden
 * - UNCLASSIFIED: selectable options exist, but neither recommendation nor manual classification is present
 */
export function classifyQuestions(questions, recommendedMarker = DEFAULT_CONFIG.recommendedMarkers, manualMarker = DEFAULT_MANUAL_MARKERS, handoff, options = {}) {
    void options;
    if (!Array.isArray(questions) || questions.length === 0) {
        return { status: 'unclassified', reason: 'No questions provided in request' };
    }
    if (handoff &&
        typeof handoff === 'object' &&
        'autoSelect' in handoff &&
        handoff.autoSelect === 'forbidden' &&
        !options.allowFallbackOnManual) {
        return {
            status: 'manual',
            reason: 'Guardian handoff explicitly forbids auto-selection (auto_select=forbidden)',
            matchedMarker: '[OPENCODE_HANDOFF:auto_select=forbidden]',
        };
    }
    const recMarkers = normalizeParamMarkers(recommendedMarker);
    const manMarkers = normalizeParamMarkers(manualMarker);
    const answers = [];
    const recommendedOptions = [];
    let matchedMarker;
    let firstManual = null;
    let firstUnclassified = null;
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qIndex = i + 1;
        if (!q) {
            if (!firstUnclassified) {
                firstUnclassified = { index: qIndex, reason: `Question ${qIndex} is null or undefined` };
            }
            continue;
        }
        if (!Array.isArray(q.options) || q.options.length === 0) {
            if (!firstUnclassified) {
                firstUnclassified = { index: qIndex, reason: `Question ${qIndex} has no options` };
            }
            continue;
        }
        // Check if explicitly manual
        const manualCheck = isQuestionExplicitlyManual(q, manMarkers);
        if (manualCheck.isManual && !options.allowFallbackOnManual) {
            if (!firstManual) {
                firstManual = { index: qIndex, marker: manualCheck.matchedMarker };
            }
            continue;
        }
        // Check recommendation
        let matched = q.options
            .map((opt) => matchOptionRecommendation(opt, recMarkers))
            .filter((x) => Boolean(x));
        // Fallback: if no recommendation marker was found, but fallback is enabled, pick the logical first option
        if (matched.length === 0 && options.allowFallback && Array.isArray(q.options) && q.options.length > 0) {
            const defaultOpt = q.options[0];
            if (defaultOpt && typeof defaultOpt.label === 'string') {
                matched = [{ opt: defaultOpt, marker: recMarkers[0] ?? '[SQ:recommended]' }];
            }
        }
        if (matched.length === 0) {
            if (!firstUnclassified) {
                firstUnclassified = {
                    index: qIndex,
                    reason: `Question ${qIndex} has no recommendation marker`,
                };
            }
            continue;
        }
        if (!q.multiple && matched.length > 1) {
            if (options.allowFallback) {
                matched = [matched[0]];
            }
            else {
                if (!firstUnclassified) {
                    firstUnclassified = {
                        index: qIndex,
                        reason: `Question ${qIndex} has ambiguous recommendation markers (${matched.length})`,
                    };
                }
                continue;
            }
        }
        const firstMatch = matched[0];
        if (!firstMatch) {
            if (!firstUnclassified) {
                firstUnclassified = {
                    index: qIndex,
                    reason: `Question ${qIndex} has no usable recommendation option`,
                };
            }
            continue;
        }
        if (!matchedMarker) {
            matchedMarker = firstMatch.marker;
        }
        if (q.multiple) {
            answers.push(matched.map((m) => m.opt.label));
            recommendedOptions.push(...matched.map((m) => m.opt));
        }
        else {
            answers.push([firstMatch.opt.label]);
            recommendedOptions.push(firstMatch.opt);
        }
    }
    // Multi-question request aggregation:
    // 1. Any manual -> whole request is MANUAL
    if (firstManual) {
        return {
            status: 'manual',
            reason: `Question ${firstManual.index} is explicitly classified as requiring manual human decision`,
            matchedMarker: firstManual.marker,
        };
    }
    // 2. Any unclassified -> whole request is UNCLASSIFIED
    if (firstUnclassified) {
        return {
            status: 'unclassified',
            reason: firstUnclassified.reason,
        };
    }
    // 3. All questions AUTO
    return {
        status: 'auto',
        answers,
        recommendedOptions,
        matchedMarker,
    };
}
/**
 * Computes a deterministic normalized fingerprint for a set of questions.
 * Used for scoping loop protection to identical unclassified chains rather than
 * permanently disabling Smart Questions across an entire session lifetime.
 */
export function computeQuestionFingerprint(questions) {
    if (questions &&
        typeof questions === 'object' &&
        !Array.isArray(questions) &&
        ('client' in questions || 'directory' in questions)) {
        return {};
    }
    if (!Array.isArray(questions) || questions.length === 0)
        return 'empty';
    const normalized = questions.map((q) => ({
        header: typeof q?.header === 'string'
            ? q.header.trim().toLowerCase().normalize('NFC')
            : '',
        question: typeof q?.question === 'string'
            ? q.question.trim().toLowerCase().normalize('NFC')
            : '',
        multiple: q?.multiple === true,
        // Preserve option order because fallback-first semantics depend on it.
        options: Array.isArray(q?.options)
            ? q.options.map((option) => ({
                label: typeof option === 'string'
                    ? option.trim().toLowerCase().normalize('NFC')
                    : typeof option?.label === 'string'
                        ? option.label.trim().toLowerCase().normalize('NFC')
                        : '',
                value: option && typeof option === 'object' && typeof option.value === 'string'
                    ? option.value.trim().normalize('NFC')
                    : '',
            }))
            : [],
    }));
    // Fingerprints are loop-control identifiers, not diagnostics. Hash the
    // normalized structure so raw question/option text never enters logs.
    return createHash('sha256')
        .update(JSON.stringify(normalized))
        .digest('hex')
        .slice(0, 24);
}
