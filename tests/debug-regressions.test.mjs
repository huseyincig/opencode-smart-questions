import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createSmartQuestionHooks } from '../dist/backend.js';
import { classifyV2Form } from '../dist/form-adapter.js';
import { tui, setup } from '../dist/ui.js';

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-regression-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const questions = [
  { question: 'Database?', options: [{ label: 'First' }, { label: 'Preferred [SQ:recommended]' }] },
  { question: 'Features?', multiple: true, options: [
    { label: 'Default' }, { label: 'Logs [SQ:recommended]' }, { label: 'Metrics [SQ:recommended]' },
  ] },
  { question: 'Region?', options: [{ label: 'Local' }, { label: 'Remote' }] },
];

function asked(id = 'request', items = questions) {
  return { type: 'question.asked', properties: { id, sessionID: 'root', questions: items } };
}

async function backend(t, options = {}, session = {}) {
  const directory = tempDirectory(t);
  const replies = [];
  const hooks = await createSmartQuestionHooks({
    directory,
    client: {
      session: { async get() { return { data: { id: 'root' } }; }, ...session },
      question: { async reply(input) { replies.push(input); } },
    },
  }, { timeoutMs: 10, configDir: directory, ...options });
  t.after(() => hooks.dispose());
  return { directory, replies, hooks };
}

test('V1 exhausted remediation preserves recommendations in every classified step', async (t) => {
  const { hooks, replies } = await backend(t, {
    unclassifiedQuestionPolicy: 'remediate-then-fallback', maxUnclassifiedRemediations: 0,
  });
  await hooks.event({ event: asked() });
  await delay(40);
  assert.deepEqual(replies.map((reply) => reply.answers), [[
    ['Preferred [SQ:recommended]'], ['Logs [SQ:recommended]', 'Metrics [SQ:recommended]'], ['Local'],
  ]]);
});

test('V1 TUI permits backend fallback once the remediation budget is exhausted', async (t) => {
  const options = { unclassifiedQuestionPolicy: 'remediate-then-fallback', maxUnclassifiedRemediations: 0 };
  const { directory, hooks, replies } = await backend(t, options);
  const events = new Map();
  await tui({
    state: { path: { directory }, session: { get(id) { return { id }; } } },
    event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
    renderer: { keyInput: { on() {}, off() {} }, requestRender() {} },
    slots: { register() {} },
    lifecycle: { onDispose(cleanup) { t.after(cleanup); } },
  }, { ...options, timeoutMs: 10, configDir: directory });
  const event = asked();
  await hooks.event({ event });
  events.get('question.asked')(event);
  await delay(40);
  assert.equal(replies.length, 1, 'the TUI must not install a manual lock for an automatic fallback');
});

for (const multiple of [false, true]) {
  test(`V2 fallback refuses ambiguous labels (${multiple ? 'multi' : 'single'}select)`, () => {
    const result = classifyV2Form({ id: 'form', sessionID: 'root', fields: [{
      key: 'choice', type: multiple ? 'multiselect' : 'string', options: [
        { value: 'first', label: 'Same' },
        { value: 'second', label: 'Same', description: '[SQ:recommended]' },
      ],
    }] }, undefined, undefined, undefined, { allowFallback: true });
    assert.equal(result.status, 'unclassified', 'a duplicated label must not silently map to the first value');
  });
}

for (const cancellation of ['dispose', 'session.deleted', 'message.updated', 'question.replied']) {
  test(`V1 ${cancellation} prevents scheduling after an in-flight session lookup`, async (t) => {
    const lookup = Promise.withResolvers();
    let lookups = 0;
    const { hooks, replies } = await backend(t, {}, { get() {
      return ++lookups === 1 ? lookup.promise : { data: { id: 'root' } };
    } });
    const handling = hooks.event({ event: asked('request', [questions[0]]) });
    if (cancellation === 'dispose') {
      await hooks.dispose();
    } else {
      await hooks.event({ event: {
        type: cancellation,
        properties: cancellation === 'session.deleted'
          ? { id: 'root' }
          : cancellation === 'question.replied'
            ? { requestID: 'request', sessionID: 'root' }
            : { id: 'human', sessionID: 'root', role: 'user' },
      } });
    }
    lookup.resolve({ data: { id: 'root' } });
    await handling;
    await delay(40);
    assert.deepEqual(replies, [], 'cancelled work must not create a new reply timer');
  });
}

test('V1 rejected message lookup cannot schedule a reply after disposal', async (t) => {
  const lookup = Promise.withResolvers();
  const started = Promise.withResolvers();
  const { hooks, replies } = await backend(t, {}, { messages() {
    started.resolve();
    return lookup.promise;
  } });
  const handling = hooks.event({ event: asked('request', [questions[0]]) });
  await started.promise;
  await hooks.dispose();
  lookup.reject(new Error('history unavailable'));
  await handling;
  await delay(40);
  assert.deepEqual(replies, []);
});

test('V1 duplicate events do not consume retry state after rejected in-flight remediation', async (t) => {
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let attempts = 0;
  const { hooks } = await backend(t, {
    unclassifiedQuestionPolicy: 'remediate', maxUnclassifiedRemediations: 1,
  }, { async synthetic() {
    if (++attempts === 1) {
      started.resolve();
      return release.promise;
    }
    return { ok: true };
  } });
  const event = asked('unclassified', [questions[2]]);
  const first = hooks.event({ event });
  await started.promise;
  await hooks.event({ event });
  release.resolve({ ok: false });
  await first;
  await hooks.event({ event });
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
  const form = { id: 'form', sessionID: 'root', fields: [{
    key: 'choice', type: 'string', options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }],
  }] };
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
    renderer: { keyInput: {
      on(type, handler) { inputs.set(type, handler); }, off(type) { inputs.delete(type); },
    } },
    ui: { router: { current() { return { type: 'session', sessionID: 'root' }; } }, slot() { return () => {}; } },
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
