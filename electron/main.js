const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_PORT = 34987; // 固定端口 => localStorage（对话记录）origin 稳定，重启后保留；被占用时自动换随机端口
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// 在 127.0.0.1 上提供静态站点（仅本机可访问，自动适配任意电脑的网络环境）
function createStaticServer() {
  return new Promise((resolve, reject) => {
    const handler = (req, res) => {
      try {
        const url = new URL(req.url, 'http://127.0.0.1');
        let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
        if (!filePath.startsWith(PUBLIC_DIR)) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404); res.end('Not Found'); return;
          }
          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
          res.end(data);
        });
      } catch (e) {
        res.writeHead(500); res.end('Error');
      }
    };

    const tryListen = (port) => {
      const server = http.createServer(handler);
      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && port !== 0) {
          tryListen(0); // 固定端口被占用 => 退回随机端口
          return;
        }
        reject(err);
      });
      server.listen(port, '127.0.0.1', () => resolve(server));
    };
    tryListen(DEFAULT_PORT);
  });
}

let mainWindow = null;
let staticServer = null;

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

  // 外部链接交给系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const port = staticServer.address().port;
  mainWindow.loadURL(`http://127.0.0.1:${port}/`);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// 单实例：重复打开时聚焦已有窗口，避免起多个服务
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.aiagent.desktop');
    staticServer = await createStaticServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (staticServer) staticServer.close();
});