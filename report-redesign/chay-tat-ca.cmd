@echo off
REM Chay het Exterior roi Interior, ghi log ra ket-qua\chay.log
REM
REM Chay bang cach nhay doi file nay, hoac:
REM     chay-tat-ca.cmd
REM
REM Tien trinh nay KHONG phu thuoc phien Claude Code hay cua so terminal nao — dung
REM start-tach-roi.ps1 de no song tiep ca khi dong terminal.
REM
REM Dung giua chung thoai mai: ket qua ghi vao bao-cao.json sau MOI anh, chay lai
REM se tu bo qua phan da xong.

cd /d "%~dp0"

echo [%date% %time%] === BAT DAU EXTERIOR === >> ket-qua\chay.log
node chay-to-hop.js --space Exterior --tat-ca --cho-cum-phut 120 --thu-lai 3 --nguong-ngat 8 >> ket-qua\chay.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] === EXTERIOR DUNG SOM, KHONG SANG INTERIOR === >> ket-qua\chay.log
  exit /b 1
)

echo [%date% %time%] === EXTERIOR XONG -^> INTERIOR === >> ket-qua\chay.log
node chay-to-hop.js --space Interior --tat-ca --cho-cum-phut 120 --thu-lai 3 --nguong-ngat 8 >> ket-qua\chay.log 2>&1
if errorlevel 1 (
  echo [%date% %time%] === INTERIOR DUNG SOM === >> ket-qua\chay.log
  exit /b 1
)

echo [%date% %time%] === XONG CA HAI NHOM === >> ket-qua\chay.log
