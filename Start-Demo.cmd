@echo off
setlocal
cd /d "%~dp0"
call npm run demo
if errorlevel 1 pause
