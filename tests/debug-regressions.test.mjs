import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyV2Form } from '../dist/form-adapter.js';
import { setup } from '../dist/ui.js';

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-regression-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const formFields = [
  {
    key: 'db',
    type: 'string',
    label: 'Database?',
    options: [
      { value: 'first', label: 'First' },
      { value: 'preferred', label: 'Preferred [SQ:recommended]' },
    ],
  },
  {
    key: 'features',
    type: 'multiselect',
    label: 'Features?',
    options: [
      { value: 'default', label: 'Default' },
      { value: 'logs', label: 'Logs [SQ:recommended]' },
      { value: 'metrics', label: 'Metrics [SQ:recommended]' },
    ],
  },
  {
    key: 'region',
    type: 'string',
    label: 'Region?',
    options: [
      { value: 'local', label: 'Local' },
      { value: 'remote', label: 'Remote' },
    ],
  },
];

function makeForm(id = 'form-1', fields = formFields) {
  return { id, sessionID: 'root', fields };
}

async function setupV2Tui(t, options = {}, overrides = {}) {
  const directory = tempDirectory(t);
  const events = new Map();
  const replies = [];
  const synthetics = [];
  const inputs = new Map();
  const pendingForms = new Map();

  const context = {
    location: { directory },
    options: { enabled: true, timeoutMs: 10, configDir: directory, ...options },
    client: {
      session: {
        async synthetic(req) {
          synthetics.push(req);
          return overrides.synthetic ? overrides.synthetic(req) : { ok: true };
        },
      },
    },
    data: {
      on(type, handler) {
        events.set(type, handler);
        return () => events.delete(type);
      },
      session: {
        get: overrides.get ?? ((id) => ({ id, agent: 'builder', location: { directory } })),
        sync: overrides.sync,
        message: overrides.message ?? { list: () => [] },
        form: {
          async sync() {},
          list(sessionID) {
            return [...pendingForms.values()].filter((f) => f.sessionID === sessionID);
          },
          async reply(input) {
            replies.push(input);
            pendingForms.delete(input.formID);
          },
          invalidate() {},
          ...overrides.form,
        },
      },
    },
    renderer: {
      keyInput: {
        on(type, handler) { inputs.set(type, handler); },
        off(type) { inputs.delete(type); },
      },
    },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: 'root' }) },
      slot: () => () => {},
    },
  };

  const dispose = await setup(context);
  t.after(() => dispose?.());
  return { directory, events, replies, synthetics, inputs, pendingForms, dispose };
}

test('V2 exhausted remediation preserves recommendations in every classified step', async (t) => {
  const { events, replies, pendingForms } = await setupV2Tui(t, {
    unclassifiedQuestionPolicy: 'remediate-then-fallback',
    maxUnclassifiedRemediations: 0,
  });
  const form = makeForm();
  pendingForms.set(form.id, form);
  await events.get('form.created')({ data: { form } });
  await delay(40);
  assert.deepEqual(replies.map((r) => r.answer), [
    {
      db: 'preferred',
      features: ['logs', 'metrics'],
      region: 'local',
    },
  ]);
});

for (const multiple of [false, true]) {
  test(`V2 fallback refuses ambiguous labels (${multiple ? 'multi' : 'single'}select)`, () => {
    const result = classifyV2Form({
      id: 'form',
      sessionID: 'root',
      fields: [{
        key: 'choice',
        type: multiple ? 'multiselect' : 'string',
        options: [
          { value: 'first', label: 'Same' },
          { value: 'second', label: 'Same', description: '[SQ:recommended]' },
        ],
      }],
    }, undefined, undefined, undefined, { allowFallback: true });
    assert.equal(result.status, 'unclassified', 'a duplicated label must not silently map to the first value');
  });
}

for (const cancellation of ['dispose', 'session.deleted', 'session.inbox.enqueued', 'form.replied']) {
  test(`V2 ${cancellation} prevents scheduling after an in-flight session sync`, async (t) => {
    const lookup = Promise.withResolvers();
    let synced = false;
    const { events, replies, pendingForms, dispose } = await setupV2Tui(t, {}, {
      get(id) {
        return synced ? { id, location: { directory: '/tmp' } } : undefined;
      },
      async sync() {
        await lookup.promise;
        synced = true;
      },
    });
    const form = makeForm('request', [formFields[0]]);
    pendingForms.set(form.id, form);
    const handling = events.get('form.created')({ data: { form } });

    if (cancellation === 'dispose') {
      dispose();
    } else if (cancellation === 'session.deleted') {
      events.get('session.deleted')({ data: { sessionID: 'root' } });
    } else if (cancellation === 'form.replied') {
      events.get('form.replied')({ data: { formID: 'request', sessionID: 'root' } });
    } else {
      events.get('session.inbox.enqueued')({
        data: { sessionID: 'root', inboxID: 'in-1', item: { type: 'user', text: 'new prompt' } },
      });
    }

    lookup.resolve();
    await handling;
    await delay(40);
    assert.deepEqual(replies, [], 'cancelled work must not create a new reply timer');
  });
}

test('V2 rejected message.sync cannot schedule a reply after disposal', async (t) => {
  const lookup = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { events, replies, pendingForms, dispose } = await setupV2Tui(t, {}, {
    message: {
      list: () => [],
      sync() {
        started.resolve();
        return lookup.promise;
      },
    },
  });
  const form = makeForm('request', [formFields[0]]);
  pendingForms.set(form.id, form);
  const handling = events.get('form.created')({ data: { form } });
  await started.promise;
  dispose();
  lookup.reject(new Error('history unavailable'));
  await handling;
  await delay(40);
  assert.deepEqual(replies, []);
});

test('V2 duplicate form.created events do not consume retry state after rejected in-flight remediation', async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let attempts = 0;
  const { events, pendingForms } = await setupV2Tui(
    t,
    { unclassifiedQuestionPolicy: 'remediate', maxUnclassifiedRemediations: 1 },
    {
      async synthetic() {
        if (++attempts === 1) {
          started.resolve();
          return release.promise;
        }
        return { ok: true };
      },
    }
  );
  const form = makeForm('unclassified', [formFields[2]]);
  pendingForms.set(form.id, form);
  const first = events.get('form.created')({ data: { form } });
  await started.promise;
  await events.get('form.created')({ data: { form } });
  release.resolve({ ok: false });
  await first;
  await events.get('form.created')({ data: { form } });
  assert.equal(attempts, 2, 'rejected remediation must remain retryable after a duplicate event');
});

for (const phase of ['sync', 'reply', 'manual']) {
  test(`V2 duplicate form during ${phase} keeps one reply owner and respects user cancellation`, async (t) => {
    const directory = tempDirectory(t);
    const events = new Map();
    const syncing = Promise.withResolvers();
    const release = Promise.withResolvers();
    const replies = [];
    const inputs = new Map();
    const form = {
      id: 'form',
      sessionID: 'root',
      fields: [{
        key: 'choice',
        type: 'string',
        options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }],
      }],
    };
    let syncCount = 0;
    const dispose = await setup({
      location: { directory },
      options: { timeoutMs: 20, configDir: directory },
      data: {
        on(type, handler) { events.set(type, handler); return () => events.delete(type); },
        session: {
          get(id) { return { id, location: { directory } }; },
          form: {
            async sync() {
              if (phase === 'sync' && ++syncCount === 1) {
                syncing.resolve();
                await release.promise;
              }
            },
            list() { return [form]; },
            async reply(input) {
              replies.push(input);
              if (phase === 'reply' && replies.length === 1) {
                syncing.resolve();
                await release.promise;
              }
            },
            invalidate() {},
          },
        },
      },
      renderer: {
        keyInput: {
          on(type, handler) { inputs.set(type, handler); },
          off(type) { inputs.delete(type); },
        },
      },
      ui: {
        router: { current() { return { type: 'session', sessionID: 'root' }; } },
        slot() { return () => {}; },
      },
    });
    t.after(dispose);
    t.after(() => release.resolve());
    await events.get('form.created')({ data: { form } });
    if (phase === 'manual') inputs.get('keypress')({});
    else await syncing.promise;
    await events.get('form.created')({ data: { form } });
    release.resolve();
    await delay(60);
    const expectedReply = { sessionID: 'root', formID: 'form', answer: { choice: 'yes' } };
    assert.deepEqual(replies, phase === 'manual' ? [] : [expectedReply]);
  });
}
