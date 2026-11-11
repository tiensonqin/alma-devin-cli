import { basename } from 'node:path';
import { readChatStream } from './chat-stream.mjs';

export const PROVIDER_ID = 'devin-cli-acp';
export const PLUGIN_ID = 'alma-devin-cli';

export function createApi(base = 'http://localhost:23001', fetchImpl = fetch) {
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new Error('Alma API 地址无效。');
  }
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('Alma API 必须是无凭据的本机 HTTP loopback 根地址。');
  }
  return async (path, method = 'GET', body, format = 'json') => {
    if (!['json', 'sse'].includes(format)) throw new Error('不支持的 Alma 响应格式。');
    const response = await fetchImpl(new URL(path, url), {
      method,
      redirect: 'error',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok) throw new Error(`Alma ${method} ${path}: HTTP ${response.status}，请检查 Alma 版本、运行状态及登录。`);
    if (format === 'sse') return readChatStream(response.body);
    return response.status === 204 ? undefined : response.json();
  };
}

export function isDevinProvider(provider) {
  return provider.type === 'acp' && basename(provider.acpCommand || '') === 'devin'
    && Array.isArray(provider.acpArgs) && provider.acpArgs.includes('acp');
}

export function findProvider(providers) {
  const canonical = providers.find(provider => provider.id === PROVIDER_ID);
  if (canonical) {
    if (!isDevinProvider(canonical)) throw new Error('devin-cli-acp 已被不同配置占用；不会覆盖。');
    return canonical;
  }
  const matches = providers.filter(isDevinProvider);
  if (matches.length > 1) throw new Error('发现多个 Devin ACP 提供商；请在 Alma 设置中明确保留所需配置。');
  return matches[0];
}

export async function ensureProvider(api, command = 'devin') {
  if (!command || basename(command) !== 'devin') throw new Error('command 必须指向 Devin 可执行文件，不能包含 shell 参数。');
  const existing = findProvider(await api('/api/providers'));
  if (existing) return { provider: existing, created: false };
  const provider = await api('/api/providers', 'POST', {
    id: PROVIDER_ID,
    name: 'Devin CLI (ACP)',
    type: 'acp',
    enabled: true,
    acpCommand: command,
    acpArgs: ['acp'],
    models: [],
  });
  return { provider, created: true };
}

export async function discoverModels(api, provider) {
  const path = `/api/providers/${encodeURIComponent(provider.id)}`;
  const result = await api(`${path}/models/fetch`, 'POST', {});
  const models = result.models;
  if (!Array.isArray(models) || !models.length || models.every(model => model.id === 'default')) {
    throw new Error('原生 ACP 未返回真实模型；请运行 devin auth login 后重试。');
  }
  const latest = (await api('/api/providers')).find(item => item.id === provider.id);
  if (!latest) throw new Error('模型刷新期间提供商被移除，请重试。');
  if (!latest.models?.length) {
    await api(`${path}/models`, 'PUT', { models: [models[0].id] });
  }
  return models;
}

export function summary(provider) {
  return {
    providerId: provider.id,
    enabled: provider.enabled,
    transport: 'native-acp-stdio',
    selectedModels: (provider.models || []).map(model => typeof model === 'string' ? model : model.id),
    availableModelCount: provider.availableModels?.length || 0,
  };
}
