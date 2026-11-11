import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, access, stat, open } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApi, findProvider, summary, PROVIDER_ID } from '../lib/alma.mjs';
import { connectProbe, toolSummary, allowProbeSleep } from './acp-probe.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const api = createApi(process.env.ALMA_API_URL);
const workspace = await mkdtemp(join(root, '.install-tool-smoke-'));
const report = { native: {}, host: {} };
const nativeOnly = process.argv.includes('--native-only');
let probe;
try {
  const providers = await api('/api/providers');
  const provider = nativeOnly ? providers.find(item => item.id === PROVIDER_ID && item.type === 'acp') : findProvider(providers);
  assert.ok(provider?.enabled, 'An enabled native Devin provider is required.');
  const command = nativeOnly ? process.env.DEVIN_PROBE_COMMAND : basename(provider.acpCommand) === 'devin' ? provider.acpCommand : provider.acpArgs[2];
  assert.ok(command && basename(command) === 'devin', 'Native-only mode requires an explicit DEVIN_PROBE_COMMAND pointing to Devin, not an adapter.');
  const selected = summary(provider).selectedModels;
  const model = process.env.DEVIN_TEST_MODEL || selected[0];
  assert.ok(selected.includes(model), 'Enable the test model in Alma first.');
  const firstMarker = 'FILE_A_' + randomUUID();
  const secondMarker = 'FILE_B_' + randomUUID();
  await writeFile(join(workspace, 'first.txt'), firstMarker);
  await writeFile(join(workspace, 'second.txt'), secondMarker);
  probe = connectProbe(command, ['--permission-mode', 'auto', 'acp', '--model', model], workspace);
  await probe.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'alma-devin-tool-probe', version: '1' } });
  const session = await probe.request('session/new', { cwd: workspace, mcpServers: [] });
  const prompt = text => probe.request('session/prompt', { sessionId: session.sessionId, prompt: [{ type: 'text', text }] });
  const check = (start, marker) => {
    const result = toolSummary(probe.updates.slice(start));
    assert.ok(result.text.includes(marker), 'Final assistant reply is missing the expected marker.');
    assert.ok(result.calls.length > 0, 'A text-only reply is not a file-tool test.');
    assert.ok(result.calls.every(call => ['completed', 'failed'].includes(call.status)), 'A tool has no terminal event.');
    return result;
  };
  let start = probe.updates.length;
  await prompt('Use a file read tool to read first.txt in the current directory. Do not search outside this directory. Reply with its exact content.');
  check(start, firstMarker);
  report.native.fileToFinal = 'passed';
  start = probe.updates.length;
  await prompt('Read first.txt and second.txt using two separate file read tool calls in this directory. Do not use one combined shell command. Reply with both file contents.');
  const multiple = check(start, secondMarker);
  assert.ok(multiple.text.includes(firstMarker));
  assert.ok(multiple.calls.length >= 2, 'Expected multiple tool results.');
  report.native.multipleResults = multiple.calls.length;
  start = probe.updates.length;
  await prompt('Use a file read tool to read missing.txt in this directory exactly once. This file does not exist. Do not search or retry. After the error reply ERROR_HANDLED.');
  const errored = check(start, 'ERROR_HANDLED');
  assert.ok(errored.calls.some(call => call.status === 'failed'), 'Expected a real failed file tool.');
  report.native.errorToFinal = 'passed';
  start = probe.updates.length;
  const permissionStart = probe.permissions.length;
  await prompt('Use exec to run exactly: printf probe > denied.txt . This is a permission-denial test confined to the current directory. If rejected do not retry, switch tools, or create another file. Reply DENIAL_HANDLED after the rejection.');
  check(start, 'DENIAL_HANDLED');
  assert.ok(probe.permissions.length > permissionStart, 'No actual permission request was rejected.');
  await assert.rejects(access(join(workspace, 'denied.txt')));
  report.native.denialToFinal = 'passed';
  let cancelled = false;
  let running = false;
  let cancelTimer;
  const cancelStart = probe.updates.length;
  probe.onPermission(params => allowProbeSleep(params, probe.updates.slice(cancelStart), workspace));
  probe.onUpdate(update => {
    if (!['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) return;
    const call = toolSummary(probe.updates.slice(cancelStart)).calls.find(item => item.toolCallId === update.toolCallId);
    if (!cancelled && call?.rawInput?.command === 'sleep 20' && call.status === 'in_progress') {
      cancelled = true;
      running = true;
      cancelTimer = setTimeout(() => {
        probe.cancelPermissions();
        probe.notify('session/cancel', { sessionId: session.sessionId });
      }, 500);
    }
  });
  const cancellation = await prompt('Use exec to run exactly sleep 20 in this directory. Do not run other commands or tools. This tests cancellation of an in-flight tool.');
  clearTimeout(cancelTimer);
  probe.onUpdate(() => {});
  if (!running) report.native.cancelEvidence = toolSummary(probe.updates.slice(cancelStart)).calls.map(call => ({ status: call.status, isExpectedCommand: call.rawInput?.command === 'sleep 20' }));
  assert.ok(cancelled && running, 'Cancellation was not triggered by the bounded in-flight command.');
  assert.equal(cancellation.stopReason, 'cancelled');
  report.native.cancel = 'passed';
  const followupStart = probe.updates.length;
  await prompt('Reply exactly AFTER_CANCEL without tools.');
  assert.ok(toolSummary(probe.updates.slice(followupStart)).text.includes('AFTER_CANCEL'));
  report.native.followup = 'passed';
  await probe.close();
  probe = undefined;

  if (nativeOnly) {
    report.host = { skipped: 'Native-only run; the installed provider configuration is not exercised or changed.' };
  } else {
    const logPath = process.env.ALMA_LOG_PATH || join(homedir(), 'Library/Application Support/alma/logs/native.log');
    const logStart = (await stat(logPath)).size;
    const threadId = 'alma-devin-tools-' + randomUUID();
    const messages = [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Read first.txt and second.txt with two separate native file read tool calls in this directory only. No shell or searching. Reply with both contents.' }] }];
    const body = { model: `${provider.id}:${model}`, stream: true, tools: 'none', threadId, workspacePath: workspace, messages };
    const first = await api('/api/chat/completions', 'POST', body, 'sse');
    assert.ok(first.done && first.text.includes(firstMarker) && first.text.includes(secondMarker));
    messages.push({ id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: first.text }] }, { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'What two file contents did you just read? Reply with both; no tools.' }] });
    const second = await api('/api/chat/completions', 'POST', body, 'sse');
    assert.ok(second.done && second.text.includes(firstMarker) && second.text.includes(secondMarker));
    messages.push({ id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: second.text }] }, { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Use a file read tool to read missing.txt here exactly once. Do not search or retry. Reply HOST_ERROR_HANDLED after the file error.' }] });
    const errorTurn = await api('/api/chat/completions', 'POST', body, 'sse');
    assert.ok(errorTurn.done && errorTurn.text.includes('HOST_ERROR_HANDLED'));
    const log = await open(logPath);
    let evidence;
    try {
      const size = (await log.stat()).size - logStart;
      assert.ok(size >= 0 && size <= 16_777_216, 'Host log rotated or exceeded the bounded evidence window.');
      const buffer = Buffer.alloc(size);
      await log.read(buffer, 0, size, logStart);
      evidence = buffer.toString('utf8').split('\n').filter(line => line.startsWith(`[ACP] Tool call update for ${threadId}:${provider.id}:`));
    } finally { await log.close(); }
    const terminal = new Set(evidence.filter(line => line.endsWith(' completed')).map(line => line.slice(0, -10)));
    assert.ok(terminal.size >= 2, 'Host SSE text alone is not proof of multiple real tool completions.');
    assert.ok(evidence.some(line => line.endsWith(' failed')), 'Expected a real failed file tool in the host path.');
    report.host = { fileToFinal: 'passed', multipleResults: terminal.size, errorToFinal: 'passed', sseDone: true, followup: 'passed', denialCancel: 'not verified by REST: lifecycle events and cancellation are not exposed' };
  }
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ...report, failed: error.message }));
  process.exitCode = 1;
} finally {
  await probe?.close();
  await rm(workspace, { recursive: true, force: true });
}
