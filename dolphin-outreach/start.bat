@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo Установи Node.js 22+ с https://nodejs.org & pause & exit /b 1)
start "" http://localhost:4747
node src\server.js
pause
