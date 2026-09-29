import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
let esbuild;
try {
  esbuild = (await import('esbuild')).default;
} catch {
  try {
    esbuild = (await import('/opt/nc-workspace/develop/repo/node_modules/esbuild/lib/main.js')).default;
  } catch {
    // optional
  }
}

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
  assert.equal(config.recommendedMarker, '(Recommended)');
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
      7,
      `Expected exactly 7 exported functions from smart-question-ui.tsx, found: ${exportedFunctions.join(', ')}`
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
    assert.deepEqual(cfg.recommendedMarkers, ['(Recommended)', '(Önerilen)']);
    assert.equal(cfg.recommendedMarker, '(Recommended)');
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
