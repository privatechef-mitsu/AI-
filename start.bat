@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.jsが見つかりません。スタートガイドの「最初の準備」を確認してください。
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4173"
node server.js
pause
