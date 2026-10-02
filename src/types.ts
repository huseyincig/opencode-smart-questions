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

export interface ActiveQuestionState {
  requestID: string;
  sessionID: string;
  questions: QuestionInfo[];
  detection: DetectionResult;
  agentName: string;
  agentFound: boolean;
  focusDisabled: boolean;
  errorMessage?: string;
}

export interface SmartQuestionUIText {
  recommendation: string;
  disabled: string;
  autoReplyFailed: string;
  agent: string;
  session: string;
}

export interface SmartQuestionConfig {
  enabled: boolean;
  timeoutMs: number;
  recommendedMarkers: string[];
  recommendedMarker?: string;
  requireExactlyOneRecommendation: boolean;
  uiText: SmartQuestionUIText;
  debugLog?: string;
  configDir?: string;
}

export interface DetectionSuccess {
  ok: true;
  answers: string[][];
  recommendedOptions?: QuestionOption[];
  matchedMarker?: string;
}

export interface DetectionFailure {
  ok: false;
  reason: string;
}

export type DetectionResult = DetectionSuccess | DetectionFailure;

export interface OpencodeClientLike {
  question?: {
    reply: (params: { requestID: string; answers: string[][] }) => Promise<unknown>;
    reject?: (params: { requestID: string }) => Promise<unknown>;
  };
  _client?: {
    post?: (params: { url: string; body?: unknown; [key: string]: any }) => Promise<any>;
    [key: string]: any;
  };
  [key: string]: any;
}

export interface PluginInput {
  client: OpencodeClientLike;
  directory?: string;
  serverUrl?: URL;
  [key: string]: any;
}

export interface Hooks {
  event?: (input: { event: any }) => Promise<void>;
  dispose?: () => Promise<void>;
  'tool.definition'?: (
    input: { toolID?: string; [key: string]: any },
    output: { description?: string; parameters?: any; jsonSchema?: any; [key: string]: any }
  ) => Promise<void>;
  'experimental.chat.system.transform'?: (
    input: { sessionID?: string; model?: any; [key: string]: any },
    output: { system?: string[]; [key: string]: any }
  ) => Promise<void>;
  [key: string]: any;
}

export type Plugin = (input: PluginInput, options?: Record<string, unknown>) => Promise<Hooks>;

export interface PendingQuestionState {
  requestID: string;
  timer: NodeJS.Timeout;
  answers: string[][];
  status: 'pending' | 'firing' | 'replied' | 'cancelled';
}
