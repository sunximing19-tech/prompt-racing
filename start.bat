@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 检查 3000 端口是否已有服务在运行
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo 服务已在运行，直接打开页面...
) else (
  echo 正在启动 AI Agent 服务...
  start "AI Agent Server" /min cmd /c "node server.js"
  timeout /t 2 /nobreak >nul
)

start "" "http://localhost:3000"
exit
