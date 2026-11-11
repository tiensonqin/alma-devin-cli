import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

test('tool smoke refuses unknown adapters and requires an explicit native-only command without mutating the provider', async () => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push([request.method, request.url]);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify([{ id: 'devin-cli-acp', type: 'acp', enabled: true, acpCommand: 'node', acpArgs: ['devin-acp.mjs', '--', 'acp'], models: ['test-model'] }]));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const scenario of [
      { args: [], command: '', error: /不同配置占用/ },
      { args: ['--native-only'], command: '', error: /explicit DEVIN_PROBE_COMMAND/ },
      { args: ['--native-only'], command: 'node', error: /explicit DEVIN_PROBE_COMMAND/ },
    ]) {
      const child = spawn(process.execPath, ['scripts/tool-smoke.mjs', ...scenario.args], {
        env: { ...process.env, ALMA_API_URL: `http://127.0.0.1:${server.address().port}`, DEVIN_PROBE_COMMAND: scenario.command },
        signal: AbortSignal.timeout(5_000),
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
      assert.equal(code, 1, output);
      assert.match(output, scenario.error);
    }
    assert.deepEqual(requests, Array.from({ length: 3 }, () => ['GET', '/api/providers']));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
