import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApi, ensureProvider, findProvider, discoverModels, summary, PLUGIN_ID } from '../lib/alma.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
let api;
const action = process.argv[2];

async function run() {
  api = createApi(process.env.ALMA_API_URL);
  if (action === 'install') {
    const command = process.env.DEVIN_COMMAND || execFileSync('which', ['devin'], { encoding: 'utf8' }).trim();
    const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
    const plugins = await api('/api/plugins');
    const entries = Array.isArray(plugins) ? plugins : plugins.plugins;
    if (!Array.isArray(entries)) throw new Error('无法识别 Alma 插件列表，停止安装。');
    const previous = entries.some(plugin => plugin.id === PLUGIN_ID) ? await api(`/api/plugins/${PLUGIN_ID}`) : undefined;
    const upgraded = previous && (previous.version !== manifest.version || process.argv.includes('--force'));
    if (!previous || upgraded) {
      const stage = await mkdtemp(join(root, '.install-'));
      try {
        for (const file of ['manifest.json', 'package.json', 'main.js', 'lib', 'bin']) {
          await cp(join(root, file), join(stage, file), { recursive: true });
        }
        for (const dependency of ['@agentclientprotocol/sdk', 'zod']) {
          await cp(join(root, 'node_modules', dependency), join(stage, 'node_modules', dependency), { recursive: true });
        }
        if (upgraded) await api(`/api/plugins/${PLUGIN_ID}`, 'DELETE');
        await api('/api/plugins', 'POST', { sourcePath: stage, source: 'global' });
        if (upgraded) {
          await api(`/api/plugins/${PLUGIN_ID}/settings`, 'PUT', previous.settings || {});
          for (const { permission, status } of previous.permissions || []) {
            if (['granted', 'denied'].includes(status)) await api(`/api/plugins/${PLUGIN_ID}/permissions`, 'PUT', { permission, status });
          }
          if (!previous.enabled) await api(`/api/plugins/${PLUGIN_ID}/disable`, 'POST', {});
        }
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
    const installed = await api(`/api/plugins/${PLUGIN_ID}`);
    if (installed.version !== manifest.version || !installed.sourcePath) throw new Error('插件版本或安装路径未确认，停止配置。');
    const { provider, created } = await ensureProvider(api, command, join(installed.sourcePath, 'bin', 'devin-acp.mjs'), process.execPath);
    const models = await discoverModels(api, provider);
    console.log(JSON.stringify({ installed: true, upgraded: Boolean(upgraded), enabled: installed.enabled, reusedProvider: !created, providerId: provider.id, permissionMode: summary(provider).permissionMode, discoveredModels: models.length }));
    return;
  }
  if (action === 'uninstall') {
    const installed = await api(`/api/plugins/${PLUGIN_ID}`);
    const provider = findProvider(await api('/api/providers'));
    if (provider?.acpArgs?.[0] === join(installed.sourcePath, 'bin', 'devin-acp.mjs')) {
      await api(`/api/providers/${encodeURIComponent(provider.id)}`, 'PUT', {
        acpCommand: provider.acpArgs[2], acpArgs: provider.acpArgs.slice(4),
      });
    }
    await api(`/api/plugins/${PLUGIN_ID}`, 'DELETE');
    console.log('插件已卸载。ACP 提供商和 Devin 登录保留；本插件启动层已还原为原生 Devin 命令，bypass 不再由插件保证。');
    return;
  }
  const provider = findProvider(await api('/api/providers'));
  if (!provider) throw new Error('未发现 Devin ACP 提供商，请先运行 npm run install:alma。');
  if (action === 'models') {
    const models = await discoverModels(api, provider);
    console.log(JSON.stringify({ providerId: provider.id, count: models.length, models: models.map(({ id, name }) => ({ id, name })) }, null, 2));
  } else if (action === 'doctor') {
    const result = await api(`/api/providers/${encodeURIComponent(provider.id)}/test`, 'POST', {});
    if (!result.success || result.error) throw new Error('原生 ACP 连接测试失败，请在 Mac 检查 Devin 登录及 Alma 提供商连接。');
    console.log(JSON.stringify({ ...summary(provider), connection: 'passed' }));
  } else if (action === 'smoke') {
    if (!provider.enabled) throw new Error('提供商已停用；不会自动更改用户设置。');
    const selected = summary(provider).selectedModels;
    const model = process.env.DEVIN_TEST_MODEL || selected[0];
    if (!selected.includes(model)) throw new Error('请先在 Alma 启用待测试模型。');
    const workspace = join(root, '.install-smoke-' + randomUUID());
    await mkdir(workspace);
    try {
      const threadId = 'alma-devin-smoke-' + randomUUID();
      const messages = [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Do not use any tools. Reply with exactly ALMA_DEVIN_OK.' }] }];
      const first = await api('/api/chat/completions', 'POST', {
        model: `${provider.id}:${model}`, stream: false, tools: 'none', threadId, workspacePath: workspace, messages,
      });
      const firstText = first.choices?.[0]?.message?.content;
      if (typeof firstText !== 'string' || !firstText.includes('ALMA_DEVIN_OK')) throw new Error('首轮聊天未返回预期标记。');
      messages.push(
        { id: randomUUID(), role: 'assistant', parts: [{ type: 'text', text: firstText }] },
        { id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Do not use tools. What exact marker did you just reply with? Reply with only that marker.' }] },
      );
      const second = await api('/api/chat/completions', 'POST', {
        model: `${provider.id}:${model}`, stream: false, tools: 'none', threadId, workspacePath: workspace, messages,
      });
      if (!second.choices?.[0]?.message?.content?.includes('ALMA_DEVIN_OK')) throw new Error('第二轮聊天未返回预期标记。');
      const stream = await api('/api/chat/completions', 'POST', {
        model: `${provider.id}:${model}`, stream: true, tools: 'none',
        threadId: `${threadId}-stream`, workspacePath: workspace,
        messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: 'Do not use any tools. Reply with exactly ALMA_DEVIN_STREAM_OK.' }] }],
      }, 'sse');
      if (!stream.text.includes('ALMA_DEVIN_STREAM_OK') || !stream.chunks) throw new Error('流式聊天未返回预期标记。');
      console.log(JSON.stringify({ providerId: provider.id, model, turns: 2, chat: 'passed', stream: 'passed', streamChunks: stream.chunks }));
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  } else {
    throw new Error('用法：node scripts/manage.mjs install|uninstall|doctor|models|smoke');
  }
}

run().catch(error => {
  console.error(error instanceof Error ? error.message : '未知错误');
  console.error('操作失败。请确认 Alma 已启动、Devin 已登录、提供商启用、端口正确。安装失败可能已保留提供商，请在设置中检查后重试。');
  process.exitCode = 1;
});
