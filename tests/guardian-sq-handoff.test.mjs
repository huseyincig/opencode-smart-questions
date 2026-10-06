import test from "node:test";
import assert from "node:assert/strict";
import {
  parseOpenCodeHandoff,
  formatOpenCodeHandoff,
  extractHandoffFromParts,
  registerSmartQuestionsCapability,
  getGuardianCapability,
  COORDINATION_SYMBOL,
  setActiveHandoff,
  getActiveHandoff,
  consumeActiveHandoff,
  resetHandoffTracking,
  SmartQuestion,
  loadConfig,
} from "../dist/index.js";
import { buildRecommendationGuidance } from "../dist/guidance.js";

test.beforeEach(() => {
  resetHandoffTracking();
});

test("SQ handoff: parser and formatter roundtrip", () => {
  const original = {
    action: "question_required",
    kind: "choice",
    autoSelect: "allowed",
    handoffId: "gq_sqtest123",
  };
  const formatted = formatOpenCodeHandoff(original);
  assert.ok(typeof formatted === "string");
  assert.ok(formatted.includes("[OPENCODE_HANDOFF:v1]"));
  assert.ok(formatted.includes("source=guardian"));
  assert.ok(formatted.includes("action=question_required"));
  assert.ok(formatted.includes("kind=choice"));
  assert.ok(formatted.includes("auto_select=allowed"));
  assert.ok(formatted.includes("handoff_id=gq_sqtest123"));

  const parsed = parseOpenCodeHandoff(formatted);
  assert.ok(parsed);
  assert.deepEqual(parsed, {
    version: "v1",
    source: "guardian",
    action: "question_required",
    kind: "choice",
    autoSelect: "allowed",
    handoffId: "gq_sqtest123",
  });
});

test("SQ handoff: extractHandoffFromParts extracts handoff from assistant or user message parts", () => {
  const parts = [
    { type: "text", text: "Some preceding explanation" },
    {
      type: "text",
      text: "[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=approval\nauto_select=forbidden\nhandoff_id=gq_destructive_1\n\nDestructive action confirmation required.",
    },
  ];

  const extracted = extractHandoffFromParts(parts);
  assert.ok(extracted);
  assert.equal(extracted.kind, "approval");
  assert.equal(extracted.autoSelect, "forbidden");
  assert.equal(extracted.handoffId, "gq_destructive_1");
});

test("SQ handoff: capability registry detection", () => {
  registerSmartQuestionsCapability();
  const globalObj = globalThis;
  const reg = globalObj[COORDINATION_SYMBOL];
  assert.ok(reg?.smartQuestions);
  assert.equal(reg.smartQuestions.version, 1);
  assert.equal(reg.smartQuestions.mainAgentOnly, true);
  assert.equal(reg.smartQuestions.supportsAutoSelect, true);

  // Simulate Guardian capability presence
  reg.guardian = {
    version: 1,
    supportsHandoff: true,
  };
  const guardCap = getGuardianCapability();
  assert.ok(guardCap);
  assert.equal(guardCap.supportsHandoff, true);
});

test("SQ handoff: loop prevention - consumed handoff cannot be reactivated", () => {
  const sessionID = "ses-loop-test";
  const handoff = {
    version: "v1",
    source: "guardian",
    action: "question_required",
    kind: "choice",
    autoSelect: "allowed",
    handoffId: "gq_unique_123",
  };

  const activated = setActiveHandoff(sessionID, handoff);
  assert.equal(activated, true);
  assert.deepEqual(getActiveHandoff(sessionID), handoff);

  // Consume on question resolution
  const consumed = consumeActiveHandoff(sessionID);
  assert.deepEqual(consumed, handoff);
  assert.equal(getActiveHandoff(sessionID), undefined);

  // Attempting to reactivate the exact same handoff ID must fail safe
  const reactivated = setActiveHandoff(sessionID, handoff);
  assert.equal(reactivated, false);
  assert.equal(getActiveHandoff(sessionID), undefined);
});

test("SQ handoff: auto_select=forbidden skips auto-reply and preserves question for manual user answer", async () => {
  const replies = [];
  const sessionID = "ses-forbidden-root";
  const client = {
    session: {
      async get({ path: p }) {
        return { data: { id: p.id, directory: "/tmp" } };
      },
    },
    question: {
      async reply(payload) {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client, directory: "/tmp" },
    { config: { enabled: true, timeoutMs: 10, recommendedMarker: "[SQ:recommended]", requireExactlyOneRecommendation: true } }
  );

  // Simulate receiving Guardian handoff with auto_select=forbidden
  const handoff = {
    version: "v1",
    source: "guardian",
    action: "question_required",
    kind: "approval",
    autoSelect: "forbidden",
    handoffId: "gq_approval_rm",
  };
  setActiveHandoff(sessionID, handoff);

  // Even if an option contains [SQ:recommended] (e.g. from an erroneous prompt), SQ must refuse to auto-select
  await hooks.event?.({
    event: {
      type: "question.asked",
      data: {
        id: "req-destruct",
        sessionID,
        questions: [{
          question: "Confirm database purge?",
          options: [
            { label: "Delete all [SQ:recommended]" },
            { label: "Cancel" },
          ],
        }],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 35));

  // Must NOT have auto-replied!
  assert.equal(replies.length, 0, "Destructive / forbidden operations must never auto-reply");
  await hooks.dispose?.();
});

test("SQ handoff: auto_select=allowed proceeds with auto-selection countdown", async () => {
  const replies = [];
  const sessionID = "ses-allowed-root";
  const client = {
    session: {
      async get({ path: p }) {
        return { data: { id: p.id, directory: "/tmp" } };
      },
    },
    question: {
      async reply(payload) {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client, directory: "/tmp" },
    { config: { enabled: true, timeoutMs: 10, recommendedMarker: "[SQ:recommended]", requireExactlyOneRecommendation: true } }
  );

  // Simulate receiving Guardian handoff with auto_select=allowed
  const handoff = {
    version: "v1",
    source: "guardian",
    action: "question_required",
    kind: "choice",
    autoSelect: "allowed",
    handoffId: "gq_choice_deploy",
  };
  setActiveHandoff(sessionID, handoff);

  await hooks.event?.({
    event: {
      type: "question.asked",
      data: {
        id: "req-choice",
        sessionID,
        questions: [{
          question: "Select deployment target:",
          options: [
            { label: "Staging [SQ:recommended]" },
            { label: "Production" },
          ],
        }],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 35));

  // Auto-reply must succeed
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.requestID, "req-choice");
  await hooks.dispose?.();
});

test("SQ handoff: chat.message hook captures Guardian handoff on root sessions", async () => {
  const sessionID = "ses-chat-msg-root";
  const client = {
    session: {
      async get({ path: p }) {
        return { data: { id: p.id, directory: "/tmp" } };
      },
    },
  };

  const hooks = await SmartQuestion(
    { client, directory: "/tmp" },
    { config: { enabled: true, timeoutMs: 10 } }
  );

  assert.ok(typeof hooks["chat.message"] === "function");

  const remediationText =
    "[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=clarification\nauto_select=allowed\nhandoff_id=gq_clarify_pkg\n\nClarify missing package dependency.";

  await hooks["chat.message"](
    { sessionID },
    {
      message: { role: "user" },
      parts: [{ type: "text", text: remediationText }],
    }
  );

  const active = getActiveHandoff(sessionID);
  assert.ok(active);
  assert.equal(active.kind, "clarification");
  assert.equal(active.autoSelect, "allowed");
  assert.equal(active.handoffId, "gq_clarify_pkg");

  await hooks.dispose?.();
});

test("SQ handoff: guidance includes Guardian Remediation Handoff Protocol instructions", () => {
  const config = loadConfig(undefined);
  const guidance = buildRecommendationGuidance(config);

  assert.match(guidance.system, /Guardian Remediation Handoff Protocol/);
  assert.match(guidance.system, /\[OPENCODE_HANDOFF:v1\]/);
  assert.match(guidance.system, /action=question_required/);
  assert.match(guidance.system, /auto_select=allowed/);
  assert.match(guidance.system, /auto_select=forbidden/);

  assert.match(guidance.tool, /\[OPENCODE_HANDOFF:v1\]/);
  assert.match(guidance.tool, /auto_select=forbidden/);
});
