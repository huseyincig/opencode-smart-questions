/** @jsxImportSource @opentui/solid */
// Deliberately excluded from typecheck scope (TSX + @opentui types require separate JSX config; see tsconfig.check.json)
// @ts-nocheck
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	TuiPlugin,
	TuiPluginApi,
	TuiPluginModule,
} from "@opencode-ai/plugin/tui";
import { createMemo, createSignal, Show } from "solid-js";

/**
 * Question option shape from @opencode/schema (QuestionV1.Option).
 */
export interface QuestionOption {
	label: string;
	description?: string;
}

/**
 * Question info shape from @opencode/schema (QuestionV1.Info).
 */
export interface QuestionInfo {
	question: string;
	header: string;
	options: QuestionOption[];
	multiple?: boolean;
	custom?: boolean;
}

/**
 * Configuration schema for smart-question plugin.
 */
export interface SmartQuestionConfig {
	enabled: boolean;
	timeoutMs: number;
	recommendedMarkers: string[];
	recommendedMarker?: string;
	requireExactlyOneRecommendation: boolean;
	configDir?: string;
}

export interface DetectionSuccess {
	ok: true;
	answers: string[][];
	recommendedOptions: QuestionOption[];
	matchedMarker?: string;
}

export interface DetectionFailure {
	ok: false;
	reason: string;
}

export type DetectionResult = DetectionSuccess | DetectionFailure;

export interface ActiveQuestionState {
	requestID: string;
	sessionID: string;
	questions: QuestionInfo[];
	detection: DetectionResult;
	agentName: string;
	agentFound: boolean;
	focusDisabled?: boolean;
}

const DEFAULT_RECOMMENDED_MARKERS: string[] = ["(Recommended)", "(Önerilen)"];

const DEFAULT_CONFIG: SmartQuestionConfig = {
	enabled: true,
	timeoutMs: 30000,
	recommendedMarkers: DEFAULT_RECOMMENDED_MARKERS,
	recommendedMarker: "(Recommended)",
	requireExactlyOneRecommendation: true,
};

function normalizeConfigMarkers(
	rawMarkers?: unknown,
	legacyMarker?: unknown,
): string[] {
	if (Array.isArray(rawMarkers)) {
		const valid = rawMarkers.filter(
			(m): m is string => typeof m === "string" && m.length > 0,
		);
		const unique = Array.from(new Set(valid));
		if (unique.length > 0) {
			return unique;
		}
	}

		if (typeof legacyMarker === "string" && legacyMarker.length > 0) {
			return [legacyMarker];
		}

	return [...DEFAULT_RECOMMENDED_MARKERS];
}

function normalizeParamMarkers(marker?: string | string[]): string[] {
	if (Array.isArray(marker)) {
		const valid = marker.filter(
			(m): m is string => typeof m === "string" && m.length > 0,
		);
		const unique = Array.from(new Set(valid));
		return unique.length > 0 ? unique : [...DEFAULT_RECOMMENDED_MARKERS];
	}
	if (typeof marker === "string" && marker.length > 0) {
		return [marker];
	}
	return [...DEFAULT_RECOMMENDED_MARKERS];
}

/**
 * Load and validate smart-question configuration from project directory.
 * Returns null if file is missing, unparseable, or enabled is false.
 */
export function loadConfig(
	projectDir?: string | Record<string, unknown>,
): SmartQuestionConfig | null {
	try {
		const dir =
			typeof projectDir === "string" && projectDir ? projectDir : process.cwd();
		const candidatePaths = [
			path.resolve(dir, ".opencode/smart-question.json"),
			path.resolve(dir, "smart-question.json"),
			path.resolve(os.homedir(), ".config/opencode/smart-question.json"),
		];

		let configPath: string | null = null;
		for (const p of candidatePaths) {
			if (fs.existsSync(p)) {
				configPath = p;
				break;
			}
		}

		if (!configPath) {
			return null;
		}
		const raw = fs.readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!parsed || parsed.enabled === false) {
			return null;
		}

		const configDir = path.dirname(configPath);
		const recommendedMarkers = normalizeConfigMarkers(
			parsed.recommendedMarkers,
			parsed.recommendedMarker,
		);
		const recommendedMarker =
			typeof parsed.recommendedMarker === "string" &&
			parsed.recommendedMarker.length > 0
				? parsed.recommendedMarker
				: (recommendedMarkers[0] ?? DEFAULT_CONFIG.recommendedMarker);

		return {
			enabled: true,
			configDir,
			timeoutMs:
				typeof parsed.timeoutMs === "number" && parsed.timeoutMs >= 0
					? parsed.timeoutMs
					: DEFAULT_CONFIG.timeoutMs,
			recommendedMarkers,
			recommendedMarker,
			requireExactlyOneRecommendation:
				typeof parsed.requireExactlyOneRecommendation === "boolean"
					? parsed.requireExactlyOneRecommendation
					: DEFAULT_CONFIG.requireExactlyOneRecommendation,
		};
	} catch (err) {
		console.error(
			`[smart-question-ui] Failed to load config: ${err instanceof Error ? err.message : String(err)}`,
		);
		return null;
	}
}

/**
 * Pure decision logic for detecting recommendations across questions.
 * Enforces fail-safe conditions matching the backend plugin:
 * - Empty questions list -> fail
 * - Zero recommended options in ANY question -> fail
 * - More than 1 recommended options in ANY single-select question -> fail
 * - Exact suffix matching on marker
 */
export function detectRecommendations(
	questions: QuestionInfo[],
	marker: string | string[] = DEFAULT_CONFIG.recommendedMarkers,
	options: { requireExactlyOneRecommendation?: boolean } = {},
): DetectionResult {
	const requireOne = options.requireExactlyOneRecommendation !== false;

	if (!Array.isArray(questions) || questions.length === 0) {
		return { ok: false, reason: "No questions provided in request" };
	}

	const markers = normalizeParamMarkers(marker);
	const markerDesc =
		markers.length === 1
			? `"${markers[0]}"`
			: `(accepted: ${markers.map((m) => `"${m}"`).join(", ")})`;

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
				if (!opt || typeof opt.label !== "string") return null;
				const m = markers.find(
					(m) => typeof m === "string" && m.length > 0 && opt.label.endsWith(m),
				);
				return m ? { opt, marker: m } : null;
			})
			.filter((x) => x !== null) as { opt: any; marker: string }[];

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
			answers.push([matched[0].opt.label]);
			recommendedOptions.push(matched[0].opt);
		}
	}

	return { ok: true, answers, recommendedOptions, matchedMarker };
}

/**
 * Resolve agent name from event metadata or session state, falling back to session short-id.
 */
export function resolveAgentName(
	api: TuiPluginApi,
	sessionID: string,
	eventProps?: Record<string, unknown>,
): { name: string; found: boolean } {
	// 1. Check if event properties explicitly carry agent info
	if (
		typeof eventProps?.agent === "string" &&
		eventProps.agent.trim().length > 0
	) {
		return { name: eventProps.agent.trim(), found: true };
	}
	if (
		typeof eventProps?.agentName === "string" &&
		eventProps.agentName.trim().length > 0
	) {
		return { name: eventProps.agentName.trim(), found: true };
	}

	// 2. Check session state via api.state.session.get(sessionID)
	try {
		const session = api.state?.session?.get?.(sessionID);
		if (
			session &&
			typeof session.agent === "string" &&
			session.agent.trim().length > 0
		) {
			return { name: session.agent.trim(), found: true };
		}
	} catch {
		// ignore lookup error
	}

	// 3. Fallback to session short-id
	const shortId =
		sessionID && typeof sessionID === "string"
			? sessionID.slice(0, 8)
			: "unknown";
	return { name: shortId, found: false };
}

/**
 * Strip marker from option label if it ends with marker.
 */
export function stripMarker(label: unknown, marker: unknown): string {
	const strLabel = typeof label === "string" ? label : String(label ?? "");
	let candidateMarkers: string[] = [];
	if (Array.isArray(marker)) {
		candidateMarkers = marker.filter(
			(m): m is string => typeof m === "string" && m.length > 0,
		);
	} else if (typeof marker === "string" && marker.length > 0) {
		candidateMarkers = [marker];
	}

	let longestMatch: string | null = null;
	for (const m of candidateMarkers) {
		if (strLabel.endsWith(m)) {
			if (!longestMatch || m.length > longestMatch.length) {
				longestMatch = m;
			}
		}
	}

	if (longestMatch) {
		return strLabel.slice(0, -longestMatch.length).trim();
	}
	return strLabel;
}

/**
 * Format total seconds into mm:ss format.
 */
export function formatCountdown(totalSeconds: unknown): string {
	const num =
		typeof totalSeconds === "number" && Number.isFinite(totalSeconds)
			? totalSeconds
			: 0;
	const clamped = Math.max(0, Math.floor(num));
	const m = Math.floor(clamped / 60);
	const s = clamped % 60;
	return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Smart Question UI overlay component.
 */
export function SmartQuestionOverlay(props: {
	api: TuiPluginApi;
	state: () => ActiveQuestionState | null;
	countdown: () => number;
	marker?: string | string[];
	markers?: string | string[];
}) {
	const theme = createMemo(() => props.api?.theme?.current);
	const t = () => theme();

	const active = () => props.state();
	const act = new Proxy(
		{},
		{
			get(_target, prop) {
				const current = active();
				if (!current) {
					return prop === "detection" ? {} : undefined;
				}
				return (current as any)[prop] ?? (prop === "detection" ? {} : undefined);
			},
		},
	) as ActiveQuestionState & {
		detection: {
			matchedMarker?: string;
		};
	};
	const isAutoSelect = createMemo(() =>
		Boolean(
			active()?.detection &&
				active()?.detection.ok === true &&
				!active()?.focusDisabled,
		),
	);
	const hasRecommendation = createMemo(() =>
		Boolean(active()?.detection && active()?.detection.ok === true),
	);

	// `✓` prefixed per option: OpenCode's Option schema is closed
	// ({label, description} only) so native pre-checking is impossible. This
	// checklist tells the user exactly what WILL be auto-submitted when the
	// countdown ends.
	const recommendedChecklist = createMemo((): string => {
		const act = active();
		if (
			!act?.detection?.ok ||
			!Array.isArray(act.detection.recommendedOptions)
		) {
			return "";
		}
		const markers =
			props.markers ?? props.marker ?? DEFAULT_CONFIG.recommendedMarkers;
		return act.detection.recommendedOptions
			.filter((opt) => Boolean(opt && typeof opt.label === "string"))
			.map((opt) => stripMarker(opt.label, markers))
			.filter(Boolean)
			.map((label) => `✓ ${label}`)
			.join("   ");
	});

	const rationale = createMemo((): string => {
		const act = active();
		if (
			!act?.detection?.ok ||
			!Array.isArray(act.detection.recommendedOptions)
		) {
			return "";
		}
		const firstRec = act.detection.recommendedOptions[0];
		const desc = firstRec?.description;
		return typeof desc === "string" ? desc : String(desc ?? "");
	});

	const countdownText = createMemo((): string => {
		const sec = typeof props.countdown === "function" ? props.countdown() : 0;
		return formatCountdown(sec);
	});

	const agentBadgeText = createMemo((): string => {
		const act = active();
		if (!act) return "";
		const name = String(act.agentName ?? "");
		return act.agentFound ? `Agent: ${name}` : `Session: ${name}`;
	});

	return (
		<box width="100%" flexDirection="column">
			<Show when={Boolean(active())}>
				<box
					width="100%"
					border={true}
					borderStyle="rounded"
					borderColor={t()?.accent ?? "cyan"}
					title=" Smart Question "
					paddingLeft={1}
					paddingRight={1}
					flexDirection="column"
				>
					{/* Header row: agent/session badge only — the panel name lives on the
					    border title, so it must not be repeated here. */}
					<box width="100%" flexDirection="row" justifyContent="flex-end">
						<text fg={t()?.textMuted ?? "gray"}>{agentBadgeText()}</text>
					</box>

					{/* Recommendation + Countdown / Disabled */}
					<box width="100%" flexDirection="row" justifyContent="space-between">
						{hasRecommendation() && recommendedChecklist() ? (
							<box flexDirection="row">
								<text fg={t()?.success ?? "green"}>
									<b>{recommendedChecklist()}</b>
								</text>
								<text fg={t()?.success ?? "green"}> </text>
								<text fg={t()?.success ?? "green"}>
									<b>
										{act.detection.matchedMarker
											? act.detection.matchedMarker
													.replace(/[()]/g, "")
													.toUpperCase()
											: "RECOMMENDED"}
									</b>
								</text>
							</box>
						) : (
							<box />
						)}
						{isAutoSelect() ? (
							<text fg={t()?.warning ?? "yellow"}>
								<b>{countdownText()}</b>
							</text>
						) : (
							<text fg={t()?.error ?? "red"}>
								<b>AUTO-SELECTION DISABLED</b>
							</text>
						)}
					</box>

					{/* Rationale line (if present) */}
					{rationale() ? (
						<box flexDirection="row">
							<text fg={t()?.textMuted ?? "gray"}>Öneri: </text>
							<text fg={t()?.text ?? "white"}>{rationale()}</text>
						</box>
					) : null}
				</box>
			</Show>
		</box>
	);
}

/**
 * Smart Question UI TUI plugin function.
 */
export const tui: TuiPlugin = async (api) => {
	const projectDir = api.state?.path?.directory ?? process.cwd();
	const config = loadConfig(projectDir);

	if (!config?.enabled) {
		// Disabled or config missing: register nothing (native behavior only)
		return;
	}

	const [activeQuestion, setActiveQuestion] =
		createSignal<ActiveQuestionState | null>(null);
	const [countdownSec, setCountdownSec] = createSignal<number>(0);
	let countdownTimer: NodeJS.Timeout | null = null;
	let focusPollTimer: NodeJS.Timeout | null = null;
	let currentLockPath: string | null = null;
	let currentTriggerFocusGuard: ((reason: string) => void) | null = null;

	const logDiagnostic = (msg: string) => {
		try {
			fs.appendFileSync(
				"/tmp/smart-question-ui.log",
				`[smart-question-ui] ${new Date().toISOString()} ${msg}\n`,
			);
		} catch {
			// Best-effort append, never throw
		}
	};

	let isPrechecking = false;

	const clearTimer = () => {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
	};

	const clearFocusPoll = () => {
		if (focusPollTimer) {
			clearInterval(focusPollTimer);
			focusPollTimer = null;
		}
	};

	const clearActive = (reason?: string) => {
		logDiagnostic(`clearActive called${reason ? ` (reason: ${reason})` : ""}`);
		clearTimer();
		clearFocusPoll();
		currentTriggerFocusGuard = null;
		if (currentLockPath) {
			try {
				if (fs.existsSync(currentLockPath)) {
					fs.unlinkSync(currentLockPath);
				}
			} catch {
				// Best-effort delete, never throw
			}
			currentLockPath = null;
		}
		setActiveQuestion(null);
		try {
			api.renderer?.requestRender?.();
		} catch {
			// ignore renderer errors
		}
	};

	const opencodeDir =
		config.configDir ?? path.resolve(process.cwd(), ".opencode");

	const handleQuestionAsked = (event: Record<string, unknown>) => {
		const data = (event?.properties ?? event?.data ?? event) as
			| Record<string, unknown>
			| undefined;
		const requestID = (data?.id ?? data?.requestID ?? event?.id) as
			| string
			| undefined;
		const sessionID = (data?.sessionID ?? event?.sessionID ?? "") as string;
		const questions = (data?.questions ??
			event?.questions ??
			[]) as QuestionInfo[];

		logDiagnostic(
			`asked event received: requestID=${requestID ?? "none"}, sessionID=${sessionID}, questionsCount=${Array.isArray(questions) ? questions.length : 0}`,
		);

		if (!requestID || !Array.isArray(questions) || questions.length === 0) {
			return;
		}

		clearTimer();
		clearFocusPoll();

		const decision = detectRecommendations(
			questions,
			config.recommendedMarkers,
			{
				requireExactlyOneRecommendation: config.requireExactlyOneRecommendation,
			},
		);

		const { name: agentName, found: agentFound } = resolveAgentName(
			api,
			sessionID,
			data,
		);

		setActiveQuestion({
			requestID,
			sessionID,
			questions,
			detection: decision,
			agentName,
			agentFound,
		});

		const lockPath = path.resolve(opencodeDir, `.sq-draft-${requestID}`);
		currentLockPath = lockPath;

		let focusGuardTriggered = false;

		const triggerFocusGuard = (reason: string) => {
			if (focusGuardTriggered) return;
			focusGuardTriggered = true;
			clearTimer();
			clearFocusPoll();

			logDiagnostic(
				`focus-activation: requestID=${requestID}, reason=${reason}, writing lockPath=${lockPath}`,
			);

			try {
				fs.writeFileSync(
					lockPath,
					JSON.stringify({ requestID, ts: Date.now() }),
					"utf8",
				);
			} catch (err) {
				logDiagnostic(
					`focus-activation write lockfile failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			setActiveQuestion((prev) => {
				if (!prev || prev.requestID !== requestID) return prev;
				return {
					...prev,
					focusDisabled: true,
				};
			});

			try {
				api.renderer?.requestRender?.();
			} catch {
				// ignore renderer errors
			}
		};

		currentTriggerFocusGuard = triggerFocusGuard;

		focusPollTimer = setInterval(() => {
			const editor = (
				api.renderer as { currentFocusedEditor?: unknown } | null | undefined
			)?.currentFocusedEditor;
			if (editor !== null && editor !== false) {
				// Truthy (user focused on input) OR undefined (API absent in this build -> fail safe)
				const reason =
					editor === undefined
						? "currentFocusedEditor is undefined (fail safe)"
						: "currentFocusedEditor is truthy";
				triggerFocusGuard(reason);
			}
		}, 250);

		if (decision.ok) {
			const markers = normalizeParamMarkers(config.recommendedMarkers);

			const sleep = (ms: number) =>
				new Promise((resolve) => setTimeout(resolve, ms));

			const precheckTabs = async () => {
				isPrechecking = true;
				try {
					await sleep(150);

					// If there is only 1 question and it's single-select, do NOT send any key
					// because pressing a number key immediately confirms and closes the prompt!
					if (questions.length === 1 && questions[0]?.multiple !== true) {
						return;
					}

					for (let qIdx = 0; qIdx < questions.length; qIdx++) {
						const q = questions[qIdx];
						if (!q || !Array.isArray(q.options)) continue;

						const recIndices: number[] = [];
						q.options.forEach((opt, idx) => {
							if (
								opt &&
								typeof opt.label === "string" &&
								markers.some((m) => opt.label.endsWith(m)) &&
								idx < 9
							) {
								recIndices.push(idx);
							}
						});

						if (q.multiple === true) {
							for (const idx of recIndices) {
								try {
									logDiagnostic(
										`Tab ${qIdx + 1}: Pre-checking multi-select option ${idx + 1}: ${q.options[idx]?.label}`,
									);
									process.stdin.emit("data", Buffer.from(String(idx + 1)));
								} catch (err) {
									logDiagnostic(`Failed to pre-check option ${idx + 1}: ${err}`);
								}
								await sleep(60);
							}
							if (qIdx < questions.length - 1) {
								try {
									logDiagnostic(`Advancing from tab ${qIdx + 1} to next tab via Tab key`);
									process.stdin.emit("data", Buffer.from("\t"));
								} catch (err) {
									logDiagnostic(`Failed to advance tab: ${err}`);
								}
								await sleep(100);
							}
						} else {
							if (recIndices.length > 0) {
								const idx = recIndices[0];
								try {
									logDiagnostic(
										`Tab ${qIdx + 1}: Selecting single-select option ${idx + 1}: ${q.options[idx]?.label}`,
									);
									process.stdin.emit("data", Buffer.from(String(idx + 1)));
								} catch (err) {
									logDiagnostic(`Failed to select option ${idx + 1}: ${err}`);
								}
								await sleep(100);
							}
						}
					}
				} finally {
					// Grace period after pre-checking completes before enabling user key intercept
					await sleep(100);
					isPrechecking = false;
				}
			};

			precheckTabs().catch((err) => {
				logDiagnostic(`precheckTabs error: ${err}`);
			});

			const initialSeconds = Math.max(0, Math.floor(config.timeoutMs / 1000));
			setCountdownSec(initialSeconds);

			countdownTimer = setInterval(() => {
				setCountdownSec((prev) => {
					const next = prev - 1;
					if (next <= 0) {
						logDiagnostic(
							`countdown zero -> clearActive: requestID=${requestID}`,
						);
						clearActive("countdown zero");
						return 0;
					}
					return next;
				});
				try {
					api.renderer?.requestRender?.();
				} catch {
					// ignore renderer errors
				}
			}, 1000);
		}

		try {
			api.renderer?.requestRender?.();
		} catch {
			// ignore renderer errors
		}
	};

	const handleQuestionEnd = (
		eventName: string,
		event: Record<string, unknown>,
	) => {
		const data = (event?.properties ?? event?.data ?? event) as
			| Record<string, unknown>
			| undefined;
		const payloadKeys = event ? Object.keys(event).join(",") : "none";
		const dataKeys = data ? Object.keys(data).join(",") : "none";
		const requestID = (data?.requestID ?? data?.id ?? event?.id) as
			| string
			| undefined;
		const current = activeQuestion();
		const idsMatched = Boolean(
			current && requestID && requestID === current.requestID,
		);

		logDiagnostic(
			`handleQuestionEnd: event=${eventName}, eventKeys=[${payloadKeys}], dataKeys=[${dataKeys}], eventRequestID=${requestID ?? "none"}, currentRequestID=${current?.requestID ?? "none"}, idsMatched=${idsMatched}`,
		);

		if (!current || !requestID || requestID === current.requestID) {
			clearActive(`handleQuestionEnd:${eventName}`);
		}
	};

	const unsubAsked = (
		api.event?.on as
			| ((
					type: string,
					handler: (e: Record<string, unknown>) => void,
			  ) => () => void)
			| undefined
	)?.("question.asked", handleQuestionAsked);
	const unsubReplied = (
		api.event?.on as
			| ((
					type: string,
					handler: (e: Record<string, unknown>) => void,
			  ) => () => void)
			| undefined
	)?.("question.replied", (e) => handleQuestionEnd("question.replied", e));
	const unsubRejected = (
		api.event?.on as
			| ((
					type: string,
					handler: (e: Record<string, unknown>) => void,
			  ) => () => void)
			| undefined
	)?.("question.rejected", (e) => handleQuestionEnd("question.rejected", e));

	api.slots.register({
		slots: {
			app_bottom() {
				return (
					<SmartQuestionOverlay
						api={api}
						state={activeQuestion}
						countdown={countdownSec}
						markers={config.recommendedMarkers}
						marker={config.recommendedMarkers}
					/>
				);
			},
		},
	});

	const unsubKey = (
		api.keymap as {
			intercept?: (
				type: string,
				handler: (payload: { event: unknown; consume?: () => void }) => void,
			) => () => void;
		} | undefined
	)?.intercept?.("key", () => {
		if (isPrechecking) return;
		if (activeQuestion() && currentTriggerFocusGuard) {
			logDiagnostic("User key interaction intercepted -> triggering focus guard");
			currentTriggerFocusGuard("User key interaction in question dialog");
		}
	});

	api.lifecycle?.onDispose?.(() => {
		unsubKey?.();
		unsubAsked?.();
		unsubReplied?.();
		unsubRejected?.();
		clearActive();
	});
};

const pluginModule: TuiPluginModule & { id: string } = {
	id: "smart-question-ui",
	tui,
};

export default pluginModule;
