import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createRoot } from 'solid-js';
import {
  clearActiveHandoff,
  getActiveHandoff,
  resolveSmartQuestionConfig,
} from '../dist/index.js';
import { setup } from '../dist/ui.js';
import { formatOpenCodeHandoff } from '../dist/handoff.js';

function tempDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('1.1: resolveConfig with static fallback options applies fallback when resolver returns undefined', (t) => {
  const dir = tempDirectory(t);
  const resolved = resolveSmartQuestionConfig(dir, {
    resolveConfig: () => undefined,
    timeoutMs: 12345,
    recommendedMarkers: ['[FALLBACK]'],
  });
  assert.ok(resolved !== null, 'static fallback options should not be rejected due to resolveConfig key');
  assert.equal(resolved.timeoutMs, 12345);
  assert.deepEqual(resolved.recommendedMarkers, ['[FALLBACK]']);
});

function makeTuiHarness(t, overrides = {}) {
  const dir = overrides.dir ?? tempDirectory(t);
  const events = new Map();
  const keyListeners = new Map();
  const replies = [];
  let currentRoute = overrides.initialRoute ?? { type: 'session', sessionID: 'ses-1' };
  let registeredSlot = null;

  const formList = overrides.formList ?? (() => []);
  const sessionGet = overrides.sessionGet ?? ((id) => ({ id, location: { directory: dir } }));

  const context = {
    location: { directory: dir },
    options: overrides.options ?? { timeoutMs: 25 },
    data: {
      on(type, handler) {
        events.set(type, handler);
        return () => events.delete(type);
      },
      session: {
        get: sessionGet,
        sync: overrides.sessionSync ?? (async () => {}),
        message: overrides.messageApi ?? {
          async sync() {},
          list() { return []; },
        },
        form: {
          async sync() {},
          list: formList,
          async reply(input) {
            replies.push(input);
          },
          invalidate() {},
        },
        prompt: overrides.prompt ?? { async send() {} },
      },
    },
    renderer: {
      keyInput: {
        on(ev, fn) {
          if (!keyListeners.has(ev)) keyListeners.set(ev, new Set());
          keyListeners.get(ev).add(fn);
        },
        off(ev, fn) {
          keyListeners.get(ev)?.delete(fn);
        },
      },
    },
    ui: {
      router: {
        current() {
          return currentRoute;
        },
      },
      slot(spec) {
        registeredSlot = spec;
        return () => {};
      },
    },
  };

  return {
    dir,
    events,
    keyListeners,
    replies,
    context,
    setRoute(route) {
      currentRoute = route;
    },
    getSlot() {
      return registeredSlot;
    },
    emitKey(keyEvent) {
      for (const fn of keyListeners.get('keypress') ?? []) {
        fn(keyEvent);
      }
    },
  };
}

test('2.1: slot render uses reactive sessionID, markers, and uiText across route changes', async (t) => {
  const dir = tempDirectory(t);
  const form = {
    id: 'frm-slot-1',
    sessionID: 'ses-2',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha [CUSTOM]' }, { value: 'b', label: 'Beta' }],
    }],
  };
  const h = makeTuiHarness(t, {
    dir,
    initialRoute: { type: 'session', sessionID: 'ses-1' },
    options: {
      timeoutMs: 200,
      recommendedMarkers: ['[CUSTOM]'],
      uiText: { agent: 'CustomAgent:' },
    },
    formList: () => [form],
  });

  const dispose = await setup(h.context);
  t.after(dispose);

  // Verify the compiled slot.render uses a reactive getSessionID() accessor and getter props for markers/uiText
  const slotFnSource = h.getSlot().render.toString();
  assert.match(slotFnSource, /getSessionID/, 'slot render must use reactive getSessionID accessor');
  assert.match(slotFnSource, /markers:\s*\(\)\s*=>/, 'slot render must pass reactive markers getter');
  assert.match(slotFnSource, /uiText:\s*\(\)\s*=>/, 'slot render must pass reactive uiText getter');

  // Mount slot while on ses-1 (active() is null so Show does not invoke OpenTUI renderer)
  const rendered = createRoot((disposeSolid) => {
    t.after(disposeSolid);
    return h.getSlot().render({});
  });
  assert.ok(!(typeof rendered === 'function' ? rendered() : rendered));

  // Route switches to ses-2 and form.created arrives; state for ses-2 is populated
  h.setRoute({ type: 'session', sessionID: 'ses-2' });
  await h.events.get('form.created')({ data: { form } });
  // Triggering slot.render on ses-2 when OpenTUI renderer is absent throws "No renderer found"
  // only because <Show when={active()}> now evaluates to truthy for ses-2!
  assert.throws(() => h.getSlot().render({}), /No renderer found/);
});

test('2.2: late duplicate form.created after form.replied is ignored via settledForms tombstone', async (t) => {
  const form = {
    id: 'frm-settled-1',
    sessionID: 'ses-1',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha [SQ:recommended]' }, { value: 'b', label: 'Beta' }],
    }],
  };
  const h = makeTuiHarness(t, {
    options: { timeoutMs: 20 },
    formList: () => [form],
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  await h.events.get('form.created')({ data: { form } });
  await h.events.get('form.replied')({ data: { sessionID: 'ses-1', formID: 'frm-settled-1' } });

  // Late duplicate form.created arrives after settlement
  await h.events.get('form.created')({ data: { form } });
  await delay(50);
  assert.equal(h.replies.length, 0, 'settled form must never be re-scheduled on duplicate form.created');
});

test('2.3: TUI session.synthetic ignores child/subagent sessions when includeSubagents is false', async (t) => {
  const dir = tempDirectory(t);
  const h = makeTuiHarness(t, {
    dir,
    sessionGet: (id) => ({ id, parentID: 'ses-root', location: { directory: dir } }),
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  clearActiveHandoff('ses-child-syn');
  await h.events.get('session.synthetic')({
    data: {
      sessionID: 'ses-child-syn',
      synthetic: true,
      metadata: { 'opencode-guardian': true },
      parts: [{
        type: 'text',
        synthetic: true,
        metadata: { 'opencode-guardian': true },
        text: `[opencode-guardian remediation]\n${formatOpenCodeHandoff({
          action: 'question_required',
          kind: 'choice',
          autoSelect: 'forbidden',
          handoffId: 'h-child-1',
        })}`,
      }],
    },
  });
  assert.equal(getActiveHandoff('ses-child-syn') ?? null, null, 'child session synthetic event must not set active handoff');
});

test('2.4: draft-guard lock creation uses exclusive wx flag and refuses pre-existing symlink', async (t) => {
  const dir = tempDirectory(t);
  const opencodeDir = path.join(dir, '.opencode');
  fs.mkdirSync(opencodeDir, { recursive: true });
  const targetFile = path.join(dir, 'sensitive-target.txt');
  fs.writeFileSync(targetFile, 'ORIGINAL', 'utf8');

  const form = {
    id: 'frm-symlink-1',
    sessionID: 'ses-1',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha [SQ:manual]' }, { value: 'b', label: 'Beta' }],
    }],
  };
  const lockPath = path.join(opencodeDir, '.sq-draft-frm-symlink-1');
  fs.symlinkSync(targetFile, lockPath);

  const h = makeTuiHarness(t, {
    dir,
    options: { timeoutMs: 20 },
    formList: () => [form],
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  await h.events.get('form.created')({ data: { form } });
  await delay(50);
  assert.equal(fs.readFileSync(targetFile, 'utf8'), 'ORIGINAL', 'symlink target must not be overwritten');
});

test('2.5: keypress ignores navigation keys (pageup) and cancels in-flight form on typing key', async (t) => {
  const form = {
    id: 'frm-inflight-key',
    sessionID: 'ses-1',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha [SQ:recommended]' }, { value: 'b', label: 'Beta' }],
    }],
  };
  let releaseSync;
  const syncBlocked = new Promise((resolve) => {
    releaseSync = resolve;
  });

  const h = makeTuiHarness(t, {
    options: { timeoutMs: 20 },
    sessionSync: () => syncBlocked,
    formList: () => [form],
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  // Start form.created (stays in-flight waiting on sessionSync)
  const createdPromise = h.events.get('form.created')({ data: { form } });
  await delay(10);

  // Typing key during in-flight sync should cancel the in-flight form
  h.emitKey({ name: 'a', sequence: 'a' });
  releaseSync();
  await createdPromise;
  await delay(50);
  assert.equal(h.replies.length, 0, 'typing key during in-flight sync must cancel auto-reply');

  // Now test a second form where pageup does NOT cancel auto-reply
  const form2 = { ...form, id: 'frm-nav-key' };
  const h2 = makeTuiHarness(t, {
    options: { timeoutMs: 25 },
    formList: () => [form2],
  });
  const dispose2 = await setup(h2.context);
  t.after(dispose2);

  await h2.events.get('form.created')({ data: { form: form2 } });
  h2.emitKey({ name: 'pageup' });
  await delay(55);
  assert.equal(h2.replies.length, 1, 'non-editing navigation key like pageup must not cancel auto-reply');
});

test('3.1a: classifyQuestions with explicit custom recommendedMarkers does not match default (Recommended) fallback', async () => {
  const { classifyQuestions } = await import('../dist/detector.js');
  const result = classifyQuestions(
    [{
      id: 'q1',
      header: 'Pick',
      question: 'Pick one',
      options: [
        { label: 'Option A (Recommended)', description: '' },
        { label: 'Option B', description: '' },
      ],
    }],
    ['[CUSTOM]']
  );
  assert.equal(result.status, 'unclassified', 'explicit custom recommendedMarkers must not fall back to default (Recommended)');
});

test('3.1b: stripMarker strips case-insensitive marker variants cleanly', async () => {
  const { stripMarker } = await import('../dist/view-model.js');
  assert.equal(stripMarker('PostgreSQL (recommended)', ['(Recommended)']), 'PostgreSQL');
  assert.equal(stripMarker('[sq:recommended] PostgreSQL', ['[SQ:recommended]']), 'PostgreSQL');
});

test('3.2: registerSmartQuestionsCapability stores reference count on globalThis coordination registry', async () => {
  const { registerSmartQuestionsCapability } = await import('../dist/handoff.js');
  const sym = Symbol.for('opencode.coordination.v1');
  const d1 = registerSmartQuestionsCapability();
  const d2 = registerSmartQuestionsCapability();
  try {
    const reg = globalThis[sym];
    assert.ok(reg?.smartQuestions, 'smartQuestions capability must be registered');
    // Simulate a second bundle/module instance reading shared count on globalThis
    const countSym = Symbol.for('opencode.coordination.sq.count.v1');
    assert.equal(globalThis[countSym], 2, 'registration count must be shared on globalThis');
  } finally {
    d1();
    d2();
  }
});

test('3.4: ui.tsx reuses stripMarker and formatCountdown from view-model.ts without duplication', async () => {
  const uiSrc = fs.readFileSync(path.resolve('src/ui.tsx'), 'utf8');
  assert.match(uiSrc, /from '\.\/view-model\.js'/);
  assert.equal(/strLabel\.slice/.test(uiSrc), false, 'ui.tsx must not duplicate stripMarker logic');
  assert.equal(/Math\.floor\(clamped \/ 60\)/.test(uiSrc), false, 'ui.tsx must not duplicate formatCountdown logic');
  const uiMod = await import('../dist/ui.js');
  assert.equal(uiMod.stripMarker('PostgreSQL (recommended)', ['(Recommended)']), 'PostgreSQL');
});

test('2.1b: keypress ignores modifier shortcuts (ctrl/meta/alt) and modifier-only keys', async (t) => {
  const form = {
    id: 'frm-mod-key',
    sessionID: 'ses-1',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha [SQ:recommended]' }, { value: 'b', label: 'Beta' }],
    }],
  };
  const h = makeTuiHarness(t, {
    options: { timeoutMs: 30 },
    formList: () => [form],
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  await h.events.get('form.created')({ data: { form } });
  h.emitKey({ name: 'f', ctrl: true });
  h.emitKey({ name: 'c', meta: true });
  h.emitKey({ name: 'tab', alt: true });
  h.emitKey({ name: 'shift' });
  await delay(60);
  assert.equal(h.replies.length, 1, 'shortcut/modifier keypresses must not cancel auto-reply');
});

test('2.2b: TUI session.synthetic syncs uncached root session before eligibility check', async (t) => {
  const dir = tempDirectory(t);
  const syncedCache = new Map();
  const h = makeTuiHarness(t, {
    dir,
    sessionGet: (id) => syncedCache.get(id),
    sessionSync: async (id) => {
      syncedCache.set(id, { id, location: { directory: dir } });
    },
  });
  const dispose = await setup(h.context);
  t.after(dispose);

  clearActiveHandoff('ses-uncached-root');
  await h.events.get('session.synthetic')({
    data: {
      sessionID: 'ses-uncached-root',
      synthetic: true,
      metadata: { 'opencode-guardian': true },
      parts: [{
        type: 'text',
        synthetic: true,
        metadata: { 'opencode-guardian': true },
        text: `[opencode-guardian remediation]\n${formatOpenCodeHandoff({
          action: 'question_required',
          kind: 'choice',
          autoSelect: 'forbidden',
          handoffId: 'h-uncached-1',
        })}`,
      }],
    },
  });
  const active = getActiveHandoff('ses-uncached-root');
  assert.equal(active?.handoffId, 'h-uncached-1', 'uncached root session must be synced and receive handoff');
  clearActiveHandoff('ses-uncached-root');
});

test('2.3b: server event.subscribe resolves sessionInfo.directory and event.location.directory', async () => {
  const { default: OpencodeSmartQuestions } = await import('../dist/index.js');
  const startupDir = '/tmp/sq-23b-disabled';
  const enabledDir = '/tmp/sq-23b-enabled';

  const eventsQueue = [
    {
      type: 'session.synthetic',
      location: { directory: enabledDir },
      data: {
        sessionID: 'ses-dir-flat',
        synthetic: true,
        metadata: { 'opencode-guardian': true },
        parts: [{
          type: 'text',
          synthetic: true,
          metadata: { 'opencode-guardian': true },
          text: `[opencode-guardian remediation]\n${formatOpenCodeHandoff({
            action: 'question_required',
            kind: 'choice',
            autoSelect: 'forbidden',
            handoffId: 'h-dir-flat-1',
          })}`,
        }],
      },
    },
  ];

  clearActiveHandoff('ses-dir-flat');
  const dispose = await OpencodeSmartQuestions.setup({
    location: { directory: startupDir },
    options: {
      resolveConfig(dir) {
        if (dir === startupDir) return { enabled: false };
        if (dir === enabledDir) return { enabled: true };
        return undefined;
      },
    },
    session: {
      async get({ sessionID }) {
        // Note: flat `directory` field (no `.location`)
        return { id: sessionID, directory: enabledDir };
      },
      async hook() {
        return { async dispose() {} };
      },
    },
    event: {
      subscribe({ signal }) {
        return (async function* () {
          for (const ev of eventsQueue) {
            if (signal?.aborted) return;
            yield ev;
          }
          await new Promise((resolve) => {
            if (signal?.aborted) return resolve();
            signal?.addEventListener('abort', resolve, { once: true });
          });
        })();
      },
    },
  });

  try {
    await delay(30);
    const active = getActiveHandoff('ses-dir-flat');
    assert.equal(active?.handoffId, 'h-dir-flat-1', 'sessionInfo.directory must be resolved by server event.subscribe');
  } finally {
    clearActiveHandoff('ses-dir-flat');
    await dispose?.();
  }
});

test('2.5b: TUI treats OpenCode UnknownError synthetic response as rejected without consuming budget', async (t) => {
  const dir = tempDirectory(t);
  let syntheticCalls = 0;
  const form = {
    id: 'frm-unknown-err',
    sessionID: 'ses-1',
    fields: [{
      key: 'pick',
      type: 'string',
      options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }],
    }],
  };
  const h = makeTuiHarness(t, {
    dir,
    options: { timeoutMs: 25, maxUnclassifiedRemediations: 1 },
    formList: () => [form],
  });
  h.context.client = {
    session: {
      async synthetic() {
        syntheticCalls += 1;
        return { name: 'UnknownError', message: 'Internal server error', ref: 'ref-123' };
      },
    },
  };

  const dispose = await setup(h.context);
  t.after(dispose);

  await h.events.get('form.created')({ data: { form } });
  // Because UnknownError rolled back remediatedForms, a second delivery of the same form must still retry
  await h.events.get('form.created')({ data: { form } });
  assert.equal(syntheticCalls, 2, 'UnknownError response must roll back remediatedForms so retry remains allowed');
});
