# AI Agent v2

v2 是 AI Agent 的独立重构版本（与 v1 完全隔离，原网页/原版本不受影响）。

## 与 v1 的区别

- **Agent 全部用 Python + LangChain 实现**（LangGraph ReAct Agent），后续加 Function Call 很方便：在 `v2/agent/tools.py` 里用 `@tool` 增加工具即可。
- **Skill 采用渐进式披露**：系统提示只放 Skill 索引（名称 + 描述），模型按需调用 `use_skill(name)` 工具获取完整指令，省 token 且避免上下文污染。
- **对话由后端驱动**：前端把消息发给后端 `/api/chat`（SSE 流式），工具循环在 Python 后端完成，前端只负责渲染。

## 架构

```
electron/main.js  ──spawn──▶  ai-agent-server（Python 后端，PyInstaller 单文件）
                                 │  ├─ FastAPI 静态托管 public/（前端页面）
                                 │  ├─ /api/chat   SSE 流式对话（LangGraph Agent）
                                 │  └─ /api/skills Skill 管理（渐进式披露索引）
                                 └─ ChatDeepSeek（DeepSeek API，OpenAI 兼容）
```

核心文件：

- `agent/agent_core.py` — 组装 System Prompt（仅 Skill 索引）、构建 LangGraph ReAct Agent、SSE 事件流
- `agent/tools.py` — LangChain 工具（get_current_time / get_today_date / calculate / use_skill）
- `agent/skills.py` — Skill 存储（JSON 持久化）与渐进式披露索引
- `agent/server.py` — FastAPI 服务与静态托管
- `public/` — 前端页面（与 v1 页面独立，Skill 走后端 API）
- `electron/main.js` — 桌面壳：启动后端、读取端口、加载页面

## 本地开发

```bash
# 后端（默认端口 34987，被占用自动换端口，启动后打印 PORT=<n>）
python v2/run_server.py

# 桌面端
cd v2 && npm install && npm run dev
```

## 打包

GitHub Actions 工作流 `.github/workflows/build-v2.yml` 一键构建：

- Windows x64：NSIS 安装包 + 便携版（.exe）
- macOS arm64（Apple 芯片）：.dmg + .zip
- macOS x64（Intel）：.dmg + .zip

发布产物见 GitHub Releases `v2.0.0`（注意：macOS 未签名，首次打开需右键 → 打开）。

## 说明

- 首次使用需在页面里填入自己的 DeepSeek API Key（只保存在本机浏览器，之后无需重复输入）。
- Skill 数据保存在本机用户目录（桌面版）或 `data/`（网页版），不会上传。
