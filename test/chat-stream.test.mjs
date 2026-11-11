import test from 'node:test';
import assert from 'node:assert/strict';
import { readChatStream } from '../lib/chat-stream.mjs';
import { createApi } from '../lib/alma.mjs';

function fragmented(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset++) controller.enqueue(bytes.slice(offset, offset + 1));
      controller.close();
    },
  });
}

test('parse fragmented UTF-8, CRLF, multiline data and completion marker', async () => {
  const result = await readChatStream(fragmented(': keepalive\r\nevent: message\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" OK"}}]}\n\ndata: [DONE]\n\n'));
  assert.deepEqual(result, { text: '你好 OK', chunks: 2, done: true });
});

test('reject premature EOF instead of reporting a successful partial response', async () => {
  await assert.rejects(readChatStream(fragmented('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')), /未收到/);
});

test('reject stream errors without exposing server error contents', async () => {
  await assert.rejects(readChatStream(fragmented('data: {"error":{"message":"synthetic-sensitive-content"}}\n\n')), error => {
    assert.match(error.message, /返回错误/);
    assert.equal(error.message.includes('synthetic-sensitive-content'), false);
    return true;
  });
});

test('reject malformed events and data after completion', async () => {
  for (const value of ['data: not-json\n\n', 'data: null\n\n', 'data: [DONE]\n\ndata: {}\n\n']) {
    await assert.rejects(readChatStream(fragmented(value)));
  }
});

test('reject missing body and oversized SSE events', async () => {
  await assert.rejects(readChatStream(null), /响应体/);
  await assert.rejects(readChatStream(new Response('data: ' + 'x'.repeat(1_048_577)).body), /大小限制/);
});

test('stream requests retain local-only API validation and HTTP error handling', async () => {
  const api = createApi('http://127.0.0.1:23001', async (url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).stream, true);
    return new Response('data: [DONE]\n\n');
  });
  assert.deepEqual(await api('/api/chat/completions', 'POST', { stream: true }, 'sse'), { text: '', chunks: 0, done: true });
  const failed = createApi('http://127.0.0.1:23001', async () => new Response('private server error', { status: 500 }));
  await assert.rejects(failed('/api/chat/completions', 'POST', {}, 'sse'), /HTTP 500/);
});
