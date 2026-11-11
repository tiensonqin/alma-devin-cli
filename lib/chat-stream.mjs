export async function readChatStream(body) {
  if (!body) throw new Error('Alma 未返回流式响应体。');
  const decoder = new TextDecoder();
  let pending = '';
  let data = [];
  let text = '';
  let chunks = 0;
  let done = false;
  const limit = 1_048_576;
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join('\n');
    data = [];
    if (done) throw new Error('Alma 在流结束标记后返回了额外数据。');
    if (payload === '[DONE]') {
      done = true;
      return;
    }
    let event;
    try {
      event = JSON.parse(payload);
    } catch {
      throw new Error('Alma 返回了无效的流式 JSON 事件。');
    }
    if (!event || typeof event !== 'object') throw new Error('Alma 返回了无效的流式事件结构。');
    if (event.error) throw new Error('Alma 流式聊天返回错误；未输出服务端原始错误内容。');
    const delta = event.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      chunks++;
      text += delta;
      if (text.length > limit) throw new Error('Alma 流式测试响应超过大小限制。');
    }
  };
  const consume = line => {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) dispatch();
    else if (line.startsWith('data:')) {
      const value = line.slice(5);
      data.push(value.startsWith(' ') ? value.slice(1) : value);
    }
  };
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    if (pending.length + data.join('\n').length > limit) throw new Error('Alma 流式事件超过大小限制。');
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      consume(pending.slice(0, newline));
      pending = pending.slice(newline + 1);
    }
  }
  pending += decoder.decode();
  if (pending) consume(pending);
  dispatch();
  if (!done) throw new Error('Alma 流式响应提前结束，未收到 [DONE]。');
  return { text, chunks, done };
}
