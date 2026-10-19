# 💡 OpenCode Smart Questions

[![npm version](https://img.shields.io/npm/v/opencode-smart-questions?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/opencode-smart-questions)
[![npm downloads](https://img.shields.io/npm/dm/opencode-smart-questions?color=blue&logo=npm&logoColor=white)](https://www.npmjs.com/package/opencode-smart-questions)
[![OpenCode: v1 & v2](https://img.shields.io/badge/OpenCode-v1%20%7C%20v2%20Dual--Mode-10b981?logo=terminal&logoColor=white)](https://opencode.ai)
[![Historical V1/V2 host baseline](https://img.shields.io/badge/Host%20baseline-historical-10b981?logo=checkmarx&logoColor=white)](docs/acceptance-v1.md)
[![Tests: 169/169 Passing](https://img.shields.io/badge/Tests-169%2F169%20Passing-339933?logo=githubactions&logoColor=white)](docs/verification.md)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Installation](#-installation) · [How Selection Works](#-how-selection-works) · [Architecture & Flowchart](#-architecture--selection-lifecycle) · [Guardian Coordination (Optional)](#-optional-coordination-with-opencode-guardian) · [Configuration](#-configuration) · [Validation](#-validation--testing)

A high-performance, deterministic OpenCode plugin that automatically answers agent-recommended choices after a configurable countdown, unless the user intervenes. It operates completely standalone and supports single-choice and multiple-choice questions across OpenCode V1 and V2 host architectures.

**Language-independent selection:** Question text and options can be written in any language. The plugin recognizes exact configured markers such as `[SQ:recommended]`; it does not translate or alter recommendations. Alternative markers like `(Recommended)` and `(Önerilen)` are also recognized by default.

---

## 📊 Verification & Live Acceptance

![Automated and host acceptance results](docs/assets/verification-overview.svg)

> The graphic separates **v0.8.2 automated verification** from the historical OpenCode V1/V2 acceptance baseline. Live-host and interactive TUI acceptance have not been rerun for v0.8.2.

Smart Questions **v0.8.2** was checked on **20 October 2026**, using Node **24.22.0**:

- **Current Automated Verification:** **169 / 169** unit, fallback, visibility, subagent, and regression tests passing.
- **Sandbox Scenarios:** **10 / 10** comprehensive scenarios and the separate smoke test pass.
- **Static Analysis:** Standard and strict TypeScript gates pass; Oxlint reports **0 warnings / 0 errors**.
- **Dependency Audits:** Not rerun for this patch; no dependency versions changed.
- **Historical Real Host Acceptance (V1 & V2):** Earlier recorded runs used OpenCode V1 (`1.18.34`) and V2 (`2.0.24`) with `opencode-go/mimo-v2.6-flash`. Their reports retain the original tested versions and results.

Read the detailed [V1 Acceptance Report](docs/acceptance-v1.md), [V2 Acceptance Report](docs/acceptance-v2.md), and [Technical Verification](docs/verification.md) for full reproduction steps and test harnesses.

See the [0.8.2 release notes](CHANGELOG.md) for fallback, cancellation, duplicate-event, and form-mapping fixes.

---

## ✨ Key Highlights

- **100% Standalone Operation:** Operates independently without requiring any other plugins, external services, or background daemons.
- **Dual-Mode Host Support:** Seamlessly supports both **OpenCode v1** (`@opencode-ai/plugin`) and **OpenCode v2** (`@opencode/plugin`) with decoupled runtime adapters.
- **Flexible Recommendation Matching:** Recognizes prefix (`(Recommended)`, `(Önerilen)`), suffix (`[SQ:recommended]`), description text, case-insensitive variations, and Turkish tokens across single-choice and multi-select prompts.
- **Multi-Step & Multi-Field Fallback:** With an explicit fallback policy, recommended steps retain their selections and unresolved steps use the first option. The default policy requests bounded agent remediation instead.
- **Configurable Fallback & Policies:** Supports `unclassifiedQuestionPolicy: 'fallback-first' | 'remediate-then-fallback' | 'remediate' | 'ignore'`, `fallbackToFirstOption: true`, and `fallbackOnManual: true` to provide complete autonomy without human intervention when needed.
- **Comprehensive Overlay State Visibility:** Renders dedicated visual states across all handled selectable questions: **AUTO** (cyan border, green checklist, countdown timer), **MANUAL** (yellow border, manual decision required), **UNCLASSIFIED** (cyan border, agent remediation in progress), and **ERROR** (red border).
- **Fingerprint-Scoped Loop Protection:** Unclassified question loop budgets are strictly scoped to identical failure chains and question fingerprints. Chains cleanly reset upon successful AUTO selection, explicit MANUAL classification, question reply/settlement, or new user messages.
- **Transport Failure Resilience:** Failed synthetic prompt remediation preserves retry capability without exhausting duplicate or budget state.
- **Instant User Intervention:** Cancels countdown immediately upon user typing, keyboard entry, draft file locking, or manual form selection.
- **Subagent & Child Scope:** Root sessions are eligible by default. Set `includeSubagents: true` to include host-confirmed child sessions across V1/V2; unknown session topology remains ineligible.
- **Zero Runtime Dependencies:** Pure TypeScript compiled to `dist/` with no heavy third-party runtime dependencies.
- **Decoupled Guardian Protocol:** Optional, zero-dependency handoff coordination when paired with [OpenCode Guardian](https://github.com/huseyincig/opencode-guardian).

---

## 📦 Installation

The current version is **0.8.2**.

### 🟢 OpenCode V1 (1.x)

Add the package to the server plugin configuration in your `opencode.json` (`~/.config/opencode/opencode.json` or project-local):

```json
{
  "plugin": ["opencode-smart-questions@latest"]
}
```

To display the countdown panel in the terminal UI, also register the package in the V1 terminal configuration (`tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-smart-questions@latest"]
}
```

### 🔵 OpenCode V2 (2.x)

Use the V2 **`plugins`** array in `opencode.json` or `opencode.jsonc`:

```json
{
  "plugins": ["opencode-smart-questions@latest"]
}
```

On V2 builds, the `./tui` export provides reactive countdown and form-reply handling.

### 🛠️ Local Development

Clone the repository into your OpenCode plugins or vendor directory:

```bash
git clone https://github.com/huseyincig/opencode-smart-questions.git ~/.config/opencode/vendor/opencode-smart-questions
```

Use the `file:///` URL in `opencode.json`:

```json
{
  "plugin": ["file:///path/to/opencode-smart-questions"]
}
```

---

## ⚡ How Selection Works

1. The agent marks each recommended option by appending `[SQ:recommended]` to its label.
2. The V1 backend intercepts `question.asked`; the V2 TUI intercepts `form.created`. Both execute the shared recommendation detector.
3. With the default `unclassifiedQuestionPolicy: "remediate"`, unclassified questions request bounded agent remediation. Explicit fallback policies can select the first option for unresolved steps while preserving recommendations in the other steps. Ambiguous V2 label-to-value mappings never auto-submit.
4. A countdown timer begins (`30000 ms` default). Any keyboard typing or manual selection cancels the pending countdown immediately.
5. If the request remains eligible upon expiry, V1 issues `client.question.reply`; V2 validates the pending form and submits `session.form.reply`.

> [!IMPORTANT]
> **Selection is not permission.** The plugin cannot determine whether a recommendation is safe, reversible, or authorized. Destructive operations should always require explicit human approval.

---

## 🔄 Architecture & Selection Lifecycle

The decision flow below illustrates Smart Questions' native, standalone operation:

```mermaid
flowchart TD
    Event["Question or form event received from OpenCode"] --> Scope{"Eligible session?"}
    Scope -->|Unknown topology or excluded child| Ignore["Bypass event; no auto-reply"]
    Scope -->|Root or opted-in child| Detect["Scan options for recommendation markers"]

    Detect --> DetectCheck{"Recommendation status?"}
    DetectCheck -->|Zero recommendations| Fallback["Apply configured remediation or fallback policy"]
    DetectCheck -->|Multiple in single-select| Fallback
    DetectCheck -->|Single valid recommendation| DraftCheck{"User draft lock active?"}

    DraftCheck -->|Lock exists or typing active| Fallback
    DraftCheck -->|Lock clear| Timer["Start countdown timer"]

    Timer --> Intervene{"User intervention before timeout?"}
    Intervene -->|Option click or keyboard press| Cancel["Cancel countdown immediately"]
    Intervene -->|Timer expires cleanly| Recheck{"Form or question still pending?"}

    Recheck -->|No or answered| Cancel
    Recheck -->|Yes and pending| Reply["Dispatch native reply transport"]
    Reply --> Complete["Agent resumes turn with selected answer"]
```

---

## 🤝 Optional: Coordination with OpenCode Guardian

Smart Questions is **100% standalone and has no dependencies on Guardian**.

However, when used together in the same OpenCode environment, they optionally coordinate through a decoupled, zero-dependency handoff protocol (`[OPENCODE_HANDOFF:v1]`):

- **Destructive Action Safety:** With the default `fallbackOnManual: false`, Guardian's `auto_select=forbidden` suppresses the countdown and requires manual input. Enabling `fallbackOnManual` opts out of that manual classification guard; it does not grant execution permission.
- **Safe Clarifications:** For routine choices, Guardian sets `auto_select=allowed`, allowing Smart Questions to execute its standard countdown.
- **Anti-Spoofing & Replay Protection:** Handshakes without valid provenance are rejected; handoffs expire after 120s TTL and consumed IDs are retained in bounded replay-protection memory.

📖 For architecture diagrams, sequence flows, and contract details, see the [Guardian + Smart Questions Coordination Guide](docs/guardian-integration.md).

---

## ⚙️ Configuration (`smart-question.json`)

Settings are resolved hierarchically from `<project>/.opencode/smart-question.json`, `<project>/smart-question.json`, or `~/.config/opencode/smart-question.json`:

```json
{
  "enabled": true,
  "timeoutMs": 30000,
  "includeSubagents": false,
  "unclassifiedQuestionPolicy": "remediate",
  "fallbackOnManual": false,
  "recommendedMarkers": [
    "[SQ:recommended]",
    "(Recommended)",
    "(Önerilen)"
  ],
  "requireExactlyOneRecommendation": true,
  "uiText": {
    "recommendation": "Recommendation:",
    "disabled": "AUTO-SELECTION DISABLED",
    "autoReplyFailed": "Auto-reply failed. Please select manually.",
    "agent": "Agent:",
    "session": "Session:"
  },
  "debugLog": ""
}
```

### 🎛️ Configuration Options:

| Setting | Default | Description |
| :--- | :---: | :--- |
| `enabled` | `true` | Enables or disables the plugin. |
| `timeoutMs` | `30000` | Countdown duration in milliseconds before auto-selecting. |
| `includeSubagents` | `false` | Opts host-confirmed child sessions into guidance, countdown and reply handling. Unknown topology is excluded. |
| `unclassifiedQuestionPolicy` | `"remediate"` | `remediate`, `ignore`, `fallback-first`, or `remediate-then-fallback`. Budget exhaustion with fallback preserves existing recommendations. |
| `maxUnclassifiedRemediations` | `3` | Maximum protocol-remediation attempts in the same question-fingerprint chain. |
| `fallbackToFirstOption` | `false` | Enables immediate first-option fallback for unresolved steps. |
| `fallbackOnManual` | `false` | Allows manual classifications, including Guardian's forbidden handoff, to proceed through normal recommendation/fallback detection. |
| `recommendedMarkers` | `["[SQ:recommended]", ...]` | Accepted suffix markers indicating an agent recommendation. |
| `requireExactlyOneRecommendation` | `true` | Legacy compatibility setting; setting it to `false` alone does not relax single-choice ambiguity checks. Explicit fallback policies have separate behavior. |
| `uiText` | English labels | Localized TUI text strings for labels and warning notices. |
| `debugLog` | `""` | File path for append-only diagnostic logging (`0600` permissions). |

---

## 🧪 Validation & Testing

Run the full verification suite locally:

```bash
npm ci
npm run typecheck
npm test
node sandbox/smoke-test.mjs
node sandbox/comprehensive-test.mjs
npm run lint
npm audit
npm pack --dry-run
```

- **CI Matrix:** Runs on Node 22, 24, and 26 with strict typechecking and Oxlint verification.
- **Acceptance Reports:** See [V1 Acceptance](docs/acceptance-v1.md) and [V2 Acceptance](docs/acceptance-v2.md) for live host benchmarks.
- **Technical Specifications:** Detailed boundaries and limitations are documented in [Technical Verification](docs/verification.md).

---

## 🏗️ Project Layout

- `src/backend.ts`: V1 event hooks, question auto-reply dispatch, and handoff coordination.
- `src/ui.tsx`: V1 and V2 interactive TUI countdown panel with reactive Solid state.
- `src/detector.ts`: Pure recommendation parser enforcing single/multi-choice invariants.
- `src/handoff.ts`: `[OPENCODE_HANDOFF:v1]` protocol parser, provenance checks, and TTL/replay tracking.
- `src/form-adapter.ts`: OpenCode V2 form schema adapter and field value mapper.
- `src/draft-guard.ts`: POSIX file-based draft locks preventing auto-reply during user typing.
- `src/config.ts`: Configuration resolver and JSON schema validator.
- `src/session-scope.ts`: V1/V2 session hierarchy analyzer ensuring root-agent isolation.
- `src/index.ts`: Dual-mode plugin entrypoint exporting V1 and V2 plugin definitions.

---

## 📄 License

MIT © [Hüseyin Hadi Çığ](https://github.com/huseyincig)
