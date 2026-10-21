@echo off
cd /d %~dp0
node dist\src\main.js > ..\backend-boot.log 2> ..\backend-boot-err.log
echo EXIT_%ERRORLEVEL% >> ..\backend-exit.log
date /t >> ..\backend-exit.log
time /t >> ..\backend-exit.log
