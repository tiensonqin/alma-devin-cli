import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const bundle = process.env.ALMA_SERVER_PATH || '/Applications/Alma.app/Contents/Resources/alma-server/lib/server.mjs';
const source = await readFile(bundle, 'utf8');
const start = source.indexOf('handleACPToolExecutionResult(e){');
const end = source.indexOf('persistGenerationFailureNoticeForAutomatedTurn(', start);
if (start < 0 || end < 0 || end - start > 12_000) throw new Error('Unknown host reducer shape; no check was run.');
const rows = [];
const terminalCache = new Map();
const warnings = [];
const reducer = runInNewContext('({' + source.slice(start, end) + '})', {
  I: {
    getMessagesByThreadId: () => rows,
    updateMessageContent: (id, message) => { rows.find(row => row.id === id).message = message; },
    getMessageById: id => rows.find(row => row.id === id),
  },
  Q_n: (id, result) => terminalCache.set(id, result),
  console: { log() {}, warn: message => warnings.push(message), error: () => { throw new Error('Host reducer threw.'); } },
}, { timeout: 1_000 });
Object.assign(reducer, {
  acpPermissionDeniedThreads: new Set(), deniedAcpToolCallIds: new Map(), generationTimerResetRefs: new Map(), broadcastThreadSync() {},
});
const event = { threadId: 'probe-thread', toolCallId: 'probe-tool', status: 'permission-requested' };
reducer.handleACPToolExecutionResult(event);
rows.push({ id: 'probe-message', message: { role: 'assistant', parts: [{ toolCallId: event.toolCallId, state: 'input-available' }] } });
const lost = rows[0].message.parts[0].state !== 'approval-requested';
reducer.handleACPToolExecutionResult({ ...event, status: 'permission-denied', output: 'timeout' });
const denied = rows[0].message.parts[0].state === 'permission-denied';
reducer.handleACPToolExecutionResult({ ...event, status: 'failed', output: 'synthetic error', isError: true });
const terminal = rows[0].message.parts[0].state === 'output-error' && terminalCache.has(event.toolCallId);
console.log(JSON.stringify({
  check: 'isolated installed host reducer; synthetic memory only, no app/database mutations',
  permissionBeforePart: lost ? 'FAIL: pending approval was not retained' : 'passed',
  warningObserved: warnings.some(message => message.includes('Tool part not found')),
  denialAfterPart: denied ? 'passed' : 'failed',
  terminalAfterPart: terminal ? 'passed' : 'failed',
  scope: 'Does not prove whether the separate approval dialog was delivered or visible.',
}, null, 2));
if (lost || !denied || !terminal) process.exitCode = 1;
