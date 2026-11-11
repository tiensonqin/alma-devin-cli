import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';

async function withHost(handler, callback) {
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    try {
      const result = await handler(request.method, request.url, text ? JSON.parse(text) : undefined);
      response.writeHead(result === undefined ? 204 : 200, { 'Content-Type': 'application/json' });
      response.end(result === undefined ? undefined : JSON.stringify(result));
    } catch {
      response.writeHead(500);
      response.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    await callback(async action => {
      const child = spawn(process.execPath, ['scripts/manage.mjs', action], {
        env: { ...process.env, ALMA_API_URL: apiUrl, DEVIN_COMMAND: 'devin', DEVIN_TEST_MODEL: 'test-model' },
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const code = await new Promise(resolve => child.on('close', resolve));
      assert.equal(code, 0, output);
      return output;
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('installer stages only plugin files, is idempotent, uninstall retains provider', async () => {
  let provider;
  let installed = false;
  let createCount = 0;
  let installCount = 0;
  await withHost(async (method, path, body) => {
    if (path === '/api/providers' && method === 'GET') return provider ? [provider] : [];
    if (path === '/api/providers' && method === 'POST') {
      createCount++;
      provider = { ...body, models: [] };
      return provider;
    }
    if (path.endsWith('/models/fetch')) return { models: [{ id: 'test-model' }] };
    if (path.endsWith('/models') && method === 'PUT') {
      provider.models = body.models;
      return provider;
    }
    if (path === '/api/plugins' && method === 'GET') return installed ? [{ id: 'alma-devin-cli' }] : [];
    if (path === '/api/plugins' && method === 'POST') {
      assert.deepEqual((await readdir(body.sourcePath)).sort(), ['lib', 'main.js', 'manifest.json']);
      installed = true;
      installCount++;
      return { enabled: true };
    }
    if (path === '/api/plugins/alma-devin-cli' && method === 'GET') return { enabled: installed };
    if (path === '/api/plugins/alma-devin-cli' && method === 'DELETE') { installed = false; return; }
    throw new Error('Unexpected request');
  }, async run => {
    await run('install');
    await run('install');
    assert.equal(createCount, 1);
    assert.equal(installCount, 1);
    await run('uninstall');
    assert.equal(installed, false);
    assert.equal(provider.id, 'devin-cli-acp');
  });
});

test('smoke uses Alma UI message parts and carries second-turn context', async () => {
  let turns = 0;
  await withHost(async (method, path, body) => {
    if (path === '/api/providers') return [{ id: 'devin-cli-acp', type: 'acp', enabled: true, acpCommand: 'devin', acpArgs: ['acp'], models: ['test-model'] }];
    assert.equal(path, '/api/chat/completions');
    assert.equal(method, 'POST');
    assert.equal(body.tools, 'none');
    assert.equal(body.model, 'devin-cli-acp:test-model');
    assert.ok(body.messages.every(message => message.id && message.parts?.[0]?.type === 'text'));
    turns++;
    if (turns === 2) {
      assert.equal(body.messages.length, 3);
      assert.equal(body.messages[1].parts[0].text, 'ALMA_DEVIN_OK');
    }
    return { choices: [{ message: { content: 'ALMA_DEVIN_OK' } }] };
  }, async run => { await run('smoke'); });
  assert.equal(turns, 2);
});
