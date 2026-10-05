import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const esbuild = (await import('esbuild')).default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  SmartQuestion,
  detectRecommendations,
  loadConfig,
  resolveLockPath,
  deleteLockfile,
  cleanupStaleDrafts,
  OpencodeSmartQuestions,
} from '../dist/index.js';
import { detectV2FormRecommendations } from '../dist/form-adapter.js';

test('detectRecommendations - valid case: exactly one recommended per question', () => {
  const questions = [
    {
      question: 'Select deployment strategy',
      header: 'Strategy',
      options: [
        { label: 'Canary', description: 'Gradual roll out' },
        { label: 'Blue-Green (Recommended)', description: 'Zero downtime' },
        { label: 'Recreate', description: 'Tear down and recreate' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '(Recommended)');
  assert.deepEqual(result.answers, [['Blue-Green (Recommended)']]);
});

test('detectRecommendations - valid multi-question: nested answers in order', () => {
  const questions = [
    {
      question: 'Choose target database',
      header: 'DB',
      options: [
        { label: 'PostgreSQL (Recommended)', description: 'Relational' },
        { label: 'SQLite', description: 'File-based' },
      ],
    },
    {
      question: 'Choose replica count',
      header: 'Replicas',
      options: [
        { label: '1 replica', description: 'Single' },
        { label: '3 replicas (Recommended)', description: 'HA' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '(Recommended)');
  assert.deepEqual(result.answers, [
    ['PostgreSQL (Recommended)'],
    ['3 replicas (Recommended)'],
  ]);
});

test('detectRecommendations - T4: no (Recommended) in any option returns reason', () => {
  const questions = [
    {
      question: 'Pick a color',
      header: 'Color',
      options: [
        { label: 'Red', description: 'Warm' },
        { label: 'Green', description: 'Nature' },
        { label: 'Blue', description: 'Cool' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.ok(typeof result.reason === 'string');
  assert.match(result.reason, /no options ending with marker/i);
});

test('detectRecommendations - T5: two (Recommended) labels returns reason', () => {
  const questions = [
    {
      question: 'Choose an environment',
      header: 'Env',
      options: [
        { label: 'Staging (Recommended)', description: 'Pre-production' },
        { label: 'Production (Recommended)', description: 'Live' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.ok(typeof result.reason === 'string');
  assert.match(result.reason, /expected exactly 1/i);
});

test('detectRecommendations - multiple: true succeeds when exactly one recommendation', () => {
  const questions = [
    {
      question: 'Choose features',
      header: 'Features',
      multiple: true,
      options: [
        { label: 'Logging (Recommended)', description: 'Audit logs' },
        { label: 'Tracing', description: 'OpenTelemetry' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '(Recommended)');
  assert.deepEqual(result.answers, [['Logging (Recommended)']]);
});

test('detectRecommendations - multiple: true succeeds with multiple recommendations', () => {
  const questions = [
    {
      question: 'Choose features',
      header: 'Features',
      multiple: true,
      options: [
        { label: 'Logging (Recommended)', description: 'Audit logs' },
        { label: 'Tracing (Recommended)', description: 'OpenTelemetry' },
        { label: 'Metrics', description: 'Prometheus metrics' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '(Recommended)');
  assert.deepEqual(result.answers, [['Logging (Recommended)', 'Tracing (Recommended)']]);
  assert.equal(result.recommendedOptions.length, 2);
  assert.equal(result.recommendedOptions[0].label, 'Logging (Recommended)');
  assert.equal(result.recommendedOptions[1].label, 'Tracing (Recommended)');
});

test('detectRecommendations - multiple: true fails when 0 options end with marker', () => {
  const questions = [
    {
      question: 'Choose features',
      header: 'Features',
      multiple: true,
      options: [
        { label: 'Logging', description: 'Audit logs' },
        { label: 'Tracing', description: 'OpenTelemetry' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no options ending with marker/i);
});

test('detectRecommendations - single-select fails with expected exactly 1 when 2 recommendations', () => {
  const questions = [
    {
      question: 'Choose features',
      header: 'Features',
      options: [
        { label: 'Logging (Recommended)', description: 'Audit logs' },
        { label: 'Tracing (Recommended)', description: 'OpenTelemetry' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.match(result.reason, /expected exactly 1/i);
});

test('detectRecommendations - requireExactlyOneRecommendation: true + multiple: true succeeds with 1 recommendation', () => {
  const questions = [
    {
      question: 'Choose features',
      header: 'Features',
      multiple: true,
      options: [
        { label: 'Logging (Recommended)', description: 'Audit logs' },
        { label: 'Tracing', description: 'OpenTelemetry' },
      ],
    },
  ];

  const result = detectRecommendations(questions, undefined, { requireExactlyOneRecommendation: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, [['Logging (Recommended)']]);
  assert.equal(result.recommendedOptions.length, 1);
});

test('detectRecommendations - marker suffix matching: label must END with marker', () => {
  const questions = [
    {
      question: 'Choose an option',
      header: 'Choice',
      options: [
        {
          label: 'Option A (Recommended) - note this is extra text',
          description: 'Contains marker in middle, does not end with it',
        },
        {
          label: '(Recommended) Option B',
          description: 'Contains marker at start, does not end with it',
        },
        {
          label: 'Option C',
          description: 'No marker',
        },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no options ending with marker/i);
});

test('detectRecommendations - custom marker support', () => {
  const questions = [
    {
      question: 'Confirm action',
      header: 'Confirm',
      options: [
        { label: 'Yes [DEFAULT]', description: 'Proceed' },
        { label: 'No', description: 'Abort' },
      ],
    },
  ];

  const result = detectRecommendations(questions, '[DEFAULT]');
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '[DEFAULT]');
  assert.deepEqual(result.answers, [['Yes [DEFAULT]']]);
});

test('detectRecommendations - fail-safe: multi-question where one has no recommendation', () => {
  const questions = [
    {
      question: 'Q1',
      header: 'H1',
      options: [{ label: 'Option 1 (Recommended)', description: '' }],
    },
    {
      question: 'Q2',
      header: 'H2',
      options: [{ label: 'Option 2', description: '' }],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Question 2/);
});

test('loadConfig - loads valid config file and sets defaults', () => {
  const config = loadConfig(path.resolve(__dirname, '..'));
  assert.ok(config !== null);
  assert.equal(config.enabled, true);
  assert.equal(config.timeoutMs, 30000);
  assert.equal(config.recommendedMarker, '[SQ:recommended]');
  assert.equal(config.requireExactlyOneRecommendation, true);
});

test('SmartQuestion plugin - missing config or enabled: false returns empty hooks', async () => {
  const hooks = await SmartQuestion(
    { client: {} },
    { config: { enabled: false, timeoutMs: 1000, recommendedMarker: '(Recommended)', requireExactlyOneRecommendation: true } }
  );
  assert.deepEqual(hooks, {});
});

test('SmartQuestion plugin - valid question auto-replies after timeout', async () => {
  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 30,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
      },
    }
  );

  assert.ok(typeof hooks.event === 'function');

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-auto-1',
        questions: [
          {
            question: 'Apply migration?',
            header: 'Migration',
            options: [
              { label: 'Apply (Recommended)', description: 'Runs migration' },
              { label: 'Cancel', description: 'Aborts' },
            ],
          },
        ],
      },
    },
  });

  // Wait for timer to fire
  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(replies.length, 1);
  assert.equal(replies[0].requestID, 'req-auto-1');
  assert.deepEqual(replies[0].answers, [['Apply (Recommended)']]);

  await hooks.dispose();
});

test('SmartQuestion plugin - T6 race: simulate timer firing AFTER reply-cancel path ran -> assert reply called exactly once total', async () => {
  const totalReplies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        totalReplies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 40,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
      },
    }
  );

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-race-boundary',
        questions: [
          {
            question: 'Proceed?',
            header: 'Confirm',
            options: [
              { label: 'Yes (Recommended)', description: '' },
              { label: 'No', description: '' },
            ],
          },
        ],
      },
    },
  });

  // User replies before or right at boundary: simulate user answering via client
  await new Promise((resolve) => setTimeout(resolve, 20));

  // User sends their answer
  await mockClient.question.reply({
    requestID: 'req-race-boundary',
    answers: [['No']],
  });

  // OpenCode fires question.replied event
  await hooks.event({
    event: {
      type: 'question.replied',
      data: {
        requestID: 'req-race-boundary',
        answers: [['No']],
      },
    },
  });

  // Now wait for timer expiration window to pass
  await new Promise((resolve) => setTimeout(resolve, 60));

  // Assert that reply function was called EXACTLY ONCE total (user's answer), never a 2nd reply
  assert.equal(totalReplies.length, 1);
  assert.deepEqual(totalReplies[0], {
    requestID: 'req-race-boundary',
    answers: [['No']],
  });

  await hooks.dispose();
});

test('SmartQuestion plugin - question.rejected also cancels auto-reply timer', async () => {
  const pluginReplies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        pluginReplies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 50,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
      },
    }
  );

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-reject-1',
        questions: [
          {
            question: 'Proceed?',
            header: 'Confirm',
            options: [
              { label: 'Yes (Recommended)', description: '' },
              { label: 'No', description: '' },
            ],
          },
        ],
      },
    },
  });

  await hooks.event({
    event: {
      type: 'question.rejected',
      data: {
        requestID: 'req-reject-1',
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(pluginReplies.length, 0);

  await hooks.dispose();
});

test('SmartQuestion plugin - T7 independence: two concurrent requests, cancel one, other still fires', async () => {
  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 40,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
      },
    }
  );

  // Q1 asked
  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-indep-1',
        questions: [
          {
            question: 'Q1',
            header: 'H1',
            options: [
              { label: 'A1 (Recommended)', description: '' },
              { label: 'B1', description: '' },
            ],
          },
        ],
      },
    },
  });

  // Q2 asked
  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-indep-2',
        questions: [
          {
            question: 'Q2',
            header: 'H2',
            options: [
              { label: 'A2', description: '' },
              { label: 'B2 (Recommended)', description: '' },
            ],
          },
        ],
      },
    },
  });

  // User answers Q1 before timer
  await hooks.event({
    event: {
      type: 'question.replied',
      data: {
        requestID: 'req-indep-1',
        answers: [['B1']],
      },
    },
  });

  // Wait for Q2 timer to fire
  await new Promise((resolve) => setTimeout(resolve, 70));

  // Only Q2 must have been replied to by plugin
  assert.equal(replies.length, 1);
  assert.equal(replies[0].requestID, 'req-indep-2');
  assert.deepEqual(replies[0].answers, [['B2 (Recommended)']]);

  await hooks.dispose();
});

test('SmartQuestion plugin - no auto-reply on invalid question (no recommended option)', async () => {
  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 30,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
      },
    }
  );

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-invalid-1',
        questions: [
          {
            question: 'Unmarked choices',
            header: 'Choices',
            options: [
              { label: 'Opt 1', description: '' },
              { label: 'Opt 2', description: '' },
            ],
          },
        ],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(replies.length, 0);

  await hooks.dispose();
});

test('SmartQuestion plugin - v1 client without question.reply falls back to REST via serverUrl', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    // Production PluginInput: `client` is the v1 SDK client with NO question
    // namespace; the reply must go to the v2 REST endpoint via serverUrl.
    const hooks = await SmartQuestion(
      {
        client: {},
        directory: '/tmp',
        serverUrl: new URL('http://127.0.0.1:4096/'),
      },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          debugLog: '',
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: 'req-rest-1',
          questions: [
            {
              question: 'Apply migration?',
              header: 'Migration',
              options: [
                { label: 'Apply (Recommended)', description: 'Runs migration' },
                { label: 'Cancel', description: 'Aborts' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(calls.length, 1, 'REST fallback must post exactly once');
    assert.equal(calls[0].url, 'http://127.0.0.1:4096/question/req-rest-1/reply');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers['content-type'], 'application/json');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      answers: [['Apply (Recommended)']],
    });

    await hooks.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SmartQuestion plugin - live SSE payload shape (properties, no data) is accepted', async () => {
  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient, directory: '/tmp' },
    {
      config: {
        enabled: true,
        timeoutMs: 30,
        recommendedMarker: '(Recommended)',
        requireExactlyOneRecommendation: true,
        debugLog: '',
      },
    }
  );

  // Live OpenCode delivers events as { id, type, properties } — never `data`.
  await hooks.event({
    event: {
      id: 'evt_1',
      type: 'question.asked',
      properties: {
        id: 'req-props-1',
        sessionID: 'ses_1',
        questions: [
          {
            question: 'Continue?',
            header: 'Continue',
            options: [
              { label: 'Continue (Recommended)', description: 'go on' },
              { label: 'Stop', description: 'halt' },
            ],
          },
        ],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(replies.length, 1, 'properties-shaped payload must still auto-reply');
  assert.equal(replies[0].requestID, 'req-props-1');
  assert.deepEqual(replies[0].answers, [['Continue (Recommended)']]);

  await hooks.dispose();
});

test('SmartQuestion plugin - ws(s) serverUrl scheme is normalized to http(s) and query is kept', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, text: async () => '' };
  };

  try {
    const hooks = await SmartQuestion(
      {
        client: {},
        directory: '/tmp',
        // Plugin transport URLs can be ws:// — REST must be http://
        serverUrl: new URL('ws://127.0.0.1:26301/?token=secret'),
      },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          debugLog: '',
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: 'req-ws-1',
          questions: [
            {
              question: 'Go?',
              header: 'Go',
              options: [
                { label: 'Go (Recommended)', description: 'yes' },
                { label: 'Stop', description: 'no' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(calls.length, 1);
    assert.equal(
      calls[0].url,
      'http://127.0.0.1:26301/question/req-ws-1/reply?token=secret',
      'ws:// must become http:// and the query token must be preserved'
    );

    await hooks.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SmartQuestion plugin - v1 client with _client.post routes reply via in-memory post and skips fetch', async () => {
  const calls = [];
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return { ok: true, status: 200, text: async () => '' };
  };

  const client = {
    _client: {
      post: async (opts) => {
        calls.push(opts);
        return {};
      },
    },
  };

  try {
    const hooks = await SmartQuestion(
      {
        client,
        directory: '/tmp',
        serverUrl: new URL('http://127.0.0.1:4096/'),
      },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          debugLog: '',
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: 'req-cpost-1',
          questions: [
            {
              question: 'Apply migration?',
              header: 'Migration',
              options: [
                { label: 'Apply (Recommended)', description: 'Runs migration' },
                { label: 'Cancel', description: 'Aborts' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, '/question/req-cpost-1/reply');
    assert.deepEqual(calls[0].body.answers, [['Apply (Recommended)']]);
    assert.equal(fetchCalled, false, 'globalThis.fetch was NOT called');

    await hooks.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('SmartQuestion lockfile - auto-reply SKIPPED when lockfile exists, lockfile removed afterwards, reply not called', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-composing-'));
  const requestID = 'req-draft-skip-1';
  const lockPath = path.join(tempDir, `.sq-draft-${requestID}`);
  fs.writeFileSync(lockPath, 'composing draft answer');
  assert.equal(fs.existsSync(lockPath), true);

  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  try {
    const hooks = await SmartQuestion(
      { client: mockClient },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: tempDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: requestID,
          questions: [
            {
              question: 'Deploy now?',
              header: 'Deploy',
              options: [
                { label: 'Yes (Recommended)', description: '' },
                { label: 'No', description: '' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(replies.length, 0, 'Auto-reply must be skipped when lockfile exists');
    assert.equal(fs.existsSync(lockPath), false, 'Lockfile must be deleted after skipping auto-reply');

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SmartQuestion lockfile - auto-reply proceeds normally when lockfile does NOT exist', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-nolock-'));
  const requestID = 'req-no-draft-1';
  const lockPath = path.join(tempDir, `.sq-draft-${requestID}`);
  assert.equal(fs.existsSync(lockPath), false);

  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  try {
    const hooks = await SmartQuestion(
      { client: mockClient },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: tempDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: requestID,
          questions: [
            {
              question: 'Deploy now?',
              header: 'Deploy',
              options: [
                { label: 'Yes (Recommended)', description: '' },
                { label: 'No', description: '' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(replies.length, 1, 'Auto-reply must proceed when no lockfile exists');
    assert.equal(replies[0].requestID, requestID);
    assert.deepEqual(replies[0].answers, [['Yes (Recommended)']]);

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SmartQuestion lockfile - lockfile for a DIFFERENT requestID does not block this request reply', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-diff-'));
  const targetRequestID = 'req-target-1';
  const otherRequestID = 'req-other-different-99';
  const otherLockPath = path.join(tempDir, `.sq-draft-${otherRequestID}`);
  fs.writeFileSync(otherLockPath, 'user composing on other question');

  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  try {
    const hooks = await SmartQuestion(
      { client: mockClient },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: tempDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: targetRequestID,
          questions: [
            {
              question: 'Deploy now?',
              header: 'Deploy',
              options: [
                { label: 'Yes (Recommended)', description: '' },
                { label: 'No', description: '' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(replies.length, 1, 'Auto-reply for target question must proceed');
    assert.equal(replies[0].requestID, targetRequestID);
    assert.equal(fs.existsSync(otherLockPath), true, 'Lockfile for different request must remain untouched');

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SmartQuestion lockfile - cleanup on question.replied removes the lockfile', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-cleanup-'));
  const requestID = 'req-cleanup-replied-1';
  const lockPath = path.join(tempDir, `.sq-draft-${requestID}`);
  fs.writeFileSync(lockPath, 'draft content from user');
  assert.equal(fs.existsSync(lockPath), true);

  try {
    const hooks = await SmartQuestion(
      { client: { question: { reply: async () => {} } } },
      {
        config: {
          enabled: true,
          timeoutMs: 1000,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: tempDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.replied',
        data: {
          requestID,
          answers: [['Manual answer']],
        },
      },
    });

    assert.equal(fs.existsSync(lockPath), false, 'question.replied must remove lockfile');

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SmartQuestion lockfile - cleanup on question.rejected removes the lockfile', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-cleanup-rej-'));
  const requestID = 'req-cleanup-rejected-1';
  const lockPath = path.join(tempDir, `.sq-draft-${requestID}`);
  fs.writeFileSync(lockPath, 'draft content from user');
  assert.equal(fs.existsSync(lockPath), true);

  try {
    const hooks = await SmartQuestion(
      { client: { question: { reply: async () => {} } } },
      {
        config: {
          enabled: true,
          timeoutMs: 1000,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: tempDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.rejected',
        data: {
          requestID,
        },
      },
    });

    assert.equal(fs.existsSync(lockPath), false, 'question.rejected must remove lockfile');

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('SmartQuestion lockfile - unreadable/inaccessible lockfile path still skips reply (fail safe)', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-inaccessible-'));
  // Create a regular file so using it as configDir causes path.join(configDir, '.sq-draft-...') to throw ENOTDIR on stat
  const fileAsDir = path.join(tempDir, 'regular-file-blocking-dir');
  fs.writeFileSync(fileAsDir, 'not a directory');

  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  try {
    const hooks = await SmartQuestion(
      { client: mockClient },
      {
        config: {
          enabled: true,
          timeoutMs: 30,
          recommendedMarker: '(Recommended)',
          requireExactlyOneRecommendation: true,
          configDir: fileAsDir,
        },
      }
    );

    await hooks.event({
      event: {
        type: 'question.asked',
        data: {
          id: 'req-inaccessible-1',
          questions: [
            {
              question: 'Deploy now?',
              header: 'Deploy',
              options: [
                { label: 'Yes (Recommended)', description: '' },
                { label: 'No', description: '' },
              ],
            },
          ],
        },
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(replies.length, 0, 'Auto-reply must be skipped when lockfile path throws unexpected error on stat');

    await hooks.dispose();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig - exposes configDir matching directory of smart-question.json', () => {
  const config = loadConfig(path.resolve(__dirname, '..'));
  assert.ok(config !== null);
  assert.equal(config.configDir, path.resolve(__dirname, '../.opencode'));
});

test('resolveLockPath - resolves configDir or falls back to process.cwd()/.opencode', () => {
  assert.equal(
    resolveLockPath('/custom/dir', 'req-123'),
    path.join('/custom/dir', '.sq-draft-req-123')
  );
  assert.equal(
    resolveLockPath(undefined, 'req-456'),
    path.join(process.cwd(), '.opencode', '.sq-draft-req-456')
  );
});

test('backend plugin - default export is an object or function (primary plugin entry)', async () => {
  const backendMod = await import('../dist/index.js');
  const type = typeof backendMod.default;
  assert.ok(
    type === 'object' || type === 'function',
    "Expected backend module default export to be an object or function"
  );
  if (type === 'object') {
    assert.equal(typeof backendMod.default.server, 'function');
  }
});

test('backend plugin - every exported function called as plugin factory must not throw and must return undefined or an object, never null', async () => {
  const backendMod = await import('../dist/index.js');

  const realisticPluginInput = {
    client: {},
    directory: '/tmp/sq-test-project',
    project: {},
    worktree: '/tmp/sq-test-project',
    serverUrl: new URL('http://127.0.0.1:4096'),
    $: undefined,
    experimental_workspace: {},
  };

  const functionExports = Object.entries(backendMod).filter(
    ([, val]) => typeof val === 'function'
  );

  assert.ok(
    functionExports.length > 0,
    'Expected backend module to have at least one exported function'
  );

  for (const [name, fn] of functionExports) {
    let result;
    try {
      result = await fn(realisticPluginInput);
    } catch (err) {
      assert.fail(
        `Export '${name}' threw when invoked as a plugin factory with PluginInput: ${err.message}. ` +
          `OpenCode calls every exported function as a factory; add a PluginInput guard to '${name}'.`
      );
    }

    assert.notEqual(
      result,
      null,
      `Export '${name}' returned null when invoked as a plugin factory. ` +
        `OpenCode crashes on null plugin hooks ('null is not an object'). Must return undefined or an object, never null.`
    );

    assert.ok(
      result === undefined || (typeof result === 'object' && !Array.isArray(result)),
      `Export '${name}' returned primitive type '${typeof result}' (${String(result)}) when invoked as a plugin factory. ` +
        `Must return undefined or an object, never null or primitive.`
    );
  }
});

test('TUI plugin module - transpile and verify exported functions (handles plain Node missing runtime deps)', async () => {
  const uiTsxPath = path.resolve(__dirname, '../src/ui.tsx');
  const uiTsxCode = fs.readFileSync(uiTsxPath, 'utf8');

  // Transpile TSX to ESM using esbuild
  const { code: transpiledUiJs } = await esbuild.transform(uiTsxCode, {
    loader: 'tsx',
    format: 'esm',
  });

  assert.ok(
    transpiledUiJs && transpiledUiJs.length > 0,
    'esbuild transpile of smart-question-ui.tsx must produce code'
  );

  // Attempt dynamic import in plain Node
  let uiMod = null;
  let importErr = null;
  try {
    uiMod = await import(
      `data:text/javascript;base64,${Buffer.from(transpiledUiJs).toString('base64')}`
    );
  } catch (err) {
    importErr = err;
  }

  if (uiMod) {
    // If the module can be imported (runtime deps present in environment), assert behavioral invariants
    const realisticPluginInput = {
      client: {},
      directory: '/tmp/sq-test-project',
      project: {},
      worktree: '/tmp/sq-test-project',
      serverUrl: new URL('http://127.0.0.1:4096'),
      $: undefined,
      experimental_workspace: {},
    };

    const functionExports = Object.entries(uiMod).filter(
      ([, val]) => typeof val === 'function'
    );
    for (const [name, fn] of functionExports) {
      let result;
      try {
        result = await fn(realisticPluginInput);
      } catch (err) {
        assert.fail(
          `TUI export '${name}' threw when invoked with PluginInput: ${err.message}. ` +
            `Add a PluginInput guard to '${name}'.`
        );
      }
      assert.notEqual(
        result,
        null,
        `TUI export '${name}' returned null when invoked as a plugin factory. Must return undefined or an object, never null.`
      );
      assert.ok(
        result === undefined || (typeof result === 'object' && !Array.isArray(result)),
        `TUI export '${name}' returned primitive type '${typeof result}'. Must return undefined or an object, never null.`
      );
    }
  } else {
    // Module cannot be imported in plain Node due to missing external runtime deps (@opentui/solid, solid-js, @opencode-ai/plugin/tui).
    // Do NOT silently skip: parse and iterate exported functions after transpile.
    assert.ok(
      importErr !== null,
      'Expected importErr to be captured when module cannot be imported in plain Node'
    );

    const exportBlockMatch = transpiledUiJs.match(/export\s*\{([\s\S]*?)\};/);
    assert.ok(
      exportBlockMatch,
      'Transpiled smart-question-ui.tsx must contain an export block'
    );

    const exportEntries = exportBlockMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const exportedFunctions = [];
    for (const entry of exportEntries) {
      const exportName = entry.includes(' as ')
        ? entry.split(' as ')[1].trim()
        : entry.trim();
      const internalName = entry.includes(' as ')
        ? entry.split(' as ')[0].trim()
        : entry.trim();

      const isFunction =
        new RegExp(`function\\s+${internalName}\\b`).test(transpiledUiJs) ||
        new RegExp(`const\\s+${internalName}\\s*=\\s*(?:async\\s*)?\\(`).test(transpiledUiJs) ||
        new RegExp(`var\\s+${internalName}\\s*=\\s*(?:async\\s*)?\\(`).test(transpiledUiJs) ||
        new RegExp(`let\\s+${internalName}\\s*=\\s*(?:async\\s*)?\\(`).test(transpiledUiJs);

      if (isFunction) {
        exportedFunctions.push(exportName);
      }
    }

    // Verify key functions are exported and accounted for
    assert.ok(
      exportedFunctions.includes('loadConfig'),
      "TUI module must export function 'loadConfig'"
    );
    assert.ok(
      exportedFunctions.includes('detectRecommendations'),
      "TUI module must export function 'detectRecommendations'"
    );
    assert.ok(
      exportedFunctions.includes('tui'),
      "TUI module must export function 'tui'"
    );
    assert.ok(
      exportedFunctions.includes('SmartQuestionOverlay'),
      "TUI module must export function 'SmartQuestionOverlay'"
    );
    assert.ok(
      exportedFunctions.includes('setup'),
      "TUI module must export function 'setup' for OpenCode v2"
    );
    assert.ok(
      exportedFunctions.includes('resolveAgentName'),
      "TUI module must export function 'resolveAgentName'"
    );
    assert.ok(
      exportedFunctions.includes('stripMarker'),
      "TUI module must export function 'stripMarker'"
    );
    assert.ok(
      exportedFunctions.includes('formatCountdown'),
      "TUI module must export function 'formatCountdown'"
    );
    assert.equal(
      exportedFunctions.length,
      8,
      `Expected exactly 8 exported functions from smart-question-ui.tsx, found: ${exportedFunctions.join(', ')}`
    );
  }
});

test('cleanupStaleDrafts - deletes an old file, keeps a fresh one, and survives a nonexistent directory (no throw)', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-cleanup-stale-'));
  try {
    const oldDraftPath = path.join(tempDir, '.sq-draft-old-request-1');
    const freshDraftPath = path.join(tempDir, '.sq-draft-fresh-request-2');
    const unrelatedFilePath = path.join(tempDir, 'other-file.txt');

    fs.writeFileSync(oldDraftPath, 'stale draft lock');
    fs.writeFileSync(freshDraftPath, 'fresh draft lock');
    fs.writeFileSync(unrelatedFilePath, 'keep me');

    // Make old file 10 minutes old (threshold with default 30s timeout is 4 * 30s = 120s = 2 min)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    fs.utimesSync(oldDraftPath, tenMinutesAgo, tenMinutesAgo);

    cleanupStaleDrafts(tempDir);

    assert.equal(fs.existsSync(oldDraftPath), false, 'Old draft file must be deleted');
    assert.equal(fs.existsSync(freshDraftPath), true, 'Fresh draft file must be kept');
    assert.equal(fs.existsSync(unrelatedFilePath), true, 'Unrelated file must not be touched');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  // Survives nonexistent directory without throwing
  assert.doesNotThrow(() => {
    cleanupStaleDrafts('/nonexistent/path/that/does/not/exist/for/sure');
  }, 'cleanupStaleDrafts must survive nonexistent directory without throwing');
});

test('cleanupStaleDrafts - loader simulation invariant: must not throw when called with { client: {}, directory: "x" }', () => {
  let result;
  assert.doesNotThrow(() => {
    result = cleanupStaleDrafts({ client: {}, directory: 'x' });
  }, 'cleanupStaleDrafts must not throw when called with PluginInput-shaped object');

  assert.deepEqual(result, {}, 'cleanupStaleDrafts must return empty object {} when invoked as plugin factory');
});

test('detectRecommendations - Turkish marker (Önerilen) alone is detected', () => {
  const questions = [
    {
      question: 'Dağıtım stratejisini seçin',
      header: 'Strateji',
      options: [
        { label: 'Canary', description: 'Kademeli geçiş' },
        { label: 'Mavi-Yeşil (Önerilen)', description: 'Kesintisiz' },
        { label: 'Yeniden Oluştur', description: 'Sıfırdan kur' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, true);
  assert.equal(result.matchedMarker, '(Önerilen)');
  assert.deepEqual(result.answers, [['Mavi-Yeşil (Önerilen)']]);
});

test('detectRecommendations - fail-safe: mixed (Recommended) and (Önerilen) in same question returns reason', () => {
  const questions = [
    {
      question: 'Choose an option',
      header: 'Choice',
      options: [
        { label: 'Option A (Recommended)', description: 'English marker' },
        { label: 'Option B (Önerilen)', description: 'Turkish marker' },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.ok(typeof result.reason === 'string');
  assert.match(result.reason, /ending with marker/i);
  assert.match(result.reason, /expected exactly 1/i);
});

test('loadConfig - config with recommendedMarkers array is honoured', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-markers-arr-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'smart-question.json'),
      JSON.stringify({
        enabled: true,
        recommendedMarkers: ['[ALPHA]', '[BETA]'],
      })
    );
    const cfg = loadConfig(tempDir);
    assert.ok(cfg !== null);
    assert.deepEqual(cfg.recommendedMarkers, ['[ALPHA]', '[BETA]']);
    assert.equal(cfg.recommendedMarker, '[ALPHA]');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig - config with only legacy recommendedMarker still works', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-marker-legacy-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'smart-question.json'),
      JSON.stringify({
        enabled: true,
        recommendedMarker: '[CUSTOM_LEGACY]',
      })
    );
    const cfg = loadConfig(tempDir);
    assert.ok(cfg !== null);
    assert.deepEqual(cfg.recommendedMarkers, ['[CUSTOM_LEGACY]']);
    assert.equal(cfg.recommendedMarker, '[CUSTOM_LEGACY]');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('loadConfig - neither recommendedMarkers nor recommendedMarker present -> defaults used', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-neither-'));
  try {
    fs.writeFileSync(
      path.join(tempDir, 'smart-question.json'),
      JSON.stringify({ enabled: true })
    );
    const cfg = loadConfig(tempDir);
    assert.ok(cfg !== null);
    assert.deepEqual(cfg.recommendedMarkers, ['[SQ:recommended]', '(Recommended)', '(Önerilen)']);
    assert.equal(cfg.recommendedMarker, '[SQ:recommended]');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('detectRecommendations - suffix semantics hold for every accepted marker', () => {
  const questions = [
    {
      question: 'Seçenek belirleyin',
      header: 'Seçenek',
      options: [
        {
          label: 'Seçenek A (Önerilen) - ekstra açıklama',
          description: 'Marker ortada, sonda değil',
        },
        {
          label: '(Önerilen) Seçenek B',
          description: 'Marker başta, sonda değil',
        },
        {
          label: 'Option C (Recommended) - note extra text',
          description: 'Marker in middle, not at end',
        },
        {
          label: '(Recommended) Option D',
          description: 'Marker at start, not at end',
        },
      ],
    },
  ];

  const result = detectRecommendations(questions);
  assert.equal(result.ok, false);
  assert.match(result.reason, /no options ending with marker/i);
});

test('SmartQuestion plugin - valid question with Turkish marker (Önerilen) auto-replies after timeout', async () => {
  const replies = [];
  const mockClient = {
    question: {
      reply: async (payload) => {
        replies.push(payload);
      },
    },
  };

  const hooks = await SmartQuestion(
    { client: mockClient },
    {
      config: {
        enabled: true,
        timeoutMs: 30,
        recommendedMarkers: ['(Recommended)', '(Önerilen)'],
        requireExactlyOneRecommendation: true,
      },
    }
  );

  await hooks.event({
    event: {
      type: 'question.asked',
      data: {
        id: 'req-turkish-auto-1',
        questions: [
          {
            question: 'Geçişi onayla?',
            header: 'Onay',
            options: [
              { label: 'Onayla (Önerilen)', description: 'Geçişi çalıştır' },
              { label: 'İptal', description: 'Durdur' },
            ],
          },
        ],
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.equal(replies.length, 1);
  assert.equal(replies[0].requestID, 'req-turkish-auto-1');
  assert.deepEqual(replies[0].answers, [['Onayla (Önerilen)']]);

  await hooks.dispose();
});

test('SmartQuestion plugin - tool.definition enriches question tool description and schema', async () => {
  const hooks = await SmartQuestion(
    { client: {} },
    {
      config: {
        enabled: true,
        timeoutMs: 30000,
        recommendedMarkers: ['(Recommended)', '(Önerilen)'],
        requireExactlyOneRecommendation: true,
      },
    }
  );

  assert.ok(typeof hooks['tool.definition'] === 'function');

  // Case 1: question tool
  const questionOutput = {
    description: 'Ask the user a question with choices',
    jsonSchema: {
      properties: {
        questions: {
          items: {
            properties: {
              options: {
                items: {
                  properties: {
                    label: { description: 'Display text' },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  await hooks['tool.definition']({ toolID: 'question' }, questionOutput);

  assert.match(questionOutput.description, /RECOMMENDED OPTION CONVENTION/);
  assert.match(questionOutput.description, /native question tool/i);
  assert.match(questionOutput.description, /plain assistant (?:text|prose)/i);
  assert.match(questionOutput.description, /\(Recommended\)/);
  assert.match(
    questionOutput.jsonSchema.properties.questions.items.properties.options.items.properties.label.description,
    /\(Recommended\)/
  );

  // Case 2: other tool (e.g. bash)
  const bashOutput = { description: 'Execute a bash command' };
  await hooks['tool.definition']({ toolID: 'bash' }, bashOutput);
  assert.equal(bashOutput.description, 'Execute a bash command');

  await hooks.dispose();
});

test('SmartQuestion plugin - experimental.chat.system.transform injects guidance into system prompt', async () => {
  const hooks = await SmartQuestion(
    { client: {} },
    {
      config: {
        enabled: true,
        timeoutMs: 30000,
        recommendedMarkers: ['(Recommended)', '(Önerilen)'],
        requireExactlyOneRecommendation: true,
      },
    }
  );

  assert.ok(typeof hooks['experimental.chat.system.transform'] === 'function');

  const systemOutput = { system: ['Base system prompt for assistant.'] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'ses-1' }, systemOutput);

  assert.equal(systemOutput.system.length, 2);
  assert.match(systemOutput.system[1], /Smart Question Auto-Selection Guidance/);
  assert.match(systemOutput.system[1], /native question\/form mechanism/i);
  assert.match(systemOutput.system[1], /plain assistant (?:text|prose)/i);
  assert.match(systemOutput.system[1], /\(Recommended\)/);

  await hooks.dispose();
});



test('loadConfig - missing file uses enabled defaults instead of silently disabling plugin', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-default-config-'));
  // A real user's global config is intentional in production, but cannot
  // determine the result of a missing-project-config unit test.
  t.mock.method(os, 'homedir', () => tempDir);
  try {
    const cfg = loadConfig(tempDir);
    assert.ok(cfg);
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.timeoutMs, 30000);
    assert.deepEqual(cfg.recommendedMarkers, ['[SQ:recommended]', '(Recommended)', '(Önerilen)']);
    assert.equal(cfg.configDir, path.join(tempDir, '.opencode'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('resolveLockPath - request IDs cannot escape configDir', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-safe-lock-'));
  try {
    const lockPath = resolveLockPath(tempDir, '../escape/nested');
    assert.equal(path.dirname(lockPath), tempDir);
    assert.ok(path.basename(lockPath).startsWith('.sq-draft-'));
    assert.ok(!path.basename(lockPath).includes('/'));
    assert.ok(!fs.existsSync(path.resolve(tempDir, '..', 'escape')));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('detectV2FormRecommendations - maps recommended labels to v2 option values', () => {
  const result = detectV2FormRecommendations(
    {
      id: 'form-v2-map',
      sessionID: 'ses-v2-map',
      fields: [
        {
          key: 'strategy',
          type: 'string',
          options: [
            { value: 'canary', label: 'Canary' },
            { value: 'blue-green', label: 'Blue-Green (Recommended)' },
          ],
        },
        {
          key: 'features',
          type: 'multiselect',
          options: [
            { value: 'logs', label: 'Logging (Recommended)' },
            { value: 'tracing', label: 'Tracing (Recommended)' },
            { value: 'metrics', label: 'Metrics' },
          ],
        },
      ],
    },
    ['(Recommended)'],
    { requireExactlyOneRecommendation: true }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.answer, {
    strategy: 'blue-green',
    features: ['logs', 'tracing'],
  });
});

test('detectV2FormRecommendations - refuses free-text forms fail-safe', () => {
  const result = detectV2FormRecommendations({
    id: 'form-v2-text',
    sessionID: 'ses-v2-text',
    fields: [
      {
        key: 'notes',
        type: 'string',
      },
    ],
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /not a supported selectable field/i);
});

test('OpenCode v2 backend setup registers current tool/context transforms', async () => {
  let transformedTool;
  let contextHook;
  const disposed = [];

  const context = {
    location: { directory: '/tmp/sq-v2-backend' },
    options: {
      enabled: true,
      recommendedMarkers: ['(Recommended)'],
      timeoutMs: 10,
    },
    tool: {
      transform(callback) {
        callback({
          update(id, mutate) {
            assert.equal(id, 'question');
            const tool = {
              description: 'Ask the user a question with choices',
            };
            mutate(tool);
            transformedTool = tool;
          },
        });
        return Promise.resolve({ dispose: async () => { disposed.push('tool'); } });
      },
    },
    session: {
      hook(name, callback) {
        assert.equal(name, 'context');
        contextHook = callback;
        return Promise.resolve({ dispose: async () => { disposed.push('context'); } });
      },
    },
  };

  const cleanup = await OpencodeSmartQuestions.setup(context);
  assert.equal(typeof cleanup, 'function');
  assert.match(transformedTool.description, /RECOMMENDED OPTION CONVENTION/);
  assert.match(transformedTool.description, /native question tool/i);
  assert.match(transformedTool.description, /plain assistant (?:text|prose)/i);

  const event = {
    system: [{ type: 'text', text: 'Base system prompt' }],
    messages: [],
    tools: [],
  };
  await contextHook(event);
  assert.equal(event.system.length, 2);
  assert.match(event.system[1].text, /Smart Question Auto-Selection Guidance/);
  assert.match(event.system[1].text, /native question\/form mechanism/i);
  assert.match(event.system[1].text, /plain assistant (?:text|prose)/i);

  await contextHook(event);
  assert.equal(event.system.length, 2, 'guidance must not duplicate');
  await cleanup();
  assert.deepEqual(disposed, ['context', 'tool']);
  await cleanup();
  assert.deepEqual(disposed, ['context', 'tool'], 'cleanup must be idempotent');
});

test('V2 backend waits for registration promises and rolls back partial setup', async () => {
  const disposed = [];
  let unblockTool;
  let hookCalled = false;
  const context = {
    location: { directory: '/tmp/sq-v2-registration-tests' },
    options: { enabled: true },
    tool: {
      transform() {
        return new Promise((resolve) => { unblockTool = resolve; });
      },
    },
    session: {
      hook() {
        hookCalled = true;
        return Promise.reject(new Error('context hook unavailable'));
      },
    },
  };

  const setup = OpencodeSmartQuestions.setup(context);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hookCalled, false, 'context hook must wait for tool registration');
  unblockTool({ dispose: async () => { disposed.push('tool'); } });
  await assert.rejects(setup, /V2 backend registration failed/);
  assert.equal(hookCalled, true);
  assert.deepEqual(disposed, ['tool'], 'partial tool registration must be rolled back');
});

test('V2 backend rejects a failed tool transform without registering context hook', async () => {
  let hookCalled = false;
  await assert.rejects(OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-registration-tests' },
    options: { enabled: true },
    tool: { transform() { return Promise.reject(new Error('tool transform unavailable')); } },
    session: { hook() { hookCalled = true; } },
  }), /V2 backend registration failed/);
  assert.equal(hookCalled, false);
});

test('V2 backend rejects an invalid context registration and disposes tool registration', async () => {
  let toolDisposed = false;
  await assert.rejects(OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-registration-tests' },
    options: { enabled: true },
    tool: { transform() { return Promise.resolve({
      dispose: async () => { toolDisposed = true; },
    }); } },
    session: { hook() { return Promise.resolve(undefined); } },
  }), /V2 backend registration failed/);
  assert.equal(toolDisposed, true);
});

test('loadConfig honours global config when project config is absent', (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-global-config-'));
  t.mock.method(os, 'homedir', () => home);
  try {
    const globalDir = path.join(home, '.config', 'opencode');
    const projectDir = path.join(home, 'project');
    fs.mkdirSync(globalDir, { recursive: true });
    fs.mkdirSync(projectDir);
    fs.writeFileSync(path.join(globalDir, 'smart-question.json'), '{"enabled":false}');
    assert.equal(loadConfig(projectDir), null, 'production global fallback must be retained');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function createV2TuiMock(tempDir, timeoutMs = 25) {
  const eventHandlers = new Map();
  const keyHandlers = new Map();
  const pendingForms = new Map();
  const replies = [];
  let route = { type: 'session', sessionID: 'ses-v2-ui' };
  let slotDisposed = false;

  const context = {
    options: {
      enabled: true,
      timeoutMs,
      recommendedMarkers: ['[SQ:recommended]', '(Recommended)', '(Önerilen)'],
      requireExactlyOneRecommendation: true,
      configDir: tempDir,
    },
    location: { directory: tempDir },
    data: {
      on(type, handler) {
        eventHandlers.set(type, handler);
        return () => eventHandlers.delete(type);
      },
      session: {
        form: {
          async sync() {},
          list(sessionID) {
            return [...pendingForms.values()].filter(
              (form) => form.sessionID === sessionID
            );
          },
          async reply(input) {
            replies.push(input);
            pendingForms.delete(input.formID);
          },
          async cancel() {},
          invalidate() {},
        },
      },
    },
    renderer: {
      keyInput: {
        on(type, handler) {
          keyHandlers.set(type, handler);
        },
        off(type, handler) {
          if (keyHandlers.get(type) === handler) keyHandlers.delete(type);
        },
      },
    },
    ui: {
      router: {
        current() {
          return route;
        },
      },
      slot(_definition) {
        return () => {
          slotDisposed = true;
        };
      },
    },
  };

  return {
    context,
    replies,
    emitCreated(form) {
      pendingForms.set(form.id, form);
      eventHandlers.get('form.created')?.({
        type: 'form.created',
        data: { form },
        location: { directory: tempDir },
      });
    },
    emitKey() {
      keyHandlers.get('keypress')?.({ name: 'down' });
    },
    emitSettled(type, formID) {
      eventHandlers.get(type)?.({ type, data: { id: formID } });
    },
    setRoute(next) {
      route = next;
    },
    get slotDisposed() {
      return slotDisposed;
    },
    get eventHandlerCount() {
      return eventHandlers.size;
    },
    get keyHandlerCount() {
      return keyHandlers.size;
    },
  };
}

test('OpenCode v2 TUI setup auto-replies through session.form using option values', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-v2-ui-reply-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 20);
    const cleanup = await ui.setup(mock.context);

    mock.emitCreated({
      id: 'form-v2-ui-reply',
      sessionID: 'ses-v2-ui',
      fields: [
        {
          key: 'choice',
          type: 'string',
          options: [
            { value: 'go', label: 'Continue (Recommended)' },
            { value: 'stop', label: 'Stop' },
          ],
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(mock.replies.length, 1);
    assert.deepEqual(mock.replies[0], {
      sessionID: 'ses-v2-ui',
      formID: 'form-v2-ui-reply',
      answer: { choice: 'go' },
    });

    cleanup?.();
    assert.equal(mock.eventHandlerCount, 0);
    assert.equal(mock.keyHandlerCount, 0);
    assert.equal(mock.slotDisposed, true);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('OpenCode v2 TUI user interaction cancels auto-reply without consuming input', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-v2-ui-manual-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 35);
    const cleanup = await ui.setup(mock.context);

    mock.emitCreated({
      id: 'form-v2-ui-manual',
      sessionID: 'ses-v2-ui',
      fields: [
        {
          key: 'choice',
          type: 'string',
          options: [
            { value: 'go', label: 'Continue (Recommended)' },
            { value: 'stop', label: 'Stop' },
          ],
        },
      ],
    });

    await new Promise((resolve) => setTimeout(resolve, 5));
    mock.emitKey();
    await new Promise((resolve) => setTimeout(resolve, 55));

    assert.equal(mock.replies.length, 0);

    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('TUI source never injects fake stdin keypresses', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/ui.tsx'),
    'utf8'
  );
  assert.doesNotMatch(source, /process\.stdin\.emit\s*\(/);
  assert.match(source, /session\.form\.reply/);
});


test('OpenCode v2 backend setup silently no-ops on partial v2 contexts', async () => {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);

  try {
    const missingTool = await OpencodeSmartQuestions.setup({
      location: { directory: process.cwd() },
      session: {},
    });
    assert.equal(missingTool, undefined);

    const missingSessionHook = await OpencodeSmartQuestions.setup({
      location: { directory: process.cwd() },
      tool: {
        transform() {
          throw new Error('must not be reached without session.hook');
        },
      },
      session: {},
    });
    assert.equal(missingSessionHook, undefined);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(
      errors,
      [],
      'partial v2 backend contexts must not emit startup errors'
    );
  } finally {
    console.error = originalError;
  }
});

test('OpenCode v2 TUI setup silently no-ops on partial v2 contexts', async () => {
  const ui = await import('../dist/ui.js');
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);

  try {
    const cleanup = await ui.setup({
      location: { directory: process.cwd() },
      data: {},
      renderer: {},
      ui: {},
    });
    assert.equal(cleanup, undefined);

    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(
      errors,
      [],
      'partial v2 TUI contexts must not emit startup errors'
    );
  } finally {
    console.error = originalError;
  }
});

test('language-neutral token selects options in unrelated writing systems', () => {
  const labels = [
    'حفظ [SQ:recommended]',
    '保存 [SQ:recommended]',
    '保存する [SQ:recommended]',
    'सहेजें [SQ:recommended]',
    'Сохранить [SQ:recommended]',
    'Guardar [SQ:recommended]',
    'Enregistrer [SQ:recommended]',
    '저장 [SQ:recommended]',
    'Kaydet [SQ:recommended]',
    'Simpan [SQ:recommended]',
  ];
  for (const label of labels) {
    const result = detectRecommendations([
      { question: 'Localized question', options: [{ label: 'Other' }, { label }] },
    ]);
    assert.equal(result.ok, true, label);
    assert.deepEqual(result.answers, [[label]]);
    assert.equal(result.matchedMarker, '[SQ:recommended]');
  }
});

test('detector accepts configured Unicode markers and NFC-equivalent suffixes', () => {
  const custom = '(Sélectionné)';
  const decomposedLabel = 'Écrire (Se\u0301lectionne\u0301)  ';
  const result = detectRecommendations(
    [{ question: 'Choix', options: [{ label: 'Autre' }, { label: decomposedLabel }] }],
    [custom],
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.answers, [[decomposedLabel]]);
});

test('v2 form refuses duplicate recommended labels with different values', () => {
  const result = detectV2FormRecommendations({
    id: 'duplicate-labels',
    sessionID: 'session',
    fields: [{
      key: 'choice',
      type: 'multiselect',
      options: [
        { value: 'first', label: '保存 [SQ:recommended]' },
        { value: 'second', label: '保存 [SQ:recommended]' },
      ],
    }],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Could not map recommended labels to values/);
});

test('v2 form refuses duplicate field keys', () => {
  const result = detectV2FormRecommendations({
    id: 'duplicate-keys',
    sessionID: 'session',
    fields: [
      { key: 'answer', type: 'string', options: [{ value: 'a', label: 'A [SQ:recommended]' }] },
      { key: 'answer', type: 'string', options: [{ value: 'b', label: 'B [SQ:recommended]' }] },
    ],
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /duplicate key/);
});

test('v2 cancellation while form.sync is awaiting prevents a stale reply', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-sync-cancel-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 15);
    const cleanup = await ui.setup(mock.context);
    mock.context.data.session.form.sync = async () => {
      mock.emitSettled('form.cancelled', 'sync-cancel');
    };
    mock.emitCreated({
      id: 'sync-cancel',
      sessionID: 'ses-v2-ui',
      fields: [{ key: 'choice', type: 'string', options: [
        { value: 'yes', label: 'نعم [SQ:recommended]' },
        { value: 'no', label: 'لا' },
      ] }],
    });
    await new Promise((resolve) => setTimeout(resolve, 65));
    assert.equal(mock.replies.length, 0);
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('v2 unsupported new form cancels older auto-reply in same session', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-replace-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 35);
    const cleanup = await ui.setup(mock.context);
    mock.emitCreated({
      id: 'earlier-form',
      sessionID: 'ses-v2-ui',
      fields: [{ key: 'choice', type: 'string', options: [
        { value: 'yes', label: 'Yes [SQ:recommended]' },
      ] }],
    });
    mock.emitCreated({
      id: 'manual-form',
      sessionID: 'ses-v2-ui',
      fields: [{ key: 'notes', type: 'string' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 65));
    assert.equal(mock.replies.length, 0);
    cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('v2 reply failure is reported and leaves the user to answer manually', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-reply-fail-'));
  const originalError = console.error;
  const reported = [];
  console.error = (...args) => reported.push(args.join(' '));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 15);
    const cleanup = await ui.setup(mock.context);
    mock.context.data.session.form.reply = async () => {
      throw new Error('simulated transport failure');
    };
    mock.emitCreated({
      id: 'reply-failure',
      sessionID: 'ses-v2-ui',
      fields: [{ key: 'choice', type: 'string', options: [
        { value: 'yes', label: 'Sí [SQ:recommended]' },
      ] }],
    });
    await new Promise((resolve) => setTimeout(resolve, 65));
    assert.equal(mock.replies.length, 0);
    assert.ok(reported.some((message) => message.includes('Auto-selection failed')));
    cleanup?.();
  } finally {
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('localized UI labels are configurable independently of recommendation markers', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-ui-locale-'));
  try {
    fs.writeFileSync(path.join(tempDir, 'smart-question.json'), JSON.stringify({
      enabled: true,
      uiText: {
        recommendation: '建议：',
        disabled: '自动选择已禁用',
        autoReplyFailed: '请手动回答。',
        agent: '代理：',
        session: '会话：',
      },
    }));
    const cfg = loadConfig(tempDir);
    assert.equal(cfg.uiText.recommendation, '建议：');
    assert.equal(cfg.uiText.disabled, '自动选择已禁用');
    assert.equal(cfg.uiText.autoReplyFailed, '请手动回答。');
    assert.equal(cfg.uiText.agent, '代理：');
    assert.equal(cfg.uiText.session, '会话：');
    assert.deepEqual(cfg.recommendedMarkers, ['[SQ:recommended]', '(Recommended)', '(Önerilen)']);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('v2 cache refresh failure after successful reply does not report failed selection', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-invalidate-'));
  const originalError = console.error;
  const reported = [];
  console.error = (...args) => reported.push(args.join(' '));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 15);
    const cleanup = await ui.setup(mock.context);
    mock.context.data.session.form.invalidate = () => {
      throw new Error('cache update failed after successful reply');
    };
    mock.emitCreated({
      id: 'invalidate-failure',
      sessionID: 'ses-v2-ui',
      fields: [{ key: 'choice', type: 'string', options: [
        { value: 'yes', label: '保存 [SQ:recommended]' },
      ] }],
    });
    await new Promise((resolve) => setTimeout(resolve, 65));
    assert.equal(mock.replies.length, 1);
    assert.deepEqual(reported, []);
    cleanup?.();
  } finally {
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('explicitly malformed auto-selection settings fail closed instead of using defaults', async () => {
  const { normalizeSmartQuestionConfig, DEFAULT_UI_TEXT } = await import('../dist/config.js');
  const invalid = [
    { enabled: 'true' },
    { timeoutMs: -1 },
    { timeoutMs: '0' },
    { timeoutMs: Number.POSITIVE_INFINITY },
    { recommendedMarkers: [] },
    { recommendedMarkers: [null, '[SQ:recommended]'] },
    { recommendedMarker: 123 },
    { requireExactlyOneRecommendation: 'false' },
    { uiText: { disabled: 12 } },
    { uiText: [] },
    { debugLog: false },
    { configDir: false },
  ];
  for (const input of invalid) {
    assert.equal(normalizeSmartQuestionConfig(input), null, JSON.stringify(input));
  }
  const valid = normalizeSmartQuestionConfig({
    timeoutMs: 0,
    uiText: { recommendation: 'Рекомендация:' },
  });
  assert.equal(valid?.timeoutMs, 0);
  assert.equal(valid?.uiText.recommendation, 'Рекомендация:');
  assert.equal(valid?.uiText.disabled, DEFAULT_UI_TEXT.disabled);
});

test('invalid configuration file disables the plugin rather than enabling default auto-replies', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-invalid-config-'));
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  try {
    fs.writeFileSync(path.join(tempDir, 'smart-question.json'), JSON.stringify({
      enabled: true,
      timeoutMs: 'incorrect',
    }));
    assert.equal(loadConfig(tempDir), null);
    assert.ok(logs.some((message) => message.includes('auto-selection disabled')));
  } finally {
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V1 TUI ignores unrelated settlement and preserves a manual-answer lock on replacement', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-ui-races-'));
  t.mock.method(os, 'homedir', () => tempDir);
  const events = new Map();
  const input = new Map();
  let dispose;
  try {
    const ui = await import('../dist/ui.js');
    await ui.tui({
      state: { path: { directory: tempDir } },
      event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
      renderer: {
        keyInput: {
          on(type, handler) { input.set(type, handler); },
          off(type) { input.delete(type); },
        },
        requestRender() {},
      },
      slots: { register() {} },
      lifecycle: { onDispose(handler) { dispose = handler; } },
    });
    const send = (id) => events.get('question.asked')({
      properties: { id, sessionID: 'same-session', questions: [{
        question: 'Select', options: [
          { label: 'Yes [SQ:recommended]' },
          { label: 'No' },
        ],
      }] },
    });
    send('first-question');
    input.get('keypress')?.({ name: 'a' });
    const { resolveLockPath: lock } = await import('../dist/draft-guard.js');
    const oldLock = lock(path.join(tempDir, '.opencode'), 'first-question');
    assert.equal(fs.existsSync(oldLock), true);

    send('second-question');
    assert.equal(fs.existsSync(oldLock), true, 'a new question must not erase an earlier manual lock');
    events.get('question.replied')?.({ properties: { id: 'unrelated-question' } });
    input.get('keypress')?.({ name: 'b' });
    const newLock = lock(path.join(tempDir, '.opencode'), 'second-question');
    assert.equal(fs.existsSync(newLock), true, 'unrelated settlement must not clear active question');
    dispose?.();
    assert.equal(
      fs.existsSync(newLock),
      true,
      'TUI disposal must preserve a manual-control lock until the backend observes it'
    );
  } finally {
    dispose?.();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('explicit malformed v2 backend and TUI config objects disable auto-selection', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-config-'));
  try {
    const backend = await OpencodeSmartQuestions.setup({
      location: { directory: tempDir },
      options: { config: null },
      tool: { transform() { assert.fail('invalid config must not transform tools'); } },
      session: { hook() { assert.fail('invalid config must not register context'); } },
    });
    assert.equal(backend, undefined);

    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 10);
    mock.context.options = { config: { timeoutMs: 'invalid' } };
    const cleanup = await ui.setup(mock.context);
    assert.equal(cleanup, undefined);
    assert.equal(mock.eventHandlerCount, 0);
    assert.equal(mock.keyHandlerCount, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native V1 reply transport error result is not reported as successful', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-transport-error-'));
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args.join(' '));
  let dispose;
  let replyAttempts = 0;
  try {
    const hooks = await SmartQuestion({
      client: { question: { reply: async () => {
        replyAttempts++;
        return { error: 'transport rejected' };
      } } },
      directory: tempDir,
    }, { config: {
      enabled: true, timeoutMs: 10,
      recommendedMarkers: ['[SQ:recommended]'],
    } });
    dispose = hooks.dispose;
    await hooks.event({ event: {
      type: 'question.asked',
      data: { id: 'native-error', questions: [
        { question: 'Choice', options: [{ label: 'Yes [SQ:recommended]' }] },
      ] },
    } });
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(replyAttempts, 1);
    assert.ok(logs.some((message) => message.includes('Auto-selection failed')));
    assert.ok(logs.every((message) => !message.includes('transport rejected')));
  } finally {
    await dispose?.();
    console.error = originalError;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V1 auto-selection fails safe when draft coordination is not writable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-coordination-'));
  const coordDir = path.join(root, 'coord');
  fs.mkdirSync(coordDir);
  fs.writeFileSync(path.join(root, 'smart-question.json'), JSON.stringify({
    enabled: true,
    timeoutMs: 20,
    configDir: coordDir,
  }));

  const replies = [];
  const events = new Map();
  const input = new Map();
  let disposeTui;
  let hooks;
  try {
    hooks = await SmartQuestion(
      { directory: root, client: { question: { reply: async (payload) => { replies.push(payload); } } } },
      { config: { enabled: true, timeoutMs: 20, configDir: coordDir } }
    );

    const ui = await import('../dist/ui.js');
    await ui.tui({
      state: { path: { directory: root } },
      event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
      renderer: {
        keyInput: {
          on(type, handler) { input.set(type, handler); },
          off(type) { input.delete(type); },
        },
        requestRender() {},
      },
      slots: { register() {} },
      lifecycle: { onDispose(handler) { disposeTui = handler; } },
    });

    fs.chmodSync(coordDir, 0o555);
    const data = {
      id: 'coordination-unwritable',
      sessionID: 'ses-v1-coordination',
      questions: [{
        question: 'Choose',
        options: [{ label: 'Go [SQ:recommended]' }, { label: 'Stop' }],
      }],
    };

    await hooks.event({ event: { type: 'question.asked', properties: data } });
    events.get('question.asked')?.({ properties: data });
    input.get('keypress')?.({ name: 'a' });
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(
      replies.length,
      0,
      'auto-selection must stay disabled when manual-control coordination cannot be written'
    );
  } finally {
    fs.chmodSync(coordDir, 0o755);
    disposeTui?.();
    await hooks?.dispose?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V2 TUI follows the live form location instead of a setup-time location snapshot', async () => {
  const ui = await import('../dist/ui.js');
  let currentLocation = { directory: '/tmp/sq-location-a' };
  const eventHandlers = new Map();
  const pendingForms = new Map();
  const replies = [];
  const keyHandlers = new Map();

  const context = {
    options: { config: { enabled: true, timeoutMs: 15, recommendedMarkers: ['[SQ:recommended]'] } },
    get location() { return currentLocation; },
    data: {
      on(type, handler) { eventHandlers.set(type, handler); return () => eventHandlers.delete(type); },
      session: {
        form: {
          async sync() {},
          list(sessionID) {
            return [...pendingForms.values()].filter((form) => form.sessionID === sessionID);
          },
          async reply(input) {
            replies.push(input);
            pendingForms.delete(input.formID);
          },
          async cancel() {},
          invalidate() {},
        },
      },
    },
    renderer: {
      keyInput: {
        on(type, handler) { keyHandlers.set(type, handler); },
        off(type) { keyHandlers.delete(type); },
      },
    },
    ui: {
      router: { current() { return { type: 'session', sessionID: 'ses-location-b' }; } },
      slot() { return () => {}; },
    },
  };

  const cleanup = await ui.setup(context);
  try {
    currentLocation = { directory: '/tmp/sq-location-b' };
    const form = {
      id: 'form-location-b',
      sessionID: 'ses-location-b',
      fields: [{
        key: 'choice',
        type: 'string',
        options: [
          { value: 'yes', label: 'Yes [SQ:recommended]' },
          { value: 'no', label: 'No' },
        ],
      }],
    };
    pendingForms.set(form.id, form);
    eventHandlers.get('form.created')?.({
      type: 'form.created',
      location: { directory: '/tmp/sq-location-b' },
      data: { form },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(replies.length, 1, 'a form in the current live location must not be dropped');
  } finally {
    cleanup?.();
  }
});

test('diagnostic logging does not expose option labels or raw transport errors', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-diagnostic-redaction-'));
  const debugLog = path.join(root, 'debug.log');
  const originalError = console.error;
  const consoleMessages = [];
  console.error = (...args) => consoleMessages.push(args.join(' '));
  let hooks;
  try {
    hooks = await SmartQuestion(
      {
        directory: root,
        client: {
          question: {
            reply: async () => {
              throw new Error('SECRET_TRANSPORT_DETAIL');
            },
          },
        },
      },
      {
        config: {
          enabled: true,
          timeoutMs: 10,
          debugLog,
          configDir: root,
          recommendedMarkers: ['[SQ:recommended]'],
        },
      }
    );

    await hooks.event({ event: {
      type: 'question.asked',
      data: {
        id: 'diagnostic-redaction',
        questions: [{
          question: 'private',
          options: [
            { label: 'CONFIDENTIAL_OPTION [SQ:recommended]' },
            { label: 'Other' },
          ],
        }],
      },
    } });

    await new Promise((resolve) => setTimeout(resolve, 40));
    const log = fs.readFileSync(debugLog, 'utf8');
    const consoleText = consoleMessages.join('\n');
    assert.doesNotMatch(log, /CONFIDENTIAL_OPTION/);
    assert.doesNotMatch(log, /SECRET_TRANSPORT_DETAIL/);
    assert.doesNotMatch(consoleText, /SECRET_TRANSPORT_DETAIL/);
  } finally {
    await hooks?.dispose?.();
    console.error = originalError;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('adaptive TUI loader does not hide host-runtime module failures behind standalone fallback', () => {
  const loader = fs.readFileSync(path.resolve(__dirname, '../dist/tui.js'), 'utf8');
  const probe = loader.match(/try\s*\{([\s\S]*?)\}\s*catch\s*\{/);
  assert.ok(probe, 'loader must probe host runtime availability');
  assert.doesNotMatch(
    probe[1],
    /tui-runtime\.js/,
    'the host-runtime implementation import must execute outside the availability-probe catch'
  );
  assert.match(loader, /tui-runtime\.js/);
  assert.match(loader, /ui\.js/);
});

test('normalizeSmartQuestionConfig rejects timeout values above the runtime-safe timer limit', async () => {
  const { normalizeSmartQuestionConfig } = await import('../dist/config.js');
  assert.equal(
    normalizeSmartQuestionConfig({ enabled: true, timeoutMs: 2_147_483_648 }),
    null,
    'timer overflow must fail closed instead of scheduling an almost-immediate reply'
  );
  assert.equal(
    normalizeSmartQuestionConfig({ enabled: true, timeoutMs: 2_147_483_647 })?.timeoutMs,
    2_147_483_647
  );
});

test('V2 form adapter refuses hidden and conditional selectable fields', () => {
  const hidden = detectV2FormRecommendations({
    id: 'hidden-form',
    sessionID: 'session',
    fields: [{
      key: 'choice',
      type: 'string',
      hidden: true,
      options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }],
    }],
  });
  assert.equal(hidden.ok, false);
  assert.match(hidden.reason, /hidden|conditional/i);

  const conditional = detectV2FormRecommendations({
    id: 'conditional-form',
    sessionID: 'session',
    fields: [{
      key: 'choice',
      type: 'string',
      when: [{ key: 'mode', op: 'eq', value: 'advanced' }],
      options: [{ value: 'yes', label: 'Yes [SQ:recommended]' }],
    }],
  });
  assert.equal(conditional.ok, false);
  assert.match(conditional.reason, /hidden|conditional/i);
});

test('V2 form adapter enforces multiselect minItems and maxItems before auto-reply', () => {
  const tooFew = detectV2FormRecommendations({
    id: 'min-items-form',
    sessionID: 'session',
    fields: [{
      key: 'features',
      type: 'multiselect',
      minItems: 2,
      options: [
        { value: 'a', label: 'A [SQ:recommended]' },
        { value: 'b', label: 'B' },
      ],
    }],
  });
  assert.equal(tooFew.ok, false);
  assert.match(tooFew.reason, /minItems|minimum/i);

  const tooMany = detectV2FormRecommendations({
    id: 'max-items-form',
    sessionID: 'session',
    fields: [{
      key: 'features',
      type: 'multiselect',
      maxItems: 1,
      options: [
        { value: 'a', label: 'A [SQ:recommended]' },
        { value: 'b', label: 'B [SQ:recommended]' },
      ],
    }],
  });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.reason, /maxItems|maximum/i);
});

test('V1 server honors direct tuple plugin options instead of falling back to disabled file config', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-inline-server-'));
  fs.writeFileSync(path.join(root, 'smart-question.json'), JSON.stringify({ enabled: false }));
  const replies = [];
  let hooks;
  try {
    hooks = await SmartQuestion(
      { directory: root, client: { question: { reply: async (payload) => { replies.push(payload); } } } },
      {
        enabled: true,
        timeoutMs: 10,
        recommendedMarkers: ['<REC>'],
        configDir: path.join(root, '.opencode'),
      }
    );
    assert.equal(typeof hooks.event, 'function', 'direct tuple options must enable the V1 server adapter');
    await hooks.event({ event: {
      type: 'question.asked',
      data: {
        id: 'inline-server',
        questions: [{
          question: 'Choose',
          options: [{ label: 'Go <REC>' }, { label: 'Stop' }],
        }],
      },
    } });
    await new Promise((resolve) => setTimeout(resolve, 35));
    assert.equal(replies.length, 1);
  } finally {
    await hooks?.dispose?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('V1 TUI honors tuple plugin options and uses the same marker/config as the server', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-inline-tui-'));
  fs.writeFileSync(path.join(root, 'smart-question.json'), JSON.stringify({ enabled: false }));
  const events = new Map();
  const input = new Map();
  let dispose;
  try {
    const ui = await import('../dist/ui.js');
    await ui.tui(
      {
        state: { path: { directory: root } },
        event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
        renderer: {
          keyInput: {
            on(type, handler) { input.set(type, handler); },
            off(type) { input.delete(type); },
          },
          requestRender() {},
        },
        slots: { register() {} },
        lifecycle: { onDispose(handler) { dispose = handler; } },
      },
      {
        enabled: true,
        timeoutMs: 100,
        recommendedMarkers: ['<REC>'],
        configDir: path.join(root, '.opencode'),
      },
      {}
    );

    assert.equal(typeof events.get('question.asked'), 'function', 'tuple options must enable the V1 TUI adapter');
    events.get('question.asked')({
      properties: {
        id: 'inline-tui',
        sessionID: 'session',
        questions: [{
          question: 'Choose',
          options: [{ label: 'Go <REC>' }, { label: 'Stop' }],
        }],
      },
    });
    input.get('keypress')?.({ name: 'a' });
    assert.equal(
      fs.existsSync(resolveLockPath(path.join(root, '.opencode'), 'inline-tui')),
      true,
      'TUI must detect the same configured marker and protect manual input'
    );
  } finally {
    dispose?.();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recommendedMarkers list fully takes precedence over legacy recommendedMarker', async () => {
  const { normalizeSmartQuestionConfig } = await import('../dist/config.js');
  const config = normalizeSmartQuestionConfig({
    enabled: true,
    recommendedMarkers: ['<PRIMARY>', '<SECONDARY>'],
    recommendedMarker: '<LEGACY>',
  });
  assert.ok(config);
  assert.deepEqual(config.recommendedMarkers, ['<PRIMARY>', '<SECONDARY>']);
  assert.equal(config.recommendedMarker, '<PRIMARY>');
});

test('V2 backend disposal completes registrations strictly in reverse order', async () => {
  const order = [];
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-disposal-order' },
    options: { enabled: true },
    tool: {
      transform() {
        return Promise.resolve({
          async dispose() {
            order.push('tool:start');
            await new Promise((resolve) => setTimeout(resolve, 1));
            order.push('tool:end');
          },
        });
      },
    },
    session: {
      hook() {
        return Promise.resolve({
          async dispose() {
            order.push('context:start');
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push('context:end');
          },
        });
      },
    },
  });

  await cleanup?.();
  assert.deepEqual(order, [
    'context:start',
    'context:end',
    'tool:start',
    'tool:end',
  ]);
});

test('V2 TUI rolls back partial event registrations when setup fails', async () => {
  const ui = await import('../dist/ui.js');
  const stopped = [];
  let registrationCount = 0;
  const context = {
    options: { config: { enabled: true, timeoutMs: 10 } },
    location: { directory: '/tmp/sq-v2-partial-tui' },
    data: {
      on(type) {
        registrationCount++;
        if (registrationCount === 2) throw new Error('synthetic registration failure');
        return () => stopped.push(type);
      },
      session: { form: {
        async sync() {},
        list() { return []; },
        async reply() {},
        async cancel() {},
        invalidate() {},
      } },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current() { return { type: 'home' }; } },
      slot() { return () => {}; },
    },
  };

  await assert.rejects(() => ui.setup(context), /synthetic registration failure/);
  assert.deepEqual(stopped, ['form.created']);
});

test('V2 TUI cleanup continues after an individual disposer fails', async () => {
  const ui = await import('../dist/ui.js');
  const cleanupEvents = [];
  const keyHandlers = new Map();
  let slotStopped = false;
  const context = {
    options: { config: { enabled: true, timeoutMs: 10 } },
    location: { directory: '/tmp/sq-v2-cleanup-failure' },
    data: {
      on(type) {
        return () => {
          cleanupEvents.push(type);
          if (type === 'form.replied') throw new Error('synthetic disposer failure');
        };
      },
      session: { form: {
        async sync() {},
        list() { return []; },
        async reply() {},
        async cancel() {},
        invalidate() {},
      } },
    },
    renderer: {
      keyInput: {
        on(type, handler) { keyHandlers.set(type, handler); },
        off(type) { cleanupEvents.push('key:' + type); keyHandlers.delete(type); },
      },
    },
    ui: {
      router: { current() { return { type: 'home' }; } },
      slot() { return () => { slotStopped = true; cleanupEvents.push('slot'); }; },
    },
  };

  const cleanup = await ui.setup(context);
  assert.equal(typeof cleanup, 'function');
  assert.doesNotThrow(() => cleanup?.());
  assert.equal(slotStopped, true);
  assert.equal(keyHandlers.size, 0);
  assert.ok(cleanupEvents.includes('form.created'));
  assert.ok(cleanupEvents.includes('form.replied'));
  assert.ok(cleanupEvents.includes('form.cancelled'));
  assert.ok(cleanupEvents.includes('key:keypress'));
  assert.ok(cleanupEvents.includes('key:paste'));
});

test('diagnostic error classification never echoes arbitrary error code or name values', async () => {
  const { diagnosticErrorCode } = await import('../dist/diagnostics.js');
  const hostile = new Error('SECRET_MESSAGE_VALUE');
  hostile.code = 'SECRET_CODE_VALUE';
  hostile.name = 'SECRET_NAME_VALUE';
  const code = diagnosticErrorCode(hostile);
  assert.doesNotMatch(code, /SECRET/);
  assert.match(code, /^(error|object-error|unknown-error)$/);
});

test('V1 TUI rolls back raw key handlers when setup fails partway', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-partial-tui-'));
  const events = new Map();
  const inputs = new Map();
  try {
    const ui = await import('../dist/ui.js');
    await assert.rejects(
      () => ui.tui({
        state: { path: { directory: root } },
        event: {
          on(type, handler) {
            events.set(type, handler);
            return () => events.delete(type);
          },
        },
        renderer: {
          keyInput: {
            on(type, handler) {
              if (type === 'paste') throw new Error('synthetic paste registration failure');
              inputs.set(type, handler);
            },
            off(type) {
              inputs.delete(type);
            },
          },
          requestRender() {},
        },
        slots: { register() { return 'slot'; } },
        keymap: { intercept() { return () => {}; } },
        lifecycle: { onDispose() { return () => {}; } },
      }),
      /synthetic paste registration failure/
    );
    assert.equal(inputs.size, 0, 'failed setup must not leave raw key handlers registered');
    assert.equal(events.size, 0, 'failed setup must release event subscriptions');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});


test('guidance avoids unnecessary questions when user direction is already sufficient', async () => {
  const hooks = await SmartQuestion({ client: {} }, {
    config: { enabled: true, recommendedMarkers: ['[SQ:recommended]'] },
  });
  try {
    const questionOutput = { description: 'Ask the user a question with choices', jsonSchema: {} };
    await hooks['tool.definition']({ toolID: 'question' }, questionOutput);
    const systemOutput = { system: ['Base system prompt'] };
    await hooks['experimental.chat.system.transform'](
      { sessionID: 'ses-guidance-necessity' },
      systemOutput
    );

    assert.match(questionOutput.description, /existing instructions.*determine|already .*direction/i);
    assert.match(questionOutput.description, /do not .*question|do not create.*form/i);
    assert.match(systemOutput.system[1], /existing instructions.*determine|already .*direction/i);
    assert.match(systemOutput.system[1], /do not .*question|do not create.*form/i);
  } finally {
    await hooks.dispose();
  }
});

test('V1 dedup ignores generic headings and keys only on the SQ sentinel', async () => {
  const hooks = await SmartQuestion({ client: {} }, {
    config: { enabled: true, recommendedMarkers: ['[SQ:recommended]'] },
  });
  try {
    const questionOutput = {
      description: 'Third-party note mentions [RECOMMENDED OPTION CONVENTION] only.',
      jsonSchema: {},
    };
    await hooks['tool.definition']({ toolID: 'question' }, questionOutput);
    assert.match(questionOutput.description, /\[SQ_GUIDANCE:v1\]/);
    assert.match(questionOutput.description, /native question tool/i);

    const systemOutput = {
      system: ['Third-party note: Smart Question Auto-Selection Guidance'],
    };
    await hooks['experimental.chat.system.transform'](
      { sessionID: 'ses-v1-sentinel' },
      systemOutput
    );
    assert.equal(systemOutput.system.length, 2);
    assert.match(systemOutput.system[1], /\[SQ_GUIDANCE:v1\]/);

    await hooks['experimental.chat.system.transform'](
      { sessionID: 'ses-v1-sentinel' },
      systemOutput
    );
    assert.equal(
      systemOutput.system.filter((part) => part.includes('[SQ_GUIDANCE:v1]')).length,
      1
    );
  } finally {
    await hooks.dispose();
  }
});

test('V2 dedup ignores generic headings and keys only on the SQ sentinel', async () => {
  let toolTransform;
  let contextHook;
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-sentinel' },
    options: { enabled: true, recommendedMarkers: ['[SQ:recommended]'] },
    tool: {
      transform(callback) {
        toolTransform = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    session: {
      hook(name, callback) {
        assert.equal(name, 'context');
        contextHook = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  });

  try {
    const questionTool = {
      description: 'Third-party note mentions [RECOMMENDED OPTION CONVENTION] only.',
    };
    toolTransform({
      update(id, mutate) {
        assert.equal(id, 'question');
        mutate(questionTool);
      },
    });
    assert.match(questionTool.description, /\[SQ_GUIDANCE:v1\]/);

    const event = {
      system: [{ type: 'text', text: 'Third-party note: Smart Question Auto-Selection Guidance' }],
      messages: [],
      tools: [],
    };
    await contextHook(event);
    assert.equal(event.system.length, 2);
    assert.match(event.system[1].text, /\[SQ_GUIDANCE:v1\]/);

    await contextHook(event);
    assert.equal(
      event.system.filter(
        (part) => typeof part.text === 'string' && part.text.includes('[SQ_GUIDANCE:v1]')
      ).length,
      1
    );
  } finally {
    await cleanup?.();
  }
});
