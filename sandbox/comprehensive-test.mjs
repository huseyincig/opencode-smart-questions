import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createSmartQuestionHooks, resolveLockPath } from '../dist/index.js';

console.log('================================================================================');
console.log('   OPENCODE-SMART-QUESTIONS — COMPREHENSIVE END-TO-END SCENARIO TEST SUITE');
console.log('================================================================================');

const sandboxDir = path.dirname(new URL(import.meta.url).pathname);

let totalPassed = 0;

// Helper to run a test with quick timeout (50ms)
async function runScenario(id, name, testFn) {
  process.stdout.write(`\n[${id}] ${name.padEnd(50)} `);
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

// SCENARIO 1: Single recommended option auto-replies
await runScenario('SCENARIO-1', 'Single recommended option auto-selection', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's1',
        questions: [{ question: 'Env?', options: [{ label: 'Dev' }, { label: 'Prod (Recommended)' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(replied, 'Expected reply to be sent');
  assert.equal(replied.requestID, 's1');
  assert.deepEqual(replied.answers, [['Prod (Recommended)']]);
  await hooks.dispose?.();
});

// SCENARIO 2: Turkish marker (Önerilen)
await runScenario('SCENARIO-2', 'Turkish marker (Önerilen) auto-selection', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)', '(Önerilen)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's2',
        questions: [{ question: 'Ortam?', options: [{ label: 'Test' }, { label: 'Canlı (Önerilen)' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(replied, 'Expected reply to be sent');
  assert.deepEqual(replied.answers, [['Canlı (Önerilen)']]);
  await hooks.dispose?.();
});

// SCENARIO 3: Ambiguous (multiple recommended options) fail-safe
await runScenario('SCENARIO-3', 'Fail-safe: multiple recommendations disabled', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's3',
        questions: [{ question: 'Choice?', options: [{ label: 'A (Recommended)' }, { label: 'B (Recommended)' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(replied, null, 'Must NOT auto-reply when ambiguous');
  await hooks.dispose?.();
});

// SCENARIO 4: Zero recommendations fail-safe
await runScenario('SCENARIO-4', 'Fail-safe: zero recommendations disabled', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's4',
        questions: [{ question: 'Choice?', options: [{ label: 'A' }, { label: 'B' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(replied, null, 'Must NOT auto-reply when no recommendation');
  await hooks.dispose?.();
});

// SCENARIO 5: Human draft guard aborts auto-selection
await runScenario('SCENARIO-5', 'Human draft lockfile blocks auto-selection', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const config = { enabled: true, timeoutMs: 40, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true };
  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config });

  const lockPath = resolveLockPath(path.resolve(sandboxDir, '.opencode'), 's5');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, 'user typing answer...');

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's5',
        questions: [{ question: 'Database?', options: [{ label: 'Postgres (Recommended)' }, { label: 'Mongo' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 70));
  assert.equal(replied, null, 'Must NOT auto-reply if user is composing');
  assert.equal(fs.existsSync(lockPath), false, 'Lockfile should be safely cleaned up');
  await hooks.dispose?.();
});

// SCENARIO 6: Manual reply cancels timer
await runScenario('SCENARIO-6', 'Manual answer cancels auto-reply timer', async () => {
  let replyCount = 0;
  const mockClient = {
    question: {
      reply: async () => { replyCount++; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 50, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's6',
        questions: [{ question: 'Proceed?', options: [{ label: 'Yes (Recommended)' }, { label: 'No' }] }],
      },
    },
  });

  // User manually answers at +15ms
  await new Promise((r) => setTimeout(r, 15));
  await hooks.event({
    event: {
      type: 'question.replied',
      data: { id: 's6', answers: [['No']] },
    },
  });

  // Wait beyond original timeout
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(replyCount, 0, 'Auto-reply must not fire after user answered');
  await hooks.dispose?.();
});

// SCENARIO 7: Rejection cancels timer
await runScenario('SCENARIO-7', 'Question rejection cancels timer', async () => {
  let replyCount = 0;
  const mockClient = {
    question: {
      reply: async () => { replyCount++; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 50, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's7',
        questions: [{ question: 'Accept?', options: [{ label: 'Accept (Recommended)' }] }],
      },
    },
  });

  // Question rejected at +15ms
  await new Promise((r) => setTimeout(r, 15));
  await hooks.event({
    event: {
      type: 'question.rejected',
      data: { id: 's7' },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.equal(replyCount, 0, 'Auto-reply must not fire after rejection');
  await hooks.dispose?.();
});

// SCENARIO 8: v1 Client _client.post fallback
await runScenario('SCENARIO-8', 'OpenCode v1 _client.post fallback routing', async () => {
  let posted = null;
  const mockClient = {
    _client: {
      post: async ({ url, body }) => {
        posted = { url, body };
        return { ok: true };
      },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's8',
        questions: [{ question: 'Format?', options: [{ label: 'JSON (Recommended)' }] }],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(posted, 'Expected _client.post to be called');
  assert.equal(posted.url, '/question/s8/reply');
  assert.deepEqual(posted.body.answers, [['JSON (Recommended)']]);
  await hooks.dispose?.();
});

// SCENARIO 9: Multi-question sequential answers
await runScenario('SCENARIO-9', 'Multi-question sequential answer order', async () => {
  let replied = null;
  const mockClient = {
    question: {
      reply: async (p) => { replied = p; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 30, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's9',
        questions: [
          { question: 'Q1', options: [{ label: 'Opt1 (Recommended)' }, { label: 'Opt2' }] },
          { question: 'Q2', options: [{ label: 'OptA' }, { label: 'OptB (Recommended)' }] },
        ],
      },
    },
  });

  await new Promise((r) => setTimeout(r, 60));
  assert.ok(replied);
  assert.deepEqual(replied.answers, [['Opt1 (Recommended)'], ['OptB (Recommended)']]);
  await hooks.dispose?.();
});

// SCENARIO 10: Dispose cleanly shuts down pending requests
await runScenario('SCENARIO-10', 'Dispose cleans up all active timers', async () => {
  let replyCount = 0;
  const mockClient = {
    question: {
      reply: async () => { replyCount++; },
    },
  };

  const hooks = await createSmartQuestionHooks({
    client: mockClient,
    directory: sandboxDir,
  }, { config: { enabled: true, timeoutMs: 50, recommendedMarkers: ['(Recommended)'], requireExactlyOneRecommendation: true } });

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 's10',
        questions: [{ question: 'Run?', options: [{ label: 'Run (Recommended)' }] }],
      },
    },
  });

  // Call dispose immediately
  await hooks.dispose?.();

  await new Promise((r) => setTimeout(r, 70));
  assert.equal(replyCount, 0, 'No replies should fire after dispose');
});

console.log('\n================================================================================');
console.log(`  ALL ${totalPassed}/10 SCENARIOS VERIFIED SUCCESSFULLY!`);
console.log('================================================================================\n');
