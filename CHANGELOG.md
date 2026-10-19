# Changelog

## 0.8.2 — 2026-10-20

- Preserve recommended selections, including multiselect answers, when V1 remediation reaches its fallback budget. The V1 TUI now permits that fallback instead of installing a manual-answer lock.
- Cancel in-flight V1 question handling on session deletion, user messages, settlement and plugin disposal; rejected history lookups cannot revive cancelled work.
- Keep rejected remediation retryable when duplicate question events arrive during transport.
- Preserve V2 form reply ownership and user cancellation across duplicate events and asynchronous sync/reply completion.
- Reject ambiguous V2 label-to-value mappings even when first-option fallback is enabled.
- Document opt-in `includeSubagents` support across V1/V2 adapters; root-session isolation remains the default.
- Add 13 debugging regressions and isolate the V1 partial-setup test from global user configuration.

Current automated results and host-verification limits are recorded in [Verification and limitations](docs/verification.md). Historical host acceptance reports retain their original versions and results.
