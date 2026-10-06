import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { SmartQuestion, OpencodeSmartQuestions } from "../dist/index.js";

const childSession = (id = "ses-child") => ({ id, parentID: "ses-root", directory: "/tmp" });
const rootSession = (id = "ses-root") => ({ id, directory: "/tmp" });

test("V1 backend ignores child-session questions and does not expose global tool guidance", async () => {
  const replies = [];
  const client = {
    session: {
      async get({ path }) {
        return { data: childSession(path.id) };
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
    { config: { enabled: true, timeoutMs: 5, recommendedMarker: "(Recommended)", requireExactlyOneRecommendation: true } }
  );

  assert.equal(hooks["tool.definition"], undefined, "global tool guidance must not leak into child agents");

  const system = [];
  await hooks["experimental.chat.system.transform"]?.(
    { sessionID: "ses-child", model: {} },
    { system }
  );
  assert.deepEqual(system, [], "child session must not receive SQ system guidance");

  await hooks.event?.({
    event: {
      type: "question.asked",
      data: {
        id: "req-child",
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

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length, 0, "child session must never auto-reply");
  await hooks.dispose?.();
});

test("V1 backend keeps root-session guidance and auto-reply active", async () => {
  const replies = [];
  const client = {
    session: {
      async get({ path }) {
        return { data: rootSession(path.id) };
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
    { config: { enabled: true, timeoutMs: 5, recommendedMarker: "(Recommended)", requireExactlyOneRecommendation: true } }
  );

  const system = [];
  await hooks["experimental.chat.system.transform"]?.(
    { sessionID: "ses-root", model: {} },
    { system }
  );
  assert.equal(system.length, 1);
  assert.match(system[0], /Smart Question Auto-Selection Guidance/);

  await hooks.event?.({
    event: {
      type: "question.asked",
      data: {
        id: "req-root",
        sessionID: "ses-root",
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

  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(replies.length, 1);
  await hooks.dispose?.();
});

test("V2 backend injects guidance only for root sessions and never registers global tool guidance", async () => {
  let contextHook;
  let toolTransformCalls = 0;
  const context = {
    location: { directory: "/tmp" },
    options: { enabled: true },
    tool: {
      transform() {
        toolTransformCalls++;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    session: {
      async get({ sessionID }) {
        return sessionID === "ses-child" ? childSession(sessionID) : rootSession(sessionID);
      },
      hook(name, callback) {
        assert.equal(name, "context");
        contextHook = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  };

  const cleanup = await OpencodeSmartQuestions.setup(context);
  assert.equal(toolTransformCalls, 0, "global V2 tool guidance must not be registered");

  const childEvent = {
    sessionID: "ses-child",
    system: [{ type: "text", text: "base" }],
    messages: [],
    tools: {},
    agent: "child",
    model: {},
  };
  await contextHook(childEvent);
  assert.equal(childEvent.system.length, 1);

  const rootEvent = {
    sessionID: "ses-root",
    system: [{ type: "text", text: "base" }],
    messages: [],
    tools: {},
    agent: "main",
    model: {},
  };
  await contextHook(rootEvent);
  assert.equal(rootEvent.system.length, 2);
  assert.match(rootEvent.system[1].text, /Smart Question Auto-Selection Guidance/);

  await cleanup?.();
});

test("V1 TUI ignores child-session question overlays", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-main-only-v1-"));
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
        configDir: tempDir,
      },
    });

    events.get("question.asked")?.({
      data: {
        id: "req-child-ui",
        sessionID: "ses-child",
        questions: [{
          question: "Proceed?",
          options: [{ label: "Yes (Recommended)" }, { label: "No" }],
        }],
      },
    });
    keys.get("keypress")?.({ name: "down" });

    assert.equal(
      fs.readdirSync(tempDir).some((name) => name.includes("req-child-ui")),
      false,
      "child question must not arm the V1 focus/draft guard"
    );
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("V2 TUI ignores child-session forms", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sq-main-only-v2-"));
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
      id: "form-child",
      sessionID: "ses-child",
      fields: [{
        key: "choice",
        type: "string",
        options: [
          { value: "yes", label: "Yes (Recommended)" },
          { value: "no", label: "No" },
        ],
      }],
    };
    pendingForms.set(form.id, form);
    handlers.get("form.created")?.({
      type: "form.created",
      data: { form },
      location: { directory: tempDir },
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(replies.length, 0, "child form must never auto-reply");
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
