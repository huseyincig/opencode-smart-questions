import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import assert from 'node:assert/strict';
import { OpencodeSmartQuestions, resolveLockPath } from '../dist/index.js';
import OpencodeSmartQuestionsTui from '../dist/tui.js';

console.log('================================================================================');
console.log('   OPENCODE-SMART-QUESTIONS V2 — COMPREHENSIVE END-TO-END SCENARIO TEST SUITE');
console.log('================================================================================');

const ROOT_SESSION_ID = 'sandbox-root-session';
let totalPassed = 0;

async function runScenario(id, name, testFn) {
  process.stdout.write(`\n[${id}] ${name.padEnd(55)} `);
  try {
    await testFn();
    console.log('➔ PASSED');
    totalPassed++;
  } catch (err) {
    console.log('➔ FAILED');
    console.error(err);
    process.exit(1);
  }
}

async function withV2Sandbox(options, fn) {
  const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-comp-v2-'));
  const events = new Map();
  const keys = new Map();
  const pendingForms = new Map();
  const replies = [];
  const synthetics = [];

  const dispose = await OpencodeSmartQuestionsTui.setup({
    location: { directory: sandboxDir },
    options: { enabled: true, timeoutMs: 30, configDir: sandboxDir, ...options },
    client: {
      session: {
        async synthetic(req) {
          synthetics.push(req);
          return { ok: true };
        },
      },
    },
    data: {
      on(type, handler) {
        events.set(type, handler);
        return () => events.delete(type);
      },
      session: {
        get: (id) => ({ id, agent: 'main', location: { directory: sandboxDir } }),
        form: {
          async sync() {},
          list: (sessionID) => [...pendingForms.values()].filter((f) => f.sessionID === sessionID),
          async reply(payload) {
            replies.push(payload);
            pendingForms.delete(payload.formID);
          },
          invalidate() {},
        },
      },
    },
    renderer: {
      keyInput: {
        on(type, handler) { keys.set(type, handler); },
        off(type) { keys.delete(type); },
      },
    },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: ROOT_SESSION_ID }) },
      slot: () => () => {},
    },
  });

  try {
    await fn({ sandboxDir, events, keys, pendingForms, replies, synthetics });
  } finally {
    dispose?.();
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  }
}

await runScenario('SCENARIO-1', 'Single recommended option auto-selection', async () => {
  await withV2Sandbox({ recommendedMarkers: ['(Recommended)'] }, async ({ events, pendingForms, replies }) => {
    const form = {
      id: 's1',
      sessionID: ROOT_SESSION_ID,
      fields: [{ key: 'env', type: 'string', options: [{ value: 'dev', label: 'Dev' }, { value: 'prod', label: 'Prod (Recommended)' }] }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].answer, { env: 'prod' });
  });
});

await runScenario('SCENARIO-2', 'Turkish marker (Önerilen) auto-selection', async () => {
  await withV2Sandbox({ recommendedMarkers: ['(Recommended)', '(Önerilen)'] }, async ({ events, pendingForms, replies }) => {
    const form = {
      id: 's2',
      sessionID: ROOT_SESSION_ID,
      fields: [{ key: 'ortam', type: 'string', options: [{ value: 'test', label: 'Test' }, { value: 'prod', label: 'Canlı (Önerilen)' }] }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].answer, { ortam: 'prod' });
  });
});

await runScenario('SCENARIO-3', 'Multiselect form auto-selection', async () => {
  await withV2Sandbox({ recommendedMarkers: ['[SQ:recommended]'] }, async ({ events, pendingForms, replies }) => {
    const form = {
      id: 's3',
      sessionID: ROOT_SESSION_ID,
      fields: [{
        key: 'features',
        type: 'multiselect',
        minItems: 1,
        maxItems: 2,
        options: [
          { value: 'lint', label: 'Lint [SQ:recommended]' },
          { value: 'test', label: 'Test [SQ:recommended]' },
          { value: 'bench', label: 'Bench' },
        ],
      }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(replies.length, 1);
    assert.deepEqual(replies[0].answer, { features: ['lint', 'test'] });
  });
});

await runScenario('SCENARIO-4', 'User keypress cancels auto-reply and sets lock', async () => {
  await withV2Sandbox({ timeoutMs: 50, recommendedMarkers: ['[SQ:recommended]'] }, async ({ sandboxDir, events, keys, pendingForms, replies }) => {
    const form = {
      id: 's4',
      sessionID: ROOT_SESSION_ID,
      fields: [{ key: 'go', type: 'string', options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }, { value: 'no', label: 'No' }] }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    keys.get('keypress')?.({ name: 'down' });
    assert.equal(fs.existsSync(resolveLockPath(sandboxDir, 's4')), true);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(replies.length, 0);
  });
});

await runScenario('SCENARIO-5', 'Manual form [SQ:manual] suppresses auto-reply', async () => {
  await withV2Sandbox({}, async ({ events, pendingForms, replies, synthetics }) => {
    const form = {
      id: 's5',
      sessionID: ROOT_SESSION_ID,
      fields: [{ key: 'drop', type: 'string', options: [{ value: 'yes', label: 'Yes [SQ:manual]' }, { value: 'no', label: 'No' }] }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(replies.length, 0);
    assert.equal(synthetics.length, 0);
  });
});

await runScenario('SCENARIO-6', 'Unclassified form dispatches synthetic remediation', async () => {
  await withV2Sandbox({}, async ({ events, pendingForms, replies, synthetics }) => {
    const form = {
      id: 's6',
      sessionID: ROOT_SESSION_ID,
      fields: [{ key: 'db', type: 'string', options: [{ value: 'pg', label: 'PostgreSQL' }, { value: 'mysql', label: 'MySQL' }] }],
    };
    pendingForms.set(form.id, form);
    await events.get('form.created')({ data: { form } });
    await new Promise((r) => setTimeout(r, 65));
    assert.equal(replies.length, 0);
    assert.equal(synthetics.length, 1);
    assert.match(synthetics[0].text, /\[Smart Questions protocol remediation\]/);
  });
});

await runScenario('SCENARIO-7', 'V2 server context hook injects guidance idempotently', async () => {
  const hooks = new Map();
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: os.tmpdir() },
    options: { enabled: true },
    session: {
      async get({ sessionID }) { return { id: sessionID }; },
      hook(name, cb) { hooks.set(name, cb); return Promise.resolve({ dispose: async () => {} }); },
    },
  });
  const event = { sessionID: ROOT_SESSION_ID, system: [], messages: [] };
  await hooks.get('context')(event);
  await hooks.get('context')(event);
  assert.equal(event.system.length, 1);
  assert.match(event.system[0].text, /\[SQ_GUIDANCE:v1\]/);
  await cleanup?.();
});

console.log(`\n================================================================================`);
console.log(`  ALL ${totalPassed} V2 SCENARIOS PASSED`);
console.log(`================================================================================`);
