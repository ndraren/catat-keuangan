@echo off
title Personal Expense Tracker - CatatKeuangan
echo ===================================================
echo     Personal Expense Tracker (CatatKeuangan)
echo ===================================================
echo Menjalankan server aplikasi di http://localhost:3000 ...
echo Tekan Ctrl+C di jendela ini untuk menghentikan server.
echo.

python server.py
if %errorlevel% neq 0 (
    "C:\Users\ASUS\AppData\Local\Programs\Python\Python311\python.exe" server.py
)
pause
