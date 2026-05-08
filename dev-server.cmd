@echo off
setlocal

if /I "%~1"=="local" (
  set SUPABASE_ENFORCE_REMOTE=false
  echo Modo local activado: se permite usar backend\src\data\database.json si Supabase no responde.
)

where npm >nul 2>nul
if %errorlevel%==0 (
  echo Iniciando Generacion de Gloria CRM con npm run dev...
  npm run dev
  goto :eof
)

echo npm no esta disponible en PATH. Iniciando con node directamente...
node backend\src\server.js
