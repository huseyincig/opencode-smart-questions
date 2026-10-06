# 💡 OpenCode Smart Questions

[![npm version](https://img.shields.io/npm/v/opencode-smart-questions?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/opencode-smart-questions)
[![npm downloads](https://img.shields.io/npm/dm/opencode-smart-questions?color=blue&logo=npm&logoColor=white)](https://www.npmjs.com/package/opencode-smart-questions)
[![OpenCode: v1 & v2](https://img.shields.io/badge/OpenCode-v1%20%7C%20v2%20Dual--Mode-10b981?logo=terminal&logoColor=white)](https://opencode.ai)
[![CI](https://github.com/huseyincig/opencode-smart-questions/actions/workflows/ci.yml/badge.svg)](https://github.com/huseyincig/opencode-smart-questions/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.0.0-339933?logo=nodedotjs&logoColor=white)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](tsconfig.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Installation](#-installation) · [How It Works](#-how-selection-works) · [Configuration](#-configuration) · [Validation](#-validation--testing) · [Architecture](#-project-layout)

A standalone OpenCode plugin that selects an agent-recommended answer after a configurable countdown, unless the user intervenes. It supports single-choice and multiple-choice questions with separate OpenCode V1 and V2 adapters.

**Language-independent selection:** question text and options can be written in any language. The plugin recognizes an exact marker such as `[SQ:recommended]`; it does not translate or judge the meaning of recommendations. The older `(Recommended)` and `(Önerilen)` markers are also accepted.

---

## 📦 Installation

The current source version is **0.4.5**. The `@latest` selector always follows the version currently published to npm; for unreleased source changes, use [local development](#-local-development).

### 🟢 OpenCode V1

Add the package to the server plugin configuration:

```json
{
  "plugin": ["opencode-smart-questions@latest"]
}
```

To show the countdown panel, also register the same package in the V1 terminal configuration (`tui.json`):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-smart-questions@latest"]
}
```

The package exposes independent `./server` and `./tui` entry points. Actual plugin loading depends on the OpenCode build.

### 🔵 OpenCode V2

Use the V2 plugin configuration:

```json
{
  "plugins": ["opencode-smart-questions@latest"]
}
```

On V2 builds that support package TUI discovery, the `./tui` export provides the countdown and form-reply handling. The V2 path has automated mock-host coverage; **a real V2 host has not yet been verified**.

### 🛠️ Local Development

```bash
git clone https://github.com/huseyincig/opencode-smart-questions.git ~/.config/opencode/vendor/opencode-smart-questions
```

Use the absolute `file:///` directory URL in the appropriate `plugin` (V1) or `plugins` (V2) list; for example:

```json
{
  "plugin": ["file:///home/me/.config/opencode/vendor/opencode-smart-questions"]
}
```

V1's terminal configuration needs the same directory in its own `plugin` list. The repository contains compiled `dist/` files, so using its committed build does not require compiling on the target machine.

---

## ⚡ How Selection Works

1. The agent marks each recommended option by appending `[SQ:recommended]` to its label, regardless of the label's language.
2. The V1 backend receives `question.asked`; the V2 TUI receives `form.created`. Both use the same recommendation detector.
3. Only questions with unambiguous recommendations are eligible. V2 also requires supported selectable fields and unambiguous label-to-value mapping.
4. A countdown begins (30 seconds by default). Keyboard or paste interaction cancels pending selection. V1 coordinates with its TUI using a per-request draft lock; V2 owns its form timer in the TUI.
5. If the request is still eligible at expiry, V1 sends `question.reply`; V2 verifies the pending form and sends `session.form.reply`.

For example, `保存 [SQ:recommended]`, `حفظ [SQ:recommended]`, `Guardar [SQ:recommended]` and `Kaydet [SQ:recommended]` all use the same detection rule. You can configure additional exact markers without adding language-specific detection logic. Unicode NFC normalization and trailing whitespace are supported.

> [!IMPORTANT]
> **Selection is not permission.** The plugin cannot determine whether a recommendation is correct, safe or authorized. Its guidance tells the agent not to mark choices requiring explicit human approval, including destructive or irreversible actions, but guidance is not an enforcement boundary. Use OpenCode's own permission and confirmation controls for sensitive actions. The optional countdown is an opportunity to intervene, not a guarantee that an already-sent reply can be recalled.

---

## ⚙️ Configuration

Settings are loaded from the first existing file in this order: project `.opencode/smart-question.json`, project `smart-question.json`, then `~/.config/opencode/smart-question.json`. If no file exists, built-in defaults apply. An explicitly malformed configuration disables auto-selection instead of silently substituting a different policy.

```json
{
  "enabled": true,
  "timeoutMs": 30000,
  "recommendedMarkers": [
    "[SQ:recommended]",
    "(Recommended)",
    "(Önerilen)"
  ],
  "requireExactlyOneRecommendation": true,
  "uiText": {
    "recommendation": "Öneri:",
    "disabled": "OTOMATİK SEÇİM DEVRE DIŞI",
    "autoReplyFailed": "Otomatik yanıt başarısız. Lütfen elle yanıtlayın.",
    "agent": "Ajan:",
    "session": "Oturum:"
  },
  "debugLog": ""
}
```

| Setting | Default | Behavior |
| --- | --- | --- |
| `enabled` | `true` | Enable the plugin; `false` disables it. |
| `timeoutMs` | `30000` | Countdown in milliseconds. `0` attempts an immediate reply, with no practical intervention window. |
| `recommendedMarkers` | `["[SQ:recommended]", "(Recommended)", "(Önerilen)"]` | Exact accepted suffixes. The first marker is suggested to the agent. |
| `recommendedMarker` | first marker | Legacy single-marker setting; `recommendedMarkers` takes precedence. |
| `requireExactlyOneRecommendation` | `true` | Retained for configuration compatibility. For safety, single-choice questions always require exactly one marked option, even when this is `false`. |
| `uiText` | English labels | Optional TUI translations for `recommendation`, `disabled`, `autoReplyFailed`, `agent`, and `session`. |
| `debugLog` | `""` | Optional diagnostic log path. Empty means no diagnostic file. |

Multiple-choice questions may mark several options. Questions with no recommendation, ambiguous single-choice recommendations, unsupported V2 field types, duplicate form keys or ambiguous label-to-value mappings are left to the user.

---

## 🧪 Validation & Testing

```bash
npm ci
npm run typecheck
npm test
node sandbox/smoke-test.mjs
node sandbox/comprehensive-test.mjs
npm audit
npm pack --dry-run
```

CI runs on Node 22 and 24. Unit/regression tests and sandbox scenarios use simulated OpenCode hosts; they do **not** establish reliable behavior on every released OpenCode build. For implementation boundaries, reproducibility and the remaining real-host checks, see [verification and limitations](docs/verification.md).

---

## 🏗️ Project Layout

- `src/backend.ts`: Handles V1 question events and reply transport
- `src/ui.tsx`: Contains V1/V2 TUI countdown and reply adapters
- `src/detector.ts`: Recognizes recommendation markers across locales
- `src/form-adapter.ts`: Maps V2 form options to field values
- `src/config.ts`: Loads and validates plugin settings
- `src/draft-guard.ts`: Manages V1 manual answer cancellation locks
- `src/index.ts`: Registers V1/V2 dual-mode backend adapters
- `dist/`: Precompiled JavaScript outputs and adaptive TUI loader

---

## 📄 License

[MIT](LICENSE) © Hüseyin Hadi Çığ
