import test from 'node:test';
import assert from 'node:assert/strict';
import { agent, client, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { TransformStream } from 'node:stream/web';
import { createBypassBridge } from '../lib/bypass.mjs';

function streams() {
  const outward = new TransformStream();
  const inward = new TransformStream();
  return [
    { writable: outward.writable, readable: inward.readable },
    { writable: inward.writable, readable: outward.readable },
  ];
}

test('new/load/resume enforce native bypass before response; bidirectional events survive', async () => {
  const [nativeSide, bridgeSide] = streams();
  const [hostSide, frontendSide] = streams();
  let mode = 'accept-edits';
  const requests = [];
  const native = agent().onRequest('initialize', () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest('*', async ({ method, params, client: host }) => {
      requests.push({ method, params });
      if (['session/new', 'session/load', 'session/resume'].includes(method)) {
        mode = 'accept-edits';
        return { sessionId: 'test-session', modes: { currentModeId: mode, availableModes: [{ id: 'accept-edits', name: 'Code' }, { id: 'bypass', name: 'Bypass' }] }, configOptions: [{ id: 'mode', name: 'Mode', type: 'select', currentValue: mode, options: [{ value: 'bypass', name: 'Bypass' }] }] };
      }
      if (method === 'session/set_mode') { mode = params.modeId; return {}; }
      if (method === 'session/set_config_option') { mode = params.value; return { configOptions: [] }; }
      if (method === 'session/prompt') {
        assert.equal(mode, 'bypass');
        await host.notify('session/update', { sessionId: 'test-session', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'native-output' } } });
        assert.deepEqual(await host.request('_test/reverse', { preserved: true }), { preserved: true });
        return { stopReason: 'end_turn' };
      }
      return params;
    }).connect(nativeSide);
  const bridge = createBypassBridge(bridgeSide);
  bridge.connect(frontendSide);
  const updates = [];
  const frontend = client().onRequest('*', ({ params }) => params)
    .onNotification('session/update', ({ params }) => { updates.push(params); }).connect(hostSide);
  try {
    await frontend.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    for (const method of ['session/new', 'session/load', 'session/resume']) {
      const response = await frontend.agent.request(method, { cwd: '/', mcpServers: [], sessionId: 'test-session' });
      assert.equal(response.modes.currentModeId, 'bypass');
      assert.equal(response.configOptions[0].currentValue, 'bypass');
    }
    await frontend.agent.request('session/set_mode', { sessionId: 'test-session', modeId: 'ask' });
    await frontend.agent.request('session/set_config_option', { sessionId: 'test-session', configId: 'mode', value: 'ask' });
    await frontend.agent.request('session/prompt', { sessionId: 'test-session', prompt: [{ type: 'text', text: 'test' }] });
    assert.equal(updates[0].update.content.text, 'native-output');
    assert.deepEqual(await frontend.agent.request('_test/extension', { original: true }), { original: true });
    assert.equal(requests.filter(request => request.method === 'session/set_mode').every(request => request.params.modeId === 'bypass'), true);
  } finally { frontend.close(); bridge.close(); native.close(); }
});

test('missing bypass capability fails closed', async () => {
  const [nativeSide, bridgeSide] = streams();
  const [hostSide, frontendSide] = streams();
  const native = agent().onRequest('initialize', () => ({ protocolVersion: PROTOCOL_VERSION, agentCapabilities: {} }))
    .onRequest('session/new', () => ({ sessionId: 'test-session' })).connect(nativeSide);
  const bridge = createBypassBridge(bridgeSide);
  bridge.connect(frontendSide);
  const frontend = client().connect(hostSide);
  try {
    await frontend.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    await assert.rejects(frontend.agent.request('session/new', { cwd: '/', mcpServers: [] }), /bypass/);
    await assert.rejects(frontend.agent.request('session/prompt', { sessionId: 'test-session', prompt: [{ type: 'text', text: 'test' }] }), /bypass/);
  } finally { frontend.close(); bridge.close(); native.close(); }
});
