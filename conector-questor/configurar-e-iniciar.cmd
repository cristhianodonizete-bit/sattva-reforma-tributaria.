@echo off
setlocal
where node >nul 2>nul || (echo Node.js 22 ou superior nao foi encontrado.& echo Instale o Node.js e execute este arquivo novamente.& pause & exit /b 1)
if exist "%~dp0config.json" (
  echo Este conector ja esta pareado nesta pasta.
  choice /c SN /n /m "Deseja substituir o pareamento salvo"
  if errorlevel 2 (
    echo Nenhuma credencial foi alterada. Use iniciar-conector.cmd para iniciar.
    pause
    exit /b 0
  )
)
echo === Conector Sattva - Questor ===
set /p SATTVA_URL=Endereco do Sattva [https://sattva-reforma-tributaria.onrender.com]: 
if "%SATTVA_URL%"=="" set SATTVA_URL=https://sattva-reforma-tributaria.onrender.com
set /p CONNECTOR_ID=Identificador do conector: 
set /p CONNECTOR_SECRET=Segredo de pareamento: 
set /p TOKEN_API=TokenApi do nWeb: 
powershell -NoProfile -Command "$c=@{sattvaUrl='%SATTVA_URL%';connectorId='%CONNECTOR_ID%';connectorSecret='%CONNECTOR_SECRET%';nwebUrl='http://127.0.0.1:8080';tokenApi='%TOKEN_API%'} | ConvertTo-Json; Set-Content -LiteralPath '%~dp0config.json' -Value $c -Encoding UTF8"
echo Configuracao salva nesta maquina. Iniciando o conector...
node "%~dp0index.js"
pause
