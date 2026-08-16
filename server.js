const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listConversations, createConversation, getConversation, deleteConversation, appendMessage, renameConversation, setSystemPrompt, listComparisons, getComparison, addComparison } = require('./store');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || ''; // 留空 => 同时监听 IPv4 与 IPv6
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-pro';
const SYSTEM_PROMPT = 'You are a helpful AI assistant.';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 2 * 1024 * 1024) { req.destroy(); reject(new Error('body too large')); } });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // fallback to index.html for SPA-ish routing
      filePath = path.join(PUBLIC_DIR, 'index.html');
      fs.stat(filePath, (err2, stat2) => {
        if (err2) { res.writeHead(404); res.end('Not Found'); return; }
        serveFile(res, filePath);
      });
      return;
    }
    serveFile(res, filePath);
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

function sseWrite(res, obj) {
  if (res.writableEnded || res.destroyed) return;
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}


// 流式调用上游 chat/completions，边读边通过 SSE 转发，返回完整文本
async function streamCompletion(res, apiKey, model, baseUrl, messages) {
  const upstream = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  res.on('error', () => {});
  const timeout = setTimeout(() => controller.abort('timeout'), 120000);
  let full = '';
  try {
    const upstreamRes = await fetch(`${upstream}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, messages, stream: true }),
      signal: controller.signal,
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      sseWrite(res, { error: `上游接口错误 (${upstreamRes.status}): ${text}` });
      res.end();
      return { error: true, full };
    }

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            sseWrite(res, { content: delta });
          }
        } catch { /* skip malformed frames */ }
      }
    }
    return { error: false, full, aborted: false };
  } catch (err) {
    if (controller.signal.aborted && controller.signal.reason !== 'timeout') {
      return { error: false, full, aborted: true };
    }
    sseWrite(res, { error: controller.signal.reason === 'timeout' ? '上游响应超时，请稍后重试' : String(err.message || err) });
    res.end();
    return { error: true, full };
  } finally {
    clearTimeout(timeout);
  }
}

async function handleChat(req, res, body) {
  const apiKey = req.headers['x-api-key'];
  const { conversationId, side = 'left', message, model, baseUrl, systemPrompt } = body || {};
  if (!apiKey) return sendJson(res, 400, { error: '缺少 API Key，请先在设置中填写' });
  if (!conversationId || !message) return sendJson(res, 400, { error: '缺少会话 ID 或消息内容' });

  const conv = getConversation(conversationId);
  if (!conv) return sendJson(res, 404, { error: '会话不存在' });

  const sideKey = side === 'right' ? 'right' : 'left';
  appendMessage(conversationId, sideKey, { role: 'user', content: message });
  const sideMessages = Array.isArray(conv.messages[sideKey]) ? conv.messages[sideKey] : [];
  const total = (conv.messages.left ? conv.messages.left.length : 0) + (conv.messages.right ? conv.messages.right.length : 0);
  if (total === 1) renameConversation(conversationId, message.slice(0, 30));

  // 优先使用请求携带的 systemPrompt（文本框当前内容），并同步持久化
  let systemText = typeof systemPrompt === 'string' ? systemPrompt : '';
  if (systemText) setSystemPrompt(conversationId, sideKey, systemText);
  if (!systemText && conv.systemPrompt && conv.systemPrompt[sideKey]) {
    systemText = conv.systemPrompt[sideKey];
  }

  const messages = systemText.trim()
    ? [{ role: 'system', content: systemText }, ...sideMessages]
    : [{ role: 'system', content: SYSTEM_PROMPT }, ...sideMessages];

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const result = await streamCompletion(res, apiKey, model, baseUrl, messages);
  if (result.error) return;
  if (result.full) appendMessage(conversationId, sideKey, { role: 'assistant', content: result.full });
  sseWrite(res, { done: true });
  res.end();
}

async function handleCompare(req, res, body) {
  const apiKey = req.headers['x-api-key'];
  const { conversationId, model, baseUrl, systemPromptLeft, systemPromptRight } = body || {};
  if (!apiKey) return sendJson(res, 400, { error: '缺少 API Key，请先在设置中填写' });
  if (!conversationId) return sendJson(res, 400, { error: '缺少会话 ID' });

  const conv = getConversation(conversationId);
  if (!conv) return sendJson(res, 404, { error: '会话不存在' });

  const leftSys = typeof systemPromptLeft === 'string' ? systemPromptLeft : ((conv.systemPrompt && conv.systemPrompt.left) || '');
  const rightSys = typeof systemPromptRight === 'string' ? systemPromptRight : ((conv.systemPrompt && conv.systemPrompt.right) || '');
  const leftMsgs = Array.isArray(conv.messages.left) ? conv.messages.left : [];
  const rightMsgs = Array.isArray(conv.messages.right) ? conv.messages.right : [];

  const formatMsgs = (msgs) => msgs.length
    ? msgs.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n')
    : '（暂无对话记录）';

  const system = '你是一位专业的提示词（Prompt）对比分析专家。你会对比左右两个窗口的系统提示词与聊天记录，详细分析左右提示词的差异是如何影响模型回复的。请用中文回答，条理清晰，分点说明，并给出可执行的优化建议。';
  const user = [
    '请对比分析以下左右两个窗口的差异：',
    '',
    `【左侧 System Prompt】\n${leftSys || '（空）'}`,
    '',
    `【右侧 System Prompt】\n${rightSys || '（空）'}`,
    '',
    `【左侧聊天记录】\n${formatMsgs(leftMsgs)}`,
    '',
    `【右侧聊天记录】\n${formatMsgs(rightMsgs)}`,
    '',
    '请详细分析：1) 左右 System Prompt 具体有哪些不同；2) 这些差异如何影响了各自模型对用户的回复（结合聊天记录举例说明）；3) 给出优化建议。',
  ].join('\n');

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const result = await streamCompletion(res, apiKey, model, baseUrl, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]);
  if (result.error) return;
  addComparison(conversationId, { analysis: result.full || '（模型未返回内容）' });
  sseWrite(res, { done: true });
  res.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    if (req.method === 'GET' && pathname === '/api/health') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/conversations') {
      sendJson(res, 200, listConversations());
      return;
    }

    if (req.method === 'POST' && pathname === '/api/conversations') {
      const body = await readBody(req);
      const conv = createConversation(body.title || '新对话');
      sendJson(res, 201, conv);
      return;
    }

    const m = pathname.match(/^\/api\/conversations\/([^/]+)$/);
    if (m) {
      const id = m[1];
      if (req.method === 'GET') {
        const conv = getConversation(id);
        if (!conv) return sendJson(res, 404, { error: '会话不存在' });
        sendJson(res, 200, conv);
        return;
      }
      if (req.method === 'PATCH') {
        const body = await readBody(req);
        const side = body.side === 'right' ? 'right' : 'left';
        const text = typeof body.text === 'string' ? body.text : '';
        if (!setSystemPrompt(id, side, text)) return sendJson(res, 404, { error: '会话不存在' });
        sendJson(res, 200, { ok: true });
        return;
      }
      if (req.method === 'DELETE') {
        if (!deleteConversation(id)) return sendJson(res, 404, { error: '会话不存在' });
        sendJson(res, 200, { ok: true });
        return;
      }
    }


    const cm = pathname.match(/^\/api\/conversations\/([^/]+)\/comparisons$/);
    if (cm) {
      const id = cm[1];
      if (req.method === 'GET') {
        const list = listComparisons(id);
        if (!list) return sendJson(res, 404, { error: '会话不存在' });
        sendJson(res, 200, list);
        return;
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        body.conversationId = id; // 会话 ID 取自 URL 路径
        await handleCompare(req, res, body);
        return;
      }
    }

    const cmi = pathname.match(/^\/api\/conversations\/([^/]+)\/comparisons\/([^/]+)$/);
    if (cmi) {
      if (req.method === 'GET') {
        const item = getComparison(cmi[1], cmi[2]);
        if (!item) return sendJson(res, 404, { error: '对比记录不存在' });
        sendJson(res, 200, item);
        return;
      }
    }
    if (req.method === 'POST' && pathname === '/api/chat') {
      const body = await readBody(req);
      await handleChat(req, res, body);
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: '接口不存在' });
      return;
    }

    serveStatic(req, res, pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch (err) {
    if (!res.headersSent) {
      sendJson(res, 400, { error: err.message });
    } else {
      res.end();
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用。请先关闭占用该端口的程序，或设置环境变量 PORT 换一个端口后重试。`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {  console.log(`AI Agent 服务已启动: http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const ni of nets[name]) {
      if (ni.family === 'IPv4' && !ni.internal) {
        console.log(`局域网访问: http://${ni.address}:${PORT}`);
      }
    }
  }
  console.log(`模型: ${DEFAULT_MODEL} | 上游: ${DEFAULT_BASE_URL}`);
});







