# AI Agent 网站

一个轻量级的 AI 对话网站，默认对接 DeepSeek（OpenAI 兼容接口），模型 `deepseek-v4-pro`。

## 特点

- **轻量本地服务**：运行 `start.bat`（或 `node server.js`）后访问 `http://localhost:3000`，已配置开机自启；也可直接双击 `public/index.html` 纯前端使用，只需本机联网
- 配置页：输入自己的 API Key 后才能进入对话页（Key 不保存、每次打开需重新输入，仅在本次使用中保存在内存）
- 聊天：流式输出（SSE），支持多轮对话
- **思考过程展示**：AI 回复时实时展示「🧠 思考过程」（reasoning_content / reasoning 字段），可折叠查看
- **工具调用链路**：AI 可调用内置工具（当前时间、今天日期、数学计算），页面展示「🔧 工具调用链路」及每个工具的参数与执行结果，最多自动循环 6 轮工具调用后给出最终回答
- **Skill 技能库**：左侧边栏「🧩 Skill」进入 Skill 管理页，可手写或让 AI 生成 Skill，支持启用/停用开关；启用的 Skill 会在对话时自动注入给模型，模型可根据需求按指令使用
- 会话管理：新建对话、删除对话、切换历史对话（数据保存在浏览器 localStorage）
- 模型与 API 地址可配置（默认 `deepseek-v4-pro` / `https://api.deepseek.com`）

## 运行

1. 双击 `start.bat`，或直接打开 `public/index.html`（纯前端模式）
2. 浏览器访问 `http://localhost:3000`（推荐，已配置开机自启）
3. 输入 API Key 后进入对话页即可使用

要求：只需本机联网即可（AI 对话时浏览器需要能访问 `https://api.deepseek.com`）。服务已配置开机自启：`autostart.vbs` 已复制到 Windows 启动文件夹（`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`），重启电脑后会自动运行，无需手动启动；若端口 3000 已被占用，脚本会自动跳过启动。启动日志写入项目目录下的 `autostart.log`。

> 说明：服务同时监听 IPv4 与 IPv6，浏览器访问 `localhost`（可能解析为 IPv6 的 `::1`）或 `127.0.0.1` 均可正常打开。页面本身由本机提供服务，AI 对话时才需要联网访问上游 API；本机回环访问不受 Windows 防火墙影响。

## 打包为桌面软件

本项目可用 Electron 打包成 Windows / macOS 桌面应用，页面全部功能不变：

- **每次打开重新输入 API Key**：Key 只在内存中使用，不写入磁盘
- **对话记录保留**：保存在本机应用数据目录（localStorage），关闭重开仍在
- **自动适配网络**：应用在 `127.0.0.1` 上自起本地服务并自动选端口，任何电脑装上即可用，只有 AI 对话时才需联网

Windows 版（已在当前电脑构建完成，产物在 `dist/`）：

- `AI Agent-Setup-1.0.0-win-x64.exe`：安装版，可自定义安装目录、创建桌面快捷方式
- `AI Agent-Portable-1.0.0-win-x64.exe`：便携版，双击即用，无需安装

重新构建 Windows 版：`npm install && npm run dist:win`

macOS 版（需要在 Mac 上构建，或使用自动构建）：

- 在 Mac 上执行 `npm install && npm run dist:mac`，产物为 dmg / zip
- 或推送到 GitHub 后，在仓库 Actions 页面手动运行 `Build Desktop Apps` 工作流（`workflow_dispatch`），会自动构建 Windows + macOS 两个版本并上传产物

> 分发提示：应用目前未做代码签名。Windows 首次运行若出现 SmartScreen“未知发布者”提示，点「更多信息 → 仍要运行」；macOS 首次打开若被系统拦截，右键点击 App 图标选择「打开」即可。

## 常见问题

- 访问 `http://localhost:3000` 提示“拒绝连接”：说明服务未运行，双击 `start.bat` 启动即可；若开机后仍如此，请确认启动文件夹中存在 `autostart.vbs`，并查看 `autostart.log` 排查
- 局域网内其他设备无法访问：Windows 防火墙默认阻止 Node 入站连接（安全默认值）。如需局域网共享，请在“Windows Defender 防火墙”中手动放行 TCP 3000 端口，并知悉本服务接口不含登录鉴权
- 页面提示“无法连接网络 / Failed to fetch”：请检查本机网络是否正常，或确认 API 地址填写正确
- 上游返回 401/403：说明 API Key 无效或模型名不对，可在设置页修改
- 担心浏览器兼容性：建议使用最新版 Chrome / Edge

## 目录结构

```
public/          # 前端页面（原生 HTML/CSS/JS，唯一必需目录）
server.js        # 本地服务：托管页面 + 健康检查等接口
store.js         # 本地服务配套的数据存储
data/            # 本地服务生成的会话数据
autostart.vbs    # 开机自启脚本（已复制到 Windows 启动文件夹）
start.bat        # 一键启动脚本（检测端口并自动打开浏览器）
electron/        # 桌面应用主进程（Electron 入口）
build/           # 打包资源（应用图标）
dist/            # 打包产物（Windows 安装版 / 便携版）
.github/workflows/  # GitHub Actions 自动构建（Windows + macOS）
```

## 说明

- 无任何第三方依赖，纯浏览器原生 JS（现代浏览器内置 fetch 流式读取）
- API Key 由浏览器直接发送给上游接口，不会写入磁盘
- 会话数据保存在当前浏览器的 localStorage 中
- 修改设置页中的“API 地址”可对接任意 OpenAI 兼容接口