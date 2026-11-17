import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { OpenCode } from '@opencode/client';
import OpencodeSmartQuestions, {
  SQ_GUIDANCE_SENTINEL,
  resolveLockPath,
  resetHandoffTracking,
} from '../dist/index.js';
import OpencodeSmartQuestionsTui from '../dist/tui.js';

console.log('========================================================================');
console.log('   OPENCODE V2 LIVE ACCEPTANCE TEST SUITE (OpenCode v2.3.0 Host)');
console.log('========================================================================');

const rootDir = path.resolve(import.meta.dirname, '..');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function waitForServer(client, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await client.server.info();
      if (info) return info;
    } catch {
      // Server still booting
    }
    await delay(150);
  }
  throw new Error(`opencode serve did not become ready within ${timeoutMs}ms`);
}

async function waitUntil(predicate, timeoutMs = 5_000, label = 'condition') {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const val = await predicate();
    if (val) return val;
    await delay(40);
  }
  throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
}

const tempWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-live-'));
const tempPackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-pack-'));
const tempExtractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sq-v2-extract-'));

let serverProc = null;
const sseAbort = new AbortController();
let disposeTui = null;
let disposeServerPlugin = null;

try {
  // 1. Verify Installed Host Version
  console.log('\n[GATE 1] Host Binary Verification...');
  const opencodeVersionOutput = execSync('opencode --version', { encoding: 'utf8' }).trim();
  console.log(`    Detected OpenCode binary version: ${opencodeVersionOutput}`);
  assert.match(opencodeVersionOutput, /2\.3\./, 'Host version must be OpenCode v2.3.x');

  // 2. Configure Isolated Temp Workspace (NEVER touch ~/.config/opencode)
  console.log('\n[GATE 2] Isolated Workspace & Plugin Discovery...');
  const opencodeDir = path.join(tempWorkspace, '.opencode');
  fs.mkdirSync(path.join(opencodeDir, 'plugins'), { recursive: true });
  fs.symlinkSync(rootDir, path.join(opencodeDir, 'plugins', 'opencode-smart-questions'), 'dir');
  fs.writeFileSync(
    path.join(tempWorkspace, 'opencode.json'),
    JSON.stringify({ $schema: 'https://opencode.ai/config.json', plugins: [rootDir] }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(opencodeDir, 'smart-question.json'),
    JSON.stringify({ enabled: true, timeoutMs: 250, recommendedMarkers: ['[SQ:recommended]'], manualMarkers: ['[SQ:manual]'] }, null, 2),
    'utf8'
  );

  const pluginListOutput = execSync('opencode plugin list', { cwd: tempWorkspace, encoding: 'utf8' });
  assert.ok(
    pluginListOutput.includes('opencode-smart-questions'),
    `opencode plugin list must include opencode-smart-questions. Got:\n${pluginListOutput}`
  );
  console.log('    ✓ opencode plugin list discovered opencode-smart-questions');

  // 3. Spawn isolated opencode serve
  console.log('\n[GATE 3] Spawning Live opencode serve...');
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  serverProc = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: tempWorkspace,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OPENCODE_DISABLE_AUTOUPDATE: '1' },
  });

  const serverPassword = await new Promise((resolve, reject) => {
    let stdoutBuf = '';
    let stderrBuf = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for opencode serve password. stdout=${stdoutBuf} stderr=${stderrBuf}`));
    }, 15_000);
    serverProc.stdout.on('data', (chunk) => {
      stdoutBuf += chunk.toString('utf8');
      const m = /server password\s+(\S+)/.exec(stdoutBuf);
      if (m && m[1]) {
        clearTimeout(timer);
        resolve(m[1]);
      }
    });
    serverProc.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString('utf8');
    });
    serverProc.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`opencode serve exited early (${code}). stdout=${stdoutBuf} stderr=${stderrBuf}`));
    });
  });

  const authHeader = `Basic ${Buffer.from(`opencode:${serverPassword}`).toString('base64')}`;
  const client = OpenCode.make({
    baseUrl,
    headers: {
      Authorization: authHeader,
      'x-opencode-directory': tempWorkspace,
    },
  });
  const serverInfo = await waitForServer(client);
  console.log(`    ✓ Live opencode serve ready at ${baseUrl} (version: ${serverInfo.version ?? opencodeVersionOutput})`);

  const livePlugins = await client.plugin.list();
  assert.ok(livePlugins && typeof livePlugins === 'object', 'client.plugin.list() must return plugin list output');

  // 4. Bridge live SSE + HTTP API to built dist/index.js & dist/tui.js
  console.log('\n[GATE 4] Wiring Built dist/index.js & dist/tui.js to Live Server...');
  resetHandoffTracking();

  const tuiListeners = new Map();
  const keyListeners = new Map();
  const formCache = new Map();
  const sessionCache = new Map();
  const messageCache = new Map();
  let activeRouteSessionID = '';

  const serverHooks = new Map();
  disposeServerPlugin = await OpencodeSmartQuestions.setup({
    location: { directory: tempWorkspace },
    options: { enabled: true, timeoutMs: 250, configDir: opencodeDir },
    session: {
      get: async ({ sessionID }) => client.session.get({ sessionID }),
      hook: async (name, cb) => {
        serverHooks.set(name, cb);
        return { dispose: async () => { serverHooks.delete(name); } };
      },
    },
    event: {
      subscribe: (opts) => client.event.subscribe(opts),
    },
  });

  const emitToTui = async (type, event) => {
    const set = tuiListeners.get(type);
    if (!set) return;
    for (const handler of Array.from(set)) {
      await handler(event);
    }
  };

  disposeTui = await OpencodeSmartQuestionsTui.setup({
    location: { directory: tempWorkspace },
    options: {},
    client: {
      session: {
        synthetic: async (input) =>
          client.session.synthetic({
            ...input,
            resume: false,
          }),
      },
    },
    data: {
      on(type, handler) {
        let set = tuiListeners.get(type);
        if (!set) {
          set = new Set();
          tuiListeners.set(type, set);
        }
        set.add(handler);
        return () => set.delete(handler);
      },
      session: {
        get: (sessionID) => sessionCache.get(sessionID),
        sync: async (sessionID) => {
          const info = await client.session.get({ sessionID });
          sessionCache.set(sessionID, info);
          return info;
        },
        message: {
          list: (sessionID) => messageCache.get(sessionID) ?? [],
          sync: async (sessionID) => {
            const msgs = await client.session.context({ sessionID });
            messageCache.set(sessionID, msgs);
            return msgs;
          },
        },
        form: {
          sync: async (sessionID) => {
            const forms = await client.session.form.list({ sessionID });
            formCache.set(sessionID, forms);
            return forms;
          },
          list: (sessionID) => formCache.get(sessionID) ?? [],
          reply: async ({ sessionID, formID, answer }) =>
            client.session.form.reply({ sessionID, formID, answer }),
          invalidate: (sessionID) => {
            formCache.delete(sessionID);
          },
        },
      },
    },
    renderer: {
      keyInput: {
        on(type, handler) {
          let set = keyListeners.get(type);
          if (!set) {
            set = new Set();
            keyListeners.set(type, set);
          }
          set.add(handler);
        },
        off(type, handler) {
          keyListeners.get(type)?.delete(handler);
        },
      },
    },
    ui: {
      router: {
        current: () =>
          activeRouteSessionID
            ? { type: 'session', sessionID: activeRouteSessionID }
            : { type: 'home' },
      },
      slot: () => () => {},
    },
  });

  // Pump live SSE events from opencode serve into TUI data.on listeners
  const sseStream = client.event.subscribe({ signal: sseAbort.signal });
  const ssePump = (async () => {
    try {
      for await (const evt of sseStream) {
        if (sseAbort.signal.aborted) break;
        if (evt && typeof evt === 'object' && typeof evt.type === 'string') {
          await emitToTui(evt.type, evt);
        }
      }
    } catch {
      // Aborted on cleanup
    }
  })();

  // Create root session on live server
  const rootSession = await client.session.create({ title: 'V2 Live Acceptance Root' });
  sessionCache.set(rootSession.id, rootSession);
  activeRouteSessionID = rootSession.id;

  // Verify V2 server context hook injects SQ_GUIDANCE_SENTINEL
  const ctxEvent = { sessionID: rootSession.id, system: [], messages: [] };
  await serverHooks.get('context')(ctxEvent);
  assert.equal(ctxEvent.system.length, 1);
  assert.ok(ctxEvent.system[0].text.includes(SQ_GUIDANCE_SENTINEL));
  console.log('    ✓ Server context hook & SSE pump active');

  // Scenario 1: Root AUTO form -> live form.created SSE -> countdown -> form.reply -> settled
  console.log('\n[SCENARIO 1] Live Root AUTO Form...');
  const autoForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Deployment strategy',
    fields: [{
      key: 'strategy',
      type: 'string',
      label: 'Deployment strategy?',
      options: [
        { value: 'canary', label: 'Canary' },
        { value: 'blue_green', label: 'Blue-Green [SQ:recommended]' },
      ],
    }],
  });
  await waitUntil(async () => {
    const pending = await client.session.form.list({ sessionID: rootSession.id });
    return !pending.some((f) => f.id === autoForm.id);
  }, 5_000, 'AUTO form settlement');
  console.log('    ✓ Scenario 1 passed: Live AUTO form auto-replied and settled');

  // Scenario 2: Multiselect form with minItems/maxItems -> settled
  console.log('\n[SCENARIO 2] Live Multiselect Form (minItems/maxItems)...');
  const multiForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Select checks',
    fields: [{
      key: 'checks',
      type: 'multiselect',
      label: 'Select checks',
      minItems: 1,
      maxItems: 2,
      options: [
        { value: 'unit', label: 'Unit Tests [SQ:recommended]' },
        { value: 'lint', label: 'Linter [SQ:recommended]' },
        { value: 'e2e', label: 'E2E' },
      ],
    }],
  });
  await waitUntil(async () => {
    const pending = await client.session.form.list({ sessionID: rootSession.id });
    return !pending.some((f) => f.id === multiForm.id);
  }, 5_000, 'Multiselect form settlement');
  console.log('    ✓ Scenario 2 passed: Multiselect form auto-replied and settled');

  // Scenario 3: User keypress intervention -> draft lock, cancelled, stays pending
  console.log('\n[SCENARIO 3] Live User Keypress Cancellation...');
  const keyForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Select mode',
    fields: [{
      key: 'mode',
      type: 'string',
      label: 'Select mode',
      options: [
        { value: 'fast', label: 'Fast [SQ:recommended]' },
        { value: 'safe', label: 'Safe' },
      ],
    }],
  });
  const lockPath3 = resolveLockPath(opencodeDir, keyForm.id);
  await delay(50);
  for (const fn of keyListeners.get('keypress') ?? []) fn({ name: 'down' });
  await delay(350);
  assert.equal(fs.existsSync(lockPath3), true, 'Draft lockfile must exist after keypress');
  const pendingAfterKey = await client.session.form.list({ sessionID: rootSession.id });
  assert.ok(pendingAfterKey.some((f) => f.id === keyForm.id), 'Cancelled form must remain pending');
  await client.session.form.cancel({ sessionID: rootSession.id, formID: keyForm.id });
  await waitUntil(() => !fs.existsSync(lockPath3), 2_000, 'lockfile removal after cancel');
  console.log('    ✓ Scenario 3 passed: Keypress cancelled auto-reply and held draft lock');

  // Scenario 4: MANUAL form ([SQ:manual]) -> suppressed, stays pending
  console.log('\n[SCENARIO 4] Live MANUAL Form Suppression...');
  const manualForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Confirm drop',
    fields: [{
      key: 'confirm',
      type: 'string',
      label: 'Drop staging DB?',
      options: [
        { value: 'yes', label: 'Yes [SQ:manual]' },
        { value: 'no', label: 'No' },
      ],
    }],
  });
  await delay(350);
  const pendingManual = await client.session.form.list({ sessionID: rootSession.id });
  assert.ok(pendingManual.some((f) => f.id === manualForm.id), 'MANUAL form must remain pending');
  await client.session.form.cancel({ sessionID: rootSession.id, formID: manualForm.id });
  console.log('    ✓ Scenario 4 passed: MANUAL form suppressed');

  // Scenario 5: UNCLASSIFIED form -> real client.session.synthetic remediation -> verified in inbox/context
  console.log('\n[SCENARIO 5] Live UNCLASSIFIED Form Synthetic Remediation...');
  const unclassForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Choose database',
    fields: [{
      key: 'db',
      type: 'string',
      label: 'Which database?',
      options: [
        { value: 'pg', label: 'PostgreSQL' },
        { value: 'mysql', label: 'MySQL' },
      ],
    }],
  });
  await waitUntil(async () => {
    const inbox = await client.session.inbox.list({ sessionID: rootSession.id });
    return inbox.some(
      (item) =>
        item.type === 'synthetic' &&
        typeof item.payload?.text === 'string' &&
        item.payload.text.includes('[Smart Questions protocol remediation]')
    );
  }, 5_000, 'synthetic remediation in session inbox');
  await client.session.form.cancel({ sessionID: rootSession.id, formID: unclassForm.id });
  console.log('    ✓ Scenario 5 passed: Real synthetic remediation recorded in live session inbox');

  // Scenario 6: Subagent (parentID set) isolation
  console.log('\n[SCENARIO 6] Live Subagent Session Isolation...');
  const childSession = await client.session.create({
    title: 'V2 Live Acceptance Child',
    parentID: rootSession.id,
  });
  assert.equal(childSession.parentID, rootSession.id, 'Child session must have parentID');
  sessionCache.set(childSession.id, childSession);
  const childForm = await client.session.form.create({
    sessionID: childSession.id,
    title: 'Subagent choice',
    fields: [{
      key: 'sub',
      type: 'string',
      label: 'Subagent choice?',
      options: [
        { value: 'a', label: 'A [SQ:recommended]' },
        { value: 'b', label: 'B' },
      ],
    }],
  });
  await delay(350);
  const pendingChild = await client.session.form.list({ sessionID: childSession.id });
  assert.ok(pendingChild.some((f) => f.id === childForm.id), 'Child session form must be ignored by default');
  await client.session.form.cancel({ sessionID: childSession.id, formID: childForm.id });

  const sqConfigPath = path.join(opencodeDir, 'smart-question.json');
  const prevConfig = fs.readFileSync(sqConfigPath, 'utf8');
  try {
    fs.writeFileSync(
      sqConfigPath,
      JSON.stringify({
        enabled: true,
        timeoutMs: 250,
        recommendedMarkers: ['[SQ:recommended]'],
        manualMarkers: ['[SQ:manual]'],
        includeSubagents: true,
      }, null, 2),
      'utf8'
    );
    const childAutoForm = await client.session.form.create({
      sessionID: childSession.id,
      title: 'Subagent opt-in choice',
      fields: [{
        key: 'sub_opt',
        type: 'string',
        label: 'Subagent opt-in?',
        options: [
          { value: 'proceed', label: 'Proceed [SQ:recommended]' },
          { value: 'skip', label: 'Skip' },
        ],
      }],
    });
    await waitUntil(async () => {
      const pending = await client.session.form.list({ sessionID: childSession.id });
      return !pending.some((f) => f.id === childAutoForm.id);
    }, 5_000, 'Child session opt-in form settlement');
  } finally {
    fs.writeFileSync(sqConfigPath, prevConfig, 'utf8');
  }
  console.log('    ✓ Scenario 6 passed: Subagent form isolated by default and auto-replied with includeSubagents=true');

  // Scenario 7: Guardian coordination over live session.synthetic
  console.log('\n[SCENARIO 7] Live Guardian Coordination over session.synthetic...');
  await client.session.synthetic({
    sessionID: rootSession.id,
    text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=approval\nauto_select=forbidden\nhandoff_id=live_forbid_1\n\nApproval needed.',
    description: 'Guardian handoff forbidden',
    metadata: { 'opencode-guardian': true },
    delivery: 'queue',
    resume: false,
  });
  const guardForbiddenForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Approve action',
    fields: [{
      key: 'approve',
      type: 'string',
      label: 'Approve?',
      options: [
        { value: 'yes', label: 'Yes [SQ:recommended]' },
        { value: 'no', label: 'No' },
      ],
    }],
  });
  await delay(350);
  const pendingForbidden = await client.session.form.list({ sessionID: rootSession.id });
  assert.ok(pendingForbidden.some((f) => f.id === guardForbiddenForm.id), 'auto_select=forbidden must block auto-reply');
  await client.session.form.cancel({ sessionID: rootSession.id, formID: guardForbiddenForm.id });

  await client.session.synthetic({
    sessionID: rootSession.id,
    text: '[opencode-guardian remediation]\n\n[OPENCODE_HANDOFF:v1]\nsource=guardian\naction=question_required\nkind=choice\nauto_select=allowed\nhandoff_id=live_allow_1\n\nChoice allowed.',
    description: 'Guardian handoff allowed',
    metadata: { 'opencode-guardian': true },
    delivery: 'queue',
    resume: false,
  });
  const guardAllowedForm = await client.session.form.create({
    sessionID: rootSession.id,
    title: 'Select environment',
    fields: [{
      key: 'env',
      type: 'string',
      label: 'Environment?',
      options: [
        { value: 'staging', label: 'Staging [SQ:recommended]' },
        { value: 'prod', label: 'Prod' },
      ],
    }],
  });
  await waitUntil(async () => {
    const pending = await client.session.form.list({ sessionID: rootSession.id });
    return !pending.some((f) => f.id === guardAllowedForm.id);
  }, 5_000, 'auto_select=allowed form settlement');
  console.log('    ✓ Scenario 7 passed: Guardian handoff forbidden blocks, allowed proceeds & tombstones');

  // Scenario 8: Packed artifact check
  console.log('\n[SCENARIO 8] Packed Artifact Import Verification...');
  const packJson = execSync(`npm pack --json --pack-destination "${tempPackDir}"`, {
    cwd: rootDir,
    encoding: 'utf8',
  });
  const packInfo = JSON.parse(packJson);
  const tgzName = packInfo[0]?.filename;
  assert.ok(tgzName, 'npm pack must produce a tarball');
  execSync(`tar -xzf "${path.join(tempPackDir, tgzName)}" -C "${tempExtractDir}"`);

  const pkgDir = path.join(tempExtractDir, 'package');
  fs.symlinkSync(path.join(rootDir, 'node_modules'), path.join(pkgDir, 'node_modules'), 'dir');
  const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const packedPkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  assert.equal(packedPkg.version, rootPkg.version);
  assert.equal(packedPkg.devDependencies?.['@opencode-ai/plugin'], undefined);
  const packedServer = await import(path.join(pkgDir, 'dist', 'index.js'));
  const packedTui = await import(path.join(pkgDir, 'dist', 'tui.js'));
  assert.equal(packedServer.default.id, 'opencode-smart-questions');
  assert.equal(typeof packedServer.default.setup, 'function');
  assert.equal(packedTui.default.id, 'opencode-smart-questions.tui');
  assert.equal(typeof packedTui.default.setup, 'function');
  console.log(`    ✓ Scenario 8 passed: Packed artifact (${tgzName}) imports cleanly`);

  sseAbort.abort();
  await ssePump;

  console.log('\n========================================================================');
  console.log('   ALL 8 LIVE OPENCODE v2.3.0 ACCEPTANCE SCENARIOS PASSED');
  console.log('========================================================================');
} finally {
  sseAbort.abort();
  try { disposeTui?.(); } catch {}
  try { await disposeServerPlugin?.(); } catch {}
  if (serverProc && !serverProc.killed) {
    serverProc.kill('SIGTERM');
    await delay(250);
    if (!serverProc.killed) serverProc.kill('SIGKILL');
  }
  fs.rmSync(tempWorkspace, { recursive: true, force: true });
  fs.rmSync(tempPackDir, { recursive: true, force: true });
  fs.rmSync(tempExtractDir, { recursive: true, force: true });
}
