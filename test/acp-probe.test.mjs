import test from 'node:test';
import assert from 'node:assert/strict';
import { connectProbe, toolSummary, allowProbeSleep } from '../scripts/acp-probe.mjs';

const fakeAgent = `
import { createInterface } from 'node:readline';
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.method === 'permission') {
    send({ id: 'approval', method: 'session/request_permission', params: {
      toolCall: { toolCallId: 'read-1' }, options: message.params.options,
    } });
  } else if (message.id === 'approval') {
    send({ id: 1, result: message.result });
  } else if (message.method === 'bad-event') {
    process.stdout.write('not-json\\n');
  } else if (message.method === 'session/cancel') {
    send({ id: 1, result: { stopReason: 'cancelled', notificationHadId: message.id !== undefined } });
  } else if (message.method === 'exit') {
    process.exit(0);
  }
});
`;

async function withProbe(callback, timeout = 2_000) {
  const probe = connectProbe(process.execPath, ['--input-type=module', '-e', fakeAgent], process.cwd(), timeout);
  try { await callback(probe); } finally { await probe.close(); }
}

test('probe denies by option kind, never blindly selects the first allow option', async () => {
  await withProbe(async probe => {
    const result = await probe.request('permission', { options: [{ kind: 'allow_always', optionId: 'unsafe' }, { kind: 'reject_once', optionId: 'deny' }] });
    assert.deepEqual(result, { outcome: { outcome: 'selected', optionId: 'deny' } });
    assert.equal(probe.permissions.length, 1);
  });
});

test('probe cancels permission when no explicit reject option exists', async () => {
  await withProbe(async probe => {
    const result = await probe.request('permission', { options: [{ kind: 'allow_once', optionId: 'allow' }] });
    assert.deepEqual(result, { outcome: { outcome: 'cancelled' } });
  });
});

test('probe sends session cancellation as a notification and awaits terminal response', async () => {
  await withProbe(async probe => {
    const prompt = probe.request('session/prompt', {});
    probe.notify('session/cancel', { sessionId: 'probe-only' });
    assert.deepEqual(await prompt, { stopReason: 'cancelled', notificationHadId: false });
  });
});

test('probe deadlines settle all pending calls instead of hanging', async () => {
  await withProbe(async probe => {
    await assert.rejects(probe.request('never-replies', {}), /timed out/);
    await assert.rejects(probe.request('after-timeout', {}), /timed out/);
  }, 150);
});

test('probe rejects malformed events and subprocess exit', async () => {
  for (const method of ['bad-event', 'exit']) {
    await withProbe(async probe => { await assert.rejects(probe.request(method, {}), /invalid protocol|subprocess exited/); });
  }
});

test('probe startup errors reject and cleanup does not hang', async () => {
  const probe = connectProbe('/nonexistent/alma-devin-probe', [], process.cwd(), 1_000);
  try { await assert.rejects(probe.request('initialize', {}), /failed to start|input stream closed/); }
  finally { await probe.close(); }
});

test('tool evidence merges partial terminal updates without confusing parallel tool IDs', () => {
  const result = toolSummary([
    { sessionUpdate: 'tool_call', toolCallId: 'one', rawInput: { path: 'first.txt' }, status: 'pending' },
    { sessionUpdate: 'tool_call', toolCallId: 'two', status: 'pending' },
    { sessionUpdate: 'tool_call_update', toolCallId: 'two', status: 'failed' },
    { sessionUpdate: 'tool_call_update', toolCallId: 'one', status: 'completed', rawOutput: 'fixture' },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'final' } },
  ]);
  assert.equal(result.text, 'final');
  assert.equal(result.calls.length, 2);
  assert.equal(result.calls[0].rawInput.path, 'first.txt');
  assert.equal(result.calls[0].rawOutput, 'fixture');
  assert.equal(result.calls[0].status, 'completed');
  assert.equal(result.calls[1].status, 'failed');
});

test('the sole cancellation-test allow is correlated by tool ID, exact command and workspace', () => {
  const params = { toolCall: { toolCallId: 'sleep-probe' }, options: [{ kind: 'allow_always', optionId: 'never' }, { kind: 'allow_once', optionId: 'once' }] };
  const updates = [{ sessionUpdate: 'tool_call', toolCallId: 'sleep-probe', rawInput: { command: 'sleep 20', workdir: '/probe' } }];
  assert.deepEqual(allowProbeSleep(params, updates, '/probe'), { outcome: 'selected', optionId: 'once' });
  assert.equal(allowProbeSleep(params, [], '/probe'), undefined);
  assert.equal(allowProbeSleep({ ...params, toolCall: { toolCallId: 'another' } }, updates, '/probe'), undefined);
  assert.equal(allowProbeSleep(params, updates, '/different'), undefined);
  assert.equal(allowProbeSleep(params, [{ ...updates[0], rawInput: { command: 'sleep 20; another-command' } }], '/probe'), undefined);
  assert.equal(allowProbeSleep({ ...params, options: [{ kind: 'allow_always', optionId: 'never' }] }, updates, '/probe'), undefined);
});
