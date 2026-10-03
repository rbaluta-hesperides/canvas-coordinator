@echo off
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe call npm.cmd install
call npm.cmd start
