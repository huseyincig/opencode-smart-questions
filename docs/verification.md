# Verification and limitations

This document describes the **v0.7.0** source evaluation on **08 October 2026**. It distinguishes automated host simulations from integration with an actual OpenCode installation.

## Automated checks

Run these commands on Node 22 or 24 from the repository root:

```bash
npm ci
npm run typecheck
npm test
node sandbox/smoke-test.mjs
node sandbox/comprehensive-test.mjs
npm audit
npm pack --dry-run
```

The unit/regression suite covers recommendation parsing in different writing systems, custom Unicode markers, invalid configuration rejection, V1 reply and timer handling, draft-lock cancellation and fail-safe coordination, V1 TUI event ordering and setup rollback, V2 form mapping and constraints, live-location changes, user intervention, form replacement, cancellation during asynchronous synchronization, privacy-safe diagnostics, sequential cleanup and partial setup rollback. The separate 10-scenario sandbox exercises a simulated V1 server adapter. CI runs these checks on Node 22 and 24.

Automated tests validate the tested inputs and mock-host behavior. They do not measure real-world failure rates or prove that every V1/V2 build delivers the expected hooks.

## Implemented boundaries

| Area | Current behavior | Boundary |
| --- | --- | --- |
| Language handling | Exact recommendation suffixes (default `[SQ:recommended]` plus legacy English/Turkish markers), Unicode NFC normalization and configurable UI text | No translation, semantic understanding, automatic locale inference or verification of an agent's recommendation |
| Single/multiple choice | Exactly one marked option is required for a single-choice question; multi-select supports several | Unmarked root-session questions trigger protocol remediation (`[Smart Questions protocol remediation]`); child sessions remain isolated |
| V1 events | A per-request timer handles `question.asked/replied/rejected`; the TUI creates a draft lock on user input | The countdown panel and keyboard cancellation require the V1 TUI adapter to be loaded; a reply already sent cannot be withdrawn |
| V1 transport | Native question client, internal client or a supported REST fallback | Host routing and authentication must be verified on the actual V1 build |
| V2 forms | Supported selectable form fields map exact labels to stable values; synchronization and pending state are checked before reply | An already-issued reply cannot be recalled; custom tools, global forms and unsupported fields are outside automatic selection |
| Error handling | Invalid explicit configuration disables auto-selection; reply errors are logged, and V2 displays a manual-answer warning | Logging/UI availability depends on host delivery; an error after sending may have an uncertain remote outcome |
| V2 registration lifecycle | Awaited `tool.transform` and `session.hook('context')` registrations; rollback on partial setup failure; cleanup is idempotent | Real-host loader behavior, reload events and disposal require actual V2 host verification |
| Configuration isolation | Project files take precedence over `~/.config/opencode/smart-question.json`; missing-config tests isolate their home-directory lookup | Global user preferences intentionally remain effective in normal installations |
| Approval | Prompt guidance asks the agent not to mark sensitive choices | The marker is not an authorization system or a pre-execution safety control |

The legacy `requireExactlyOneRecommendation` setting is accepted for compatibility but does not relax single-choice ambiguity checks. `timeoutMs: 0` provides no practical opportunity to cancel an automatic reply.

## Current automated acceptance — 08 October 2026

The local evaluation used Node **24.21.0** in an isolated checkout. The GitHub CI matrix separately runs Node **22.x** and **24.x**. The following results were obtained for the v0.7.0 source tree:

| Check | Observed result |
| --- | ---: |
| Unit and regression tests | **148/148 passed** |
| Strict TypeScript checks (`noUnused*`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) | **Passed** |
| V1 simulated sandbox scenarios | **10/10 passed** |
| Smoke test and TypeScript typecheck | **Passed** |
| Full `npm audit` | **0 reported vulnerabilities** |
| `npm pack --dry-run` | **36 files**, expected exports present |
| Real OpenCode V1/V2 host acceptance for v0.7.0 | **PASSED (see acceptance-v1.md & acceptance-v2.md)** |

OpenTUI's development dependency currently declares Node >=26.4 or Bun >=1.3; npm installation on Node 24 reports an engine warning. Passing the Node 22/24 automated suite does not demonstrate full native TUI runtime compatibility.

## Real-host checks still required

**V1:** Install both the server and TUI adapters on a selected OpenCode V1 version. Verify question-event delivery, countdown visibility, the native and fallback reply paths as applicable, manual input near timeout, question rejection, overlapping questions and plugin unload.

**V2:** On a real V2 build supporting the required APIs, verify server context guidance, TUI package discovery, `form.created/replied/cancelled` delivery, option-label-to-value mapping, user interaction during synchronization, form replacement, UI failure messaging, session switching and plugin cleanup.

Test both with normal and malformed configuration, single- and multi-select forms, Unicode option labels, and unsupported form fields. Record the exact host build and observed results before making a real-host compatibility claim.

There is no coupling to OpenCode Guardian. Neither plugin is required to install or run the other.

## Source and test references

- [V1 backend and transport](https://github.com/huseyincig/opencode-smart-questions/blob/main/src/backend.ts)
- [V1/V2 TUI and countdowns](https://github.com/huseyincig/opencode-smart-questions/blob/main/src/ui.tsx)
- [Language-independent detector](https://github.com/huseyincig/opencode-smart-questions/blob/main/src/detector.ts)
- [Configuration validation](https://github.com/huseyincig/opencode-smart-questions/blob/main/src/config.ts)
- [Unit/regression tests](https://github.com/huseyincig/opencode-smart-questions/blob/main/tests/smart-question.test.mjs)
- [Sandbox scenarios](https://github.com/huseyincig/opencode-smart-questions/blob/main/sandbox/comprehensive-test.mjs)
- [CI workflow](https://github.com/huseyincig/opencode-smart-questions/blob/main/.github/workflows/ci.yml)
