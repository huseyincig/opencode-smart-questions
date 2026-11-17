import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { classifyV2Form } from '../dist/form-adapter.js';
import OpencodeSmartQuestions, {
  clearActiveHandoff,
  getActiveHandoff,
  resolveSmartQuestionConfig,
} from '../dist/index.js';
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

test('SQ-02: resolveConfig resolves per-session directory settings even when startup directory is disabled', async () => {
  const startupDir = '/tmp/sq-startup-disabled';
  const projectBDir = '/tmp/sq-project-b';
  const pluginOptions = {
    resolveConfig(directory) {
      if (directory === startupDir) return { enabled: false };
      if (directory === projectBDir) {
        return { enabled: true, recommendedMarkers: ['[B:rec]'], timeoutMs: 25 };
      }
      return undefined;
    },
  };

  assert.equal(resolveSmartQuestionConfig(startupDir, pluginOptions), null);
  const resolvedB = resolveSmartQuestionConfig(projectBDir, pluginOptions);
  assert.ok(resolvedB?.enabled);
  assert.deepEqual(resolvedB.recommendedMarkers, ['[B:rec]']);
  assert.equal(resolvedB.configDir, path.resolve(projectBDir, '.opencode'));

  let contextHook = null;
  const dispose = await OpencodeSmartQuestions.setup({
    location: { directory: startupDir },
    options: pluginOptions,
    session: {
      async get({ sessionID }) {
        return {
          id: sessionID,
          location: { directory: sessionID === 'ses-disabled' ? startupDir : projectBDir },
        };
      },
      async hook(name, fn) {
        if (name === 'context') contextHook = fn;
        return { async dispose() {} };
      },
    },
  });

  try {
    assert.equal(typeof contextHook, 'function', 'setup must not short-circuit when resolveConfig is provided');
    const sysDisabled = [];
    await contextHook({ sessionID: 'ses-disabled', system: sysDisabled, messages: [] });
    assert.equal(sysDisabled.length, 0);

    const sysB = [];
    await contextHook({ sessionID: 'ses-b', system: sysB, messages: [] });
    assert.equal(sysB.length, 1);
    assert.match(sysB[0].text, /\[B:rec\]/);
  } finally {
    await dispose?.();
  }
});

test('SQ-02: V2 TUI resolves per-session directory config via resolveConfig even when startup dir is disabled', async (t) => {
  const startupDir = tempDirectory(t);
  const projectBDir = tempDirectory(t);
  const events = new Map();
  const replies = [];

  const dispose = await setup({
    location: { directory: startupDir },
    options: {
      resolveConfig(directory) {
        if (directory === startupDir) return { enabled: false };
        if (directory === projectBDir) return { enabled: true, timeoutMs: 15 };
        return undefined;
      },
    },
    data: {
      on(type, handler) { events.set(type, handler); return () => events.delete(type); },
      session: {
        get(id) { return { id, location: { directory: projectBDir } }; },
        form: {
          async sync() {},
          list() {
            return [{
              id: 'form-dyn-1',
              sessionID: 'ses-dyn',
              fields: [{
                key: 'choice',
                type: 'string',
                options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }, { value: 'no', label: 'No' }],
              }],
            }];
          },
          async reply(input) { replies.push(input); },
          invalidate() {},
        },
      },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current() { return { type: 'session', sessionID: 'ses-dyn' }; } },
      slot() { return () => {}; },
    },
  });
  t.after(dispose);

  assert.equal(typeof events.get('form.created'), 'function');
  await events.get('form.created')({
    location: { directory: projectBDir },
    data: {
      form: {
        id: 'form-dyn-1',
        sessionID: 'ses-dyn',
        fields: [{
          key: 'choice',
          type: 'string',
          options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }, { value: 'no', label: 'No' }],
        }],
      },
    },
  });
  await delay(50);
  assert.deepEqual(replies, [{ sessionID: 'ses-dyn', formID: 'form-dyn-1', answer: { choice: 'yes' } }]);
});

test('SQ-03: V2 backend event.subscribe reconnects after stream error and stops on dispose', async (t) => {
  const sessionID = 'ses-reconnect-1';
  t.after(() => clearActiveHandoff(sessionID));

  let subscribeCalls = 0;
  let lastSignal = null;

  const dispose = await OpencodeSmartQuestions.setup({
    location: { directory: tempDirectory(t) },
    options: {},
    session: {
      async get({ sessionID: id }) {
        return { id, location: { directory: '/tmp' } };
      },
      async hook() {
        return { async dispose() {} };
      },
    },
    event: {
      subscribe({ signal }) {
        subscribeCalls += 1;
        lastSignal = signal;
        const callIndex = subscribeCalls;
        return {
          async *[Symbol.asyncIterator]() {
            if (callIndex === 1) {
              throw new Error('EventBusOverflowError');
            }
            yield {
              type: 'session.synthetic',
              data: {
                sessionID,
                text: [
                  '[opencode-guardian remediation]',
                  '[OPENCODE_HANDOFF:v1]',
                  'source=guardian',
                  'action=question_required',
                  'kind=approval',
                  'auto_select=forbidden',
                  'handoff_id=gq_reconnect_1',
                ].join('\n'),
                metadata: {
                  'opencode-guardian': true,
                  'opencode-guardian-provenance': 'tok-reconnect',
                  'opencode-guardian-kind': 'remediation',
                },
              },
            };
            await new Promise((resolve) => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', resolve, { once: true });
            });
          },
        };
      },
    },
  });

  // First attempt fails immediately; exponential backoff starts at 250ms.
  await delay(350);
  assert.ok(subscribeCalls >= 2, `expected reconnect attempt, got subscribeCalls=${subscribeCalls}`);
  const active = getActiveHandoff(sessionID);
  assert.equal(active?.handoffId, 'gq_reconnect_1');
  assert.equal(active?.autoSelect, 'forbidden');

  await dispose?.();
  assert.equal(lastSignal?.aborted, true);
});

test('SQ-04: V2 TUI bounds remediatedForms and sessionChains to 512 entries via LRU eviction', async (t) => {
  const directory = tempDirectory(t);
  const events = new Map();
  const sentPrompts = [];

  const dispose = await setup({
    location: { directory },
    options: { timeoutMs: 20, configDir: directory, maxUnclassifiedRemediations: 1 },
    client: {
      session: {
        async synthetic(payload) {
          sentPrompts.push(payload.sessionID);
          return { id: `syn-${sentPrompts.length}` };
        },
      },
    },
    data: {
      on(type, handler) { events.set(type, handler); return () => events.delete(type); },
      session: {
        get(id) { return { id, location: { directory } }; },
        message: { list() { return []; } },
        form: {
          async sync() {},
          list() { return []; },
          async reply() {},
          invalidate() {},
        },
      },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current() { return { type: 'home' }; } },
      slot() { return () => {}; },
    },
  });
  t.after(dispose);

  const onCreated = events.get('form.created');
  const makeForm = (i) => ({
    id: `frm-lru-${i}`,
    sessionID: `ses-lru-${i}`,
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    }],
  });

  // Emit 520 distinct unclassified forms across 520 distinct sessions (> 512 LRU cap).
  for (let i = 1; i <= 520; i++) {
    await onCreated({ data: { form: makeForm(i) } });
  }
  assert.equal(sentPrompts.length, 520);

  // Entry #520 is still within the 512-entry LRU cap -> duplicate form & exhausted chain suppress new prompt.
  await onCreated({ data: { form: makeForm(520) } });
  assert.equal(sentPrompts.length, 520);

  // Entry #1 was evicted when exceeding 512 -> re-sending form #1 triggers fresh remediation instead of stale state.
  await onCreated({ data: { form: makeForm(1) } });
  assert.equal(sentPrompts.length, 521);
});
