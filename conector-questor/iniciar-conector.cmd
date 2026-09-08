@echo off
setlocal
if not exist "%~dp0config.json" (
  echo O conector ainda nao foi configurado nesta pasta.
  echo Execute configurar-e-iniciar.cmd uma unica vez.
  pause
  exit /b 1
)
where node >nul 2>nul || (echo Node.js 22 ou superior nao foi encontrado.& pause & exit /b 1)
node "%~dp0index.js"
pause
