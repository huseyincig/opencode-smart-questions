# Verification and limitations

This document describes the **v0.8.2** source evaluation on **20 October 2026**. Automated adapter tests and historical real-host acceptance are separate evidence.

## Automated checks

Run these commands from the repository root:

```bash
npm ci
npm run typecheck
npm run typecheck:strict
npm run lint
npm test
node sandbox/smoke-test.mjs
node sandbox/comprehensive-test.mjs
npm pack --dry-run
```

CI declares Node 22.x, 24.x and 26.x. The local run used Node **24.22.0** and installed plugin SDKs **@opencode-ai/plugin 1.18.34** and **@opencode/plugin 2.0.22**. A configured CI matrix is not evidence that all those runtimes were executed locally.

## Current results

| Check | Observed result |
| --- | --- |
| Unit and regression tests | **169/169 passed**, including 13 new debugging regressions |
| Strict TypeScript and lint | **Passed**, warnings denied |
| Simulated V1 comprehensive scenarios | **10/10 passed** |
| Separate smoke test | **Passed** |
| Packaging dry run | Expected server, UI, TUI, declaration and release-document files included |
| Dependency audits | Not rerun for this patch; dependency versions unchanged |
| Fresh real V1/V2 host and interactive TUI acceptance | **Not run for v0.8.2** |

The [V1](acceptance-v1.md) and [V2](acceptance-v2.md) acceptance reports are historical records with their original host builds, plugin versions, commits and test results. They do not certify this patch's live behavior.

## v0.8.2 regression coverage

- V1 exhausted remediation preserves recommendations in every classified step, including multiselects; the TUI does not block that fallback with a manual lock.
- Disposal, session deletion, new human messages and settlement cancel V1 question handling that is awaiting session/history lookup. A rejected history lookup cannot reschedule cancelled work.
- Duplicate events during rejected remediation preserve the retry budget and duplicate-suppression state correctly.
- V2 duplicate form events retain their reply owner and user-interaction cancellation during sync and reply; stale async completions cannot clear another owner's pending entry.
- V2 label-to-value mapping rejects repeated labels even with fallback enabled.
- V1 partial-setup testing uses an explicit local configuration directory, independent of global user preferences.
- `includeSubagents: true` is tested across V1/V2 server and TUI adapters; the default remains root-only.

## Implemented boundaries

| Area | Current behavior | Boundary |
| --- | --- | --- |
| Recommendation parsing | Configured markers, Unicode NFC normalization, flexible prefix/suffix/description matching in the runtime classifier | No semantic understanding or verification of the recommended action; the legacy detector retains exact suffix semantics |
| Selection policies | Default unclassified-question remediation; explicit first-option fallback preserves recommendations in other steps | Fallback can resolve ambiguous recommendations by choosing the first match; ambiguous V2 label-to-value mapping is still rejected |
| Session scope | Root sessions by default; host-confirmed children only with `includeSubagents: true` | Unknown topology is excluded; Guardian's interactive handoffs remain root-scoped |
| V1 events and transport | Per-request timers, cancellation ownership, native question client/internal client/REST fallback | Keyboard cancellation requires the V1 TUI; already-sent replies cannot be withdrawn |
| V2 forms | Supported selectable fields map to stable values; synchronization, pending ownership and cancellation are rechecked | Global, hidden, conditional and unsupported fields are excluded; already-issued replies cannot be recalled |
| V2 backend registration | `session.hook('context')` guidance with idempotent registration disposal | Real loader, hot-reload and interactive rendering need host acceptance; no global tool transform is registered |
| Configuration | Malformed explicit settings disable selection; project files take precedence over global settings | Global preferences remain effective during normal installation; tests isolate configuration when needed |
| Manual classification | Default `fallbackOnManual: false` honors manual markers and Guardian `auto_select=forbidden` | Enabling `fallbackOnManual` opts out of this guard. Selection never grants execution permission |

`requireExactlyOneRecommendation` is accepted for compatibility but setting it to `false` alone does not relax single-choice ambiguity checks. `timeoutMs: 0` gives no practical opportunity to cancel.

## Real-host checks still required

On pinned V1/V2 hosts, load the packaged server and TUI entrypoints and exercise countdown rendering, keyboard/paste cancellation, settlement, duplicate delivery, session switching/deletion and unload. Check native and fallback transports as applicable, multi-step/multiselect fallback, opt-in child sessions, unsupported forms, malformed configuration and manual-classification policy. Record exact host versions and observed outcomes before making a new host-compatibility claim.

OpenTUI's native runtime requirements must be checked independently from the Node-based core and simulated tests. Importing the package successfully does not prove that the terminal widget renders or reacts correctly.

Neither plugin requires the other. Optional coordination is described in [Guardian integration](guardian-integration.md).

## Source and test references

- [Release notes](../CHANGELOG.md)
- [V1 backend](../src/backend.ts), [V1/V2 TUI](../src/ui.tsx), [V2 forms](../src/form-adapter.ts)
- [Debugging regressions](../tests/debug-regressions.test.mjs), [subagent support](../tests/subagent-support.test.mjs)
- [Sandbox scenarios](../sandbox/comprehensive-test.mjs), [CI workflow](../.github/workflows/ci.yml)
