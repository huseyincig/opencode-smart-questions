import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setup as v2Setup } from '../dist/ui.js';
import {
  classifyQuestions,
  resetHandoffTracking,
} from '../dist/index.js';
import { classifyV2Form } from '../dist/form-adapter.js';

test.beforeEach(() => {
  resetHandoffTracking();
});

const TEST_ROOT_SESSION_ID = 'ses-test-root';
const TEST_CHILD_SESSION_ID = 'ses-test-child';

async function createV2Harness(t, options = {}, isChild = false, syntheticImpl) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-unclass-v2-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const promptCalls = [];
  const replies = [];
  const events = new Map();
  const keys = new Map();
  const pendingForms = new Map();

  const dispose = await v2Setup({
    location: { directory },
    options: { enabled: true, configDir: directory, ...options },
    client: {
      session: {
        synthetic: async (params) => {
          promptCalls.push(params);
          if (syntheticImpl) return syntheticImpl(params);
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
        get: (id) => ({
          id,
          parentID: isChild ? TEST_ROOT_SESSION_ID : undefined,
          location: { directory },
        }),
        form: {
          sync: async () => {},
          list: (sessionID) => [...pendingForms.values()].filter((f) => f.sessionID === sessionID),
          reply: async (params) => {
            replies.push(params);
            pendingForms.delete(params.formID);
            return { ok: true };
          },
          invalidate: () => {},
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
      router: { current: () => ({ type: 'session', sessionID: isChild ? TEST_CHILD_SESSION_ID : TEST_ROOT_SESSION_ID }) },
      slot: () => () => {},
    },
  });
  t.after(() => dispose?.());

  const emitForm = async (form) => {
    pendingForms.set(form.id, form);
    await events.get('form.created')?.({ data: { form } });
  };

  return { directory, events, keys, promptCalls, replies, pendingForms, emitForm };
}

test('TEST 1 - Unclassified root form receives protocol remediation and does not wait silently', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 });

  await emitForm({
    id: 'form-unclassified-1',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'db',
      type: 'string',
      label: 'Which database?',
      options: [
        { value: 'pg', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
        { value: 'sqlite', label: 'SQLite' },
      ],
    }],
  });

  assert.equal(promptCalls.length, 1, 'Exactly one protocol remediation prompt should be sent');
  assert.match(promptCalls[0]?.text ?? '', /\[Smart Questions protocol remediation\]/);
  assert.match(promptCalls[0]?.text ?? '', /\[SQ:recommended\]/);
  assert.match(promptCalls[0]?.text ?? '', /\[SQ:manual\]/);

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'No auto-reply must be made for an unclassified form');
});

test('TEST 2 - Remediated AUTO replacement form countdown fires and auto-replies', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 });

  await emitForm({
    id: 'form-auto-replacement',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'db',
      type: 'string',
      label: 'Which database?',
      options: [
        { value: 'pg', label: 'PostgreSQL [SQ:recommended]' },
        { value: 'mysql', label: 'MySQL' },
      ],
    }],
  });

  assert.equal(promptCalls.length, 0, 'No remediation prompt should be sent for an AUTO form');

  await new Promise((resolve) => setTimeout(resolve, 65));
  assert.equal(replies.length, 1, 'AUTO form must be auto-replied after timeout');
  assert.deepEqual(replies[0]?.answer, { db: 'pg' });
});

test('TEST 3 - Explicit MANUAL form intentionally waits for human without remediation or timer', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 });

  await emitForm({
    id: 'form-manual-1',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'confirm',
      type: 'string',
      label: 'Confirm deleting production database?',
      options: [
        { value: 'yes', label: 'Yes [SQ:manual]' },
        { value: 'no', label: 'No' },
      ],
    }],
  });

  assert.equal(promptCalls.length, 0, 'MANUAL form must receive 0 remediation prompts');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'MANUAL form must receive 0 auto-replies');
});

test('TEST 4 - Guardian handoff auto_select=allowed but missing recommendation sends remediation', async (t) => {
  const { events, emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 });

  events.get('session.synthetic')?.({
    data: {
      sessionID: TEST_ROOT_SESSION_ID,
      metadata: { 'opencode-guardian': true },
      text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=choice\nauto_select=allowed\nhandoff_id=h-allowed-1\n\nPlease select an option.',
    },
  });

  await emitForm({
    id: 'form-guardian-missing-marker',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'target',
      type: 'string',
      label: 'Choose deployment target',
      options: [
        { value: 'staging', label: 'Staging' },
        { value: 'prod', label: 'Production' },
      ],
    }],
  });

  assert.equal(promptCalls.length, 1, 'Should send remediation for missing marker under Guardian allowed handoff');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Must not auto-reply without marker');
});

test('TEST 5 - Guardian handoff auto_select=forbidden is explicit MANUAL: 0 remediation, 0 auto-reply', async (t) => {
  const { events, emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 });

  events.get('session.synthetic')?.({
    data: {
      sessionID: TEST_ROOT_SESSION_ID,
      metadata: { 'opencode-guardian': true },
      text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=approval\nauto_select=forbidden\nhandoff_id=h-forbidden-1\n\nApproval required.',
    },
  });

  await emitForm({
    id: 'form-guardian-forbidden',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'approve',
      type: 'string',
      label: 'Approve deleting files?',
      options: [
        { value: 'yes', label: 'Yes [SQ:recommended]' },
        { value: 'no', label: 'No' },
      ],
    }],
  });

  assert.equal(promptCalls.length, 0, 'Must send 0 remediation prompts when Guardian handoff forbids auto-select');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Must NOT auto-reply when Guardian handoff forbids auto-select');
});

test('TEST 6 - Subagent unclassified form receives 0 remediation and 0 auto-reply', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 30 }, true);

  await emitForm({
    id: 'form-child-1',
    sessionID: TEST_CHILD_SESSION_ID,
    fields: [{
      key: 'opt',
      type: 'string',
      label: 'Subagent question?',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    }],
  });

  assert.equal(promptCalls.length, 0, 'Subagent must receive 0 remediation');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Subagent must receive 0 auto-replies');
});

test('TEST 7 - User typing lock cancels auto-reply for AUTO form', async (t) => {
  const { emitForm, keys, replies } = await createV2Harness(t, { timeoutMs: 40 });

  await emitForm({
    id: 'form-typing-lock',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'choice',
      type: 'string',
      label: 'Proceed?',
      options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }, { value: 'no', label: 'No' }],
    }],
  });

  keys.get('keypress')?.({ name: 'a' });
  await new Promise((resolve) => setTimeout(resolve, 75));
  assert.equal(replies.length, 0, 'User keypress must cancel auto-reply');
});

test('TEST 8 - Duplicate event on same unclassified form ID does not duplicate remediation', async (t) => {
  const { emitForm, promptCalls } = await createV2Harness(t, { timeoutMs: 30 });
  const form = {
    id: 'form-dup-1',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'choice',
      type: 'string',
      label: 'Which one?',
      options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
    }],
  };
  await emitForm(form);
  await emitForm(form);
  assert.equal(promptCalls.length, 1);
});

test('V2 synthetic rejection does not use the remediation budget', async (t) => {
  let attempt = 0;
  const { emitForm, promptCalls } = await createV2Harness(
    t,
    { timeoutMs: 30, maxUnclassifiedRemediations: 1 },
    false,
    () => (++attempt === 1 ? { ok: false } : { ok: true })
  );

  const fields = [{
    key: 'choice',
    type: 'string',
    label: 'Pick?',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
  }];
  await emitForm({ id: 'form-rej-1', sessionID: TEST_ROOT_SESSION_ID, fields });
  await emitForm({ id: 'form-rej-2', sessionID: TEST_ROOT_SESSION_ID, fields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9 - Repeated unclassified forms obey bounded limit without infinite loop', async (t) => {
  const { emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  const fields = [{
    key: 'choice',
    type: 'string',
    label: 'Pick?',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
  }];
  await emitForm({ id: 'form-loop-1', sessionID: TEST_ROOT_SESSION_ID, fields });
  await emitForm({ id: 'form-loop-2', sessionID: TEST_ROOT_SESSION_ID, fields });
  await emitForm({ id: 'form-loop-3', sessionID: TEST_ROOT_SESSION_ID, fields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9B - Different unclassified form gets a fresh chain instead of session-lifetime suppression', async (t) => {
  const { emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 1,
  });

  await emitForm({
    id: 'form-q1-a',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }],
  });
  await emitForm({
    id: 'form-q1-b',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }],
  });
  await emitForm({
    id: 'form-q2-a',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'b', type: 'string', label: 'Q2?', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] }],
  });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9C - Successful AUTO form resets unclassified remediation chain', async (t) => {
  const { emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 1,
  });
  const unclassFields = [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }];

  await emitForm({ id: 'f-1', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  await emitForm({
    id: 'f-auto',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'ok', type: 'string', label: 'Ok?', options: [{ value: 'y', label: 'Yes [SQ:recommended]' }, { value: 'n', label: 'No' }] }],
  });
  await emitForm({ id: 'f-2', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9D - Explicit MANUAL form resets unclassified remediation chain', async (t) => {
  const { emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 1,
  });
  const unclassFields = [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }];

  await emitForm({ id: 'f-1', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  await emitForm({
    id: 'f-manual',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'ok', type: 'string', label: 'Confirm?', options: [{ value: 'y', label: 'Yes [SQ:manual]' }, { value: 'n', label: 'No' }] }],
  });
  await emitForm({ id: 'f-2', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9E - Settled form via form.replied resets unclassified remediation chain', async (t) => {
  const { events, emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 1,
  });
  const unclassFields = [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }];

  await emitForm({ id: 'f-1', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  events.get('form.replied')?.({ data: { id: 'f-1', sessionID: TEST_ROOT_SESSION_ID } });
  await emitForm({ id: 'f-2', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 9F - New user inbox message resets unclassified remediation chain', async (t) => {
  const { events, emitForm, promptCalls } = await createV2Harness(t, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 1,
  });
  const unclassFields = [{ key: 'a', type: 'string', label: 'Q1?', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }];

  await emitForm({ id: 'f-1', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  events.get('session.inbox.enqueued')?.({
    data: {
      sessionID: TEST_ROOT_SESSION_ID,
      inboxID: 'in-human-1',
      item: { type: 'user', text: 'Next human request' },
    },
  });
  await emitForm({ id: 'f-2', sessionID: TEST_ROOT_SESSION_ID, fields: unclassFields });
  assert.equal(promptCalls.length, 2);
});

test('TEST 10 - Multi-field form where all fields are AUTO auto-replies all answers', async (t) => {
  const { emitForm, replies } = await createV2Harness(t, { timeoutMs: 25 });
  await emitForm({
    id: 'f-multi-auto',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [
      { key: 'a', type: 'string', options: [{ value: '1', label: 'One [SQ:recommended]' }, { value: '2', label: 'Two' }] },
      { key: 'b', type: 'string', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y [SQ:recommended]' }] },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(replies[0]?.answer, { a: '1', b: 'y' });
});

test('TEST 11 - Multi-field form containing at least one MANUAL option makes whole form MANUAL', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 25 });
  await emitForm({
    id: 'f-multi-manual',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [
      { key: 'a', type: 'string', options: [{ value: '1', label: 'One [SQ:recommended]' }, { value: '2', label: 'Two' }] },
      { key: 'b', type: 'string', options: [{ value: 'x', label: 'X [SQ:manual]' }, { value: 'y', label: 'Y' }] },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(promptCalls.length, 0);
  assert.equal(replies.length, 0);
});

test('TEST 12 - Multi-field form containing an UNCLASSIFIED field triggers remediation', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, { timeoutMs: 25 });
  await emitForm({
    id: 'f-multi-unclass',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [
      { key: 'a', type: 'string', options: [{ value: '1', label: 'One [SQ:recommended]' }, { value: '2', label: 'Two' }] },
      { key: 'b', type: 'string', options: [{ value: 'x', label: 'X' }, { value: 'y', label: 'Y' }] },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(promptCalls.length, 1);
  assert.equal(replies.length, 0);
});

test('TEST 13 - Language independence: [SQ:recommended] and [SQ:manual] work across alphabets', () => {
  const tr = classifyQuestions([{ question: 'Hangisi?', options: [{ label: 'Evet [SQ:recommended]' }, { label: 'Hayır' }] }]);
  assert.equal(tr.status, 'auto');
  const jp = classifyQuestions([{ question: 'どちら？', options: [{ label: 'はい [SQ:manual]' }, { label: 'いいえ' }] }]);
  assert.equal(jp.status, 'manual');
});

test('TEST 14 - V2 form classifier produces identical states as question classifier', () => {
  const qAuto = classifyQuestions([{ question: 'Q?', options: [{ label: 'A [SQ:recommended]' }, { label: 'B' }] }]);
  const fAuto = classifyV2Form({
    id: 'f1',
    sessionID: 's1',
    fields: [{ key: 'k', type: 'string', options: [{ value: 'a', label: 'A [SQ:recommended]' }, { value: 'b', label: 'B' }] }],
  });
  assert.equal(qAuto.status, 'auto');
  assert.equal(fAuto.status, 'auto');
});

test('TEST 15 - unclassifiedQuestionPolicy ignore suppresses remediation', async (t) => {
  const { emitForm, promptCalls, replies } = await createV2Harness(t, {
    timeoutMs: 25,
    unclassifiedQuestionPolicy: 'ignore',
  });
  await emitForm({
    id: 'f-ignore',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{ key: 'a', type: 'string', options: [{ value: '1', label: 'One' }, { value: '2', label: 'Two' }] }],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(promptCalls.length, 0);
  assert.equal(replies.length, 0);
});
