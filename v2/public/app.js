(() => {
  const DEFAULT_MODEL = 'deepseek-v4-pro';
  const DEFAULT_BASE_URL = 'https://api.deepseek.com';
  const DEFAULT_SYSTEM = 'You are a helpful AI assistant.';
  const STORAGE_KEY = 'ai_agent_conversations_v2';

  const $ = (sel) => document.querySelector(sel);

  const els = {
    settingsView: $('#settings-view'),
    chatView: $('#chat-view'),
    settingsForm: $('#settings-form'),
    apiKeyInput: $('#api-key-input'),
    modelInput: $('#model-input'),
    baseUrlInput: $('#base-url-input'),
    settingsError: $('#settings-error'),
    toggleKey: $('#toggle-key'),
    newChatBtn: $('#new-chat-btn'),
    conversationList: $('#conversation-list'),
    settingsBtn: $('#settings-btn'),
    chatTitle: $('#chat-title'),
    modelBadge: $('#model-badge'),
    messagesLeft: $('#messages-left'),
    messagesRight: $('#messages-right'),
    sysLeft: $('#sys-left'),
    sysRight: $('#sys-right'),
    sysToggles: document.querySelectorAll('.sys-toggle'),
    diffBadge: $('#diff-badge'),
    sysHighlight: $('#sys-right-highlight'),
    messageInput: $('#message-input'),
    sendBtn: $('#send-btn'),
    chatError: $('#chat-error'),
    compareBtn: $('#compare-btn'),
    comparePanel: $('#compare-panel'),
    compareClose: $('#compare-close'),
    compareList: $('#compare-list'),
    comparePrev: $('#compare-prev'),
    compareNext: $('#compare-next'),
    compareView: $('#compare-view'),
    toolsToggle: $('#tools-toggle'),
    skillsView: $('#skills-view'),
    skillsBtn: $('#skills-btn'),
    skillsBack: $('#skills-back'),
    skillList: $('#skill-list'),
    skillNewBtn: $('#skill-new-btn'),
    skillAiBtn: $('#skill-ai-btn'),
    skillFormWrap: $('#skill-form-wrap'),
    skillForm: $('#skill-form'),
    skillName: $('#skill-name'),
    skillDesc: $('#skill-desc'),
    skillContent: $('#skill-content'),
    skillFormCancel: $('#skill-form-cancel'),
    skillFormError: $('#skill-form-error'),
    skillAiWrap: $('#skill-ai-wrap'),
    skillAiRequest: $('#skill-ai-request'),
    skillAiGenerate: $('#skill-ai-generate'),
    skillAiCancel: $('#skill-ai-cancel'),
    skillAiStatus: $('#skill-ai-status'),
    skillAiPreview: $('#skill-ai-preview'),
    skillAiOutput: $('#skill-ai-output'),
    skillAiName: $('#skill-ai-name'),
    skillAiDesc: $('#skill-ai-desc'),
    skillAiAdd: $('#skill-ai-add'),
    skillAiApply: $('#skill-ai-apply'),
    skillModal: $('#skill-modal'),
    skillModalName: $('#skill-modal-name'),
    skillModalDesc: $('#skill-modal-desc'),
    skillModalContent: $('#skill-modal-content'),
    skillModalClose: $('#skill-modal-close'),
  };

  const state = {
    apiKey: '', // 每次打开软件都重新输入，不持久化
    model: localStorage.getItem('ai_agent_model') || DEFAULT_MODEL,
    baseUrl: localStorage.getItem('ai_agent_base_url') || DEFAULT_BASE_URL,
    conversations: [],
    currentId: null,
    streamCount: 0,
    compareList: [],
    compareCurrent: null,
    compareStreaming: false,
    toolsEnabled: localStorage.getItem('ai_agent_tools_enabled') !== '0',
    skillGenController: null,
  };

  /* ---------- 本地会话存储（无需服务器） ---------- */
  function loadConversationsFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      state.conversations = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(state.conversations)) state.conversations = [];
    } catch {
      state.conversations = [];
    }
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

  function saveConversationsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.conversations));
    } catch (err) {
      showChatError(new Error('浏览器存储空间不足，无法保存会话'));
    }
  }

  /* ---------- Skill 后端存储（v2：完整指令只存服务端，渐进式披露） ---------- */
  async function loadSkills() {
    try {
      const res = await fetch('/api/skills');
      if (!res.ok) throw new Error('加载 Skill 失败');
      state.skills = await res.json();
      for (const s of state.skills) {
        if (!s.id) s.id = genId();
        if (typeof s.name !== 'string') s.name = '未命名 Skill';
        if (typeof s.description !== 'string') s.description = '';
        if (typeof s.content !== 'string') s.content = '';
        if (typeof s.enabled !== 'boolean') s.enabled = true;
      }
      renderSkillList();
    } catch (err) {
      state.skills = [];
      console.error(err);
    }
  }

  async function apiSaveSkill(skill) {
    const payload = {
      name: skill.name,
      description: skill.description || '',
      content: skill.content || '',
    };
    if (skill.id) {
      const res = await fetch('/api/skills/' + skill.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, enabled: !!skill.enabled }),
      });
      if (!res.ok) throw new Error('保存 Skill 失败');
      return res.json();
    }
    const res = await fetch('/api/skills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('创建 Skill 失败');
    const created = await res.json();
    skill.id = created.id;
    return created;
  }

  async function apiDeleteSkill(id) {
    const res = await fetch('/api/skills/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('删除 Skill 失败');
  }

  function getEnabledSkills() {
    return state.skills.filter((s) => s.enabled && s.name.trim());
  }

  /* ---------- Skill 视图 ---------- */
  function showSkills() {
    els.settingsView.classList.add('hidden');
    els.chatView.classList.add('hidden');
    els.skillsView.classList.remove('hidden');
    renderSkillList();
  }

  function renderSkillList() {
    const countEl = document.getElementById('skill-count');
    if (countEl) countEl.textContent = state.skills.length + ' 个';
    els.skillList.innerHTML = '';
    if (!state.skills.length) {
      const empty = document.createElement('div');
      empty.className = 'skill-empty';
      empty.textContent = '还没有 Skill。点击「＋ 新建 Skill」手写，或「✨ AI 生成」让 AI 帮你创建。';
      els.skillList.appendChild(empty);
      return;
    }
    for (const skill of state.skills) {
      const item = document.createElement('div');
      item.className = 'skill-item' + (skill.enabled ? '' : ' off');

      const top = document.createElement('div');
      top.className = 'skill-item-top';
      const name = document.createElement('div');
      name.className = 'skill-item-name' + (skill.enabled ? '' : ' off');
      name.textContent = skill.name;
      const status = document.createElement('span');
      status.className = 'skill-item-status ' + (skill.enabled ? 'on' : 'off');
      status.textContent = skill.enabled ? '已启用' : '已停用';
      top.appendChild(name);
      top.appendChild(status);

      const desc = document.createElement('div');
      desc.className = 'skill-item-desc';
      desc.textContent = skill.description || '（无描述）';

      const view = document.createElement('div');
      view.className = 'skill-item-view';
      view.textContent = '👁 点击查看完整内容';

      const actions = document.createElement('div');
      actions.className = 'skill-item-actions';

      const label = document.createElement('label');
      label.className = 'skill-switch';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = !!skill.enabled;
      cb.addEventListener('change', async () => {
        skill.enabled = cb.checked;
        skill.updatedAt = Date.now();
        try {
          await apiSaveSkill(skill);
        } catch (err) {
          showChatError(err);
        }
        renderSkillList();
      });
      const sw = document.createElement('span');
      sw.textContent = skill.enabled ? '开启' : '关闭';
      label.appendChild(cb);
      label.appendChild(sw);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'skill-item-btn-group';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'skill-edit-btn';
      edit.textContent = '编辑';
      edit.addEventListener('click', () => openSkillForm(skill.id));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'skill-del-btn';
      del.textContent = '删除';
      del.addEventListener('click', async () => {
        if (!confirm(`确定删除 Skill「${skill.name}」？`)) return;
        try {
          await apiDeleteSkill(skill.id);
          state.skills = state.skills.filter((s) => s.id !== skill.id);
        } catch (err) {
          showChatError(err);
        }
        renderSkillList();
      });
      btnGroup.appendChild(edit);
      btnGroup.appendChild(del);

      actions.appendChild(label);
      actions.appendChild(btnGroup);

      item.appendChild(top);
      item.appendChild(desc);
      item.appendChild(view);
      item.appendChild(actions);
      item.addEventListener('click', (e) => {
        if (e.target.closest('button, label, input')) return;
        openSkillDetail(skill.id);
      });
      els.skillList.appendChild(item);
    }
  }

  async function addAiSkillDirectly() {
    const text = els._lastAiSkillJson || els.skillAiOutput.textContent || '';
    const json = extractJson(text);
    if (!json || !json.name) {
      els.skillAiStatus.textContent = '无法解析生成的 Skill，请点击「✎ 填入表单编辑」手动保存。';
      return;
    }
    const name = String(json.name).slice(0, 80);
    let skill = state.skills.find((s) => s.name === name);
    try {
      if (skill) {
        skill.description = String(json.description || '').slice(0, 300);
        skill.content = String(json.content || '');
        skill.enabled = true;
        skill.updatedAt = Date.now();
        await apiSaveSkill(skill);
        els.skillAiStatus.textContent = `已更新已有 Skill「${name}」`;
      } else {
        skill = {
          name,
          description: String(json.description || '').slice(0, 300),
          content: String(json.content || ''),
          enabled: true,
        };
        await apiSaveSkill(skill);
        state.skills.push(skill);
        els.skillAiStatus.textContent = `已添加 Skill「${name}」，可在下方列表中查看和开关。`;
      }
    } catch (err) {
      els.skillAiStatus.textContent = '保存失败：' + friendlyError(err);
    }
    renderSkillList();
  }
  function openSkillForm(id) {
    state.editingSkillId = id || null;
    els.skillFormWrap.classList.remove('hidden');
    els.skillFormError.classList.add('hidden');
    const skill = id ? state.skills.find((s) => s.id === id) : null;
    els.skillName.value = skill ? skill.name : '';
    els.skillDesc.value = skill ? (skill.description || '') : '';
    els.skillContent.value = skill ? (skill.content || '') : '';
    els.skillName.focus();
  }

  function closeSkillForm() {
    els.skillFormWrap.classList.add('hidden');
    state.editingSkillId = null;
  }

  function openSkillDetail(id) {
    const skill = state.skills.find((s) => s.id === id);
    if (!skill) return;
    els.skillModalName.textContent = skill.name || '未命名 Skill';
    els.skillModalDesc.textContent = skill.description || '（无描述）';
    els.skillModalContent.textContent = skill.content || '（暂无指令内容）';
    els.skillModal.classList.remove('hidden');
  }
  function closeSkillDetail() {
    els.skillModal.classList.add('hidden');
  }

  async function saveSkillFromForm() {
    const name = els.skillName.value.trim();
    if (!name) {
      els.skillFormError.textContent = '请填写 Skill 名称';
      els.skillFormError.classList.remove('hidden');
      return;
    }
    const data = {
      name,
      description: els.skillDesc.value.trim(),
      content: els.skillContent.value,
      enabled: true,
    };
    try {
      if (state.editingSkillId) {
        const skill = state.skills.find((s) => s.id === state.editingSkillId);
        if (!skill) throw new Error('Skill 不存在');
        skill.name = data.name;
        skill.description = data.description;
        skill.content = data.content;
        skill.enabled = true;
        skill.updatedAt = Date.now();
        await apiSaveSkill(skill);
      } else {
        const skill = { ...data, id: undefined };
        await apiSaveSkill(skill);
        state.skills.push(skill);
      }
    } catch (err) {
      els.skillFormError.textContent = '保存失败：' + friendlyError(err);
      els.skillFormError.classList.remove('hidden');
      return;
    }
    closeSkillForm();
    renderSkillList();
  }

  function showSkillAi() {
    els.skillAiWrap.classList.remove('hidden');
    els.skillAiRequest.focus();
  }

  async function generateSkillWithAi() {
    const prompt = els.skillAiRequest.value.trim();
    if (!prompt) {
      els.skillAiStatus.textContent = '请先描述你想要的 Skill';
      return;
    }
    if (!state.apiKey) {
      els.skillAiStatus.textContent = '请先在设置中填写 API Key';
      return;
    }
    const controller = new AbortController();
    state.skillGenController = controller;
    els.skillAiGenerate.disabled = true;
    els.skillAiCancel.classList.remove('hidden');
    els.skillAiStatus.textContent = '正在生成…（点击「✕ 取消」可中止）';
    els.skillAiPreview.classList.add('hidden');
    els.skillAiOutput.textContent = '';
    try {
      const messages = [
        { role: 'system', content: '你是 Skill 生成专家。用户会描述一个需要的技能（Skill），请你输出一个可直接使用的 Skill 定义。只输出 JSON，不要包含任何其他文字或 Markdown 代码块标记。JSON 格式：{"name":"英文短名称，如 web_researcher","description":"一句话描述该 Skill 的用途和适用场景（中文）","content":"该 Skill 的详细指令内容（中文，给 AI 助手执行的步骤说明）"}' },
        { role: 'user', content: prompt },
      ];
      const result = await streamUpstream(messages, {}, controller.signal);
      const text = (result.content || '').trim();
      els.skillAiOutput.textContent = text;
      els.skillAiPreview.classList.remove('hidden');
      const parsed = extractJson(text);
      if (parsed && parsed.name) {
        els.skillAiName.textContent = parsed.name;
        els.skillAiDesc.textContent = parsed.description || '';
        els.skillAiStatus.textContent = '生成完成，可直接「＋ 直接添加」，或「填入表单」编辑后再保存。';
      } else {
        els.skillAiName.textContent = '（未能自动解析，请点击「填入表单」编辑）';
        els.skillAiDesc.textContent = '';
        els.skillAiStatus.textContent = '生成完成，但未能自动解析 JSON，建议点击「填入表单」手动整理。';
      }
      els._lastAiSkillJson = text;
    } catch (err) {
      if (err && err.message === '已取消') {
        els.skillAiStatus.textContent = '已取消生成。';
      } else {
        els.skillAiStatus.textContent = '生成失败：' + friendlyError(err);
      }
    } finally {
      state.skillGenController = null;
      els.skillAiGenerate.disabled = false;
      els.skillAiCancel.classList.add('hidden');
    }
  }
  function applyAiSkillToForm() {
    const text = els._lastAiSkillJson || els.skillAiOutput.textContent || '';
    const json = extractJson(text);
    if (!json || !json.name) {
      els.skillAiStatus.textContent = '无法解析生成的 Skill，请重试。';
      return;
    }
    els.skillName.value = String(json.name).slice(0, 80);
    els.skillDesc.value = String(json.description || '').slice(0, 300);
    els.skillContent.value = String(json.content || '');
    els.skillAiPreview.classList.add('hidden');
    els.skillAiWrap.classList.add('hidden');
    openSkillForm(null);
  }

  function extractJson(text) {
    if (!text) return null;
    try {
      const direct = JSON.parse(text);
      return (direct && direct.name) ? direct : null;
    } catch { /* fallthrough */ }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch { return null; }
  }
  function genId() {
    return (crypto.randomUUID && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function findConversation(id) {
    return state.conversations.find((c) => c.id === id) || null;
  }

  /* ---------- 内置工具（浏览器本地执行） ---------- */
  const BUILTIN_TOOLS = [
    {
      type: 'function',
      function: {
        name: 'get_current_time',
        description: '获取当前本地时间',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_today_date',
        description: '获取今天的日期',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'calculate',
        description: '计算数学表达式，如 (1+2)*3',
        parameters: {
          type: 'object',
          properties: { expression: { type: 'string', description: '数学表达式' } },
          required: ['expression'],
        },
      },
    },
  ];

  function executeTool(name, args) {
    switch (name) {
      case 'get_current_time':
        return new Date().toLocaleTimeString('zh-CN', { hour12: false });
      case 'get_today_date':
        return new Date().toLocaleDateString('zh-CN');
      case 'calculate': {
        const expr = String(args.expression || '').replace(/[^0-9+\-*/().\s%]/g, '');
        if (!expr) return '表达式为空';
        try {
          // 表达式已做字符过滤，仅本地求值
          const value = Function('"use strict"; return (' + expr + ')')();
          return String(value);
        } catch (e) {
          return '计算失败：' + (e && e.message ? e.message : String(e));
        }
      }
      default:
        return '未知工具：' + name;
    }
  }

  function parseToolArguments(raw) {
    try {
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function renderToolList(listEl, toolCalls) {
    listEl.innerHTML = '';
    for (const tc of toolCalls) {
      const item = document.createElement('div');
      item.className = 'tool-call';

      const head = document.createElement('div');
      head.className = 'tool-call-head';
      const name = document.createElement('span');
      name.className = 'tool-call-name';
      name.textContent = '⚙ ' + (tc.name || '工具');
      const args = document.createElement('code');
      args.className = 'tool-call-args';
      const hasArgs = tc.parsedArgs && Object.keys(tc.parsedArgs).length;
      args.textContent = hasArgs ? JSON.stringify(tc.parsedArgs) : (tc.arguments || '{}');
      head.appendChild(name);
      head.appendChild(args);
      item.appendChild(head);

      if (tc.result !== undefined) {
        const result = document.createElement('div');
        result.className = 'tool-call-result';
        result.textContent = '→ ' + String(tc.result).slice(0, 500);
        item.appendChild(result);
      }
      listEl.appendChild(item);
    }
  }

  /* ---------- 调用 v2 Python Agent 后端（LangChain 框架，流式） ---------- */
  // handlers: { onContent, onReasoning, onToolStart, onToolEnd }
  // 返回 { content, reasoning, toolCalls }（工具循环由后端执行，前端只渲染）
  async function streamUpstream(messages, handlers = {}, externalSignal) {
    const sysMsg = messages.find((m) => m.role === 'system');
    const history = messages.filter((m) => m.role !== 'system');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    const out = { content: '', reasoning: '', toolCalls: [] };
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': state.apiKey,
        },
        body: JSON.stringify({
          system: sysMsg ? sysMsg.content : '',
          messages: history,
          model: state.model || DEFAULT_MODEL,
          baseUrl: state.baseUrl || DEFAULT_BASE_URL,
          toolsEnabled: state.toolsEnabled,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        let message = '后端错误 (' + res.status + ')';
        try {
          const j = await res.json();
          message = j.error || message;
        } catch { /* keep default */ }
        throw new Error(message);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop();
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }
          if (evt.type === 'content' && evt.delta) {
            out.content += evt.delta;
            if (handlers.onContent) handlers.onContent(evt.delta);
          } else if (evt.type === 'reasoning' && evt.delta) {
            out.reasoning += evt.delta;
            if (handlers.onReasoning) handlers.onReasoning(evt.delta);
          } else if (evt.type === 'tool_start') {
            if (handlers.onToolStart) handlers.onToolStart(evt.name, evt.arguments);
          } else if (evt.type === 'tool_end') {
            out.toolCalls.push({ name: evt.name, output: evt.output });
            if (handlers.onToolEnd) handlers.onToolEnd(evt.name, evt.output);
          } else if (evt.type === 'done') {
            if (evt.content !== undefined) out.content = evt.content;
            if (evt.reasoning !== undefined) out.reasoning = evt.reasoning;
            if (Array.isArray(evt.toolCalls)) out.toolCalls = evt.toolCalls;
          } else if (evt.type === 'error') {
            throw new Error(evt.message || '后端返回错误');
          }
        }
      }
      return out;
    } catch (err) {
      if (err && err.name === 'AbortError') throw new Error('已取消');
      throw err;
    } finally {
      clearTimeout(timeout);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  function showSettings() {
    els.chatView.classList.add('hidden');
    els.skillsView.classList.add('hidden');
    els.settingsView.classList.remove('hidden');
    els.apiKeyInput.value = state.apiKey;
    els.modelInput.value = state.model;
    els.baseUrlInput.value = state.baseUrl;
    els.toolsToggle.checked = state.toolsEnabled;
  }

  function showChat() {
    els.settingsView.classList.add('hidden');
    els.skillsView.classList.add('hidden');
    els.chatView.classList.remove('hidden');
    els.modelBadge.textContent = state.model;
    loadConversations();
    if (!state.currentId && state.conversations.length) {
      // 自动恢复最近一次对话
      state.currentId = state.conversations[0].id;
      selectConversation(state.currentId);
    } else if (!state.currentId) {
      renderEmpty();
    }
  }

  function init() {
    loadConversationsFromStorage();
    loadSkills();
    // 每次打开都重新输入 API Key（对话记录仍保留在本地）
    showSettings();
  }

  function friendlyError(err) {
    const msg = err && err.message ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('network')) {
      return '无法连接网络，请检查本机网络是否正常，或确认 API 地址填写正确';
    }
    return msg;
  }

  /* ---------- 设置 ---------- */
  els.settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const key = els.apiKeyInput.value.trim();
    if (!key) {
      showSettingsError('请输入 API Key');
      return;
    }
    state.apiKey = key;
    state.model = (els.modelInput.value.trim() || DEFAULT_MODEL);
    state.baseUrl = (els.baseUrlInput.value.trim() || DEFAULT_BASE_URL);
    localStorage.setItem('ai_agent_model', state.model);
    localStorage.setItem('ai_agent_base_url', state.baseUrl);
    state.toolsEnabled = els.toolsToggle.checked;
    localStorage.setItem('ai_agent_tools_enabled', state.toolsEnabled ? '1' : '0');
    showChat();
  });

  els.toggleKey.addEventListener('click', () => {
    const show = els.apiKeyInput.type === 'password';
    els.apiKeyInput.type = show ? 'text' : 'password';
    els.toggleKey.textContent = show ? '隐藏' : '显示';
  });

  function showSettingsError(msg) {
    els.settingsError.textContent = msg;
    els.settingsError.classList.remove('hidden');
  }

  els.settingsBtn.addEventListener('click', () => {
    if (state.streamCount > 0) return;
    showSettings();
  });

  /* ---------- 会话列表 ---------- */
  function loadConversations() {
    state.conversations.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    renderConversationList();
  }

  function renderConversationList() {
    els.conversationList.innerHTML = '';
    if (!state.conversations.length) {
      const empty = document.createElement('div');
      empty.className = 'conv-item';
      empty.style.cursor = 'default';
      empty.textContent = '暂无对话';
      els.conversationList.appendChild(empty);
      return;
    }
    for (const conv of state.conversations) {
      const item = document.createElement('div');
      item.className = 'conv-item' + (conv.id === state.currentId ? ' active' : '');
      item.dataset.id = conv.id;

      const title = document.createElement('span');
      title.className = 'conv-title';
      title.textContent = conv.title;

      const del = document.createElement('button');
      del.className = 'conv-del';
      del.textContent = '✕';
      del.title = '删除对话';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteConversation(conv.id);
      });

      item.appendChild(title);
      item.appendChild(del);
      item.addEventListener('click', () => selectConversation(conv.id));
      els.conversationList.appendChild(item);
    }
  }

  function selectConversation(id) {
    if (state.streamCount > 0) return;
    state.currentId = id;
    closeComparePanel();
    const conv = findConversation(id);
    if (!conv) return;
    els.chatTitle.textContent = conv.title;
    els.sysLeft.value = conv.systemPrompt.left || '';
    els.sysRight.value = conv.systemPrompt.right || '';
    renderMessages(conv.messages || { left: [], right: [] });
    renderConversationList();
    updateDiff();
  }

  function createConversation() {
    const now = Date.now();
    const conv = {
      id: genId(),
      title: '新对话',
      createdAt: now,
      updatedAt: now,
      messages: { left: [], right: [] },
      systemPrompt: { left: '', right: '' },
      comparisons: [],
    };
    state.conversations.push(conv);
    saveConversationsToStorage();
    state.currentId = conv.id;
    els.chatTitle.textContent = conv.title;
    els.sysLeft.value = '';
    els.sysRight.value = '';
    closeComparePanel();
    renderEmpty();
    loadConversations();
    updateDiff();
  }

  function deleteConversation(id) {
    if (state.streamCount > 0) return;
    if (!confirm('确定删除该对话？')) return;
    state.conversations = state.conversations.filter((c) => c.id !== id);
    saveConversationsToStorage();
    if (state.currentId === id) {
      state.currentId = null;
      els.chatTitle.textContent = '新对话';
      closeComparePanel();
      renderEmpty();
    }
    loadConversations();
  }

  els.newChatBtn.addEventListener('click', () => {
    if (state.streamCount > 0) return;
    createConversation();
  });

  /* ---------- 消息渲染（双窗） ---------- */
  function renderEmpty() {
    renderPane(els.messagesLeft, []);
    renderPane(els.messagesRight, []);
  }

  function renderMessages(messages) {
    renderPane(els.messagesLeft, messages.left || []);
    renderPane(els.messagesRight, messages.right || []);
  }

  function renderPane(container, list) {
    container.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = '<div class="big">✦</div><div>等待提示词…</div>';
      container.appendChild(empty);
      return;
    }
    for (const msg of list) {
      appendMessageBubble(container, msg.role, msg.content, false, msg);
    }
    scrollPane(container);
  }

  function appendMessageBubble(container, role, content, typing, meta) {
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role === 'user' ? '我' : 'AI';

    const bubble = document.createElement('div');
    bubble.className = 'bubble' + (typing ? ' typing' : '');

    if (role === 'assistant') {
      // 思考过程（可折叠，按时间线：思考1 → 调用工具 → 思考2 → 回答）
      const thinkEl = document.createElement('details');
      thinkEl.className = 'think-block';
      const thinkSummary = document.createElement('summary');
      thinkSummary.textContent = '🧠 思考过程';
      const thinkBody = document.createElement('div');
      thinkBody.className = 'think-body';
      thinkEl.appendChild(thinkSummary);
      thinkEl.appendChild(thinkBody);
      thinkEl.style.display = 'none';

      // 工具调用链路
      const toolEl = document.createElement('div');
      toolEl.className = 'toolchain-block';
      const toolTitle = document.createElement('div');
      toolTitle.className = 'toolchain-title';
      toolTitle.textContent = '🔧 工具调用链路';
      const toolList = document.createElement('div');
      toolList.className = 'toolchain-list';
      toolEl.appendChild(toolTitle);
      toolEl.appendChild(toolList);
      toolEl.style.display = 'none';

      const contentEl = document.createElement('div');
      contentEl.className = 'bubble-content';
      contentEl.textContent = content || '';

      bubble.appendChild(thinkEl);
      bubble.appendChild(toolEl);
      bubble.appendChild(contentEl);

      bubble._thinkEl = thinkEl;
      bubble._thinkBody = thinkBody;
      bubble._toolEl = toolEl;
      bubble._toolList = toolList;
      bubble._contentEl = contentEl;

      if (meta) {
        if (meta.reasoning) {
          const part = document.createElement('div');
          part.className = 'think-part';
          const tag = document.createElement('span');
          tag.className = 'think-part-tag';
          tag.textContent = '思考 1';
          const text = document.createElement('div');
          text.className = 'think-part-text';
          text.textContent = meta.reasoning;
          part.appendChild(tag);
          part.appendChild(text);
          thinkBody.appendChild(part);
          thinkEl.style.display = '';
        }
        if (meta.skillCalls && meta.skillCalls.length) {
          for (const name of meta.skillCalls) {
            const row = document.createElement('div');
            row.className = 'think-skill';
            const tag = document.createElement('span');
            tag.className = 'think-skill-name';
            tag.textContent = '🧩 调用 Skill：' + name;
            row.appendChild(tag);
            thinkBody.appendChild(row);
          }
        }
        if (meta.toolCalls && meta.toolCalls.length) {
          for (const tc of meta.toolCalls) {
            const row = document.createElement('div');
            row.className = 'think-tool';
            const name = document.createElement('span');
            name.className = 'think-tool-name';
            name.textContent = '🔧 调用工具：' + (tc.name || '工具');
            const args = document.createElement('code');
            args.className = 'think-tool-args';
            const hasArgs = tc.parsedArgs && Object.keys(tc.parsedArgs).length;
            args.textContent = hasArgs ? JSON.stringify(tc.parsedArgs) : (tc.arguments || '{}');
            const resultEl = document.createElement('span');
            resultEl.className = 'think-tool-result';
            resultEl.textContent = '→ ' + (tc.result !== undefined ? String(tc.result).slice(0, 300) : '（未记录结果）');
            row.appendChild(name);
            row.appendChild(args);
            row.appendChild(resultEl);
            thinkBody.appendChild(row);
          }
          renderToolList(toolList, meta.toolCalls);
          toolEl.style.display = '';
        }
      }
    } else {
      bubble.textContent = content || '';
    }

    msg.appendChild(avatar);
    msg.appendChild(bubble);
    container.appendChild(msg);
    scrollPane(container);
    return bubble;
  }
  function scrollPane(container) {
    container.scrollTop = container.scrollHeight;
  }

  function showChatError(err) {
    els.chatError.textContent = friendlyError(err);
    els.chatError.classList.remove('hidden');
    setTimeout(() => els.chatError.classList.add('hidden'), 6000);
  }

  /* ---------- System Prompt 与 Diff ---------- */
  function charDiff(aText, bText) {
    const a = Array.from(aText);
    const b = Array.from(bText);
    const n = a.length, m = b.length;
    if (n * m > 400000) {
      return [{ type: 'del', text: aText }, { type: 'add', text: bText }];
    }
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const ops = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        ops.push({ type: 'same', text: a[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        ops.push({ type: 'del', text: a[i] });
        i++;
      } else {
        ops.push({ type: 'add', text: b[j] });
        j++;
      }
    }
    while (i < n) { ops.push({ type: 'del', text: a[i] }); i++; }
    while (j < m) { ops.push({ type: 'add', text: b[j] }); j++; }
    const merged = [];
    for (const op of ops) {
      const last = merged[merged.length - 1];
      if (last && last.type === op.type) last.text += op.text;
      else merged.push({ ...op });
    }
    return merged;
  }

  function updateDiff() {
    const left = els.sysLeft.value;
    const right = els.sysRight.value;
    const hasDiff = left !== right;
    els.diffBadge.classList.toggle('hidden', !hasDiff);

    els.sysHighlight.textContent = '';
    const ops = left === right ? [{ type: 'same', text: right }] : charDiff(left, right);
    const frag = document.createDocumentFragment();
    for (const op of ops) {
      if (op.type === 'same') {
        frag.appendChild(document.createTextNode(op.text));
      } else {
        const span = document.createElement('span');
        span.className = op.type === 'add' ? 'diff-add' : 'diff-del';
        span.textContent = op.text;
        frag.appendChild(span);
      }
    }
    els.sysHighlight.appendChild(frag);
    syncHighlightScroll();
  }

  function syncHighlightScroll() {
    if (!els.sysRight || !els.sysHighlight) return;
    els.sysHighlight.scrollTop = els.sysRight.scrollTop;
    els.sysHighlight.scrollLeft = els.sysRight.scrollLeft;
  }

  let sysSaveTimer = null;
  function scheduleSystemPromptSave(side) {
    clearTimeout(sysSaveTimer);
    sysSaveTimer = setTimeout(() => {
      const text = side === 'right' ? els.sysRight.value : els.sysLeft.value;
      if (!state.currentId) return;
      const conv = findConversation(state.currentId);
      if (!conv) return;
      conv.systemPrompt[side === 'right' ? 'right' : 'left'] = text;
      conv.updatedAt = Date.now();
      saveConversationsToStorage();
    }, 500);
  }

  els.sysLeft.addEventListener('input', () => {
    scheduleSystemPromptSave('left');
    updateDiff();
  });
  els.sysRight.addEventListener('input', () => {
    scheduleSystemPromptSave('right');
    updateDiff();
  });
  els.sysRight.addEventListener('scroll', syncHighlightScroll);
  window.addEventListener('resize', syncHighlightScroll);

  els.sysToggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const box = btn.closest('.sys-box');
      box.classList.toggle('collapsed');
      btn.textContent = box.classList.contains('collapsed') ? '展开' : '收起';
    });
  });

  /* ---------- 发送消息（同时发给两侧） ---------- */
  function setStreaming(on) {
    state.streamCount += on ? 1 : -1;
    if (state.streamCount < 0) state.streamCount = 0;
    const busy = state.streamCount > 0;
    els.sendBtn.disabled = busy;
    els.messageInput.disabled = busy;
  }

  async function sendMessage() {
    const text = els.messageInput.value.trim();
    if (!text || state.streamCount > 0) return;

    els.messageInput.value = '';
    autoResize();

    if (!state.currentId) {
      createConversation();
    }
    const conv = findConversation(state.currentId);
    if (!conv) return;

    const isFirst = conv.messages.left.length === 0 && conv.messages.right.length === 0;

    appendMessageToStore(state.currentId, 'left', { role: 'user', content: text });
    appendMessageToStore(state.currentId, 'right', { role: 'user', content: text });
    if (isFirst) {
      conv.title = text.slice(0, 30);
      els.chatTitle.textContent = conv.title;
      saveConversationsToStorage();
    }

    appendMessageBubble(els.messagesLeft, 'user', text, false);
    appendMessageBubble(els.messagesRight, 'user', text, false);
    const bubbleL = appendMessageBubble(els.messagesLeft, 'assistant', '', true);
    const bubbleR = appendMessageBubble(els.messagesRight, 'assistant', '', true);

    setStreaming(true);
    try {
      await Promise.all([
        streamChat('left', text, bubbleL, els.messagesLeft),
        streamChat('right', text, bubbleR, els.messagesRight),
      ]);
    } finally {
      setStreaming(false);
      loadConversations();
    }
  }

  function appendMessageToStore(id, side, msg) {
    const conv = findConversation(id);
    if (!conv) return;
    const key = side === 'right' ? 'right' : 'left';
    conv.messages[key].push({ ...msg, ts: Date.now() });
    conv.updatedAt = Date.now();
    saveConversationsToStorage();
  }

  // 单侧对话：支持思考过程展示 + 工具调用循环（最多 6 轮）
  // 单侧对话：支持思考过程时间线展示 + 工具调用循环（最多 6 轮）
  async function streamChat(side, text, bubble, container) {
    try {
      const conv = findConversation(state.currentId);
      if (!conv) return;
      const sideKey = side === 'right' ? 'right' : 'left';
      const sysText = side === 'right' ? els.sysRight.value : els.sysLeft.value;
      const sysContent = sysText.trim() || DEFAULT_SYSTEM;

      // 渐进式披露：Skill 完整指令存服务端，system 只放索引，由后端按需披露
      const messages = [...conv.messages[sideKey].map((m) => ({ role: m.role, content: m.content }))];
      if (text) messages.push({ role: 'user', content: text });

      const thinkBody = bubble._thinkBody;
      const toolList = bubble._toolList;
      const contentEl = bubble._contentEl;
      const trace = { reasoning: '', toolCalls: [] };
      let full = '';
      let thinkCount = 0;
      let currentThinkText = null;

      function ensureThinkPart() {
        if (!currentThinkText) {
          thinkCount += 1;
          const part = document.createElement('div');
          part.className = 'think-part';
          const tag = document.createElement('span');
          tag.className = 'think-part-tag';
          tag.textContent = '思考 ' + thinkCount;
          const textEl = document.createElement('div');
          textEl.className = 'think-part-text';
          part.appendChild(tag);
          part.appendChild(textEl);
          thinkBody.appendChild(part);
          currentThinkText = textEl;
        }
        return currentThinkText;
      }

      function appendThinkTool(name, args, result) {
        const row = document.createElement('div');
        row.className = 'think-tool';
        const nameEl = document.createElement('span');
        nameEl.className = 'think-tool-name';
        nameEl.textContent = '🔧 调用工具：' + (name || '工具');
        const argsEl = document.createElement('code');
        argsEl.className = 'think-tool-args';
        argsEl.textContent = args && Object.keys(args).length ? JSON.stringify(args) : '{}';
        const resultEl = document.createElement('span');
        resultEl.className = 'think-tool-result';
        resultEl.textContent = '→ ' + String(result).slice(0, 300);
        row.appendChild(nameEl);
        row.appendChild(argsEl);
        row.appendChild(resultEl);
        thinkBody.appendChild(row);
        currentThinkText = null;
        scrollPane(container);
      }

      const result = await streamUpstream(
        [{ role: 'system', content: sysContent }, ...messages],
        {
          onReasoning: (delta) => {
            const textEl = ensureThinkPart();
            textEl.textContent += delta;
            bubble._thinkEl.style.display = '';
            scrollPane(container);
          },
          onContent: (delta) => {
            full += delta;
            contentEl.textContent = full;
            scrollPane(container);
          },
          onToolStart: (name, args) => {
            trace.toolCalls.push({ name, arguments: args || {} });
          },
          onToolEnd: (name, output) => {
            const last = trace.toolCalls[trace.toolCalls.length - 1];
            if (last && last.name === name) last.result = output;
            appendThinkTool(name, last ? last.arguments : {}, output);
            renderToolList(toolList, trace.toolCalls);
            bubble._toolEl.style.display = '';
            scrollPane(container);
          },
        }
      );

      full = result.content || full;
      contentEl.textContent = full;
      bubble.classList.remove('typing');
      const stored = { role: 'assistant', content: full };
      if (result.reasoning) stored.reasoning = result.reasoning;
      if (result.toolCalls && result.toolCalls.length) stored.toolCalls = result.toolCalls;
      appendMessageToStore(state.currentId, sideKey, stored);
    } catch (err) {
      bubble.classList.remove('typing');
      const contentEl = bubble._contentEl;
      if (contentEl) {
        contentEl.textContent = (contentEl.textContent || '') + (contentEl.textContent ? '\n\n' : '') + `⚠ 出错了：${friendlyError(err)}`;
      } else {
        bubble.textContent = (bubble.textContent || '') + (bubble.textContent ? '\n\n' : '') + `⚠ 出错了：${friendlyError(err)}`;
      }
      showChatError(err);
    }
  }

  els.sendBtn.addEventListener('click', sendMessage);

  els.messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  function autoResize() {
    els.messageInput.style.height = 'auto';
    els.messageInput.style.height = Math.min(els.messageInput.scrollHeight, 180) + 'px';
  }
  els.messageInput.addEventListener('input', autoResize);

  /* ---------- 一键对比 ---------- */
  function openComparePanel() {
    els.comparePanel.classList.remove('hidden');
    loadCompareList();
  }

  function closeComparePanel() {
    els.comparePanel.classList.add('hidden');
    els.compareView.innerHTML = '';
    els.compareList.innerHTML = '';
    state.compareList = [];
    state.compareCurrent = null;
  }

  els.compareBtn.addEventListener('click', () => {
    if (state.compareStreaming || state.streamCount > 0) return;
    if (!state.currentId) {
      showChatError(new Error('请先新建对话，再使用一键对比'));
      return;
    }
    openComparePanel();
    runCompare();
  });

  els.compareClose.addEventListener('click', closeComparePanel);
  els.comparePrev.addEventListener('click', () => navigateCompare(-1));
  els.compareNext.addEventListener('click', () => navigateCompare(1));

  function loadCompareList() {
    if (!state.currentId) return;
    const conv = findConversation(state.currentId);
    if (!conv) return;
    state.compareList = [...conv.comparisons]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(({ id, createdAt, question }) => ({ id, createdAt, question }));
    renderCompareList();
  }

  function formatCompareTime(ts) {
    return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function renderCompareList() {
    els.compareList.innerHTML = '';
    const n = state.compareList.length;
    const idx = state.compareList.findIndex((c) => c.id === state.compareCurrent);
    els.comparePrev.disabled = n === 0 || idx <= 0;
    els.compareNext.disabled = n === 0 || idx === -1 || idx >= n - 1;
    if (!n) {
      const empty = document.createElement('div');
      empty.className = 'compare-empty';
      empty.textContent = '暂无对比记录';
      els.compareList.appendChild(empty);
      return;
    }
    state.compareList.forEach((item, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'compare-item' + (item.id === state.compareCurrent ? ' active' : '');
      chip.title = `${item.question || '对比分析'} · ${new Date(item.createdAt).toLocaleString('zh-CN')}`;
      const t = document.createElement('span');
      t.className = 'compare-item-time';
      t.textContent = `${i + 1} · ${formatCompareTime(item.createdAt)}`;
      chip.appendChild(t);
      chip.addEventListener('click', () => viewCompare(item.id));
      els.compareList.appendChild(chip);
    });
    const active = els.compareList.querySelector('.compare-item.active');
    if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
  }

  function navigateCompare(dir) {
    if (!state.compareList.length) return;
    const idx = state.compareList.findIndex((c) => c.id === state.compareCurrent);
    const base = idx === -1 ? (dir > 0 ? -1 : 0) : idx;
    const target = Math.min(Math.max(base + dir, 0), state.compareList.length - 1);
    const item = state.compareList[target];
    if (item && item.id !== state.compareCurrent) viewCompare(item.id);
  }

  function viewCompare(cid) {
    if (state.compareStreaming) return;
    state.compareCurrent = cid;
    renderCompareList();
    const conv = findConversation(state.currentId);
    if (!conv) return;
    const item = conv.comparisons.find((c) => c.id === cid);
    renderCompareView((item && item.analysis) || '（无内容）');
  }

  function renderCompareView(analysis) {
    els.compareView.innerHTML = '';

    const userMsg = document.createElement('div');
    userMsg.className = 'cmp-msg cmp-user';
    const userAvatar = document.createElement('div');
    userAvatar.className = 'cmp-avatar';
    userAvatar.textContent = '我';
    const userBubble = document.createElement('div');
    userBubble.className = 'cmp-bubble';
    userBubble.textContent = '帮我分析区别';
    userMsg.appendChild(userAvatar);
    userMsg.appendChild(userBubble);

    const aiMsg = document.createElement('div');
    aiMsg.className = 'cmp-msg cmp-ai';
    const aiAvatar = document.createElement('div');
    aiAvatar.className = 'cmp-avatar';
    aiAvatar.textContent = 'AI';
    const aiBubble = document.createElement('div');
    aiBubble.className = 'cmp-bubble';
    aiBubble.textContent = analysis;
    aiMsg.appendChild(aiAvatar);
    aiMsg.appendChild(aiBubble);

    els.compareView.appendChild(userMsg);
    els.compareView.appendChild(aiMsg);
    els.compareView.scrollTop = els.compareView.scrollHeight;
  }

  async function runCompare() {
    if (!state.currentId || state.compareStreaming) return;
    state.compareStreaming = true;
    els.compareBtn.disabled = true;

    els.compareView.innerHTML = '';
    const userMsg = document.createElement('div');
    userMsg.className = 'cmp-msg cmp-user';
    const userAvatar = document.createElement('div');
    userAvatar.className = 'cmp-avatar';
    userAvatar.textContent = '我';
    const userBubble = document.createElement('div');
    userBubble.className = 'cmp-bubble';
    userBubble.textContent = '帮我分析区别';
    userMsg.appendChild(userAvatar);
    userMsg.appendChild(userBubble);

    const aiMsg = document.createElement('div');
    aiMsg.className = 'cmp-msg cmp-ai';
    const aiAvatar = document.createElement('div');
    aiAvatar.className = 'cmp-avatar';
    aiAvatar.textContent = 'AI';
    const aiBubble = document.createElement('div');
    aiBubble.className = 'cmp-bubble typing';
    aiBubble.textContent = '';
    aiMsg.appendChild(aiAvatar);
    aiMsg.appendChild(aiBubble);

    els.compareView.appendChild(userMsg);
    els.compareView.appendChild(aiMsg);

    try {
      const conv = findConversation(state.currentId);
      if (!conv) throw new Error('会话不存在');
      const leftMsgs = Array.isArray(conv.messages.left) ? conv.messages.left : [];
      const rightMsgs = Array.isArray(conv.messages.right) ? conv.messages.right : [];

      const formatMsgs = (msgs) => msgs.length
        ? msgs.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`).join('\n')
        : '（暂无对话记录）';

      const system = '你是一位专业的提示词（Prompt）对比分析专家。你会对比左右两个窗口的系统提示词与聊天记录，详细分析左右提示词的差异是如何影响模型回复的。请用中文回答，条理清晰，分点说明，并给出可执行的优化建议。';
      const user = [
        '请对比分析以下左右两个窗口的差异：',
        '',
        `【左侧 System Prompt】\n${els.sysLeft.value || '（空）'}`,
        '',
        `【右侧 System Prompt】\n${els.sysRight.value || '（空）'}`,
        '',
        `【左侧聊天记录】\n${formatMsgs(leftMsgs)}`,
        '',
        `【右侧聊天记录】\n${formatMsgs(rightMsgs)}`,
        '',
        '请详细分析：1) 左右 System Prompt 具体有哪些不同；2) 这些差异如何影响了各自模型对用户的回复（结合聊天记录举例说明）；3) 给出优化建议。',
      ].join('\n');

      const result = await streamUpstream(
        [{ role: 'system', content: system }, { role: 'user', content: user }],
        {
          onContent: (delta) => {
            aiBubble.textContent += delta;
            els.compareView.scrollTop = els.compareView.scrollHeight;
          },
        }
      );
      const full = result.content;
      aiBubble.classList.remove('typing');
      if (full) {
        conv.comparisons.push({ id: genId(), createdAt: Date.now(), question: '帮我分析区别', analysis: full });
        conv.updatedAt = Date.now();
        saveConversationsToStorage();
        loadCompareList();
        if (state.compareList.length) {
          state.compareCurrent = state.compareList[0].id;
          renderCompareList();
        }
      }
    } catch (err) {
      aiBubble.classList.remove('typing');
      aiBubble.textContent = (aiBubble.textContent || '') + (aiBubble.textContent ? '\n\n' : '') + `⚠ 出错了：${friendlyError(err)}`;
      showChatError(err);
    } finally {
      state.compareStreaming = false;
      els.compareBtn.disabled = false;
    }
  }

  /* ---------- Skill 事件绑定 ---------- */
  els.skillsBtn.addEventListener('click', () => {
    if (state.streamCount > 0) return;
    showSkills();
  });
  els.skillsBack.addEventListener('click', () => {
    if (state.apiKey) {
      showChat();
    } else {
      showSettings();
    }
  });
  els.skillNewBtn.addEventListener('click', () => {
    openSkillForm(null);
  });
  els.skillAiBtn.addEventListener('click', () => {
    showSkillAi();
  });
  els.skillForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSkillFromForm();
  });
  els.skillFormCancel.addEventListener('click', () => {
    closeSkillForm();
  });
  els.skillAiGenerate.addEventListener('click', () => {
  els.skillAiCancel.addEventListener('click', () => {
    if (state.skillGenController) state.skillGenController.abort();
  });
    generateSkillWithAi();
  });
  els.skillAiRequest.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      generateSkillWithAi();
    }
  });
  els.skillAiAdd.addEventListener('click', () => {
    addAiSkillDirectly();
  });
  els.skillAiApply.addEventListener('click', () => {
    applyAiSkillToForm();
  });
  els.skillModalClose.addEventListener('click', closeSkillDetail);
  els.skillModal.addEventListener('click', (e) => {
    if (e.target === els.skillModal || e.target.classList.contains('skill-modal-mask')) closeSkillDetail();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSkillDetail();
  });
  init();
})();
