# Changelog

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
