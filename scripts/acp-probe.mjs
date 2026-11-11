import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function connectProbe(command, args, cwd, timeoutMs = 90_000) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map();
  const updates = [];
  const permissions = [];
  let nextId = 0;
  let listener = () => {};
  let failure;
  let permissionOutcome = 'deny';
  let permissionHandler;
  const send = message => {
    if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
  };
  const fail = error => {
    failure = error;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  };
  const lines = createInterface({ input: child.stdout });
  child.once('error', () => fail(new Error('ACP probe subprocess failed to start.')));
  child.stdin.on('error', () => fail(new Error('ACP probe input stream closed.')));
  child.once('exit', () => fail(new Error('ACP probe subprocess exited.')));
  lines.on('line', line => {
    try {
      const message = JSON.parse(line);
      if (message.method === 'session/update') {
        updates.push(message.params.update);
        listener(message.params.update);
      } else if (message.method === 'session/request_permission') {
        permissions.push(message.params);
        const reject = message.params.options.find(option => option.kind === 'reject_once');
        const outcome = permissionHandler?.(message.params) || (permissionOutcome === 'cancel' || !reject
          ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: reject.optionId });
        send({ id: message.id, result: { outcome } });
      } else if (message.method && message.id !== undefined) {
        send({ id: message.id, error: { code: -32601, message: 'Probe does not expose client tools.' } });
      } else if (pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error) request.reject(new Error(`ACP request failed (${message.error.code}).`));
        else request.resolve(message.result);
      }
    } catch {
      fail(new Error('ACP probe received an invalid protocol event.'));
    }
  });
  return {
    updates,
    permissions,
    onUpdate(callback) { listener = callback; },
    onPermission(callback) { permissionHandler = callback; },
    cancelPermissions() { permissionOutcome = 'cancel'; },
    notify(method, params) { send({ method, params }); },
    request(method, params) {
      if (failure) return Promise.reject(failure);
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          fail(new Error(`ACP probe timed out: ${method}; only the probe subprocess is stopped.`));
          child.kill('SIGTERM');
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        send({ id, method, params });
      });
    },
    async close() {
      fail(new Error('ACP probe closed.'));
      lines.close();
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      await new Promise(resolve => {
        const terminateTimer = setTimeout(() => child.kill('SIGTERM'), 500);
        const killTimer = setTimeout(() => child.kill('SIGKILL'), 2_500);
        child.once('exit', () => { clearTimeout(terminateTimer); clearTimeout(killTimer); resolve(); });
        child.stdin.end();
      });
    },
  };
}

export function toolSummary(updates) {
  const calls = new Map();
  let text = '';
  for (const update of updates) {
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') text += update.content.text;
    if (!['tool_call', 'tool_call_update'].includes(update.sessionUpdate)) continue;
    const previous = calls.get(update.toolCallId) || {};
    calls.set(update.toolCallId, { ...previous, ...update });
  }
  return { text, calls: [...calls.values()] };
}

export function allowProbeSleep(params, updates, workspace) {
  const call = toolSummary(updates).calls.find(item => item.toolCallId === params.toolCall.toolCallId);
  const input = call?.rawInput;
  if (input?.command !== 'sleep 20' || (input.workdir && input.workdir !== workspace)) return;
  const allow = params.options.find(option => option.kind === 'allow_once');
  return allow ? { outcome: 'selected', optionId: allow.optionId } : undefined;
}
