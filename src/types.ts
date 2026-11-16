/**
 * opencode-smart-questions: Core Types
 */

export interface QuestionOption {
  label: string;
  description?: string;
  value?: string;
  [key: string]: unknown;
}

export interface QuestionInfo {
  question: string;
  header?: string;
  key?: string;
  options: QuestionOption[];
  multiple?: boolean;
  custom?: boolean;
  [key: string]: unknown;
}

export type QuestionOverlayStatus = 'auto' | 'manual' | 'unclassified' | 'error';

export interface ActiveQuestionState {
  requestID: string;
  sessionID: string;
  questions: QuestionInfo[];
  detection: DetectionResult;
  agentName: string;
  agentFound: boolean;
  focusDisabled: boolean;
  errorMessage?: string | undefined;
  status?: QuestionOverlayStatus | undefined;
  statusMessage?: string | undefined;
}

export interface SmartQuestionUIText {
  recommendation: string;
  disabled: string;
  autoReplyFailed: string;
  agent: string;
  session: string;
  manualTitle?: string | undefined;
  manualSubtitle?: string | undefined;
  unclassifiedTitle?: string | undefined;
  unclassifiedSubtitle?: string | undefined;
  remediationFailed?: string | undefined;
  budgetExhausted?: string | undefined;
}

export interface SmartQuestionConfig {
  enabled: boolean;
  timeoutMs: number;
  recommendedMarkers: string[];
  recommendedMarker?: string;
  manualMarkers?: string[];
  manualMarker?: string;
  maxUnclassifiedRemediations?: number | undefined;
  unclassifiedQuestionPolicy?: 'remediate' | 'ignore' | 'fallback-first' | 'remediate-then-fallback' | undefined;
  fallbackToFirstOption?: boolean | undefined;
  fallbackOnManual?: boolean | undefined;
  requireExactlyOneRecommendation: boolean;
  uiText: SmartQuestionUIText;
  debugLog?: string | undefined;
  configDir?: string | undefined;
  includeSubagents?: boolean | undefined;
}

export interface DetectionSuccess {
  ok: true;
  answers: string[][];
  recommendedOptions?: QuestionOption[];
  matchedMarker?: string | undefined;
}

export interface DetectionFailure {
  ok: false;
  reason: string;
}

export type DetectionResult = DetectionSuccess | DetectionFailure;

export type QuestionStatus = 'auto' | 'manual' | 'unclassified';

export interface QuestionClassificationAuto {
  status: 'auto';
  answers: string[][];
  recommendedOptions: QuestionOption[];
  matchedMarker?: string | undefined;
}

export interface QuestionClassificationManual {
  status: 'manual';
  reason: string;
  matchedMarker?: string | undefined;
}

export interface QuestionClassificationUnclassified {
  status: 'unclassified';
  reason: string;
}

export type QuestionClassification =
  | QuestionClassificationAuto
  | QuestionClassificationManual
  | QuestionClassificationUnclassified;
