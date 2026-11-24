# Verification and limitations

This document describes the **v1.3.4** evaluation on **24 November 2026**.

## Automated checks

Run these commands from the repository root:

```bash
npm ci
npm run typecheck
npm run typecheck:strict
npm run lint
npm run test:all
node sandbox/smoke-test.mjs
node sandbox/comprehensive-test.mjs
npm audit
npm pack --dry-run
```

CI declares Node 22.x, 24.x and 26.x. The local verification run used Node **26.13.1**, `@opencode/plugin` **2.4.1**, and OpenCode **v2.4.1**.

## Current results

| Check | Observed result |
| --- | --- |
| Unit and regression tests (`npm test`) | **181/181 passed** |
| Live OpenCode `v2.4.1` acceptance (`npm run test:acceptance`) | **8/8 scenarios passed** against live `opencode serve` |
| Strict TypeScript and Oxlint | **Passed**, 0 warnings / 0 errors |
| Simulated V2 comprehensive scenarios | **7/7 passed** |
| Separate V2 smoke test | **Passed** |
| Dependency audit (`npm audit`) | **0 vulnerabilities** |
| Packaging dry run (`npm pack --dry-run`) | Expected server, UI, TUI, declaration, and documentation files included |

## v1.3.4 regression & fix coverage

- **V2 `form.metadata` Classification & Break Fix (`src/form-adapter.ts`)**: Scanned `form.metadata.message` and `form.metadata.description` for manual markers and destructive `manualOnPatterns`, and broke out of the outer loop on first match so `matchedManualMarker` cannot be overwritten.
- **Isolated `loadConfig` Cache Clones (`src/config.ts`)**: Added `cloneSmartQuestionConfig()` on cache store/return so caller mutations to marker/pattern arrays or `uiText` cannot poison cached configs.
- **In-Flight User Cancellation Tombstone & Safe Router Access (`src/ui.tsx`)**: Added a bounded 512-entry `userCancelledForms` map to prevent duplicate `form.created` re-delivery from starting a countdown after user interaction during `inFlightForms`, and wrapped `context.ui.router.current()` in `try/catch`.
- **Canonical Plugin Mesh Bridge Sync (`src/bridge.ts`)**: Synchronized `src/bridge.ts` with canonical `BRIDGE_REVISION: 2.3.1` (`MeshAgentProfile.bindingOwner`).

## v1.3.3 regression & fix coverage

- **Server Event Filtering (`src/index.ts`)**: Subscribes only to the 6 relevant event types (`session.synthetic`, `session.inbox.enqueued`, `form.created`, `form.replied`, `form.cancelled`, `session.deleted`) via `context.event.subscribe({ signal, types })` so streaming text/tool deltas incur zero processing overhead.
- **TUI Idle Keypress, Countdown & Sync Optimizations (`src/ui.tsx`)**: Added an idle fast-path in `cancelActiveInteraction` (`pending.size === 0 && inFlightForms.size === 0`), skipped unchanged-second Solid updates in `updateSessionState`/countdown interval, and bypassed `session.message.sync` for strictly manual or ignored unsupported forms.
- **Stat-Validated Config Cache (`src/config.ts`)**: Cached parsed `smart-question.json` files by `mtimeMs:ctimeMs:size` in a 64-entry LRU map with instant invalidation on modification or deletion.

## v1.3.2 regression & fix coverage

- **OpenCode `v2.4.1` Unattended Automation Isolation (`src/session-scope.ts`)**: Classified `ses_aut_*` automation run sessions as `scope: 'automation'` and excluded them from both server `[SQ_GUIDANCE:v1]` injection and TUI auto-selection regardless of `includeSubagents`.
- **OpenCode `v2.4.1` Peer & SDK Alignment (`package.json`, `package-lock.json`)**: Relaxed OpenTUI peer floors to `@opentui/core >=0.8.0` and `@opentui/solid >=0.8.0` per `@opencode/plugin@2.4.1` (`#65819`) while typechecking and testing against `@opencode/plugin@2.4.1` and `@opentui/*@0.9.9`.

## v1.3.1 regression & fix coverage

- **Live TUI Keypress & Paste Countdown Cancellation (`src/ui.tsx`)**: Switched `context.renderer.keyInput` subscription to `prependListener` (with `.on` fallback) so user keypresses/pastes cancel countdowns before OpenCode's `Form` keymap calls `stopPropagation()`.
- **Session & Kitty Modifier Coverage (`src/ui.tsx`)**: Added `lastRenderedSlotSessionID` and root-family fallback in `cancelActiveInteraction`, added `option`/`hyper` chord filtering, and added Kitty modifier-only keys to `NON_INTERVENTION_KEYS`.
- **OpenCode `v2.4.0` Peer Alignment (`package.json`, `tests/v2-live-acceptance.mjs`)**: Updated `peerDependencies` (`@opentui/core >=0.9.4`, `@opentui/solid >=0.9.4`, `solid-js ^1.9.12`, `@opencode/plugin ^2.3.0 || ^2.4.0`) and acceptance host version matching.

## v1.3.0 regression & fix coverage

- **Unsupported Form Field Bypass (`src/form-adapter.ts`, `src/ui.tsx`, `src/config.ts`)**: Flagged non-selectable V2 form fields (`free-text` string without `options`, numeric, boolean, `hidden`, `when`) with `unsupported: true` so they never trigger `session.synthetic` remediation loops; added `unsupportedFieldPolicy: "ignore" | "manual" | "remediate"`.
- **Runtime Destructive Pattern Guard (`src/detector.ts`, `src/form-adapter.ts`, `src/config.ts`)**: Added `manualOnPatterns` (with `DEFAULT_MANUAL_ON_PATTERNS` for high-risk shell/git/SQL/disk commands) to force `status: "manual"` at runtime regardless of `[SQ:recommended]`.
- **Guidance Token Control & In-Memory Decision Audit (`src/guidance.ts`, `src/diagnostics.ts`, `src/index.ts`, `src/ui.tsx`)**: Added `guidanceMode: "full" | "compact" | "hint" | "off"` and exported bounded in-memory audit helpers (`getRecentSmartQuestionDecisions`, `recordSmartQuestionDecision`, `clearSmartQuestionDecisions`).

## v1.2.1 regression & fix coverage

- **Plugin Mesh Bridge `2.3.1` & Session Cleanup (`src/bridge.ts`, `src/handoff.ts`, `src/index.ts`, `src/ui.tsx`)**: Added `onSessionForget` peer cleanup callbacks, cross-directory RPC standby promotion, `synthetic: false` envelope checks, `resolveMeshAgentProfile`-aware worker guidance skipping, and `event.data ?? event.properties` alignment.
- **Metadata Merging & Nested Provenance (`src/handoff.ts`)**: Merged outer host metadata with `prompt`/`info`/`payload`/`state` metadata so host keys never shadow provenance; added `prompt.parts`/`text` extraction, `hi-message`/`hi-internal` detection, and markerless non-Guardian mesh handoffs.
- **Remediation Budget, Lease Races & Context Priority (`src/ui.tsx`, `src/index.ts`, `src/handoff.ts`)**: Preserved `sessionChains` when `form.cancelled` arrives mid-`synthetic`, released 45s remediation leases if `session.synthetic` subsequently fails, protected newer form leases from superseded `form.cancelled` events, preserved handoffs on server `form.cancelled` during remediation, and prioritized `event.messages` handoffs over stale `event.system` handoffs.

## v1.2.0 regression & fix coverage

- **Universal OpenCode V2 Plugin Mesh (`src/bridge.ts`, `src/handoff.ts`, `src/index.ts`, `src/ui.tsx`)**: Added `BRIDGE_REVISION: 2.3.0` capability registry, `user_interaction` session leases (`Math.max(timeoutMs + 15000, 120000)` TTL), primary/standby RPC failover (`registerMeshStateRpc`), and multi-peer `[OPENCODE_HANDOFF:v1]` support (`source=guardian`, `source=opencode-hi`, etc.).
- **Provenance & Anti-Spoofing Hardening (`src/handoff.ts`, `src/index.ts`)**: Enforced `hasGuardianMetadata(value, 'remediation')` on all Guardian-flagged payloads without mesh fallback bypass, and required `extractTrustedGuardianHandoff` provenance on `context` hook `event.system` parts while skipping `SQ_GUIDANCE_SENTINEL`.
- **Lease & Settlement Lifecycle (`src/ui.tsx`, `src/index.ts`)**: Released `user_interaction` leases immediately on auto-reply `fire()`, `!stillPending` sync verification, `formID`-only and `evt.properties` settlement payloads, user inbox messages, `session.deleted`, and `dispose()`.

## v1.1.2 regression & fix coverage

- **Shortcut & modifier key filtering**: `NON_INTERVENTION_KEYS` includes modifier-only keys and `onKey` ignores `ctrl`/`meta`/`alt`/`super` shortcut chords so OpenCode `v2.3.1+` tab-switch, find, and copy shortcuts never cancel auto-selection.
- **Uncached TUI handoff session sync**: `setHandoffIfEligible` keeps synchronous eligibility for cached sessions while falling back to `session.sync` for uncached root sessions on `session.synthetic` / `session.inbox.enqueued`.
- **Server directory resolution & `UnknownError` handling**: `sessionDirectoryFromInfo` supports flat `sessionInfo.directory`, `event.subscribe` forwards `event.location.directory`, `client.session.synthetic` treats `{ name: 'UnknownError' }` as rejected, and `tests/v2-live-acceptance.mjs` supports npm 11's object `npm pack --json` output.

## v1.1.1 regression & fix coverage

- **Config fallback with `resolveConfig`**: Stripped function `resolveConfig` prior to `SMART_QUESTION_CONFIG_KEYS` validation so fallback options apply when `resolveConfig(directory)` returns `undefined`.
- **Reactive TUI slot & settlement tombstone**: `session.composer.top` uses reactive `getSessionID()`, `markers`, and `uiText` accessors; `settledForms` (512-entry LRU) blocks late duplicate `form.created` events after settlement.
- **Session scope, symlink safety, & keyboard precision**: Enforced `isEligibleTuiSessionSync` on TUI synthetic/inbox events and `isSessionEligible` on server `prompt` hook; added `flag: 'wx'` to `ensureDraftLock`; ignored non-editing navigation keys (`pageup`/`pagedown`/etc.) while cancelling in-flight sync forms on typing/paste.
- **Detector, marker stripping, & global handoff counter**: Scoped `commonMarkers` fallback to default markers, added case-insensitive `stripMarker`, moved `registerSmartQuestionsCapability` refcount to `globalThis`, and deduplicated `ui.tsx` / `form-adapter.ts`.

## v1.1.0 regression & fix coverage

- **Dynamic per-session directory config (`resolveConfig`)**: `resolveSmartQuestionConfig`, `src/index.ts`, and `src/ui.tsx` support an optional `options.resolveConfig(directory)` callback without short-circuiting startup when a host's initial directory disables auto-selection; standalone `.opencode/smart-question.json` resolution remains unchanged when omitted.
- **Event stream reconnect**: `context.event.subscribe` in `src/index.ts` automatically reconnects with exponential backoff (`250 ms` to `30 s`) on transient stream errors and exits cleanly on `dispose()`.
- **Bounded TUI caches**: `remediatedForms` and `sessionChains` in `src/ui.tsx` enforce a 512-entry LRU cap via `setBounded` alongside `session.deleted` cleanup.

## v1.0.0 regression & fix coverage

- Pure OpenCode V2 server (`Plugin.define`) and TUI (`Plugin.define`) entrypoints with zero `@opencode-ai/plugin` V1 code or adapters.
- `scripts/emit-tui.mjs` rewrites `@opencode/plugin/tui` to `opentui:runtime-module:%40opencode%2Fplugin%2Ftui` in `dist/tui-runtime.js`.
- V2 TUI uses `context.data.session.message.list/sync`, typed V2 events (`form.created`, `form.replied`, `form.cancelled`, `session.synthetic`, `session.inbox.enqueued`, `session.deleted`), and `SessionInfo.agent` in `resolveAgentName`.
- V2 TUI verifies `canUseDraftCoordination` and `fs.statSync(lockPath)` before `session.form.reply` and guards async `sync` / `synthetic` calls with `inFlightForms`.
- `extractCurrentTurnGuardianHandoff` ignores Smart Questions' own synthetic remediation messages (`metadata['opencode-smart-questions'] === true`) while strictly requiring Guardian provenance for handoffs.

## Implemented boundaries

| Area | Current behavior | Boundary |
| --- | --- | --- |
| Recommendation parsing | Configured markers, Unicode NFC normalization, flexible prefix/suffix/description matching | No semantic understanding or verification of the recommended action |
| Selection policies | Default unclassified-form remediation via `session.synthetic`; explicit first-option fallback preserves recommendations in other fields | Fallback can resolve ambiguous recommendations by choosing the first match; ambiguous V2 label-to-value mapping is still rejected |
| Session scope | Root sessions by default; host-confirmed children only with `includeSubagents: true` | Unknown topology is excluded; Guardian's interactive handoffs remain root-scoped |
| V2 forms | Supported selectable fields map to stable values; synchronization, lockfile, pending ownership and cancellation are rechecked | Global, hidden, conditional and unsupported fields are excluded; already-issued replies cannot be recalled |
| V2 backend registration | `session.hook('context')`, `session.hook('prompt')`, and `event.subscribe` with reverse-order disposal | No global tool transform is registered |
| Configuration | Malformed explicit settings disable selection; project files take precedence over global settings | Global preferences remain effective during normal installation |
| Manual classification | Default `fallbackOnManual: false` honors manual markers and Guardian `auto_select=forbidden` | Enabling `fallbackOnManual` opts out of this guard. Selection never grants execution permission |

## Source and test references

- [Release notes](../CHANGELOG.md)
- [V2 server](../src/index.ts), [V2 TUI](../src/ui.tsx), [V2 forms](../src/form-adapter.ts), [Handoff protocol](../src/handoff.ts), [Mesh bridge](../src/bridge.ts)
- [Debugging regressions](../tests/debug-regressions.test.mjs), [Live V2 acceptance](../tests/v2-live-acceptance.mjs)
- [Sandbox scenarios](../sandbox/comprehensive-test.mjs), [CI workflow](../.github/workflows/ci.yml)
