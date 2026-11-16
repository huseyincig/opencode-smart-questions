import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OpencodeSmartQuestions } from "../dist/index.js";

const childSession = (id = "ses-child") => ({ id, parentID: "ses-root", directory: "/tmp" });
const rootSession = (id = "ses-root") => ({ id, directory: "/tmp" });

test("V2 backend injects guidance only for root sessions and never registers global tool guidance", async () => {
  const hooks = new Map();
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
        hooks.set(name, callback);
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  };

  const cleanup = await OpencodeSmartQuestions.setup(context);
  assert.equal(toolTransformCalls, 0, "global V2 tool guidance must not be registered");
  const contextHook = hooks.get("context");
  assert.ok(contextHook, "context hook must be registered");

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

    await handlers.get("form.created")?.({
      type: "form.created",
      data: { form },
      location: { directory: tempDir },
    });

    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(replies.length, 0, "child form must never auto-reply");
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
