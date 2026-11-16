import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { OpencodeSmartQuestions } from '../dist/index.js';
import OpencodeSmartQuestionsTui from '../dist/tui.js';

console.log('==================================================');
console.log('  OPENCODE-SMART-QUESTIONS V2 ISOLATED SANDBOX TEST');
console.log('==================================================');

const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-sandbox-smoke-'));
const ROOT_SESSION_ID = 'sandbox-root-session';

try {
  console.log('\n[1] Initializing V2 Server & TUI plugins...');
  const hooks = new Map();
  const cleanupServer = await OpencodeSmartQuestions.setup({
    location: { directory: sandboxDir },
    options: { enabled: true, timeoutMs: 50, recommendedMarkers: ['(Recommended)', '(Önerilen)'] },
    session: {
      async get({ sessionID }) {
        return { id: sessionID, location: { directory: sandboxDir } };
      },
      hook(name, cb) {
        hooks.set(name, cb);
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  });

  const events = new Map();
  const pendingForms = new Map();
  let lastReply = null;

  const cleanupTui = await OpencodeSmartQuestionsTui.setup({
    location: { directory: sandboxDir },
    options: {
      enabled: true,
      timeoutMs: 50,
      recommendedMarkers: ['(Recommended)', '(Önerilen)'],
      configDir: sandboxDir,
    },
    data: {
      on(type, handler) {
        events.set(type, handler);
        return () => events.delete(type);
      },
      session: {
        get: (id) => ({ id, agent: 'builder', location: { directory: sandboxDir } }),
        form: {
          async sync() {},
          list: (sessionID) => [...pendingForms.values()].filter((f) => f.sessionID === sessionID),
          async reply(payload) {
            lastReply = payload;
            pendingForms.delete(payload.formID);
          },
          invalidate() {},
        },
      },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: ROOT_SESSION_ID }) },
      slot: () => () => {},
    },
  });

  assert.ok(hooks.has('context'), 'Server plugin must register context hook');
  assert.ok(events.has('form.created'), 'TUI plugin must subscribe to form.created');
  console.log('    ✓ V2 Server and TUI plugins initialized successfully');

  console.log('\n[2] Testing Auto-Selection on Recommended Option...');
  const form = {
    id: 'sandbox-form-001',
    sessionID: ROOT_SESSION_ID,
    fields: [
      {
        key: 'approach',
        type: 'string',
        label: 'Which deployment approach?',
        options: [
          { value: 'canary', label: 'Canary', description: 'Slow' },
          { value: 'blue-green', label: 'Blue-Green (Recommended)', description: 'Fast zero-downtime' },
        ],
      },
    ],
  };
  pendingForms.set(form.id, form);
  await events.get('form.created')({ data: { form } });

  await new Promise((r) => setTimeout(r, 90));
  assert.ok(lastReply, 'Expected reply to be sent');
  assert.deepEqual(lastReply.answer, { approach: 'blue-green' });
  console.log('    ✓ Auto-reply triggered with answer:', JSON.stringify(lastReply.answer));

  cleanupTui?.();
  await cleanupServer?.();

  console.log('\n==================================================');
  console.log('  SMOKE TEST PASSED — SYSTEM FULLY OPERATIONAL');
  console.log('==================================================');
} finally {
  fs.rmSync(sandboxDir, { recursive: true, force: true });
}
