# OpenCode V2 Acceptance Result

**Status: PASS (8/8 Scenarios)**

Smart Questions **v1.3.4** was verified end-to-end against a live **OpenCode v2.4.1** (`opencode serve`) instance on **24 November 2026** via `npm run test:acceptance` (`tests/v2-live-acceptance.mjs`).

## Test Environment

| Item | Result |
| --- | --- |
| OpenCode line | V2 (Pure V2) |
| OpenCode version | `2.4.1` |
| Plugin SDK | `@opencode/plugin` `2.4.1` |
| Client SDK | `@opencode/client` `2.4.1` |
| Smart Questions version | `1.3.4` |
| Node.js | `26.13.1` |
| Platform | Linux x86_64 |

## Live OpenCode v2.4.1 Acceptance Scenarios

| Scenario | Result | Observed Behavior |
| --- | --- | --- |
| 1. Root AUTO Form | PASS | `client.session.form.create` → live `form.created` SSE → countdown → `session.form.reply` → settled |
| 2. Multiselect Form (`minItems`/`maxItems`) | PASS | Multiple `[SQ:recommended]` options mapped to option values and settled |
| 3. User Keypress Cancellation | PASS | Keypress wrote `.sq-draft-<formID>` lockfile, cancelled auto-reply, and kept form pending |
| 4. MANUAL Form (`[SQ:manual]`) | PASS | Auto-reply suppressed and form remained pending |
| 5. UNCLASSIFIED Form Remediation | PASS | Real `client.session.synthetic` remediation dispatched and verified in `session.inbox.list` |
| 6. Subagent Session Isolation | PASS | Child session (`parentID` set) ignored when `includeSubagents: false`; auto-replied and settled when `includeSubagents: true` |
| 7. Guardian Coordination (`session.synthetic`) | PASS | `auto_select=forbidden` blocked auto-reply; `auto_select=allowed` auto-replied and tombstoned |
| 8. Packed Artifact Verification | PASS | `npm pack` tarball extracted to clean directory and imported `.` (`dist/index.js`) and `./tui` (`dist/tui.js`) |

## Reproduction

```bash
npm run build
npm run test:acceptance
```

All live tests run in an isolated temporary workspace with an ephemeral `opencode serve --port <free>` process and never modify `~/.config/opencode/`.
