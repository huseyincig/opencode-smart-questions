import type { DetectionResult, QuestionInfo } from './types.js';
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
    when?: Array<{
        key: string;
        op: 'eq' | 'neq';
        value: string | number | boolean;
    }>;
    options?: V2FormOption[];
    minItems?: number;
    maxItems?: number;
    custom?: boolean;
}
export interface V2FormInfo {
    id: string;
    sessionID: string;
    title?: string;
    fields: V2FormField[];
}
export type V2FormDetectionResult = {
    ok: true;
    answer: Record<string, string | string[]>;
    detection: Extract<DetectionResult, {
        ok: true;
    }>;
    questions: QuestionInfo[];
} | {
    ok: false;
    reason: string;
};
/**
 * Converts OpenCode v2 selectable form fields into the legacy question shape
 * used by the shared detector, then maps recommended labels back to stable
 * option values required by session.form.reply().
 *
 * Forms containing free-text, numeric, boolean, external, hidden, or otherwise
 * unsupported fields are deliberately not auto-answered.
 */
export declare function detectV2FormRecommendations(form: V2FormInfo, markers?: string | string[], options?: {
    requireExactlyOneRecommendation?: boolean;
}): V2FormDetectionResult;
