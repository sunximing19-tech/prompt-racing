const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// 无 GPU / 远程桌面环境下避免 GPU 进程崩溃（Electron 37 已知问题）
app.disableHardwareAcceleration();

const DEFAULT_PORT = 34987;
const STARTUP_TIMEOUT_MS = 180000;

let mainWindow = null;
let backend = null;
let backendPort = null;

// 找到后端可执行文件（打包后是 PyInstaller 单文件；开发时用系统 Python）
function resolveBackend() {
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'ai-agent-server.exe' : 'ai-agent-server';
    const bin = path.join(process.resourcesPath, 'server-bin', exe);
    if (fs.existsSync(bin)) return { command: bin, args: [] };
    return null;
  }
  const python = process.env.AI_AGENT_PYTHON || 'python';
  const script = path.join(__dirname, '..', 'run_server.py');
  return { command: python, args: [script] };
}

function startBackend() {
  return new Promise((resolve, reject) => {
    const resolved = resolveBackend();
    if (!resolved) {
      reject(new Error('未找到内置的 AI Agent 后端程序（server-bin）。'));
      return;
    }
    const env = { ...process.env, AI_AGENT_DATA_DIR: app.getPath('userData') };
    const child = spawn(resolved.command, resolved.args, { env, windowsHide: true });
    backend = child;

    let port = null;
    let stderrBuf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('后端启动超时（180 秒）。' + (stderrBuf ? '\n' + stderrBuf.slice(-500) : '')));
    }, STARTUP_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      const m = text.match(/PORT=(\d+)/);
      if (m && !port) {
        port = parseInt(m[1], 10);
        clearTimeout(timer);
        resolve(port);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderrBuf += chunk.toString();
    });
    child.on('exit', (code) => {
      if (!port && backend === child) {
        clearTimeout(timer);
        reject(new Error('后端进程已退出（code=' + code + '）。' + (stderrBuf ? '\n' + stderrBuf.slice(-500) : '')));
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#0f1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://127.0.0.1:${backendPort}/`);
  mainWindow.on('closed', () => { mainWindow = null; });
}

function shutdownBackend() {
  if (backend) {
    try { backend.kill(); } catch { /* ignore */ }
    backend = null;
  }
}

app.whenReady().then(async () => {
    app.setAppUserModelId('com.aiagent.desktop.v2');
    try {
      backendPort = await startBackend();
      createWindow();
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    } catch (err) {
      dialog.showErrorBox('AI Agent 启动失败', String(err && err.message || err));
      app.quit();
    }
  });
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  shutdownBackend();
});
