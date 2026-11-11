@echo off
title Push ke GitHub - Catat Keuangan
cd /d "%~dp0"

echo =======================================================
echo   MENGIRIM KODE KE GITHUB REPOSITORY (ndraren/catat-keuangan)
echo =======================================================
echo.

git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/ndraren/catat-keuangan.git

echo Mengunggah file ke GitHub...
git push -u origin main

echo.
if %ERRORLEVEL% equ 0 (
    echo =======================================================
    echo  BERHASIL! Kode proyek Anda sudah masuk ke GitHub:
    echo  https://github.com/ndraren/catat-keuangan
    echo =======================================================
) else (
    echo [!] Jika gagal, pastikan Anda sudah membuat repository 
    echo     bernama 'catat-keuangan' di https://github.com/new
)

echo.
pause
