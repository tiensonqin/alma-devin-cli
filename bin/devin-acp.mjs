import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { ndJsonStream } from '@agentclientprotocol/sdk';
import { createBypassBridge } from '../lib/bypass.mjs';

const [option, command, separator, ...args] = process.argv.slice(2);
if (option !== '--devin-command' || !command || separator !== '--' || !args.includes('acp')) {
  console.error('用法：node bin/devin-acp.mjs --devin-command devin -- acp');
  process.exitCode = 1;
} else {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const bridge = createBypassBridge(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  const host = bridge.connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
  const cleanup = () => {
    bridge.close();
    child.stdin.end();
    child.kill();
  };
  host.closed.then(cleanup);
  process.once('SIGTERM', cleanup);
  process.once('SIGINT', cleanup);
  child.once('error', () => {
    console.error('无法启动 Devin ACP；请检查命令路径。');
    process.exitCode = 1;
    cleanup();
  });
  child.once('exit', code => {
    process.exitCode = code ?? 1;
    bridge.close();
    process.stdin.destroy();
  });
}
