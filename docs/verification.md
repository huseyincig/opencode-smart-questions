# Verification and limitations

This document describes the **v1.2.0** evaluation on **20 November 2026**.

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

CI declares Node 22.x, 24.x and 26.x. The local verification run used Node **26.13.1**, `@opencode/plugin` **2.3.0**, and OpenCode **v2.3.2**.

## Current results

| Check | Observed result |
| --- | --- |
| Unit and regression tests (`npm test`) | **159/159 passed** |
| Live OpenCode `v2.3.2` acceptance (`npm run test:acceptance`) | **8/8 scenarios passed** against live `opencode serve` |
| Strict TypeScript and Oxlint | **Passed**, 0 warnings / 0 errors |
| Simulated V2 comprehensive scenarios | **7/7 passed** |
| Separate V2 smoke test | **Passed** |
| Dependency audit (`npm audit`) | **0 vulnerabilities** |
| Packaging dry run (`npm pack --dry-run`) | Expected server, UI, TUI, declaration, and documentation files included |

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
