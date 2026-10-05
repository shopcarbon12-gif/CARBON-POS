@echo off
title Carbon Print Agent
cd /d "%~dp0"
:loop
node carbon-print-agent.mjs
echo Agent stopped - restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
