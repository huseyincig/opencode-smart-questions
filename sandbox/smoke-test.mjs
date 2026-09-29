import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SmartQuestion, OpencodeSmartQuestions } from '../dist/index.js';

console.log('==================================================');
console.log('  OPENCODE-SMART-QUESTIONS ISOLATED SANDBOX TEST');
console.log('==================================================');

const sandboxDir = path.dirname(new URL(import.meta.url).pathname);

// Mock client that tracks replies
let lastReply = null;
const mockClient = {
  question: {
    reply: async (payload) => {
      lastReply = payload;
    },
  },
};

console.log('\n[1] Initializing SmartQuestion plugin...');
const hooks = await OpencodeSmartQuestions.server({
  client: mockClient,
  directory: sandboxDir,
}, { config: { enabled: true, timeoutMs: 50, recommendedMarkers: ['(Recommended)', '(Önerilen)'] } });

assert.ok(typeof hooks.event === 'function', 'Plugin must register event hook');
console.log('    ✓ Plugin initialized successfully');

// Scenario 1: Auto-reply on Recommended option with short timeout
console.log('\n[2] Testing Auto-Selection on Recommended Option...');
const requestID = 'sandbox-req-001';
await hooks.event({
  event: {
    type: 'question.asked',
    data: {
      id: requestID,
      questions: [
        {
          question: 'Which deployment approach?',
          options: [
            { label: 'Canary', description: 'Slow' },
            { label: 'Blue-Green (Recommended)', description: 'Fast zero-downtime' },
          ],
        },
      ],
    },
  },
});

await new Promise((r) => setTimeout(r, 80));
assert.ok(lastReply, 'Expected reply to be sent');
assert.deepEqual(lastReply.answers, [['Blue-Green (Recommended)']]);
console.log('    ✓ Auto-reply triggered with answer:', JSON.stringify(lastReply.answers));
await hooks.dispose?.();

console.log('\n==================================================');
console.log('  SMOKE TEST PASSED — SYSTEM FULLY OPERATIONAL');
console.log('==================================================');
