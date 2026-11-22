# Changelog

## 1.3.0 — 2026-11-23

- **Unsupported Form Field Bypass & Policy (`src/form-adapter.ts`, `src/ui.tsx`, `src/config.ts`, `src/types.ts`)**: Forms containing free-text (`type: "string"` without `options`), numeric, boolean, hidden (`hidden: true`), or conditional (`when`) fields are now flagged with `unsupported: true` and no longer trigger `client.session.synthetic` unclassified remediation loops. Added `unsupportedFieldPolicy: "ignore" | "manual" | "remediate"` (default `"ignore"`).
- **Runtime Destructive Pattern Guard (`src/detector.ts`, `src/form-adapter.ts`, `src/config.ts`)**: Added configurable `manualOnPatterns` (with built-in `DEFAULT_MANUAL_ON_PATTERNS` covering `rm -rf`, `force push`, `force-push`, `git push --force`, `git reset --hard`, `drop database`, `drop table`, `truncate table`, `delete production`, `format disk`, `mkfs`) that forces `status: "manual"` at runtime even if the model appended `[SQ:recommended]`. Pass `manualOnPatterns: []` to opt out or provide custom patterns.
- **Guidance Token Cost Control (`src/guidance.ts`, `src/index.ts`, `src/config.ts`)**: Added `guidanceMode: "full" | "compact" | "hint" | "off"` (default `"full"`). `"compact"` (`"hint"`) reduces the injected system guidance block by ~82% (< 350 chars), and `"off"` disables guidance injection completely while keeping TUI auto-selection active.
- **In-Memory Decision Audit Ring Buffer (`src/diagnostics.ts`, `src/ui.tsx`, `src/index.ts`)**: Exported `getRecentSmartQuestionDecisions`, `recordSmartQuestionDecision`, and `clearSmartQuestionDecisions` backed by a 128-entry bounded ring buffer recording redacted classification and auto-reply decisions per session without requiring `debugLog` file I/O.
- **Verification**: 170/170 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.2` host acceptance scenarios pass (`npm run test:all`).

## 1.2.1 — 2026-11-22

- **Plugin Mesh Bridge `2.3.1` & Session Cleanup (`src/bridge.ts`, `src/handoff.ts`, `src/index.ts`, `src/ui.tsx`)**: Updated `BRIDGE_REVISION` to `2.3.1` with `onSessionForget` peer callbacks, cross-directory RPC standby promotion, `synthetic: false` envelope guards, `resolveMeshAgentProfile`-aware worker guidance skipping, and `event.data ?? event.properties` alignment across TUI and server listeners.
- **Metadata Merging & Nested Provenance (`src/handoff.ts`)**: Merged outer host metadata with `prompt.metadata`, `info.metadata`, `payload.metadata`, and `state.metadata` so non-empty host wrappers never shadow mesh/Guardian provenance; added `prompt.parts`/`text` extraction, `hi-message`/`hi-internal` detection, and markerless non-Guardian mesh handoff support.
- **Remediation Budget & Lease Race Fixes (`src/ui.tsx`, `src/index.ts`, `src/handoff.ts`)**: Preserved `sessionChains` remediation budgets when `form.cancelled` arrives while `session.synthetic` is in-flight, released optimistic 45s remediation leases if `session.synthetic` subsequently fails, protected newer form leases from superseded `form.cancelled` events, and preserved active handoffs + 45s leases on server `form.cancelled` during unclassified form remediation.
- **Context Hook Handoff Priority (`src/index.ts`)**: Prioritized current-turn `event.messages` handoffs over stale `event.system` handoffs in the `context` hook.
- **Verification**: 166/166 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.2` host acceptance scenarios pass (`npm run test:all`).

## 1.2.0 — 2026-11-20

- **Universal OpenCode V2 Plugin Mesh Interoperability (`src/bridge.ts`, `src/handoff.ts`, `src/index.ts`, `src/ui.tsx`)**: Added zero-dependency OpenCode V2 Plugin Mesh bridge (`BRIDGE_REVISION: 2.3.0`) enabling seamless coordination across `opencode-smart-questions`, `opencode-guardian`, `opencode-hi`, `opencode-lazy-skill-engine`, and `opencode-trim` in any combination.
- **Session Interaction Leases & Failover RPC Bridge (`src/index.ts`, `src/ui.tsx`, `src/bridge.ts`)**: Acquire and synchronize `user_interaction` session leases (`Math.max(timeoutMs + 15000, 120000)` TTL) while forms are active so orchestrators (`opencode-hi`) and policy engines (`opencode-guardian`) defer background harvesting/remediation; added automatic primary/standby failover in `registerMeshStateRpc`.
- **Multi-Peer Handoff & Strict Anti-Spoofing Provenance (`src/handoff.ts`, `src/index.ts`)**: Support `[OPENCODE_HANDOFF:v1]` handoffs from any verified mesh peer (`source=guardian`, `source=opencode-hi`, etc.) and `[opencode-mesh remediation]` markers while strictly enforcing `hasGuardianMetadata(value, 'remediation')` for Guardian messages (rejecting `visible` or partially spoofed metadata) and requiring trusted provenance on `context` hook `event.system` parts.
- **Complete Lease & Settlement Lifecycle (`src/ui.tsx`, `src/index.ts`)**: Release `user_interaction` leases immediately on auto-reply `fire()`, `!stillPending` sync checks, `formID`-only or `evt.properties` settlement payloads, user inbox messages, `session.deleted`, and `dispose()`.
- **Documentation & Installation Guide (`README.md`, `docs/*`)**: Expanded installation instructions covering global (`~/.config/opencode/opencode.json`), project-scoped (`opencode.json` / `.opencode/opencode.json`), CLI/npm global & local commands, explicit server/TUI entrypoints, and local `file://` development.
- **Verification**: 159/159 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.2` host acceptance scenarios pass (`npm run test:all`).

## 1.1.2 — 2026-11-19

- **Shortcut & modifier key filtering (`src/ui.tsx`)**: Ignore modifier-only keys (`shift`, `ctrl`, `control`, `alt`, `meta`, `super`, `capslock`, `numlock`, `scrolllock`) and shortcut chords (`ctrl`/`meta`/`alt`/`super`) in `keyInput` so OpenCode `v2.3.1+` tab switching, panel search (`Ctrl+F`/`Cmd+F`), and copy shortcuts no longer cancel active auto-selection countdowns.
- **Uncached session sync for TUI handoffs (`src/ui.tsx`)**: Added `setHandoffIfEligible` with synchronous fast-path for cached sessions and automatic `session.sync` fallback when `session.synthetic` or `session.inbox.enqueued` arrives before a root session is cached.
- **Server directory resolution (`src/index.ts`)**: `sessionDirectoryFromInfo` now checks both `sessionInfo.location?.directory` and flat `sessionInfo.directory`, and `context.event.subscribe` forwards `event.location?.directory` to `isSessionEligible`.
- **OpenCode `v2.3.1+` & npm 11 compatibility (`src/ui.tsx`, `tests/v2-live-acceptance.mjs`)**: Treat OpenCode `UnknownError` HTTP 500 JSON responses as rejected synthetic deliveries without consuming remediation budget, support npm 11's object-form `npm pack --json` output, and report live host version dynamically.
- **Verification**: 149/149 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.2` host acceptance scenarios pass (`npm run test:all`).

## 1.1.1 — 2026-11-17

- **Config fallback fix (`src/config.ts`)**: Strip function `resolveConfig` before validating static fallback keys so `{ resolveConfig, ...fallbackOptions }` applies fallback settings instead of failing closed when `resolveConfig(directory)` returns `undefined`.
- **Reactive TUI slot (`src/ui.tsx`)**: Use a reactive `getSessionID()` accessor and reactive `markers`/`uiText` getters in `session.composer.top` slot `render`, reading live `active()` state config on route switches without remounting.
- **Settlement & session scope hardening (`src/ui.tsx`, `src/index.ts`)**: Added a 512-entry LRU `settledForms` tombstone to reject late duplicate `form.created` events after `form.replied`/`form.cancelled`, enforced `isEligibleTuiSessionSync` in TUI `session.synthetic`/`session.inbox.enqueued` handlers, and enforced `isSessionEligible` in the server `prompt` hook.
- **Draft lock & keyboard intervention (`src/ui.tsx`)**: Added exclusive `flag: 'wx'` on `ensureDraftLock` to refuse pre-existing symlinks, ignored non-editing navigation keys (`pageup`, `pagedown`, `home`, `end`, `scrollup`, `scrolldown`, `f1`–`f12`) in `keyInput`, and cancelled in-flight `sync` forms on user typing/paste.
- **Detector, marker stripping & deduplication (`src/detector.ts`, `src/view-model.ts`, `src/handoff.ts`, `src/form-adapter.ts`)**: Restricted hardcoded `commonMarkers` fallback to default marker configs, made `stripMarker` case-insensitive, moved `registerSmartQuestionsCapability` reference counting to `globalThis` symbols, and eliminated duplication in `src/ui.tsx` (`view-model.js`) and `src/form-adapter.ts` (`prepareV2FormFields`).
- **Verification**: 145/145 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.0` host acceptance scenarios pass (`npm run test:all`).

## 1.1.0 — 2026-11-17

- **Dynamic per-session directory config (`resolveConfig`)**: Added optional `options.resolveConfig?: (directory: string) => unknown` support in `resolveSmartQuestionConfig` (`src/config.ts`), `src/index.ts`, and `src/ui.tsx` so multi-directory hosts can resolve per-session configuration dynamically while preserving 100% standalone `.opencode/smart-question.json` behavior when omitted.
- **Event stream reconnect resilience**: Updated `context.event.subscribe` in `src/index.ts` with an `AbortController`-aware exponential backoff reconnect loop (250 ms → 30 s cap) so transient `EventBusOverflowError` or stream interruptions recover automatically without silently stopping event handling.
- **Bounded TUI remediation & chain caches**: Added 512-entry LRU eviction (`setBounded`) for `remediatedForms` and `sessionChains` in `src/ui.tsx` alongside `session.deleted` cleanup.
- **Verification**: 135/135 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.0` host acceptance scenarios pass (`npm run test:all`).

## 1.0.0 — 2026-11-17

**Breaking:** Dropped OpenCode V1 support and `@opencode-ai/plugin`; Smart Questions is now a pure OpenCode V2 plugin targeting `@opencode/plugin` `^2.3.0` (`opencode v2.3.0+`).

- **Pure OpenCode V2 Server Plugin (`src/index.ts`):** Export `Plugin.define({ id: 'opencode-smart-questions', setup })`, register `session.hook('context')` and `session.hook('prompt')`, and subscribe to `context.event.subscribe` (`session.synthetic`, `session.inbox.enqueued`, `form.replied`, `form.cancelled`, `session.deleted`) with reverse-order disposal.
- **Pure OpenCode V2 TUI Plugin (`src/ui.tsx`, `scripts/emit-tui.mjs`):** Export `Plugin.define({ id: 'opencode-smart-questions.tui', setup })`, rewrite `@opencode/plugin/tui` to `opentui:runtime-module:%40opencode%2Fplugin%2Ftui`, fix `context.data.session.message.list/sync` lookup, replace non-existent `message.created` with typed V2 events, extract `SessionInfo.agent` in `resolveAgentName`, enforce draft lockfile / `canUseDraftCoordination` checks in `fire()`, and add in-flight async race guards.
- **Handoff & Protocol Fixes (`src/handoff.ts`):** Prevent Smart Questions' own synthetic remediation messages (`metadata['opencode-smart-questions'] === true`) from resetting active Guardian handoffs in `extractCurrentTurnGuardianHandoff`, and support `SessionInboxItem` payloads.
- **Verification:** 131/131 unit & regression tests, 7/7 sandbox scenarios, and 8/8 live OpenCode `v2.3.0` host acceptance scenarios pass (`npm run test:all`).

## 0.8.2 — 2026-10-20

- Preserve recommended selections, including multiselect answers, when V1 remediation reaches its fallback budget. The V1 TUI now permits that fallback instead of installing a manual-answer lock.
- Cancel in-flight V1 question handling on session deletion, user messages, settlement and plugin disposal; rejected history lookups cannot revive cancelled work.
- Keep rejected remediation retryable when duplicate question events arrive during transport.
- Preserve V2 form reply ownership and user cancellation across duplicate events and asynchronous sync/reply completion.
- Reject ambiguous V2 label-to-value mappings even when first-option fallback is enabled.
- Document opt-in `includeSubagents` support across V1/V2 adapters; root-session isolation remains the default.
- Add 13 debugging regressions and isolate the V1 partial-setup test from global user configuration.

Current automated results and host-verification limits are recorded in [Verification and limitations](docs/verification.md).
