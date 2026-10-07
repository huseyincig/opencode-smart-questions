import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SmartQuestion as SmartQuestionPlugin } from '../dist/index.js';
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

function withSessionClient(client = {}, isChild = false) {
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
            id: p?.id ?? (isChild ? TEST_CHILD_SESSION_ID : TEST_ROOT_SESSION_ID),
            parentID: isChild ? TEST_ROOT_SESSION_ID : undefined,
          },
        };
      },
    },
  };
}

async function createPluginHarness(options = {}, isChild = false) {
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

  const client = withSessionClient(mockClient, isChild);
  const hooks = await SmartQuestionPlugin({ client }, options);
  return { hooks, promptCalls, replies, client };
}

// ---------------------------------------------------------------------------
// TEST 1 — Unclassified root question: no silent wait, sends remediation = 1
// ---------------------------------------------------------------------------
test('TEST 1 - Unclassified root question receives protocol remediation and does not wait silently', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-unclassified-1',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Which database?',
            options: [
              { label: 'PostgreSQL' },
              { label: 'MySQL' },
              { label: 'SQLite' },
            ],
          },
        ],
      },
    },
  });

  // Verify remediation was sent
  assert.equal(promptCalls.length, 1, 'Exactly one protocol remediation prompt should be sent');
  const sentText = promptCalls[0]?.body?.parts?.[0]?.text ?? '';
  assert.match(sentText, /\[Smart Questions protocol remediation\]/);
  assert.match(sentText, /\[SQ:recommended\]/);
  assert.match(sentText, /\[SQ:manual\]/);

  // Wait past any timer to prove no auto-reply was scheduled
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'No auto-reply must be made for an unclassified question');
});

// ---------------------------------------------------------------------------
// TEST 2 — Remediated AUTO question: countdown starts, timeout, auto-replies
// ---------------------------------------------------------------------------
test('TEST 2 - Remediated AUTO replacement question countdown fires and auto-replies', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-auto-replacement',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Which database?',
            options: [
              { label: 'PostgreSQL [SQ:recommended]' },
              { label: 'MySQL' },
              { label: 'SQLite' },
            ],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'No remediation prompt should be sent for an AUTO question');

  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 1, 'AUTO question must be auto-replied after timeout');
  assert.deepEqual(replies[0]?.answers, [['PostgreSQL [SQ:recommended]']]);
});

// ---------------------------------------------------------------------------
// TEST 3 — Explicit MANUAL question: intentional human wait, no timer, no reply, no remediation
// ---------------------------------------------------------------------------
test('TEST 3 - Explicit MANUAL question intentionally waits for human without remediation or timer', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-manual-1',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Confirm deleting production database? [SQ:manual]',
            options: [
              { label: 'Yes' },
              { label: 'No' },
            ],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'MANUAL question must receive 0 remediation prompts');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'MANUAL question must receive 0 auto-replies');
});

// ---------------------------------------------------------------------------
// TEST 4 — Guardian allowed but missing marker: protocol violation -> remediation
// ---------------------------------------------------------------------------
test('TEST 4 - Guardian handoff auto_select=allowed but missing recommendation sends remediation', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  // Simulate Guardian handoff event with auto_select=allowed
  await hooks.event({
    event: {
      type: 'message.created',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        sessionID: TEST_ROOT_SESSION_ID,
        role: 'user',
        metadata: { 'opencode-guardian': true },
        text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=choice\nauto_select=allowed\nhandoff_id=h-allowed-1\n\nPlease select an option.',
      },
    },
  });

  // Question arrives without recommendation marker
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-guardian-missing-marker',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Choose deployment target',
            options: [
              { label: 'Staging' },
              { label: 'Production' },
            ],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 1, 'Should send remediation for missing marker under Guardian allowed handoff');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Must not auto-reply without marker');
});

// ---------------------------------------------------------------------------
// TEST 5 — Guardian forbidden: intentional manual wait, 0 remediation, 0 reply
// ---------------------------------------------------------------------------
test('TEST 5 - Guardian handoff auto_select=forbidden is explicit MANUAL: 0 remediation, 0 auto-reply', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  // Guardian handoff with auto_select=forbidden
  await hooks.event({
    event: {
      type: 'message.created',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        sessionID: TEST_ROOT_SESSION_ID,
        role: 'user',
        metadata: { 'opencode-guardian': true },
        text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=approval\nauto_select=forbidden\nhandoff_id=h-forbidden-1\n\nApproval required.',
      },
    },
  });

  // Question arrives (even if someone put [SQ:recommended] erroneously)
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-guardian-forbidden',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Approve deleting files?',
            options: [
              { label: 'Yes [SQ:recommended]' },
              { label: 'No' },
            ],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'Guardian forbidden must never send unclassified remediation');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Guardian forbidden must never auto-reply');
});

// ---------------------------------------------------------------------------
// TEST 6 — Subagent unclassified question: child isolation, 0 remediation, 0 auto-reply
// ---------------------------------------------------------------------------
test('TEST 6 - Subagent unclassified question receives 0 remediation and 0 auto-reply', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 }, true);

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_CHILD_SESSION_ID,
      data: {
        id: 'req-child-unclassified',
        sessionID: TEST_CHILD_SESSION_ID,
        questions: [
          {
            question: 'Child question?',
            options: [{ label: 'Option A' }, { label: 'Option B' }],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'Subagents must never receive synthetic remediation from SQ');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Subagents must never receive auto-reply from SQ');
});

// ---------------------------------------------------------------------------
// TEST 7 — User starts typing / lockfile: cancels auto-reply
// ---------------------------------------------------------------------------
test('TEST 7 - User typing lock cancels auto-reply for AUTO question', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-typing-'));
  try {
    const { hooks, promptCalls, replies } = await createPluginHarness({
      timeoutMs: 40,
      configDir: tempDir,
    });

    // Create draft lockfile as if user started typing
    const lockPath = path.join(tempDir, '.sq-draft-req-typing');
    fs.writeFileSync(lockPath, '');

    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: 'req-typing',
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Choice',
              options: [{ label: 'Option A [SQ:recommended]' }, { label: 'Option B' }],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(replies.length, 0, 'User typing lock must cancel auto-reply');
    assert.equal(promptCalls.length, 0, 'No remediation should be sent');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TEST 8 — Duplicate event: at most 1 remediation prompt sent
// ---------------------------------------------------------------------------
test('TEST 8 - Duplicate event on same unclassified request ID does not duplicate remediation', async () => {
  const { hooks, promptCalls } = await createPluginHarness({ timeoutMs: 30 });

  const eventPayload = {
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-dup-1',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Choice',
            options: [{ label: 'Option A' }, { label: 'Option B' }],
          },
        ],
      },
    },
  };

  await hooks.event(eventPayload);
  await hooks.event(eventPayload);

  assert.equal(promptCalls.length, 1, 'Duplicate event must be suppressed; remediation count <= 1');
});

test('Failed V1 unclassified remediation transport does not consume duplicate/budget state', async () => {
  let attempts = 0;
  const client = withSessionClient({
    session: {
      promptAsync: async () => {
        attempts++;
        if (attempts === 1) throw new Error('synthetic transport failure');
        return { ok: true };
      },
    },
  });
  const hooks = await SmartQuestionPlugin({ client }, {
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  const eventPayload = {
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-retry-after-send-failure',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [{
          question: 'Choose a backend',
          options: [{ label: 'A' }, { label: 'B' }],
        }],
      },
    },
  };

  await hooks.event(eventPayload);
  await hooks.event(eventPayload);

  assert.equal(
    attempts,
    2,
    'A failed remediation send must remain retryable instead of being marked completed'
  );
});

// ---------------------------------------------------------------------------
// TEST 9 — Unclassified remediation loop: bounded limit stops runaway loops
// ---------------------------------------------------------------------------
test('TEST 9 - Repeated unclassified questions obey bounded limit without infinite loop', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  for (let i = 1; i <= 5; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-loop-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Repeated unclassified question',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
      },
    });
  }

  assert.equal(
    promptCalls.length,
    2,
    'Remediation count must not exceed configured max budget (2) for identical unclassified chain'
  );
});

test('TEST 9B - Different unclassified question gets a fresh chain instead of session-lifetime suppression', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  // Question 1 fails twice and hits budget
  for (let i = 1; i <= 3; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-q1-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'First unclassified question',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
      },
    });
  }
  assert.equal(promptCalls.length, 2, 'Q1 should receive exactly 2 remediations');

  // Question 2 is a DIFFERENT substantive question: must start a new chain and receive remediation!
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-q2-1',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Second unclassified question with different options',
            options: [{ label: 'X' }, { label: 'Y' }],
          },
        ],
      },
    },
  });

  assert.equal(
    promptCalls.length,
    3,
    'A new substantive question fingerprint must receive remediation rather than being permanently suppressed'
  );
});

test('TEST 9C - Successful AUTO question resets unclassified remediation chain', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  // Question 1 hits budget
  for (let i = 1; i <= 2; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-q1-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Config question',
              options: [{ label: 'A' }, { label: 'B' }],
            },
          ],
        },
      },
    });
  }
  assert.equal(promptCalls.length, 2);

  // Agent produces a successful AUTO question
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-auto-success',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Config question',
            options: [{ label: 'A [SQ:recommended]' }, { label: 'B' }],
          },
        ],
      },
    },
  });

  // Later in session, another unclassified question appears: chain was reset by AUTO!
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-after-auto',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Config question',
            options: [{ label: 'A' }, { label: 'B' }],
          },
        ],
      },
    },
  });

  assert.equal(
    promptCalls.length,
    3,
    'Successful AUTO classification must reset the unclassified chain'
  );
});

test('TEST 9D - Explicit MANUAL question resets unclassified remediation chain', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  // Question 1 hits budget
  for (let i = 1; i <= 2; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-q1-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Dangerous operation',
              options: [{ label: 'Yes' }, { label: 'No' }],
            },
          ],
        },
      },
    });
  }
  assert.equal(promptCalls.length, 2);

  // Agent marks question MANUAL
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-manual',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Dangerous operation',
            options: [{ label: 'Yes [SQ:manual]' }, { label: 'No' }],
          },
        ],
      },
    },
  });

  // Later, another unclassified question appears: chain was reset by MANUAL!
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-after-manual',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Dangerous operation',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      },
    },
  });

  assert.equal(
    promptCalls.length,
    3,
    'Explicit MANUAL classification must reset the unclassified chain'
  );
});

test('TEST 9E - Settled question via question.replied resets unclassified remediation chain', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  // Question hits budget
  for (let i = 1; i <= 2; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-q1-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Select database',
              options: [{ label: 'PG' }, { label: 'SQLite' }],
            },
          ],
        },
      },
    });
  }
  assert.equal(promptCalls.length, 2);

  // User replies to question
  await hooks.event({
    event: {
      type: 'question.replied',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-q1-2',
        sessionID: TEST_ROOT_SESSION_ID,
      },
    },
  });

  // Later unclassified question arrives: chain was reset by question settlement!
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-after-reply',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Select database',
            options: [{ label: 'PG' }, { label: 'SQLite' }],
          },
        ],
      },
    },
  });

  assert.equal(
    promptCalls.length,
    3,
    'Settled question via question.replied must reset the unclassified chain'
  );
});

test('TEST 9F - New user message resets unclassified remediation chain', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    maxUnclassifiedRemediations: 2,
  });

  // Question hits budget
  for (let i = 1; i <= 2; i++) {
    await hooks.event({
      event: {
        type: 'question.asked',
        sessionID: TEST_ROOT_SESSION_ID,
        data: {
          id: `req-q1-${i}`,
          sessionID: TEST_ROOT_SESSION_ID,
          questions: [
            {
              question: 'Choice',
              options: [{ label: '1' }, { label: '2' }],
            },
          ],
        },
      },
    });
  }
  assert.equal(promptCalls.length, 2);

  // Human sends a new message in chat
  await hooks.event({
    event: {
      type: 'message.created',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        sessionID: TEST_ROOT_SESSION_ID,
        role: 'user',
        text: 'Continue with option 1',
      },
    },
  });

  // Later unclassified question arrives: chain was reset by new user turn!
  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-after-user-turn',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Choice',
            options: [{ label: '1' }, { label: '2' }],
          },
        ],
      },
    },
  });

  assert.equal(
    promptCalls.length,
    3,
    'New user message must reset the unclassified chain'
  );
});

// ---------------------------------------------------------------------------
// TEST 10 — Multi-question all AUTO: auto-replies all recommended options
// ---------------------------------------------------------------------------
test('TEST 10 - Multi-question where all questions are AUTO auto-replies all answers', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-multi-auto',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Q1',
            options: [{ label: 'A1 [SQ:recommended]' }, { label: 'B1' }],
          },
          {
            question: 'Q2',
            options: [{ label: 'A2' }, { label: 'B2 [SQ:recommended]' }],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 1);
  assert.deepEqual(replies[0]?.answers, [
    ['A1 [SQ:recommended]'],
    ['B2 [SQ:recommended]'],
  ]);
});

// ---------------------------------------------------------------------------
// TEST 11 — Multi-question includes MANUAL: whole request is MANUAL (0 auto-reply)
// ---------------------------------------------------------------------------
test('TEST 11 - Multi-question containing at least one MANUAL option makes whole request MANUAL', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-multi-manual',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Q1',
            options: [{ label: 'A1 [SQ:recommended]' }, { label: 'B1' }],
          },
          {
            question: 'Q2 Dangerous action [SQ:manual]',
            options: [{ label: 'Yes' }, { label: 'No' }],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'No remediation for request containing manual question');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Multi-question containing manual question must not auto-reply');
});

// ---------------------------------------------------------------------------
// TEST 12 — Multi-question includes UNCLASSIFIED: whole request is UNCLASSIFIED
// ---------------------------------------------------------------------------
test('TEST 12 - Multi-question containing an UNCLASSIFIED question triggers remediation', async () => {
  const { hooks, promptCalls, replies } = await createPluginHarness({ timeoutMs: 30 });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-multi-unclassified',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Q1',
            options: [{ label: 'A1 [SQ:recommended]' }, { label: 'B1' }],
          },
          {
            question: 'Q2',
            options: [{ label: 'A2' }, { label: 'B2' }], // Missing marker!
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 1, 'Should trigger remediation for multi-question containing unclassified');
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(replies.length, 0, 'Must not auto-reply partially');
});

// ---------------------------------------------------------------------------
// TEST 13 — Language independence: same canonical markers work across languages
// ---------------------------------------------------------------------------
test('TEST 13 - Language independence: [SQ:recommended] and [SQ:manual] work across alphabets', () => {
  const cases = [
    {
      lang: 'Turkish',
      autoOpt: 'PostgreSQL kullan [SQ:recommended]',
      manualQ: 'Veritabanı silinsin mi? [SQ:manual]',
    },
    {
      lang: 'English',
      autoOpt: 'Use PostgreSQL [SQ:recommended]',
      manualQ: 'Delete database? [SQ:manual]',
    },
    {
      lang: 'German',
      autoOpt: 'PostgreSQL verwenden [SQ:recommended]',
      manualQ: 'Datenbank löschen? [SQ:manual]',
    },
    {
      lang: 'Chinese',
      autoOpt: '使用 PostgreSQL [SQ:recommended]',
      manualQ: '删除数据库？ [SQ:manual]',
    },
    {
      lang: 'Russian',
      autoOpt: 'Использовать PostgreSQL [SQ:recommended]',
      manualQ: 'Удалить базу данных? [SQ:manual]',
    },
  ];

  for (const c of cases) {
    const autoClass = classifyQuestions([
      {
        question: 'DB?',
        options: [{ label: c.autoOpt }, { label: 'MySQL' }],
      },
    ]);
    assert.equal(autoClass.status, 'auto', `${c.lang} auto recommendation should classify as 'auto'`);

    const manualClass = classifyQuestions([
      {
        question: c.manualQ,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    ]);
    assert.equal(manualClass.status, 'manual', `${c.lang} manual question should classify as 'manual'`);
  }
});

// ---------------------------------------------------------------------------
// TEST 14 — V1 / V2 parity across AUTO, MANUAL, and UNCLASSIFIED
// ---------------------------------------------------------------------------
test('TEST 14 - V1 and V2 parity: form classifier produces identical states as question classifier', () => {
  // AUTO form
  const autoForm = {
    id: 'f-auto',
    sessionID: 'ses-1',
    fields: [
      {
        key: 'choice',
        type: 'string',
        options: [
          { value: 'pg', label: 'PostgreSQL [SQ:recommended]' },
          { value: 'my', label: 'MySQL' },
        ],
      },
    ],
  };
  const v2Auto = classifyV2Form(autoForm);
  assert.equal(v2Auto.status, 'auto');
  assert.deepEqual(v2Auto.answer, { choice: 'pg' });

  // MANUAL form
  const manualForm = {
    id: 'f-manual',
    sessionID: 'ses-1',
    title: 'Delete files? [SQ:manual]',
    fields: [
      {
        key: 'confirm',
        type: 'string',
        options: [
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
        ],
      },
    ],
  };
  const v2Manual = classifyV2Form(manualForm);
  assert.equal(v2Manual.status, 'manual');

  // UNCLASSIFIED form
  const unclassifiedForm = {
    id: 'f-unclass',
    sessionID: 'ses-1',
    fields: [
      {
        key: 'db',
        type: 'string',
        options: [
          { value: 'pg', label: 'PostgreSQL' },
          { value: 'my', label: 'MySQL' },
        ],
      },
    ],
  };
  const v2Unclass = classifyV2Form(unclassifiedForm);
  assert.equal(v2Unclass.status, 'unclassified');
});

// ---------------------------------------------------------------------------
// TEST 15 — unclassifiedQuestionPolicy: 'ignore' suppresses remediation
// ---------------------------------------------------------------------------
test('TEST 15 - unclassifiedQuestionPolicy ignore suppresses remediation', async () => {
  const { hooks, promptCalls } = await createPluginHarness({
    timeoutMs: 30,
    unclassifiedQuestionPolicy: 'ignore',
  });

  await hooks.event({
    event: {
      type: 'question.asked',
      sessionID: TEST_ROOT_SESSION_ID,
      data: {
        id: 'req-ignore-unclass',
        sessionID: TEST_ROOT_SESSION_ID,
        questions: [
          {
            question: 'Pick database',
            options: [{ label: 'PostgreSQL' }, { label: 'MySQL' }],
          },
        ],
      },
    },
  });

  assert.equal(promptCalls.length, 0, 'No remediation prompt should be sent when policy is ignore');
});

