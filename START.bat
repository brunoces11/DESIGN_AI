@echo off
cd /d C:\Users\Bruno\Desktop\VIBE\DESIGN_AI

:: Prevenir sleep/idle do Windows enquanto o app roda
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /change monitor-timeout-ac 0

echo Compilando o projeto...
call npm run build

echo Build concluido. Iniciando o servidor na porta 3030...
start http://localhost:3030
npm run start -- -p 3030

:: Restaurar configuracoes padrao ao fechar
powercfg /change standby-timeout-ac 30
powercfg /change standby-timeout-dc 15
powercfg /change monitor-timeout-ac 10
