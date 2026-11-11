import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { client, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { createApi, findProvider, summary } from '../lib/alma.mjs';

const provider = findProvider(await createApi(process.env.ALMA_API_URL)('/api/providers'));
assert.ok(provider?.enabled, '需要已安装且启用的 Devin 提供商。');
assert.equal(summary(provider).permissionMode, 'bypass', '提供商尚未升级。');
const marker = `ALMA_DEVIN_TOOL_${randomUUID().replaceAll('-', '')}`;
const child = spawn(provider.acpCommand, provider.acpArgs, { stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
let permissionRequests = 0;
let currentMode;
const tools = new Map();
const connection = client()
  .onRequest('session/request_permission', () => {
    permissionRequests++;
    return { outcome: { outcome: 'cancelled' } };
  })
  .onNotification('session/update', ({ params: { update } }) => {
    if (update.sessionUpdate === 'current_mode_update') currentMode = update.currentModeId;
    if (['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) {
      tools.set(update.toolCallId, { ...tools.get(update.toolCallId), ...update });
    }
  }).connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
try {
  await connection.agent.request('initialize', {
    protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
    clientInfo: { name: 'alma-devin-bypass-smoke', version: '0.1.2' },
  }, { signal: AbortSignal.timeout(30_000) });
  const session = await connection.agent.request('session/new', { cwd: process.cwd(), mcpServers: [] }, { signal: AbortSignal.timeout(30_000) });
  assert.equal(session.modes?.currentModeId, 'bypass');
  await connection.agent.request('session/set_mode', { sessionId: session.sessionId, modeId: 'bypass' }, { signal: AbortSignal.timeout(30_000) });
  assert.equal(currentMode, 'bypass');
  const response = await connection.agent.request('session/prompt', {
    sessionId: session.sessionId,
    prompt: [{ type: 'text', text: `Use the exec tool to run exactly: printf '%s\\n' '${marker}' | cat\nDo not write files or run other commands. Then reply with the command output.` }],
  }, { signal: AbortSignal.timeout(180_000) });
  assert.equal(response.stopReason, 'end_turn');
  assert.equal(permissionRequests, 0, '原生 bypass 仍请求了权限；未代为批准。');
  const executions = [...tools.values()].filter(tool => tool.kind === 'execute' || tool.toolCallId.startsWith('exec:'));
  assert.ok(executions.some(tool => tool.status === 'completed' && JSON.stringify(tool.content || tool.rawOutput).includes(marker)), '未观察到 exec 完成及真实输出。');
  assert.ok([...tools.values()].every(tool => tool.status === 'completed'), '存在未完成或失败工具。');
  console.log(JSON.stringify({ providerId: provider.id, sessionMode: currentMode, nativeTools: executions.length, permissionRequests, toolExecution: 'passed' }));
} catch {
  console.error('Devin bypass 工具实测失败：需要检查原生模式、工具完成事件及组织策略；未代为批准权限。');
  process.exitCode = 1;
} finally {
  connection.close();
  child.stdin.end();
  child.kill();
}
