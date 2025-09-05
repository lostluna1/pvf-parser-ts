@echo off
setlocal enabledelayedexpansion
title ALS File Binary/Text Diff Helper

:: ===================== 输入与校验 =====================
if "%~1"=="" (
  set /p F1=输入第一个文件路径(File1): 
) else (
  set "F1=%~1"
)
if "%~2"=="" (
  set /p F2=输入第二个文件路径(File2): 
) else (
  set "F2=%~2"
)

if not exist "%F1%" (echo [ERR] 文件不存在: %F1% & exit /b 1)
if not exist "%F2%" (echo [ERR] 文件不存在: %F2% & exit /b 1)

echo [INFO] File1: "%F1%"
echo [INFO] File2: "%F2%"
echo.

:: ===================== 基本信息 =====================
for %%A in ("%F1%") do set SZ1=%%~zA
for %%B in ("%F2%") do set SZ2=%%~zB
echo [SIZE] %SZ1% bytes  | echo [SIZE] %SZ2% bytes

:: ===================== 哈希 (MD5 / SHA1) =====================
echo [HASH] 计算 MD5 / SHA1 ...
for %%H in (MD5 SHA1) do (
  for /f "skip=1 tokens=1,2" %%a in ('certutil -hashfile "%F1%" %%H') do if /i not "%%a"=="CertUtil:" if /i not "%%a"=="哈希" if /i not "%%a"=="Hash" if not "%%a"=="%" set H1_%%H=%%a
  for /f "skip=1 tokens=1,2" %%a in ('certutil -hashfile "%F2%" %%H') do if /i not "%%a"=="CertUtil:" if /i not "%%a"=="哈希" if /i not "%%a"=="Hash" if not "%%a"=="%" set H2_%%H=%%a
)
echo [MD5]  %H1_MD5%  |  %H2_MD5%
echo [SHA1] %H1_SHA1% |  %H2_SHA1%
echo.

:: ===================== BOM 检测 =====================
call :DetectBOM "%F1%" BOM1
call :DetectBOM "%F2%" BOM2
echo [BOM ] File1=%BOM1%  File2=%BOM2%
echo.

:: ===================== 换行统计 (CRLF / LF) =====================
echo [EOL ] 统计换行(调用 PowerShell)...
for /f "usebackq tokens=1,2,3 delims=," %%a in (`
  powershell -NoProfile -Command ^
    "$b=[IO.File]::ReadAllBytes('%F1%'); ^
     $crlf=0; for($i=0;$i -lt $b.Length-1;$i++){ if($b[$i]-eq 13 -and $b[$i+1]-eq 10){$crlf++} } ^
     $lf=0;  for($i=0;$i -lt $b.Length; $i++){ if($b[$i]-eq 10 -and ($i -eq 0 -or $b[$i-1]-ne 13)){ $lf++ } } ^
     Write-Host ($crlf, $lf, $b.Length -join ',')"`) do (
  set F1_CRLF=%%a
  set F1_LF=%%b
)
for /f "usebackq tokens=1,2,3 delims=," %%a in (`
  powershell -NoProfile -Command ^
    "$b=[IO.File]::ReadAllBytes('%F2%'); ^
     $crlf=0; for($i=0;$i -lt $b.Length-1;$i++){ if($b[$i]-eq 13 -and $b[$i+1]-eq 10){$crlf++} } ^
     $lf=0;  for($i=0;$i -lt $b.Length; $i++){ if($b[$i]-eq 10 -and ($i -eq 0 -or $b[$i-1]-ne 13)){ $lf++ } } ^
     Write-Host ($crlf, $lf, $b.Length -join ',')"`) do (
  set F2_CRLF=%%a
  set F2_LF=%%b
)
echo [EOL ] File1: CRLF=%F1_CRLF%  LF(孤立)=%F1_LF%
echo [EOL ] File2: CRLF=%F2_CRLF%  LF(孤立)=%F2_LF%
echo.

:: ===================== 快速是否完全一致 =====================
if /i "%H1_MD5%"=="%H2_MD5%" (
  echo [RESULT] 哈希一致，文件内容完全相同（无须继续差异字节分析）。
  goto :EOF
)

echo [RESULT] 哈希不同，继续字节差异分析...
echo.

:: ===================== 字节差异 (前 20 处) =====================
set DIFFTMP=%temp%\__als_diff_%random%.tmp
fc /b "%F1%" "%F2%" > "%DIFFTMP%" 2>nul

echo [DIFF] 前 20 条原始 fc /b 差异行:
set /a COUNT=0
for /f "usebackq delims=" %%L in (`findstr /R "^[0-9A-F][0-9A-F]*:" "%DIFFTMP%"`) do (
  if !COUNT! lss 20 (
    echo   %%L
    if !COUNT!==0 for /f "tokens=1 delims=:" %%O in ("%%L") do set FIRST_OFFSET=%%O
    set /a COUNT+=1
  )
)
if not defined FIRST_OFFSET (
  echo [WARN] 未能解析差异（可能是本地化输出格式变化），请直接打开 "%DIFFTMP%".
  goto :HexWindow
)

:: ===================== 首个差异窗口 (±16 字节) =====================
:HexWindow
if defined FIRST_OFFSET (
  set /a OFF_DEC=0x%FIRST_OFFSET%
  set /a START=OFF_DEC-16
  if !START! lss 0 set START=0
  set /a LEN=32
  echo.
  echo [WINDOW] 首个差异偏移: 0x%FIRST_OFFSET% (十进制 !OFF_DEC!)
  echo [WINDOW] 显示从十进制 !START! 起 32 字节 (不足处自动截断)
  echo.
  echo --- File1 ---
  powershell -NoProfile -Command ^
    "$b=[IO.File]::ReadAllBytes('%F1%'); ^
     $s=%START%; $len=%LEN%; if($s+$len -gt $b.Length){$len=$b.Length-$s}; ^
     ($b[$s..($s+$len-1)] | ForEach-Object { $_.ToString('X2') }) -join ' '"
  echo --- File2 ---
  powershell -NoProfile -Command ^
    "$b=[IO.File]::ReadAllBytes('%F2%'); ^
     $s=%START%; $len=%LEN%; if($s+$len -gt $b.Length){$len=$b.Length-$s}; ^
     ($b[$s..($s+$len-1)] | ForEach-Object { $_.ToString('X2') }) -join ' '"
)

echo.
choice /c YN /n /m "[OPT] 生成完整十六进制转储? (Y/N): "
if errorlevel 2 goto :Cleanup

set HEX1=%temp%\__als_hex1_%random%.txt
set HEX2=%temp%\__als_hex2_%random%.txt
echo [HEX] 生成中...
powershell -NoProfile -Command ^
  "[IO.File]::ReadAllBytes('%F1%') | ForEach-Object { $_.ToString('X2') } | Set-Content '%HEX1%'"
powershell -NoProfile -Command ^
  "[IO.File]::ReadAllBytes('%F2%') | ForEach-Object { $_.ToString('X2') } | Set-Content '%HEX2%'"
echo [HEX] 已保存:
echo   %HEX1%
echo   %HEX2%
echo 使用 WinMerge / diff 工具按行比较可视化差异。
echo.

:Cleanup
if exist "%DIFFTMP%" del "%DIFFTMP%" >nul 2>nul
echo [DONE]
exit /b 0

:: ===================== 子过程：BOM 检测 =====================
:DetectBOM
set "FILE=%~1"
set "RETVAR=%~2"
setlocal
for /f "skip=1 tokens=1,2" %%a in ('certutil -dump "%FILE%" ^| findstr /R /C:"^0000"') do (
  set LINE=%%a %%b
)
:: LINE 形如: 0000  EF BB BF 2D ...
:: 提取前三个字节
set B1=
set B2=
set B3=
for /f "tokens=2,3,4" %%x in ("!LINE!") do (
  set B1=%%x
  set B2=%%y
  set B3=%%z
)
set B1=!B1:~0,2!
set B2=!B2:~0,2!
set B3=!B3:~0,2!
set BOM=None
if /i "!B1!!B2!!B3!"=="EFBBBF" set BOM=UTF-8
if /i "!B1!!B2!"=="FFFE" set BOM=UTF-16-LE
if /i "!B1!!B2!"=="FEFF" set BOM=UTF-16-BE
(
  endlocal
  set "%RETVAR%=%BOM%"
)
goto :eof