@echo off
cd /d C:\Users\Bruno\Desktop\VIBE\DESIGN_AI

:: Prevenir sleep/idle do Windows enquanto o app roda
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change monitor-timeout-ac 0

echo ============================================
echo  AI PRINT DESIGN - Iniciando...
echo ============================================

echo.
echo [1/2] Compilando o projeto (aguarde)...
call npm run build
if %errorlevel% neq 0 (
    echo ERRO: Build falhou. Verifique os erros acima.
    pause
    exit /b 1
)

echo.
echo [2/2] Build concluido. Iniciando servidor na porta 3030...
echo.

:: Inicia o servidor em uma janela separada que permanece aberta
start "AI PRINT DESIGN - Servidor" cmd /k "cd /d C:\Users\Bruno\Desktop\VIBE\DESIGN_AI && npm run start -- -p 3030"

:: Aguarda 4 segundos para o servidor subir antes de abrir o browser
echo Aguardando servidor iniciar...
timeout /t 4 /nobreak > nul

:: Abre o browser
start http://localhost:3030

echo.
echo Servidor rodando em http://localhost:3030
echo Feche a janela "AI PRINT DESIGN - Servidor" para encerrar.
echo.

:: Restaurar configuracoes de energia ao fechar este BAT
:: (o servidor continua rodando na outra janela)
powercfg /change standby-timeout-ac 30
powercfg /change standby-timeout-dc 15
powercfg /change monitor-timeout-ac 10

:: Manter esta janela aberta brevemente para o usuario ver o status
timeout /t 3 /nobreak > nul
