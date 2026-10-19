import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SmartQuestion, OpencodeSmartQuestions } from "../dist/index.js";

const childSession = (id = "ses-child") => ({ id, parentID: "ses-root", directory: "/tmp" });

test("V1 backend with includeSubagents: true injects guidance and auto-replies to child sessions", async () => {
  const replies = [];
  const client = {
    session: {
      async get({ path: p }) {
        return { data: childSession(p.id) };
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
    {
      config: {
        enabled: true,
        timeoutMs: 5,
        recommendedMarker: "(Recommended)",
        requireExactlyOneRecommendation: true,
        includeSubagents: true,
      },
    }
  );

  const system = [];
  await hooks["experimental.chat.system.transform"]?.(
    { sessionID: "ses-child", model: {} },
    { system }
  );
  assert.equal(system.length, 1, "child session must receive SQ system guidance when includeSubagents is true");
  assert.match(system[0], /Smart Question Auto-Selection Guidance/);

  await hooks.event?.({
    event: {
      type: "question.asked",
      data: {
        id: "req-child-subagent",
        sessionID: "ses-child",
        questions: [{
          question: "Proceed?",
          options: [
            { label: "Yes (Recommended)" },
            { label: "No" },
          ],
        }],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(replies.length, 1, "child session question must auto-reply when includeSubagents is true");
  assert.deepEqual(replies[0], {
    requestID: "req-child-subagent",
    answers: [["Yes (Recommended)"]],
  });

  await hooks.dispose?.();
});

test("V1 TUI with includeSubagents: true arms the focus/draft guard for child questions", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-subagent-v1-"));
  try {
    const ui = await import("../dist/ui.js");
    const events = new Map();
    const keys = new Map();
    const api = {
      state: {
        path: { directory: tempDir },
        session: {
          get(sessionID) {
            return childSession(sessionID);
          },
        },
      },
      event: {
        on(type, handler) {
          events.set(type, handler);
          return () => events.delete(type);
        },
      },
      renderer: {
        requestRender() {},
        keyInput: {
          on(type, handler) { keys.set(type, handler); },
          off(type) { keys.delete(type); },
        },
      },
      slots: { register() {} },
    };

    const cleanup = await ui.tui(api, {
      config: {
        enabled: true,
        timeoutMs: 100,
        recommendedMarker: "(Recommended)",
        requireExactlyOneRecommendation: true,
        includeSubagents: true,
        configDir: tempDir,
      },
    });

    events.get("question.asked")?.({
      data: {
        id: "req-child-ui-active",
        sessionID: "ses-child",
        questions: [{
          question: "Proceed with subagent?",
          options: [{ label: "Yes (Recommended)" }, { label: "No" }],
        }],
      },
    });
    keys.get("keypress")?.({ name: "down" });

    assert.equal(
      fs.readdirSync(tempDir).some((name) => name.includes("req-child-ui-active")),
      true,
      "child question must arm the V1 focus/draft guard when includeSubagents is true"
    );
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V2 backend with includeSubagents: true injects guidance into child session context", async () => {
  let contextHook;
  let toolTransformCalls = 0;
  const context = {
    location: { directory: "/tmp" },
    options: { enabled: true, includeSubagents: true },
    tool: {
      transform() {
        toolTransformCalls++;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    session: {
      async get({ sessionID }) {
        return childSession(sessionID);
      },
      hook(name, callback) {
        assert.equal(name, "context");
        contextHook = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  };

  const cleanup = await OpencodeSmartQuestions.setup(context);
  assert.equal(toolTransformCalls, 0, "global tool guidance must not be registered");
  assert.ok(contextHook, "context hook registered");
  const childEvent = { sessionID: "ses-child", system: ["base system"] };
  await contextHook(childEvent);
  assert.equal(childEvent.system.length, 2);
  assert.match(childEvent.system[1].text, /Smart Question Auto-Selection Guidance/);

  await cleanup?.();
});

test("V2 TUI with includeSubagents: true auto-replies to child session forms", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-subagent-v2-"));
  try {
    const ui = await import("../dist/ui.js");
    const handlers = new Map();
    const pendingForms = new Map();
    const replies = [];
    const context = {
      options: {
        enabled: true,
        timeoutMs: 5,
        recommendedMarker: "(Recommended)",
        requireExactlyOneRecommendation: true,
        includeSubagents: true,
        configDir: tempDir,
      },
      location: { directory: tempDir },
      data: {
        on(type, handler) {
          handlers.set(type, handler);
          return () => handlers.delete(type);
        },
        session: {
          get(sessionID) {
            return childSession(sessionID);
          },
          form: {
            async sync() {},
            list(sessionID) {
              return [...pendingForms.values()].filter((form) => form.sessionID === sessionID);
            },
            async reply(input) {
              replies.push(input);
              pendingForms.delete(input.formID);
            },
            invalidate() {},
          },
        },
      },
      renderer: {
        keyInput: {
          on() {},
          off() {},
        },
      },
      ui: {
        router: { current: () => ({ type: "session", sessionID: "ses-child" }) },
        slot: () => () => {},
      },
    };

    const cleanup = await ui.setup(context);
    const form = {
      id: "form-child-v2",
      sessionID: "ses-child",
      fields: [{
        key: "choice",
        type: "string",
        options: [
          { value: "deploy", label: "Deploy (Recommended)" },
          { value: "cancel", label: "Cancel" },
        ],
      }],
    };
    pendingForms.set(form.id, form);

    handlers.get("form.created")?.({
      type: "form.created",
      data: { form },
      location: { directory: tempDir },
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(replies.length, 1, "child form must auto-reply when includeSubagents is true");
    assert.deepEqual(replies[0], {
      sessionID: "ses-child",
      formID: "form-child-v2",
      answer: { choice: "deploy" },
    });
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
