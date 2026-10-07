import assert from 'node:assert/strict';
import test from 'node:test';

import { SmartQuestion as SmartQuestionPlugin } from '../dist/index.js';
import { classifyQuestions } from '../dist/detector.js';
import { classifyV2Form } from '../dist/form-adapter.js';

const TEST_ROOT_SESSION_ID = 'ses-multi-step-root';

function withSessionClient(client = {}) {
  const existingSession =
    client && typeof client.session === 'object' && client.session
      ? client.session
      : {};
  return {
    ...client,
    session: {
      ...existingSession,
      async get({ path: p }) {
        if (typeof existingSession.get === 'function') {
          return existingSession.get({ path: p });
        }
        return {
          data: {
            id: p?.id ?? TEST_ROOT_SESSION_ID,
          },
        };
      },
    },
  };
}

async function createPluginHarness(options = {}) {
  const promptCalls = [];
  const replies = [];
  const mockClient = {
    question: {
      reply: async (params) => {
        replies.push(params);
        return { ok: true };
      },
    },
    session: {
      promptAsync: async (params) => {
        promptCalls.push(params);
        return { ok: true };
      },
    },
  };

  const client = withSessionClient(mockClient);
  const hooks = await SmartQuestionPlugin({ client }, options);
  return { hooks, promptCalls, replies, client };
}

// ---------------------------------------------------------------------------
// 1. Flexible Recommendation Detection
// ---------------------------------------------------------------------------
test('classifyQuestions: detects recommendations flexibly (prefix, lowercase, description, Turkish)', () => {
  // Prefix
  const q1 = classifyQuestions([
    {
      question: 'Select DB',
      options: [{ label: '(Recommended) PostgreSQL' }, { label: 'MySQL' }],
    },
  ]);
  assert.equal(q1.status, 'auto');
  assert.deepEqual(q1.answers, [['(Recommended) PostgreSQL']]);

  // Lowercase suffix
  const q2 = classifyQuestions([
    {
      question: 'Run tests?',
      options: [{ label: 'Yes (recommended)' }, { label: 'No' }],
    },
  ]);
  assert.equal(q2.status, 'auto');
  assert.deepEqual(q2.answers, [['Yes (recommended)']]);

  // In description
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

  // Turkish prefix
  const q4 = classifyQuestions([
    {
      question: 'Onaylıyor musunuz?',
      options: [{ label: '(Önerilen) Evet' }, { label: 'Hayır' }],
    },
  ]);
  assert.equal(q4.status, 'auto');
  assert.deepEqual(q4.answers, [['(Önerilen) Evet']]);
});

// ---------------------------------------------------------------------------
// 2. Multi-Step (1., 2., 3. Adımlı) Questions with Mixed Recommendations
// ---------------------------------------------------------------------------
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
      options: [{ label: 'Yes, run now' }, { label: 'No, later' }], // No explicit marker
    },
  ];

  // With allowFallback: true -> resolves Step 1 (recommended), Step 2 (recommended), Step 3 (first option)
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

// ---------------------------------------------------------------------------
// 3. Multi-Step (1., 2., 3. Adımlı) Questions in Backend with fallback-first
// ---------------------------------------------------------------------------
test('backend: 3-step question with fallback-first policy auto-replies all steps without stalling', async () => {
  const { hooks, replies, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    unclassifiedQuestionPolicy: 'fallback-first',
  });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-multi-step-123',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Adım 1: Mimari seçim',
            options: [{ label: 'Clean Architecture [SQ:recommended]' }, { label: 'Monolith' }],
          },
          {
            question: 'Adım 2: Veritabanı',
            options: [{ label: 'PostgreSQL (Recommended)' }, { label: 'MySQL' }],
          },
          {
            question: 'Adım 3: Docker ayağa kalksın mı?',
            options: [{ label: 'Evet, ayağa kaldır' }, { label: 'Hayır, lokal çalış' }],
          },
        ],
      },
    },
  });

  // Zero remediation prompts dispatched: immediately scheduled for auto-reply
  assert.equal(promptCalls.length, 0);

  // Wait for 30ms timer
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Exactly 1 reply received, answering all 3 steps!
  assert.equal(replies.length, 1);
  assert.equal(replies[0]?.requestID, 'req-multi-step-123');
  assert.deepEqual(replies[0]?.answers, [
    ['Clean Architecture [SQ:recommended]'],
    ['PostgreSQL (Recommended)'],
    ['Evet, ayağa kaldır'],
  ]);
});

// ---------------------------------------------------------------------------
// 4. V2 Form 3-Field Sequential Form with fallback-first
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// 5. fallbackOnManual: Even manual questions auto-reply after countdown
// ---------------------------------------------------------------------------
test('backend: fallbackOnManual auto-replies rather than stalling indefinitely', async () => {
  const { hooks, replies } = await createPluginHarness({
    timeoutMs: 30,
    fallbackOnManual: true,
    fallbackToFirstOption: true,
  });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-manual-no-stall',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Destructive action [SQ:manual]',
            options: [{ label: 'Confirm and proceed' }, { label: 'Cancel' }],
          },
        ],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0]?.answers, [['Confirm and proceed']]);
});
