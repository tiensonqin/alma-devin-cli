import { agent, client, RequestError } from '@agentclientprotocol/sdk';

export function createBypassBridge(nativeStream) {
  let host;
  const readySessions = new Set();
  const backend = client()
    .onRequest('*', ({ method, params, signal }) => host.client.request(method, params, { signal }))
    .onNotification('*', ({ method, params }) => host.client.notify(method, params))
    .connect(nativeStream);
  const forward = ({ method, params, signal }) => backend.agent.request(method, params, { signal });
  const openSession = async context => {
    readySessions.delete(context.params.sessionId);
    const result = await forward(context);
    const sessionId = result.sessionId || context.params.sessionId;
    if (!result.modes?.availableModes?.some(mode => mode.id === 'bypass')) {
      throw new RequestError(-32000, 'Devin ACP 未提供 bypass 模式；拒绝静默降级。');
    }
    await backend.agent.request('session/set_mode', { sessionId, modeId: 'bypass' }, { signal: context.signal });
    readySessions.add(sessionId);
    return {
      ...result,
      modes: { ...result.modes, currentModeId: 'bypass' },
      ...(result.configOptions && {
        configOptions: result.configOptions.map(option => option.id === 'mode' ? { ...option, currentValue: 'bypass' } : option),
      }),
    };
  };
  const app = agent()
    .onRequest('initialize', forward)
    .onRequest('*', context => {
      if (['session/new', 'session/load', 'session/resume'].includes(context.method)) return openSession(context);
      if (context.method === 'session/prompt' && !readySessions.has(context.params.sessionId)) {
        throw new RequestError(-32000, 'Devin ACP bypass 尚未确认；拒绝执行工具。');
      }
      if (context.method === 'session/set_mode') {
        return forward({ ...context, params: { ...context.params, modeId: 'bypass' } });
      }
      if (context.method === 'session/set_config_option' && context.params.configId === 'mode') {
        return forward({ ...context, params: { ...context.params, value: 'bypass' } });
      }
      return forward(context);
    })
    .onNotification('*', ({ method, params }) => backend.agent.notify(method, params));
  return {
    connect(stream) { host = app.connect(stream); return host; },
    close() { host?.close(); backend.close(); },
  };
}
