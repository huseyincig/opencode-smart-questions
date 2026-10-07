import { DEFAULT_CONFIG } from './config.js';
import type {
  DetectionResult,
  QuestionInfo,
  QuestionOption,
  QuestionOverlayStatus,
  SmartQuestionUIText,
} from './types.js';

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

export function stripMarker(label: unknown, marker: unknown): string {
  let strLabel = (typeof label === 'string' ? label : String(label ?? '')).trim().normalize('NFC');
  const markers = Array.isArray(marker)
    ? marker.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : typeof marker === 'string' && marker.length > 0
      ? [marker]
      : [];

  let longestSuffix = '';
  for (const candidate of markers) {
    const normalized = candidate.normalize('NFC');
    if (strLabel.endsWith(normalized) && normalized.length > longestSuffix.length) {
      longestSuffix = normalized;
    }
  }
  if (longestSuffix) {
    strLabel = strLabel.slice(0, -longestSuffix.length).trim();
  }

  let longestPrefix = '';
  for (const candidate of markers) {
    const normalized = candidate.normalize('NFC');
    if (strLabel.startsWith(normalized) && normalized.length > longestPrefix.length) {
      longestPrefix = normalized;
    }
  }
  if (longestPrefix) {
    strLabel = strLabel.slice(longestPrefix.length).trim();
  }

  return strLabel;
}

export function formatCountdown(totalSeconds: unknown): string {
  const numeric =
    typeof totalSeconds === 'number' && Number.isFinite(totalSeconds)
      ? totalSeconds
      : 0;
  const clamped = Math.max(0, Math.floor(numeric));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

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

export function computeOverlayViewModel(
  state: OverlayState | null | undefined,
  options: {
    countdown?: number | undefined;
    markers?: string[] | undefined;
    uiText?: SmartQuestionUIText | undefined;
  } = {}
): OverlayViewModel | null {
  if (!state) return null;
  const status = state.status ?? 'auto';
  const markers = options.markers ?? state.markers ?? DEFAULT_CONFIG.recommendedMarkers ?? [];
  const labels = options.uiText ?? state.uiText ?? DEFAULT_CONFIG.uiText;

  let title = ' Smart Question ';
  let borderColor: 'cyan' | 'yellow' | 'red' = 'cyan';
  switch (status) {
    case 'manual':
      title = ' Smart Question — Manual Decision ';
      borderColor = 'yellow';
      break;
    case 'unclassified':
      title = ' Smart Question — Intercepted ';
      borderColor = 'cyan';
      break;
    case 'error':
      title = ' Smart Question — Warning ';
      borderColor = 'red';
      break;
    case 'auto':
    default:
      title = ' Smart Question ';
      borderColor = 'cyan';
      break;
  }

  let recommendedChecklist = '';
  let rationale = '';
  if (state.detection?.ok) {
    const recommendedOptions: QuestionOption[] = state.detection.recommendedOptions ?? [];
    recommendedChecklist = recommendedOptions
      .filter((option: QuestionOption) => option && typeof option.label === 'string')
      .map((option: QuestionOption) => stripMarker(option.label, markers))
      .filter((label: string): label is string => typeof label === 'string' && label.length > 0)
      .map((label: string) => `✓ ${label}`)
      .join('   ');
    const desc = recommendedOptions[0]?.description;
    rationale = typeof desc === 'string' ? desc : '';
  }

  const seconds = options.countdown ?? state.countdown ?? 0;
  const countdownText = formatCountdown(seconds);
  const agentName = state.agentName ?? 'unknown';
  const badge = state.agentFound
    ? `${labels.agent} ${agentName}`
    : `${labels.session} ${agentName}`;

  return {
    status,
    title,
    borderColor,
    badge,
    recommendedChecklist,
    rationale,
    countdownText,
    statusMessage: state.statusMessage,
    errorMessage: state.errorMessage,
  };
}
