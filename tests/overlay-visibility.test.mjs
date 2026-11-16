import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { computeOverlayViewModel } from '../dist/view-model.js';
import { resolveAgentName, setup as v2Setup } from '../dist/ui.js';
import { resolveLockPath } from '../dist/draft-guard.js';

test('computeOverlayViewModel computes distinct visual metadata for AUTO, MANUAL, UNCLASSIFIED, and ERROR states', () => {
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

test('resolveAgentName extracts V2 SessionInfo.agent and falls back to short sessionID', () => {
  assert.deepEqual(resolveAgentName({ id: 'ses-1234567890', agent: 'architect' }, 'ses-1234567890'), {
    name: 'architect',
    found: true,
  });
  assert.deepEqual(resolveAgentName({ id: 'ses-1234567890' }, 'ses-1234567890'), {
    name: 'ses-1234',
    found: false,
  });
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
        get(id) { return { id, agent: 'planner', location: { directory: tempDir } }; },
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

  const dispose = await v2Setup(mockContext);
  t.after(() => dispose?.());

  await eventHandlers.get('form.created')({
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
        get(id) { return { id, agent: 'coder', location: { directory: tempDir } }; },
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

  const dispose = await v2Setup(mockContext);
  t.after(() => dispose?.());

  await eventHandlers.get('form.created')({
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

test('V2 TUI: deleting owning session clears manual form lock and remediated form state', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-delete-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const eventHandlers = new Map();
  const dispose = await v2Setup({
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
      router: { current: () => ({ type: 'session', sessionID: 'ses-del' }) },
      slot: () => () => {},
    },
  });
  t.after(() => dispose?.());

  await eventHandlers.get('form.created')({
    data: {
      form: {
        id: 'form-del-1',
        sessionID: 'ses-del',
        fields: [{
          key: 'action',
          type: 'string',
          options: [{ value: 'yes', label: 'Yes [SQ:manual]' }, { value: 'no', label: 'No' }],
        }],
      },
    },
  });

  const lock = resolveLockPath(tempDir, 'form-del-1');
  assert.equal(fs.existsSync(lock), true);

  eventHandlers.get('session.deleted')({ data: { sessionID: 'ses-del' } });
  assert.equal(fs.existsSync(lock), false, 'deleted session must release form lock');
});
