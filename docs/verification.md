# Verification and limitations

This document describes how the current `main` source is checked. It distinguishes automated host simulations from integration with an actual OpenCode installation.

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

The unit/regression suite includes recommendation parsing in different writing systems, custom Unicode markers, invalid configuration rejection, V1 reply and timer handling, draft-lock cancellation, V1 TUI event ordering, V2 form mapping, malformed fields, user intervention, form replacement, cancellation during asynchronous synchronization, and reply failures. The separate 10-scenario sandbox exercises a simulated V1 server adapter. CI runs these checks on Node 22 and 24.

Automated tests validate the tested inputs and mock-host behavior. They do not measure real-world failure rates or prove that every V1/V2 build delivers the expected hooks.

## Implemented boundaries

| Area | Current behavior | Boundary |
| --- | --- | --- |
| Language handling | Exact recommendation suffixes (default `[SQ:recommended]` plus legacy English/Turkish markers), Unicode NFC normalization and configurable UI text | No translation, semantic understanding, automatic locale inference or verification of an agent's recommendation |
| Single/multiple choice | Exactly one marked option is required for a single-choice question; multi-select supports several | Unmarked, ambiguous and unsupported questions are left to the user |
| V1 events | A per-request timer handles `question.asked/replied/rejected`; the TUI creates a draft lock on user input | The countdown panel and keyboard cancellation require the V1 TUI adapter to be loaded; a reply already sent cannot be withdrawn |
| V1 transport | Native question client, internal client or a supported REST fallback | Host routing and authentication must be verified on the actual V1 build |
| V2 forms | Supported selectable form fields map exact labels to stable values; synchronization and pending state are checked before reply | An already-issued reply cannot be recalled; custom tools, global forms and unsupported fields are outside automatic selection |
| Error handling | Invalid explicit configuration disables auto-selection; reply errors are logged, and V2 displays a manual-answer warning | Logging/UI availability depends on host delivery; an error after sending may have an uncertain remote outcome |
| Approval | Prompt guidance asks the agent not to mark sensitive choices | The marker is not an authorization system or a pre-execution safety control |

The legacy `requireExactlyOneRecommendation` setting is accepted for compatibility but does not relax single-choice ambiguity checks. `timeoutMs: 0` provides no practical opportunity to cancel an automatic reply.

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
