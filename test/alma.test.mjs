import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ensureProvider, findProvider, discoverModels, summary } from '../lib/alma.mjs';
import { fileURLToPath } from 'node:url';
import { activate } from '../main.js';

const launcher = fileURLToPath(new URL('../bin/devin-acp.mjs', import.meta.url));
const existing = { id: 'devin-cli-acp', type: 'acp', acpCommand: process.execPath, acpArgs: [launcher, '--devin-command', 'devin', '--', 'acp'], enabled: true, models: ['real-model'] };

test('reuse canonical provider without mutation or exposing credentials', async () => {
  const calls = [];
  const result = await ensureProvider(async (...args) => { calls.push(args); return [{ ...existing, apiKey: 'not-a-real-secret' }]; });
  assert.equal(result.created, false);
  assert.equal(calls.length, 1);
  assert.equal(JSON.stringify(summary(result.provider)).includes('not-a-real-secret'), false);
});

test('reuse differently named provider and refuse ambiguous/colliding configuration', () => {
  const alternate = { ...existing, id: 'other-devin' };
  assert.equal(findProvider([alternate]), alternate);
  assert.throws(() => findProvider([alternate, { ...alternate, id: 'another' }]), /多个/);
  assert.throws(() => findProvider([{ ...existing, type: 'openai' }]), /不会覆盖/);
  assert.throws(() => findProvider([{ ...existing, acpArgs: [] }]), /不会覆盖/);
});

test('create only a native ACP provider with stable identity', async () => {
  const calls = [];
  const result = await ensureProvider(async (...args) => {
    calls.push(args);
    return args[1] === 'POST' ? args[2] : [];
  });
  assert.equal(result.created, true);
  assert.deepEqual(calls[1], ['/api/providers', 'POST', {
    id: 'devin-cli-acp', name: 'Devin CLI (ACP)', type: 'acp', enabled: true,
    acpCommand: 'node', acpArgs: existing.acpArgs, models: [],
  }]);
});

test('upgrade only Devin launch fields, preserve native arguments and other providers', async () => {
  const legacy = { ...existing, id: 'custom-devin', acpCommand: 'devin', acpArgs: ['acp', '--model', 'keep-model'], enabled: false, acpMcpServerIds: ['keep'] };
  const calls = [];
  const result = await ensureProvider(async (...args) => {
    calls.push(args);
    return args[1] === 'PUT' ? { ...legacy, ...args[2] } : [{ id: 'other', type: 'openai' }, legacy];
  });
  assert.deepEqual(calls[2], ['/api/providers/custom-devin', 'PUT', {
    acpCommand: 'node', acpArgs: [launcher, '--devin-command', 'devin', '--', ...legacy.acpArgs],
  }]);
  assert.equal(result.provider.enabled, false);
  assert.deepEqual(result.provider.acpMcpServerIds, ['keep']);
  assert.equal(summary(result.provider).permissionMode, 'bypass');
});

test('concurrent provider launch changes are not overwritten', async () => {
  let reads = 0;
  const legacy = { ...existing, acpCommand: 'devin', acpArgs: ['acp'] };
  await assert.rejects(ensureProvider(async (path, method) => {
    assert.equal(method, undefined);
    return [{ ...legacy, acpArgs: ++reads === 1 ? ['acp'] : ['acp', '--model', 'parallel-edit'] }];
  }), /并行修改/);
});

test('model discovery preserves existing selections and only initializes empty selection', async () => {
  for (const selection of [[], ['keep-user-model']]) {
    const calls = [];
    const models = await discoverModels(async (...args) => {
      calls.push(args);
      if (args[0].endsWith('/fetch')) return { models: [{ id: 'discovered', name: 'Discovered' }] };
      return [{ ...existing, models: selection }];
    }, existing);
    assert.equal(models[0].id, 'discovered');
    assert.equal(calls.filter(call => call[1] === 'PUT').length, selection.length ? 0 : 1);
  }
});

test('reject fallback-only discovery instead of claiming success', async () => {
  await assert.rejects(discoverModels(async () => ({ models: [{ id: 'default' }] }), existing), /真实模型/);
});

test('restrict local API and reject redirects and error bodies', async () => {
  for (const url of ['bad-secret-input', 'https://localhost', 'http://example.com', 'http://user:secret@localhost', 'http://localhost/api', 'http://localhost?token=secret']) {
    assert.throws(() => createApi(url));
  }
  const api = createApi('http://127.0.0.1:23001', async (url, options) => {
    assert.equal(url.hostname, '127.0.0.1');
    assert.equal(options.redirect, 'error');
    return { ok: false, status: 403, text: () => 'secret' };
  });
  await assert.rejects(api('/api/providers'), error => error.message.includes('403') && !error.message.includes('secret'));
});

test('activation registers real command API, reuses provider, disposes cleanly', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json([existing]); };
  const commands = new Map();
  let disposed = 0;
  try {
    const plugin = await activate({
      settings: { get: (key, fallback) => fallback },
      commands: { register: (id, callback) => { commands.set(id, callback); return { dispose: () => disposed++ }; } },
      logger: { info() {}, warn() {} }, ui: { showNotification() {} },
    });
    assert.equal(requests, 1);
    assert.equal((await commands.get('status')()).providerId, existing.id);
    assert.equal(commands.has('refreshModels'), true);
    plugin.dispose();
    assert.equal(disposed, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
