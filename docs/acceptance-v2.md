# OpenCode V2 Acceptance Result

**Status: PASS**

Guardian ve Smart Questions, gerçek OpenCode V2 hostunda hem bağımsız hem birlikte çalışma açısından kabul testlerinden geçirilmiştir.

## Test Environment

| Item | Result |
| --- | --- |
| OpenCode line | V2 |
| OpenCode version | 2.0.24 |
| Runtime | V2 |
| Test model | `opencode-go/mimo-v2.6-flash` |
| Guardian commit | `c8a05bf35ea316fda7d52ccf798e3798d5c51f32` |
| Smart Questions commit | `513fad1a696172f5820ee12c234bda2e2f77fd84` |
| Platform | Linux x86_64 |

The repositories were tested from fresh source checkouts in an isolated sandbox.

## Acceptance Results

| Area | Result |
| --- | --- |
| Guardian standalone | PASS |
| Smart Questions standalone | PASS |
| Guardian + Smart Questions | PASS |
| Guardian preflight enforcement | PASS |
| Redundant confirmation prevention | PASS |
| Native question/recommendation handling | PASS |
| Safe auto-selection | PASS |
| `auto_select=forbidden` manual approval | PASS |
| Guardian → SQ trusted handoff | PASS |
| Handoff provenance / anti-spoofing | PASS |
| TTL / turn binding | PASS |
| Subagent isolation | PASS |
| Handoff replay prevention | PASS |
| Loop prevention | PASS |
| Independent plugin fallback | PASS |

## Guardian Standalone

Guardian loaded successfully on the V2 runtime with strict preflight active.

A safe shell operation was inspected and allowed normally.

A destructive shell operation was blocked before execution. The target file's SHA-256 hash remained unchanged before and after the attempted operation, confirming that the destructive command was prevented before mutation.

Instruction Fidelity also correctly detected a redundant confirmation request when the user had already authorized the requested work and instructed the agent to continue instead of asking again.

Subagent execution remained functional and was not incorrectly blocked by Guardian.

## Smart Questions Standalone

Smart Questions loaded successfully without Guardian.

Root-session scoping was enforced through the V2 session hierarchy, while child/subagent sessions were excluded from SQ handling.

The model used the native question interface and produced a single recommendation marker:

`[SQ:recommended]`

The recommendation was correctly detected.

A live timeout test confirmed that the SQ timer fired and called the question reply transport with the expected recommended option.

Observed result:

- configured timeout: 50 ms
- reply count: 1
- selected option: `PostgreSQL [SQ:recommended]`
- automatic reply successfully executed

## Guardian + Smart Questions

The two plugins loaded simultaneously and coordinated through:

`[OPENCODE_HANDOFF:v1]`

### Allowed Handoff

A trusted Guardian clarification handoff with:

`auto_select=allowed`

was accepted by SQ.

Observed flow:

Guardian → trusted handoff → SQ → native question → countdown → automatic reply → handoff consumed

The same handoff ID was preserved through the coordination path and the active handoff was removed after resolution.

**Result: PASS**

### Forbidden Handoff

A Guardian approval handoff with:

`auto_select=forbidden`

was accepted by SQ.

Even when the question contained an `[SQ:recommended]` option:

- no countdown-based answer was sent
- auto reply count remained `0`
- the question remained waiting for explicit manual user action

**Result: PASS**

## Handoff Security

### Anti-Spoofing

A user-supplied fake:

`[OPENCODE_HANDOFF:v1]`

without trusted Guardian provenance was rejected.

Observed state:

- untrusted extraction: `null`
- marker-only extraction: `null`
- active handoff: `undefined`

User text alone cannot impersonate a trusted Guardian handoff.

**Result: PASS**

### TTL and Turn Binding

The active handoff TTL is:

`120000 ms`

A handoff timestamped 125 seconds in the past was purged and tombstoned.

A newer human user turn also prevented an older handoff from being rediscovered through message-history scanning.

**Result: PASS**

### Subagent Isolation

The same blocking condition was evaluated for both root and child sessions.

Observed result:

- root session: handoff generated
- child/subagent session: handoff `null`
- SQ classified the child session as `child` and did not activate coordination

Guardian/SQ handoff coordination remains root-agent only.

**Result: PASS**

### Replay and Loop Prevention

A handoff ID was:

1. activated
2. consumed
3. immediately submitted again

The replay attempt returned `false`, and no active handoff was recreated.

A new handoff with a new sequence ID was accepted normally.

This verifies consumed-ID tombstoning and prevents immediate Guardian ↔ SQ handoff loops.

**Result: PASS**

## Automated Verification

At the tested revisions:

- Guardian: `474 / 474` tests passed
- Smart Questions: `113 / 113` tests passed

These automated tests supplement, but do not replace, the real-host acceptance and direct runtime integration checks described above.

## Evidence Classification

The acceptance used two complementary evidence levels:

1. **Real OpenCode V2 host evidence**
   - plugin loading
   - real V2 runtime
   - `opencode-go/mimo-v2.6-flash`
   - Guardian preflight
   - destructive-operation prevention
   - native agent/subagent behavior
   - simultaneous Guardian + SQ loading

2. **Live runtime integration evidence**
   - SQ timeout/reply transport
   - trusted handoff extraction
   - allowed/forbidden handoff state
   - anti-spoofing
   - TTL and turn boundaries
   - root/subagent isolation
   - replay/tombstone behavior

The second category directly exercised the built plugin runtime, hooks and shared handoff state on the test host. It should not be described as external black-box UI automation.

## Final Result

```text
OpenCode line: V2
OpenCode version: 2.0.24
Runtime: V2
Model: opencode-go/mimo-v2.6-flash

GUARDIAN ONLY: PASS
SMART QUESTIONS ONLY: PASS
GUARDIAN + SMART QUESTIONS: PASS

Handoff allowed: PASS
Handoff forbidden: PASS
Anti-spoofing: PASS
TTL / turn binding: PASS
Subagent isolation: PASS
Replay prevention: PASS
Loop prevention: PASS
Independent fallback: PASS

FAILURES: none

FINAL: PASS
```
