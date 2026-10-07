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
| Guardian commit | `cb1cb140797f9bd775c621f8fae42a426a2f8459` |
| Guardian version/tag | `v0.7.0` |
| Smart Questions commit | `ecd43c879a9d74b8323fc316370a3b6247166909` |
| Smart Questions version/tag | `v0.5.0` |
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
| Capability-aware subagent remediation | PASS |
| Read-only reviewer remediation isolation | PASS |
| Write-allowed subagent bounded remediation | PASS |
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

### Subagent Isolation & Capability-Aware Remediation Policy

The same blocking condition was evaluated for both root and child sessions across the V2 plugin runtime:

1. **Handoff Isolation**:
   - root session: handoff generated
   - child/subagent session: handoff `null`
   - SQ classified the child session as `child` and did not activate coordination

2. **Capability-Aware Remediation Policy (v0.6.7 Fix)**:
   - Evaluated via `resolveV2AgentCapability` and `evaluateAgentMutationProfile` against live V2 tool/permission surfaces.
   - **Read-Only Subagents (Reviewer / Oracle / Explorer)**:
     - Reviewer subagent completes analysis and yields findings to parent.
     - Guardian inspects the completion gate with `isSubagent: true` and resolves `canSelfRemediate: false` (read-only mutation profile: read/grep/glob only, file editing prohibited).
     - Guardian emits **0 synthetic remediation prompts** (`remediationCount: 0`).
     - Reviewer does **NOT** re-enter `Thinking` state or initiate redundant review loops.
     - Findings are transferred cleanly and intact to parent.
   - **Write-Allowed Subagents (Fixer / Editor / Designer)**:
     - Subagents with granted file modification capabilities (`write_allowed` mutation profile) receive bounded Guardian remediation when a controlled blocking condition occurs.
     - Bounded retry counter (`maxRounds: 6`) is preserved and respected.
   - **Write-Requires-Approval & Unknown Subagents**:
     - Subagents with approval-required mutation or unknown capabilities fail safe with zero remediation.
   - **Root Agent Sessions**:
     - Completion-gate blocking and remediation prompt generation remain fully active.
   - **Guardian + SQ Root Coordination**:
     - Trusted handoff activation and automatic selection operate without regression.

Guardian/SQ handoff coordination remains root-agent only, and subagent remediation is strictly capability-aware.

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

- Guardian: `484 / 484` tests passed (including 10 dedicated regression tests for capability-aware remediation)
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
   - capability-aware subagent remediation execution
   - simultaneous Guardian + SQ loading

2. **Live runtime integration evidence**
   - SQ timeout/reply transport
   - trusted handoff extraction
   - allowed/forbidden handoff state
   - anti-spoofing
   - TTL and turn boundaries
   - root/subagent isolation
   - read-only reviewer remediation isolation (0 remediation, no thinking loop)
   - write-allowed subagent bounded remediation
   - replay/tombstone behavior

The second category directly exercised the built plugin runtime, hooks and shared handoff state on the test host. It should not be described as external black-box UI automation.

## Final Result

```text
OpenCode line: V2
OpenCode version: 2.0.24
Runtime: V2
Model: opencode-go/mimo-v2.6-flash

Guardian SHA: cb1cb140797f9bd775c621f8fae42a426a2f8459
Guardian version: v0.7.0
Smart Questions SHA: ecd43c879a9d74b8323fc316370a3b6247166909
Smart Questions version: v0.5.0

GUARDIAN ONLY: PASS
SMART QUESTIONS ONLY: PASS
GUARDIAN + SMART QUESTIONS: PASS

Capability-aware remediation: PASS
Read-only reviewer isolation: PASS
Write-allowed bounded remediation: PASS
Root completion gate: PASS
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
