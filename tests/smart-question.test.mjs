import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const esbuild = (await import('esbuild')).default;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import {
  detectRecommendations,
  loadConfig,
  resolveLockPath,
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

test('backend plugin - default export is a pure OpenCode V2 plugin definition', async () => {
  const backendMod = await import('../dist/index.js');
  assert.equal(typeof backendMod.default, 'object');
  assert.equal(backendMod.default.id, 'opencode-smart-questions');
  assert.equal(typeof backendMod.default.setup, 'function');
  assert.equal('server' in backendMod.default, false);
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

  const exportBlockMatch = transpiledUiJs.match(/export\s*\{([\s\S]*?)\};/);
  assert.ok(
    exportBlockMatch,
    'Transpiled src/ui.tsx must contain an export block'
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

  for (const expectedName of [
    'loadConfig',
    'detectRecommendations',
    'SmartQuestionOverlay',
    'setup',
    'resolveAgentName',
    'stripMarker',
    'formatCountdown',
  ]) {
    assert.ok(
      exportedFunctions.includes(expectedName),
      `TUI module must export function '${expectedName}'`
    );
  }
  assert.equal(
    exportedFunctions.length,
    7,
    `Expected exactly 7 exported functions from src/ui.tsx, found: ${exportedFunctions.join(', ')}`
  );

  const tuiMod = await import('../dist/tui.js');
  assert.equal(tuiMod.default?.id, 'opencode-smart-questions.tui');
  assert.equal(typeof tuiMod.default?.setup, 'function');

  const runtimeCode = fs.readFileSync(path.resolve(__dirname, '../dist/tui-runtime.js'), 'utf8');
  assert.ok(
    runtimeCode.includes('opentui:runtime-module:%40opencode%2Fplugin%2Ftui'),
    'dist/tui-runtime.js must rewrite @opencode/plugin/tui to host virtual runtime module'
  );
  assert.equal(
    runtimeCode.includes('@opencode-ai/'),
    false,
    'dist/tui-runtime.js must not reference @opencode-ai/*'
  );
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

test('OpenCode v2 backend setup registers root-only context guidance', async () => {
  let contextHook;
  let toolTransformCalls = 0;
  const disposed = [];

  const context = {
    location: { directory: '/tmp/sq-v2-backend' },
    options: {
      enabled: true,
      recommendedMarkers: ['(Recommended)'],
      timeoutMs: 10,
    },
    tool: {
      transform() {
        toolTransformCalls++;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
    session: {
      async get({ sessionID }) {
        return { id: sessionID };
      },
      hook(name, callback) {
        if (name === 'context') contextHook = callback;
        return Promise.resolve({ dispose: async () => { disposed.push(name); } });
      },
    },
  };

  const cleanup = await OpencodeSmartQuestions.setup(context);
  assert.equal(typeof cleanup, 'function');
  assert.equal(toolTransformCalls, 0);

  const event = {
    sessionID: 'ses-v2-root',
    system: [{ type: 'text', text: 'Base system prompt' }],
    messages: [],
    tools: {},
    agent: 'main',
    model: {},
  };
  await contextHook(event);
  assert.equal(event.system.length, 2);
  assert.match(event.system[1].text, /Smart Question Auto-Selection Guidance/);
  assert.match(event.system[1].text, /native question\/form mechanism/i);
  assert.match(event.system[1].text, /plain assistant (?:text|prose)/i);

  await contextHook(event);
  assert.equal(event.system.length, 2, 'guidance must not duplicate');
  await cleanup();
  assert.deepEqual(disposed, ['prompt', 'context']);
  await cleanup();
  assert.deepEqual(disposed, ['prompt', 'context'], 'cleanup must be idempotent');
});

test('V2 backend surfaces a failed context registration', async () => {
  await assert.rejects(
    OpencodeSmartQuestions.setup({
      location: { directory: '/tmp/sq-v2-registration-tests' },
      options: { enabled: true },
      session: {
        async get({ sessionID }) {
          return { id: sessionID };
        },
        hook() {
          return Promise.reject(new Error('context hook unavailable'));
        },
      },
    }),
    /V2 backend registration failed/
  );
});

test('V2 backend does not require the global tool transform capability', async () => {
  let hookCalled = false;
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-registration-tests' },
    options: { enabled: true },
    session: {
      async get({ sessionID }) {
        return { id: sessionID };
      },
      hook() {
        hookCalled = true;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  });
  assert.equal(hookCalled, true);
  await cleanup?.();
});

test('V2 backend rejects an invalid context registration', async () => {
  await assert.rejects(
    OpencodeSmartQuestions.setup({
      location: { directory: '/tmp/sq-v2-registration-tests' },
      options: { enabled: true },
      session: {
        async get({ sessionID }) {
          return { id: sessionID };
        },
        hook() {
          return Promise.resolve(undefined);
        },
      },
    }),
    /V2 backend registration failed/
  );
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
        get(sessionID) {
          return { id: sessionID, location: { directory: tempDir } };
        },
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

test('V2 TUI structured synthetic rejection remains retryable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-v2-structured-retry-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 20);
    let attempts = 0;
    mock.context.client = {
      session: {
        async synthetic() {
          attempts++;
          return attempts === 1 ? { error: { code: 'REJECTED' } } : { ok: true };
        },
      },
    };
    const cleanup = await ui.setup(mock.context);
    try {
      const form = {
        id: 'form-v2-structured-rejection',
        sessionID: 'ses-v2-ui',
        fields: [{ key: 'choice', type: 'string',
          options: [{ value: 'a', label: 'Option A' }, { value: 'b', label: 'Option B' }] }],
      };
      mock.emitCreated(form);
      await new Promise((resolve) => setTimeout(resolve, 10));
      mock.emitCreated(form);
      await new Promise((resolve) => setTimeout(resolve, 10));
      assert.equal(attempts, 2);
    } finally {
      await cleanup?.();
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('V2 TUI unclassified remediation send failure remains retryable', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-test-v2-remediation-retry-'));
  try {
    const ui = await import('../dist/ui.js');
    const mock = createV2TuiMock(tempDir, 20);
    let attempts = 0;
    mock.context.client = {
      session: {
        async synthetic() {
          attempts++;
          if (attempts === 1) throw new Error('synthetic transport failure');
          return {};
        },
      },
    };

    const cleanup = await ui.setup(mock.context);
    const form = {
      id: 'form-v2-unclassified-retry',
      sessionID: 'ses-v2-ui',
      fields: [{
        key: 'choice',
        type: 'string',
        options: [
          { value: 'a', label: 'Option A' },
          { value: 'b', label: 'Option B' },
        ],
      }],
    };

    mock.emitCreated(form);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mock.emitCreated(form);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(
      attempts,
      2,
      'A failed V2 remediation send must remain retryable instead of being suppressed as already remediated'
    );
    await cleanup?.();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

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
        get(sessionID) {
          return { id: sessionID, location: currentLocation };
        },
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
  let dispose;
  try {
    const ui = await import('../dist/ui.js');
    const handlers = new Map();
    const form = {
      id: 'diagnostic-redaction',
      sessionID: 'ses-diag',
      fields: [{
        key: 'choice',
        type: 'string',
        options: [
          { value: 'secret', label: 'CONFIDENTIAL_OPTION [SQ:recommended]' },
          { value: 'other', label: 'Other' },
        ],
      }],
    };
    dispose = await ui.setup({
      location: { directory: root },
      options: {
        enabled: true,
        timeoutMs: 10,
        debugLog,
        configDir: root,
        recommendedMarkers: ['[SQ:recommended]'],
      },
      data: {
        on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
        session: {
          get: (id) => ({ id, location: { directory: root } }),
          form: {
            async sync() {},
            list: () => [form],
            async reply() { throw new Error('SECRET_TRANSPORT_DETAIL'); },
            invalidate() {},
          },
        },
      },
      renderer: { keyInput: { on() {}, off() {} } },
      ui: {
        router: { current: () => ({ type: 'session', sessionID: 'ses-diag' }) },
        slot: () => () => {},
      },
    });

    await handlers.get('form.created')?.({ data: { form } });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const log = fs.readFileSync(debugLog, 'utf8');
    const consoleText = consoleMessages.join('\n');
    assert.doesNotMatch(log, /CONFIDENTIAL_OPTION/);
    assert.doesNotMatch(log, /SECRET_TRANSPORT_DETAIL/);
    assert.doesNotMatch(consoleText, /SECRET_TRANSPORT_DETAIL/);
  } finally {
    dispose?.();
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

test('V2 backend disposal releases the root-only context registration', async () => {
  const order = [];
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-disposal-order' },
    options: { enabled: true },
    session: {
      async get({ sessionID }) {
        return { id: sessionID };
      },
      hook(name) {
        return Promise.resolve({
          async dispose() {
            order.push(`${name}:start`);
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push(`${name}:end`);
          },
        });
      },
    },
  });

  await cleanup?.();
  assert.deepEqual(order, [
    'prompt:start',
    'prompt:end',
    'context:start',
    'context:end',
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

test('guidance avoids unnecessary questions when user direction is already sufficient', async () => {
  let contextHook;
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-guidance-necessity' },
    options: { enabled: true, recommendedMarkers: ['[SQ:recommended]'] },
    session: {
      async get({ sessionID }) { return { id: sessionID }; },
      hook(name, callback) {
        if (name === 'context') contextHook = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  });
  try {
    const event = {
      sessionID: 'ses-guidance-necessity',
      system: [{ type: 'text', text: 'Base system prompt' }],
      messages: [],
      tools: {},
      agent: 'main',
      model: {},
    };
    await contextHook(event);

    assert.match(event.system[1].text, /existing instructions.*determine|already .*direction/i);
    assert.match(event.system[1].text, /do not .*question|do not create.*form/i);
  } finally {
    await cleanup?.();
  }
});

test('V2 dedup ignores generic headings and keys only on the SQ sentinel', async () => {
  let contextHook;
  const cleanup = await OpencodeSmartQuestions.setup({
    location: { directory: '/tmp/sq-v2-sentinel' },
    options: { enabled: true, recommendedMarkers: ['[SQ:recommended]'] },
    session: {
      async get({ sessionID }) {
        return { id: sessionID };
      },
      hook(name, callback) {
        if (name === 'context') contextHook = callback;
        return Promise.resolve({ dispose: async () => {} });
      },
    },
  });

  try {
    const event = {
      sessionID: 'ses-v2-sentinel',
      system: [{ type: 'text', text: 'Third-party note: Smart Question Auto-Selection Guidance' }],
      messages: [],
      tools: {},
      agent: 'main',
      model: {},
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

test('Section 12.F: canonical marker [SQ:recommended] works identically across multi-language option labels', () => {
  const labels = [
    'Use PostgreSQL [SQ:recommended]',
    'PostgreSQL kullan [SQ:recommended]',
    'PostgreSQL verwenden [SQ:recommended]',
    '使用 PostgreSQL [SQ:recommended]',
    'Использовать PostgreSQL [SQ:recommended]',
  ];
  for (const label of labels) {
    const questions = [
      {
        question: 'Which database should we use?',
        options: [
          { label },
          { label: 'Alternative database option' },
        ],
      },
    ];
    const result = detectRecommendations(questions);
    assert.equal(result.ok, true, `Must detect recommendation for label: ${label}`);
    assert.equal(result.matchedMarker, '[SQ:recommended]');
    assert.deepEqual(result.answers, [[label]]);
  }
});
