const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'conversations.json');

let state = { conversations: [] };
let loaded = false;

function load() {
  if (loaded) return;
  loaded = true;
  try {
    if (fs.existsSync(FILE)) {
      state = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    }
  } catch {
    state = { conversations: [] };
  }
  if (!Array.isArray(state.conversations)) state.conversations = [];
  // 兼容旧版数据：messages 数组 -> { left, right }；补 systemPrompt
  for (const conv of state.conversations) {
    if (Array.isArray(conv.messages)) {
      conv.messages = { left: conv.messages, right: [] };
    }
    if (!conv.messages || typeof conv.messages !== 'object') {
      conv.messages = { left: [], right: [] };
    }
    if (!Array.isArray(conv.messages.left)) conv.messages.left = [];
    if (!Array.isArray(conv.messages.right)) conv.messages.right = [];
    if (!conv.systemPrompt || typeof conv.systemPrompt !== 'object') {
      conv.systemPrompt = { left: '', right: '' };
    }
    if (typeof conv.systemPrompt.left !== 'string') conv.systemPrompt.left = '';
    if (typeof conv.systemPrompt.right !== 'string') conv.systemPrompt.right = '';
    if (!Array.isArray(conv.comparisons)) conv.comparisons = [];
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, FILE);
}

function listConversations() {
  load();
  return [...state.conversations]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .map(({ id, title, createdAt, updatedAt }) => ({ id, title, createdAt, updatedAt }));
}

function createConversation(title = '新对话') {
  load();
  const now = Date.now();
  const conv = { id: crypto.randomUUID(), title, createdAt: now, updatedAt: now, messages: { left: [], right: [] }, systemPrompt: { left: '', right: '' } };
  state.conversations.push(conv);
  save();
  return { id: conv.id, title: conv.title, createdAt: conv.createdAt, updatedAt: conv.updatedAt };
}

function getConversation(id) {
  load();
  return state.conversations.find((c) => c.id === id) || null;
}

function deleteConversation(id) {
  load();
  const idx = state.conversations.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  state.conversations.splice(idx, 1);
  save();
  return true;
}

function appendMessage(id, side, msg) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  const key = side === 'right' ? 'right' : 'left';
  if (!Array.isArray(conv.messages[key])) conv.messages[key] = [];
  conv.messages[key].push({ ...msg, ts: Date.now() });
  conv.updatedAt = Date.now();
  save();
}

function renameConversation(id, title) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return;
  conv.title = title.length > 30 ? title.slice(0, 30) + '…' : title;
  save();
}

function setSystemPrompt(id, side, text) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return false;
  if (!conv.systemPrompt || typeof conv.systemPrompt !== 'object') {
    conv.systemPrompt = { left: '', right: '' };
  }
  conv.systemPrompt[side === 'right' ? 'right' : 'left'] = typeof text === 'string' ? text : '';
  conv.updatedAt = Date.now();
  save();
  return true;
}

function listComparisons(id) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return null;
  if (!Array.isArray(conv.comparisons)) conv.comparisons = [];
  return [...conv.comparisons]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .map(({ id: cid, createdAt, question }) => ({ id: cid, createdAt, question }));
}

function getComparison(id, cid) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return null;
  if (!Array.isArray(conv.comparisons)) conv.comparisons = [];
  return conv.comparisons.find((c) => c.id === cid) || null;
}

function addComparison(id, { analysis }) {
  load();
  const conv = state.conversations.find((c) => c.id === id);
  if (!conv) return null;
  if (!Array.isArray(conv.comparisons)) conv.comparisons = [];
  const item = { id: crypto.randomUUID(), createdAt: Date.now(), question: '帮我分析区别', analysis };
  conv.comparisons.push(item);
  conv.updatedAt = Date.now();
  save();
  return item;
}

module.exports = { listConversations, createConversation, getConversation, deleteConversation, appendMessage, renameConversation, setSystemPrompt, listComparisons, getComparison, addComparison };

