import type { DetectionResult, QuestionInfo, QuestionOverlayStatus, SmartQuestionUIText } from './types.js';
export interface OverlayState {
    requestID?: string | undefined;
    sessionID?: string | undefined;
    questions?: QuestionInfo[] | undefined;
    detection?: DetectionResult | null | undefined;
    status?: QuestionOverlayStatus | undefined;
    statusMessage?: string | undefined;
    errorMessage?: string | undefined;
    agentName?: string | undefined;
    agentFound?: boolean | undefined;
    countdown?: number | undefined;
    initialCountdown?: number | undefined;
    markers?: string[] | undefined;
    uiText?: SmartQuestionUIText | undefined;
    lockPath?: string | undefined;
}
export declare function stripMarker(label: unknown, marker: unknown): string;
export declare function formatCountdown(totalSeconds: unknown): string;
export interface OverlayViewModel {
    status: QuestionOverlayStatus;
    title: string;
    borderColor: 'cyan' | 'yellow' | 'red';
    badge: string;
    recommendedChecklist: string;
    rationale: string;
    countdownText: string;
    statusMessage?: string | undefined;
    errorMessage?: string | undefined;
}
export declare function computeOverlayViewModel(state: OverlayState | null | undefined, options?: {
    countdown?: number | undefined;
    markers?: string[] | undefined;
    uiText?: SmartQuestionUIText | undefined;
}): OverlayViewModel | null;
