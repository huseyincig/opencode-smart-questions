import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { setup as v2Setup } from '../dist/ui.js';
import { classifyQuestions } from '../dist/detector.js';
import { classifyV2Form, detectV2FormRecommendations } from '../dist/form-adapter.js';

const TEST_ROOT_SESSION_ID = 'ses-multi-step-root';

async function createV2TuiHarness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-multi-step-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const synthetics = [];
  const replies = [];
  const events = new Map();
  const pendingForms = new Map();

  const dispose = await v2Setup({
    location: { directory },
    options: { enabled: true, configDir: directory, ...options },
    client: {
      session: {
        synthetic: async (params) => {
          synthetics.push(params);
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
        get: (id) => ({ id, location: { directory } }),
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
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: TEST_ROOT_SESSION_ID }) },
      slot: () => () => {},
    },
  });
  t.after(() => dispose?.());

  return { events, synthetics, replies, pendingForms };
}

test('V2 form reserved field key preserves an own serialized answer', () => {
  const form = {
    id: 'form-reserved',
    sessionID: 'root',
    fields: [{
      key: '__proto__',
      type: 'multiselect',
      options: [{ value: 'safe', label: 'Safe [SQ:recommended]' }],
    }],
  };
  for (const result of [classifyV2Form(form), detectV2FormRecommendations(form)]) {
    const answer = result.answer;
    assert.equal(Object.hasOwn(answer, '__proto__'), true);
    assert.deepEqual(JSON.parse(JSON.stringify(answer)), Object.fromEntries([['__proto__', ['safe']]]));
  }
});

test('classifyQuestions: detects recommendations flexibly (prefix, lowercase, description, Turkish)', () => {
  const q1 = classifyQuestions([
    {
      question: 'Select DB',
      options: [{ label: '(Recommended) PostgreSQL' }, { label: 'MySQL' }],
    },
  ]);
  assert.equal(q1.status, 'auto');
  assert.deepEqual(q1.answers, [['(Recommended) PostgreSQL']]);

  const q2 = classifyQuestions([
    {
      question: 'Run tests?',
      options: [{ label: 'Yes (recommended)' }, { label: 'No' }],
    },
  ]);
  assert.equal(q2.status, 'auto');
  assert.deepEqual(q2.answers, [['Yes (recommended)']]);

  const q3 = classifyQuestions([
    {
      question: 'Select cache',
      options: [
        { label: 'Redis', description: '(Recommended) in-memory data store' },
        { label: 'Memcached', description: 'Simple cache' },
      ],
    },
  ]);
  assert.equal(q3.status, 'auto');
  assert.deepEqual(q3.answers, [['Redis']]);

  const q4 = classifyQuestions([
    {
      question: 'Onaylıyor musunuz?',
      options: [{ label: '(Önerilen) Evet' }, { label: 'Hayır' }],
    },
  ]);
  assert.equal(q4.status, 'auto');
  assert.deepEqual(q4.answers, [['(Önerilen) Evet']]);
});

test('classifyQuestions: 3-step question resolves all steps with allowFallback', () => {
  const threeStepQuestions = [
    {
      question: 'Step 1: Framework',
      options: [{ label: 'Next.js [SQ:recommended]' }, { label: 'Remix' }],
    },
    {
      question: 'Step 2: Database',
      options: [{ label: 'PostgreSQL (Recommended)' }, { label: 'SQLite' }],
    },
    {
      question: 'Step 3: Run migration now?',
      options: [{ label: 'Yes, run now' }, { label: 'No, later' }],
    },
  ];

  const res = classifyQuestions(threeStepQuestions, undefined, undefined, null, {
    allowFallback: true,
  });

  assert.equal(res.status, 'auto');
  assert.deepEqual(res.answers, [
    ['Next.js [SQ:recommended]'],
    ['PostgreSQL (Recommended)'],
    ['Yes, run now'],
  ]);
  assert.equal(res.recommendedOptions.length, 3);
});

test('V2 TUI: 3-step form with fallback-first policy auto-replies all steps without stalling', async (t) => {
  const { events, replies, synthetics, pendingForms } = await createV2TuiHarness(t, {
    timeoutMs: 30,
    unclassifiedQuestionPolicy: 'fallback-first',
  });

  const form = {
    id: 'form-multi-step-123',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [
      {
        key: 'step1',
        type: 'string',
        label: 'Adım 1: Mimari seçim',
        options: [
          { value: 'clean', label: 'Clean Architecture [SQ:recommended]' },
          { value: 'monolith', label: 'Monolith' },
        ],
      },
      {
        key: 'step2',
        type: 'string',
        label: 'Adım 2: Veritabanı',
        options: [
          { value: 'pg', label: 'PostgreSQL (Recommended)' },
          { value: 'mysql', label: 'MySQL' },
        ],
      },
      {
        key: 'step3',
        type: 'string',
        label: 'Adım 3: Docker ayağa kalksın mı?',
        options: [
          { value: 'yes', label: 'Evet, ayağa kaldır' },
          { value: 'no', label: 'Hayır, lokal çalış' },
        ],
      },
    ],
  };
  pendingForms.set(form.id, form);

  await events.get('form.created')({ data: { form } });
  assert.equal(synthetics.length, 0);

  await new Promise((resolve) => setTimeout(resolve, 65));

  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.formID, 'form-multi-step-123');
  assert.deepEqual(replies[0]?.answer, {
    step1: 'clean',
    step2: 'pg',
    step3: 'yes',
  });
});

test('V2 Form: 3-field form with allowFallback maps all fields to valid values', () => {
  const v2Form = {
    id: 'form-v2-steps',
    sessionID: 'ses-1',
    fields: [
      {
        key: 'step1_lang',
        type: 'string',
        options: [
          { label: 'TypeScript [SQ:recommended]', value: 'ts' },
          { label: 'JavaScript', value: 'js' },
        ],
      },
      {
        key: 'step2_test',
        type: 'string',
        options: [
          { label: 'Vitest (Recommended)', value: 'vitest' },
          { label: 'Jest', value: 'jest' },
        ],
      },
      {
        key: 'step3_deploy',
        type: 'string',
        options: [
          { label: 'Docker container', value: 'docker' },
          { label: 'Bare metal', value: 'bare' },
        ],
      },
    ],
  };

  const res = classifyV2Form(v2Form, undefined, undefined, null, {
    allowFallback: true,
  });

  assert.equal(res.status, 'auto');
  assert.deepEqual(res.answer, {
    step1_lang: 'ts',
    step2_test: 'vitest',
    step3_deploy: 'docker',
  });
});

test('V2 TUI: fallbackOnManual auto-replies rather than stalling indefinitely', async (t) => {
  const { events, replies, pendingForms } = await createV2TuiHarness(t, {
    timeoutMs: 30,
    fallbackOnManual: true,
    fallbackToFirstOption: true,
  });

  const form = {
    id: 'form-manual-no-stall',
    sessionID: TEST_ROOT_SESSION_ID,
    fields: [{
      key: 'action',
      type: 'string',
      label: 'Destructive action [SQ:manual]',
      options: [
        { value: 'confirm', label: 'Confirm and proceed' },
        { value: 'cancel', label: 'Cancel' },
      ],
    }],
  };
  pendingForms.set(form.id, form);

  await events.get('form.created')({ data: { form } });
  await new Promise((resolve) => setTimeout(resolve, 65));

  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0]?.answer, { action: 'confirm' });
});
