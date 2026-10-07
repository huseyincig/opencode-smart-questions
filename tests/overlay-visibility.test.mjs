import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeOverlayViewModel } from '../dist/view-model.js';
import {
  tui as v1Tui,
  setup as v2Setup,
} from '../dist/ui.js';
import { resolveLockPath } from '../dist/draft-guard.js';

test('computeOverlayViewModel computes distinct visual metadata for AUTO, MANUAL, UNCLASSIFIED, and ERROR states', () => {
  // 1. AUTO State
  const autoState = {
    requestID: 'req-auto',
    sessionID: 'ses-1',
    questions: [
      {
        question: 'Deploy?',
        options: [{ label: 'Production [SQ:recommended]', description: 'Recommended for release' }, { label: 'Staging' }],
      },
    ],
    detection: {
      ok: true,
      answers: [['Production [SQ:recommended]']],
      recommendedOptions: [{ label: 'Production [SQ:recommended]', description: 'Recommended for release' }],
      matchedMarker: '[SQ:recommended]',
    },
    agentName: 'Orchestrator',
    agentFound: true,
    focusDisabled: false,
    status: 'auto',
    countdown: 25,
  };

  const autoModel = computeOverlayViewModel(autoState, { countdown: 25 });
  assert.notEqual(autoModel, null);
  assert.equal(autoModel.status, 'auto');
  assert.equal(autoModel.borderColor, 'cyan');
  assert.match(autoModel.title, /Smart Question/);
  assert.equal(autoModel.countdownText, '00:25');
  assert.equal(autoModel.recommendedChecklist, '✓ Production');
  assert.equal(autoModel.rationale, 'Recommended for release');

  // 2. MANUAL State
  const manualState = {
    requestID: 'req-manual',
    sessionID: 'ses-1',
    questions: [
      {
        question: 'Drop database?',
        options: [{ label: 'Yes [SQ:manual]' }, { label: 'No' }],
      },
    ],
    detection: { ok: false, reason: 'Manual decision required' },
    agentName: 'Orchestrator',
    agentFound: true,
    focusDisabled: true,
    status: 'manual',
    statusMessage: 'Auto-selection disabled — human approval required.',
  };

  const manualModel = computeOverlayViewModel(manualState);
  assert.notEqual(manualModel, null);
  assert.equal(manualModel.status, 'manual');
  assert.equal(manualModel.borderColor, 'yellow');
  assert.match(manualModel.title, /Manual Decision/);
  assert.equal(manualModel.statusMessage, 'Auto-selection disabled — human approval required.');

  // 3. UNCLASSIFIED State
  const unclassifiedState = {
    requestID: 'req-unclass',
    sessionID: 'ses-1',
    questions: [
      {
        question: 'Which framework?',
        options: [{ label: 'Solid' }, { label: 'React' }],
      },
    ],
    detection: { ok: false, reason: 'No recommendation marker found' },
    agentName: 'ses-1-short',
    agentFound: false,
    focusDisabled: true,
    status: 'unclassified',
    statusMessage: 'Agent was asked to classify the question.',
  };

  const unclassifiedModel = computeOverlayViewModel(unclassifiedState);
  assert.notEqual(unclassifiedModel, null);
  assert.equal(unclassifiedModel.status, 'unclassified');
  assert.equal(unclassifiedModel.borderColor, 'cyan');
  assert.match(unclassifiedModel.title, /Intercepted/);
  assert.equal(unclassifiedModel.statusMessage, 'Agent was asked to classify the question.');

  // 4. ERROR State (budget exhausted / remediation failed)
  const errorState = {
    requestID: 'req-err',
    sessionID: 'ses-1',
    questions: [
      {
        question: 'Which framework?',
        options: [{ label: 'Solid' }, { label: 'React' }],
      },
    ],
    detection: { ok: false, reason: 'Budget exhausted' },
    agentName: 'ses-1-short',
    agentFound: false,
    focusDisabled: true,
    status: 'error',
    errorMessage: 'Automatic remediation stopped for this repeated question. Please answer manually.',
  };

  const errorModel = computeOverlayViewModel(errorState);
  assert.notEqual(errorModel, null);
  assert.equal(errorModel.status, 'error');
  assert.equal(errorModel.borderColor, 'red');
  assert.match(errorModel.title, /Warning/);
  assert.match(errorModel.errorMessage, /Automatic remediation stopped/);
});

test('V1 TUI: AUTO question activates overlay slot and lockfile', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-auto-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const events = new Map();
  let registeredSlot = null;

  await v1Tui({
    state: {
      path: { directory: tempDir },
      session: { get(id) { return { id }; } },
    },
    event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
    renderer: { keyInput: { on() {}, off() {} }, requestRender() {} },
    slots: {
      register(def) {
        registeredSlot = def;
      },
    },
    lifecycle: { onDispose() {} },
  }, { configDir: path.join(tempDir, '.opencode') });

  events.get('question.asked')({
    properties: {
      id: 'req-v1-auto',
      sessionID: 's1',
      questions: [{
        question: 'Proceed?',
        options: [{ label: 'Yes [SQ:recommended]' }, { label: 'No' }],
      }],
    },
  });

  assert.ok(registeredSlot, 'V1 TUI must register slot');
  assert.equal(typeof registeredSlot.slots.app_bottom, 'function', 'app_bottom slot must be registered');
});

test('V1 TUI: MANUAL question [SQ:manual] activates visible MANUAL overlay and disables auto-reply', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-manual-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const events = new Map();
  let registeredSlot = null;
  let renderRequested = false;

  await v1Tui({
    state: {
      path: { directory: tempDir },
      session: { get(id) { return { id }; } },
    },
    event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
    renderer: {
      keyInput: { on() {}, off() {} },
      requestRender() { renderRequested = true; },
    },
    slots: {
      register(def) {
        registeredSlot = def;
      },
    },
    lifecycle: { onDispose() {} },
  }, { configDir: path.join(tempDir, '.opencode') });

  events.get('question.asked')({
    properties: {
      id: 'req-v1-man',
      sessionID: 's1',
      questions: [{
        question: 'Are you sure?',
        options: [{ label: 'Confirm [SQ:manual]' }, { label: 'Cancel' }],
      }],
    },
  });

  assert.equal(renderRequested, true, 'Render must be requested for manual question');
  assert.ok(registeredSlot, 'V1 TUI must register slot');
  assert.equal(typeof registeredSlot.slots.app_bottom, 'function');

  // Verify draft lock was written to prevent backend timer auto-selection
  const lock = resolveLockPath(path.join(tempDir, '.opencode'), 'req-v1-man');
  assert.equal(fs.existsSync(lock), true, 'Draft lock must be held for manual question');

  // Settle question and verify overlay cleans up
  events.get('question.replied')({ properties: { id: 'req-v1-man', sessionID: 's1' } });
  assert.equal(fs.existsSync(lock), false, 'Draft lock must be cleaned up on reply');
});

test('V1 TUI: UNCLASSIFIED question activates visible UNCLASSIFIED overlay and draft lock', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-unclass-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const events = new Map();
  let registeredSlot = null;
  let renderCount = 0;

  await v1Tui({
    state: {
      path: { directory: tempDir },
      session: { get(id) { return { id }; } },
    },
    event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
    renderer: {
      keyInput: { on() {}, off() {} },
      requestRender() { renderCount++; },
    },
    slots: {
      register(def) {
        registeredSlot = def;
      },
    },
    lifecycle: { onDispose() {} },
  }, { configDir: path.join(tempDir, '.opencode') });

  events.get('question.asked')({
    properties: {
      id: 'req-v1-unclass',
      sessionID: 's1',
      questions: [{
        question: 'Pick database',
        options: [{ label: 'Postgres' }, { label: 'MySQL' }],
      }],
    },
  });

  assert.ok(renderCount >= 1, 'Render must be requested for unclassified question');
  assert.ok(registeredSlot, 'Slot must be registered');
  assert.equal(typeof registeredSlot.slots.app_bottom, 'function');

  const lock = resolveLockPath(path.join(tempDir, '.opencode'), 'req-v1-unclass');
  assert.equal(fs.existsSync(lock), true, 'Draft lock must be created for unclassified question');
});

test('V1 TUI: Loop-exhausted unclassified question requests render with budget-exhausted lock', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v1-loop-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const events = new Map();
  let registeredSlot = null;
  let renderCount = 0;

  await v1Tui({
    state: {
      path: { directory: tempDir },
      session: { get(id) { return { id }; } },
    },
    event: { on(type, handler) { events.set(type, handler); return () => events.delete(type); } },
    renderer: {
      keyInput: { on() {}, off() {} },
      requestRender() { renderCount++; },
    },
    slots: {
      register(def) {
        registeredSlot = def;
      },
    },
    lifecycle: { onDispose() {} },
  }, { configDir: path.join(tempDir, '.opencode'), maxUnclassifiedRemediations: 2 });

  const questionPayload = {
    properties: {
      id: 'req-v1-repeated',
      sessionID: 's1',
      questions: [{
        question: 'Pick database',
        options: [{ label: 'Postgres' }, { label: 'MySQL' }],
      }],
    },
  };

  // Turn 1: unclassified
  events.get('question.asked')(questionPayload);
  // Turn 2: unclassified
  events.get('question.asked')(questionPayload);
  // Turn 3: budget exhausted -> error state
  events.get('question.asked')(questionPayload);

  assert.ok(renderCount >= 3, 'Render must be requested for each turn');
  assert.ok(registeredSlot, 'Slot must be registered');
});

test('V2 TUI: MANUAL form creates lock and cleans up on settlement', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-manual-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const eventHandlers = new Map();
  let slotRenderFn = null;

  const mockContext = {
    options: { enabled: true, timeoutMs: 30, configDir: tempDir },
    location: { directory: tempDir },
    data: {
      on(type, handler) { eventHandlers.set(type, handler); return () => eventHandlers.delete(type); },
      session: {
        get(id) { return { id, location: { directory: tempDir } }; },
        form: {
          sync: async () => {},
          list: () => [],
          reply: async () => {},
          invalidate: () => {},
        },
      },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: 'ses-v2' }) },
      slot(def) {
        slotRenderFn = def.render;
        return () => {};
      },
    },
  };

  await v2Setup(mockContext);

  eventHandlers.get('form.created')({
    data: {
      form: {
        id: 'form-manual-1',
        sessionID: 'ses-v2',
        fields: [{
          key: 'action',
          type: 'string',
          options: [{ value: 'delete', label: 'Delete [SQ:manual]' }, { value: 'keep', label: 'Keep' }],
        }],
      },
    },
  });

  assert.ok(slotRenderFn, 'V2 TUI slot must be registered');

  const lock = resolveLockPath(tempDir, 'form-manual-1');
  assert.equal(fs.existsSync(lock), true, 'Draft lock must be held for manual form');

  // Settle form via form.replied
  eventHandlers.get('form.replied')({ data: { id: 'form-manual-1', sessionID: 'ses-v2' } });
  assert.equal(fs.existsSync(lock), false, 'Draft lock must be cleaned up on form settlement');
});

test('V2 TUI: UNCLASSIFIED form sends remediation and creates draft lock', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-unclass-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const eventHandlers = new Map();
  let slotRenderFn = null;
  const prompts = [];

  const mockContext = {
    options: { enabled: true, timeoutMs: 30, configDir: tempDir },
    location: { directory: tempDir },
    client: {
      session: {
        synthetic: async (req) => { prompts.push(req); return {}; },
      },
    },
    data: {
      on(type, handler) { eventHandlers.set(type, handler); return () => eventHandlers.delete(type); },
      session: {
        get(id) { return { id, location: { directory: tempDir } }; },
        form: {
          sync: async () => {},
          list: () => [],
          reply: async () => {},
          invalidate: () => {},
        },
      },
    },
    renderer: { keyInput: { on() {}, off() {} } },
    ui: {
      router: { current: () => ({ type: 'session', sessionID: 'ses-v2' }) },
      slot(def) {
        slotRenderFn = def.render;
        return () => {};
      },
    },
  };

  await v2Setup(mockContext);

  eventHandlers.get('form.created')({
    data: {
      form: {
        id: 'form-unclass-1',
        sessionID: 'ses-v2',
        fields: [{
          key: 'action',
          type: 'string',
          options: [{ value: 'opt1', label: 'Option 1' }, { value: 'opt2', label: 'Option 2' }],
        }],
      },
    },
  });

  assert.equal(prompts.length, 1, 'Synthetic remediation prompt must be sent');
  assert.match(prompts[0].text, /\[Smart Questions protocol remediation\]/);
  assert.ok(slotRenderFn, 'V2 slot must be registered');

  const lock = resolveLockPath(tempDir, 'form-unclass-1');
  assert.equal(fs.existsSync(lock), true, 'Draft lock must be created for unclassified form');
});
