@echo off
chcp 65001 > nul
title CrystalDiskInfo 디스크 관리대장 변환기

echo ========================================================
echo   CrystalDiskInfo 사진 -^> 디스크 관리대장 변환기
echo ========================================================
echo.
echo [1/2] 서버를 실행하고 있습니다...

:: Open browser in 2 seconds
start "" cmd /c "timeout /t 2 /nobreak > nul & start http://localhost:3000"

:: Start Node server
node server.js

pause

