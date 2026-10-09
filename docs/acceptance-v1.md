# OpenCode V1 Acceptance Result

**Status: PASS**

Guardian ve Smart Questions, gerçek OpenCode V1 hostunda hem bağımsız hem birlikte çalışma açısından kabul testlerinden geçirilmiştir.

## Test Environment

| Item | Result |
| --- | --- |
| OpenCode line | V1 |
| OpenCode version | 1.18.34 |
| Runtime | Node v24.21.0 |
| Test model | `opencode-go/mimo-v2.6-flash` |
| Guardian commit | `cb1cb140797f9bd775c621f8fae42a426a2f8459` |
| Guardian version/tag | `v0.10.0` |
| Smart Questions commit | `ecd43c879a9d74b8323fc316370a3b6247166909` |
| Smart Questions version/tag | `v0.8.0` |
| Platform | Linux x86_64 |

The repositories were tested from fresh source checkouts in an isolated sandbox.

The OpenCode Go model was used directly with no model fallback:

`opencode-go/mimo-v2.6-flash`

## Acceptance Results

| Area | Result |
| --- | --- |
| Guardian standalone | PASS |
| Smart Questions standalone | PASS |
| Guardian + Smart Questions | PASS |
| Guardian preflight / rule enforcement | PASS |
| Redundant confirmation prevention | PASS |
| Native question/recommendation handling | PASS |
| Safe auto-selection | PASS |
| `auto_select=forbidden` manual approval | PASS |
| Guardian → SQ trusted handoff | PASS |
| Handoff provenance / anti-spoofing | PASS |
| TTL expiry | PASS |
| Turn binding | PASS |
| Subagent isolation | PASS |
| Capability-aware subagent remediation | PASS |
| Read-only reviewer remediation isolation | PASS |
| Write-allowed subagent bounded remediation | PASS |
| Handoff replay prevention | PASS |
| Loop prevention | PASS |
| Independent plugin fallback | PASS |

## Guardian Standalone

Guardian loaded successfully on the V1 runtime and emitted a runtime-started event identifying the runtime as V1.

A real `opencode-go/mimo-v2.6-flash` agent turn completed successfully while Guardian was active.

Guardian correctly handled:

- root-agent execution
- subagent execution
- redundant confirmation prevention
- legitimate handoff generation
- remediation continuation
- provenance-aware handoff formatting

When the user had already explicitly authorized the requested task, Guardian detected the unnecessary confirmation attempt and returned a blocking Instruction Fidelity result.

No handoff was generated for that case because no genuine user decision was required.

**Result: PASS**

## Smart Questions Standalone

Smart Questions loaded successfully without Guardian.

V1 session scope classification correctly distinguished:

- root sessions
- child/subagent sessions

Single recommendation markers were correctly detected, including:

`[SQ:recommended]`

and configured alternative recommendation markers.

Ambiguous or missing recommendations failed safe.

A real countdown auto-selection test confirmed that a recommended option was automatically answered after the configured timeout.

Observed behavior:

- timeout: 1500 ms
- root-session recommendation detected
- `client.question.reply` executed
- recommended option selected successfully

Manual user interaction before timeout cancelled the pending automatic reply.

Questions originating from child/subagent sessions were ignored by SQ and did not start an automatic-selection timer.

**Result: PASS**

## Guardian + Smart Questions

The two plugins were loaded together and coordinated through:

`[OPENCODE_HANDOFF:v1]`

### Allowed Handoff

Guardian generated a legitimate decision handoff with:

```text
kind=choice
auto_select=allowed
```

Smart Questions accepted the trusted handoff.

Observed flow:

```text
Guardian
→ trusted OPENCODE_HANDOFF:v1
→ SQ activates handoff
→ native question
→ recommendation detected
→ 1500 ms countdown
→ client.question.reply
→ handoff consumed
→ agent continues
```

Observed reply payload:

`Blue-Green Deployment [SQ:recommended]`

**Result: PASS**

### Forbidden Handoff

Guardian generated an approval handoff with:

```text
kind=approval
auto_select=forbidden
```

Even when the question contained an `[SQ:recommended]` option:

- SQ did not perform automatic selection
- no automatic reply was sent
- the user remained responsible for the approval decision

Observed state:

`forbiddenReplied = null`

**Result: PASS**

## Handoff Security

### Anti-Spoofing

A user-supplied fake:

`[OPENCODE_HANDOFF:v1]`

without trusted Guardian provenance was rejected.

The trusted Guardian handoff extractor returned:

`null`

No active handoff was created.

Ordinary user text therefore cannot impersonate a trusted Guardian remediation handoff.

**Result: PASS**

### TTL Expiry

The active handoff TTL is:

`120000 ms`

A handoff was created with:

```text
createdAt = Date.now() - 125000
```

The handoff was therefore 125 seconds old, exceeding the 120-second TTL.

Observed runtime evidence:

```text
ttlLimitMs: 120000
stateAfter125s: undefined
replay/resurrection: blocked
```

Calling `getActiveHandoff(sessionID)` caused the stale handoff to be purged.

The expired handoff ID was tombstoned through the closed-handoff tracking mechanism.

A subsequent attempt to activate the same handoff ID was rejected.

This confirms that an expired handoff cannot be resurrected through direct replay or message-history fallback.

**Result: PASS**

### Turn Binding

Turn binding was tested independently from TTL expiry.

When a new human user turn was observed:

```text
role: "user"
```

the previous active handoff was invalidated.

The previous turn's handoff could not migrate into or be rediscovered by the new user turn.

**Result: PASS**

### Subagent Isolation & Capability-Aware Remediation Policy

Root and child session behavior was tested separately across both plugin layers:

1. **Handoff Isolation**:
   - Guardian handoff generation remains strictly root-agent only (`handoff: null` across all child session evaluations).
   - Smart Questions ignores child/subagent sessions entirely (`autoReplyCount: 0`).

2. **Capability-Aware Remediation Policy (v0.6.7 Fix)**:
   - Remediation dispatch is resolved strictly from host-evaluated agent capabilities (`evaluateAgentMutationProfile`, `resolveV1AgentCapability`) rather than hardcoded agent names.
   - **Read-Only Subagents (Reviewer / Oracle / Explorer)**:
     - Reviewer subagent completes analysis and yields findings to parent/root.
     - Guardian inspects the completion gate with `isSubagent: true` and resolves `canSelfRemediate: false` (read-only mutation profile: grep/glob/read only, no file edits).
     - Guardian emits **0 synthetic remediation prompts** (`remediationCount: 0`).
     - Reviewer does **NOT** re-enter `Thinking` state or initiate redundant review loops.
     - Findings are transferred cleanly and intact to the parent/root agent.
   - **Write-Allowed Subagents (Fixer / Editor / Designer)**:
     - Subagents with granted file modification capabilities (`write_allowed` mutation profile) receive bounded Guardian remediation when a controlled blocking condition occurs.
     - Bounded retry counter (`maxRounds: 6`) is preserved and respected.
   - **Write-Requires-Approval & Unknown Subagents**:
     - Subagents with approval-required mutation or unknown capabilities fail safe with zero remediation.
   - **Root Agent Sessions**:
     - Completion-gate blocking and remediation prompt generation remain fully active.
   - **Guardian + SQ Root Coordination**:
     - Trusted handoff activation and automatic selection operate without regression.

Observed behavior:

- root session: coordination enabled
- child session: handoff isolated (`handoff: null`)
- read-only child: `remediation: 0`, loop prevention active
- write-allowed child: bounded remediation supported
- SQ child-session auto reply: none

Subagent operation itself remained functional.

**Result: PASS**

### Replay Prevention

A handoff ID was:

1. activated
2. consumed
3. submitted again

After consumption, the handoff ID was retained in the closed-handoff tracking state.

A subsequent:

`setActiveHandoff(...)`

attempt using the same consumed ID returned:

`false`

The consumed handoff was not recreated.

**Result: PASS**

### Loop Prevention

Guardian remediation and Smart Questions coordination were exercised through the V1 runtime acceptance flow.

The remediation turn completed without producing a Guardian ↔ SQ handoff loop.

Combined with the consumed-ID replay protection, repeated activation of the same resolved handoff was prevented.

Observed result:

`hasLoopBlock = false`

and the agent turn completed normally.

**Result: PASS**

## Independent Plugin Operation

Both directions were tested independently:

- Guardian without Smart Questions
- Smart Questions without Guardian

Neither plugin requires the other as an npm dependency.

Their coordination uses only the versioned handoff protocol and trusted host metadata.

Failure or absence of one plugin therefore does not prevent the other from operating independently.

**Result: PASS**

## Security Properties Verified

The V1 acceptance run verified the following fail-safe properties:

- untrusted handoff text is rejected
- Guardian provenance is required
- missing or invalid automatic-selection authorization does not permit auto-selection
- ambiguous recommendations fail safe
- child/subagent sessions remain isolated
- stale handoffs expire
- new human turns invalidate previous handoff state
- consumed handoff IDs cannot be reused
- forbidden approval handoffs never auto-select
- plugins remain independently operational

## Automated Verification

At the tested revisions:

- Guardian: `484 / 484` tests passed (including 10 dedicated regression tests for capability-aware remediation)
- Smart Questions: `113 / 113` tests passed

These automated tests supplement, but do not replace, the real-host acceptance and direct runtime integration checks described above.

## Evidence Classification

The acceptance used two complementary evidence levels:

1. **Real OpenCode V1 host evidence**
   - OpenCode 1.18.34 runtime
   - Node v24.21.0
   - `opencode-go/mimo-v2.6-flash`
   - plugin loading
   - real root-agent execution
   - real subagent execution
   - Guardian remediation continuation
   - capability-aware subagent remediation execution
   - isolated V1 host configuration

2. **Live runtime integration evidence**
   - SQ countdown and reply transport
   - trusted Guardian handoff extraction
   - allowed handoff behavior
   - forbidden handoff behavior
   - anti-spoofing
   - TTL expiry
   - turn binding
   - root/child session isolation
   - read-only reviewer remediation isolation (0 remediation, no thinking loop)
   - write-allowed subagent bounded remediation
   - consumed-ID replay prevention
   - loop-prevention state behavior

The second category directly exercised the built plugin runtime, hooks and shared handoff state on the V1 test host. It should not be described as external black-box UI automation.

## Final Result

```text
OpenCode line: V1
OpenCode version: 1.18.34
Runtime: Node v24.21.0
Model: opencode-go/mimo-v2.6-flash

Guardian SHA: cb1cb140797f9bd775c621f8fae42a426a2f8459
Guardian version: v0.10.0
Smart Questions SHA: ecd43c879a9d74b8323fc316370a3b6247166909
Smart Questions version: v0.8.0

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
TTL expiry: PASS
Turn binding: PASS
Subagent isolation: PASS
Replay prevention: PASS
Loop prevention: PASS
Independent fallback: PASS

FAILURES: none

FINAL: PASS
```
