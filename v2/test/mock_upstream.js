// 本地模拟 OpenAI 兼容上游（仅用于测试 Agent 循环与渐进式披露，不随应用发布）
const http = require('http');

const PORT = 39001;

function sse(obj) { return 'data: ' + JSON.stringify(obj) + '\n\n'; }

function decide(messages) {
  // 检查是否已存在 tool 结果（role=tool）
  const hasToolResult = messages.some(m => m.role === 'tool');
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const text = (lastUser && lastUser.content) || '';

  if (!hasToolResult) {
    if (/写作|技能|skill/i.test(text)) {
      return { kind: 'tool', name: 'use_skill', id: 'call_skill_1', args: '{"name":"写作助手"}' };
    }
    if (/几点|时间|现在.*钟/i.test(text)) {
      return { kind: 'tool', name: 'get_current_time', id: 'call_time_1', args: '{}' };
    }
  } else {
    // 有 tool 结果：读取最后一个 tool 消息内容，给出最终答复
    const toolMsg = [...messages].reverse().find(m => m.role === 'tool');
    const result = toolMsg ? toolMsg.content : '';
    if (messages.some(m => m.tool_call_id === 'call_skill_1' || (m.content || '').includes('【Skill'))) {
      return { kind: 'final', text: '已调用技能并按其指令执行。技能内容开头是：' + String(result).slice(0, 60) };
    }
    if (messages.some(m => m.tool_call_id === 'call_time_1')) {
      return { kind: 'final', text: '现在是：' + result };
    }
    return { kind: 'final', text: '工具结果已收到：' + String(result).slice(0, 60) };
  }
  return { kind: 'final', text: '收到你的消息：' + text.slice(0, 50) };
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end(); return;
  }
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch {}
    const messages = parsed.messages || [];
    const sysMsg = messages.find(m => m.role === 'system');
    console.log('REQ system=[' + (sysMsg ? sysMsg.content : '') + '] tools=' + (parsed.tools ? parsed.tools.map(t => t.function && t.function.name).join(',') : 'none'));
    const decision = decide(messages);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    if (decision.kind === 'tool') {
      res.write(sse({ id: '1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
      res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: '我需要先确认该调用哪个工具…' }, finish_reason: null }] }));
      res.write(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: decision.id, type: 'function', function: { name: decision.name, arguments: '' } }] }, finish_reason: null }] }));
      res.write(sse({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: decision.args } }] }, finish_reason: null }] }));
      res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
      res.end('data: [DONE]\n\n');
      return;
    }

    // final：先 reasoning，再分段 content
    const chunks = decision.text.split(/(?<=[，。！？])/);
    res.write(sse({ id: '1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] }));
    res.write(sse({ choices: [{ index: 0, delta: { reasoning_content: '思考完成，现在输出最终答案。' }, finish_reason: null }] }));
    for (const c of chunks) {
      if (c) res.write(sse({ choices: [{ index: 0, delta: { content: c }, finish_reason: null }] }));
    }
    res.write(sse({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
    res.end('data: [DONE]\n\n');
  });
});

server.listen(PORT, '127.0.0.1', () => console.log('MOCK upstream on 127.0.0.1:' + PORT));
